import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import (
    Campaign,
    Conversation,
    DraftQueueItem,
    Lead,
    Message,
    SafetyLog,
    SendingAccount,
    SequenceStep,
    User,
    Workspace,
)
from app.schemas import (
    BulkApproveRequest,
    DraftGenerateRequest,
    DraftOut,
    DraftStats,
    DraftUpdate,
    LeadBrief,
    Paginated,
    SuccessResponse,
)
from app.services import metrics

router = APIRouter(prefix="/drafts", tags=["drafts"])


def _to_out(draft: DraftQueueItem) -> dict:
    lead = draft.lead
    return DraftOut(
        id=draft.id,
        campaign_id=draft.campaign_id,
        lead_id=draft.lead_id,
        sequence_step_id=draft.sequence_step_id,
        lead=LeadBrief.model_validate(lead, from_attributes=True) if lead else None,
        step_type=draft.sequence_step.step_type if draft.sequence_step else None,
        ai_draft=draft.ai_draft,
        human_edit=draft.human_edit,
        personalization_hooks=draft.personalization_hooks or {},
        status=draft.status,
        scheduled_for=draft.scheduled_for,
        approved_at=draft.approved_at,
        sent_at=draft.sent_at,
        created_at=draft.created_at,
    ).model_dump(mode="json")


async def _get_draft(draft_id: uuid.UUID, workspace, db: AsyncSession) -> DraftQueueItem:
    draft = (await db.execute(
        select(DraftQueueItem)
        .join(Campaign, Campaign.id == DraftQueueItem.campaign_id)
        .where(DraftQueueItem.id == draft_id, Campaign.workspace_id == workspace.id)
        .options(selectinload(DraftQueueItem.lead), selectinload(DraftQueueItem.sequence_step))
    )).scalar_one_or_none()
    if draft is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Draft not found")
    return draft


def _approve(draft: DraftQueueItem, user: User) -> bool:
    """Marks a draft approved; returns True if it was human-edited."""
    edited = bool(draft.human_edit) and draft.human_edit.strip() != draft.ai_draft.strip()
    draft.status = "edited_and_approved" if edited else "approved"
    draft.approved_at = datetime.utcnow()
    draft.approved_by = user.id
    draft.updated_at = datetime.utcnow()
    return edited


async def _record_external_send(db: AsyncSession, draft: DraftQueueItem, workspace, action_type: str) -> None:
    """Bookkeeping for a message delivered outside the app (e.g. by the local
    LinkedIn browser agent): mark sent, log the send against the sending
    account, open/append the conversation, advance the lead, bump metrics.
    Mirrors the in-app dispatcher so analytics and safety stay consistent."""
    content = draft.human_edit or draft.ai_draft
    draft.status = "sent"
    draft.sent_at = datetime.utcnow()
    draft.updated_at = datetime.utcnow()

    account = (await db.execute(
        select(SendingAccount).where(
            SendingAccount.workspace_id == workspace.id, SendingAccount.status == "active"
        ).order_by(SendingAccount.created_at).limit(1)
    )).scalar_one_or_none()
    if account is not None:
        account.sends_today += 1
        account.sends_this_week += 1
        if action_type == "connection_request":
            account.connections_this_week += 1
        db.add(SafetyLog(
            account_id=account.id,
            action_type=action_type,
            details={"draft_id": str(draft.id), "delivered_via": "browser_agent"},
            daily_count_at_time=account.sends_today,
            weekly_count_at_time=account.sends_this_week,
        ))

    conversation = (await db.execute(
        select(Conversation).where(
            Conversation.campaign_id == draft.campaign_id, Conversation.lead_id == draft.lead_id
        ).limit(1)
    )).scalar_one_or_none()
    if conversation is None:
        conversation = Conversation(campaign_id=draft.campaign_id, lead_id=draft.lead_id)
        db.add(conversation)
        await db.flush()
    db.add(Message(conversation_id=conversation.id, sender_type="user", content=content))
    conversation.last_message_at = datetime.utcnow()

    lead = draft.lead
    if lead is not None and lead.status in ("new", "queued"):
        lead.status = "contacted"
    workspace_row = await db.get(Workspace, workspace.id)
    if workspace_row is not None:
        workspace_row.current_month_usage += 1
    await metrics.bump_metric(db, draft.campaign_id, "messages_sent")
    await metrics.record_event(db, draft.campaign_id, "message_sent", {"draft_id": str(draft.id), "action_type": action_type, "via": "browser_agent"})


@router.post("/generate")
async def generate_drafts(
    payload: DraftGenerateRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = (await db.execute(
        select(Campaign).where(Campaign.id == payload.campaign_id, Campaign.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    step_count = (await db.execute(
        select(func.count()).select_from(SequenceStep).where(SequenceStep.campaign_id == campaign.id)
    )).scalar_one()
    if step_count == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Campaign has no sequence steps")
    pending = (await db.execute(
        select(func.count()).select_from(Lead).where(
            Lead.campaign_id == campaign.id,
            Lead.status.in_(["new", "queued"]),
            Lead.id.not_in(select(DraftQueueItem.lead_id).where(DraftQueueItem.campaign_id == campaign.id)),
        )
    )).scalar_one()
    from app.tasks import generate_drafts_task

    generate_drafts_task.delay(str(campaign.id))
    return {"queued": pending}


@router.get("", response_model=Paginated)
async def list_drafts(
    campaign_id: uuid.UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    base = (
        select(DraftQueueItem)
        .join(Campaign, Campaign.id == DraftQueueItem.campaign_id)
        .where(Campaign.workspace_id == workspace.id)
    )
    if campaign_id is not None:
        base = base.where(DraftQueueItem.campaign_id == campaign_id)
    if status_filter:
        base = base.where(DraftQueueItem.status == status_filter)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    drafts = (await db.execute(
        base.options(selectinload(DraftQueueItem.lead), selectinload(DraftQueueItem.sequence_step))
        .order_by(DraftQueueItem.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )).scalars().all()
    return Paginated(items=[_to_out(d) for d in drafts], total=total, page=page, page_size=page_size)


@router.get("/stats", response_model=DraftStats)
async def draft_stats(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    base = select(DraftQueueItem.status, func.count()).join(Campaign, Campaign.id == DraftQueueItem.campaign_id).where(
        Campaign.workspace_id == workspace.id
    ).group_by(DraftQueueItem.status)
    counts = dict((await db.execute(base)).all())
    sent_today = (await db.execute(
        select(func.count())
        .select_from(DraftQueueItem)
        .join(Campaign, Campaign.id == DraftQueueItem.campaign_id)
        .where(
            Campaign.workspace_id == workspace.id,
            DraftQueueItem.status == "sent",
            func.date(DraftQueueItem.sent_at) == func.current_date(),
        )
    )).scalar_one()
    return DraftStats(
        pending_review=counts.get("pending_review", 0),
        approved=counts.get("approved", 0) + counts.get("edited_and_approved", 0),
        sent_today=sent_today,
        skipped=counts.get("skipped", 0),
    )


@router.get("/{draft_id}")
async def get_draft(
    draft_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return _to_out(await _get_draft(draft_id, workspace, db))


@router.put("/{draft_id}")
async def update_draft(
    draft_id: uuid.UUID,
    payload: DraftUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status in ("sent", "skipped"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot edit a {draft.status} draft")
    data = payload.model_dump(exclude_unset=True)
    if "human_edit" in data:
        draft.human_edit = data["human_edit"]
    if "scheduled_for" in data and data["scheduled_for"] is not None:
        draft.scheduled_for = data["scheduled_for"].replace(tzinfo=None)
    draft.updated_at = datetime.utcnow()
    await db.commit()
    return _to_out(draft)


@router.post("/{draft_id}/approve")
async def approve_draft(
    draft_id: uuid.UUID,
    user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status not in ("pending_review",):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Draft is already {draft.status}")
    edited = _approve(draft, user)
    await metrics.bump_metric(db, draft.campaign_id, "drafts_approved")
    if edited:
        await metrics.bump_metric(db, draft.campaign_id, "drafts_edited")
    await db.commit()
    return _to_out(draft)


@router.post("/{draft_id}/send-now")
async def send_draft_now(
    draft_id: uuid.UUID,
    user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """The user explicitly pushes one message out immediately: approves it if
    still pending, then dispatches without waiting for the schedule window.
    Soft safety limits still apply at dispatch time."""
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status in ("sent", "skipped", "failed"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Draft is already {draft.status}")
    if draft.status == "pending_review":
        edited = _approve(draft, user)
        await metrics.bump_metric(db, draft.campaign_id, "drafts_approved")
        if edited:
            await metrics.bump_metric(db, draft.campaign_id, "drafts_edited")
    draft.scheduled_for = datetime.utcnow()
    await db.commit()

    from app.tasks import dispatch_draft_task

    dispatch_draft_task.delay(str(draft.id))
    return {**_to_out(draft), "dispatch_queued": True}


def _action_type(draft: DraftQueueItem) -> str:
    step = draft.sequence_step
    return "connection_request" if step and step.step_type == "connection_request" else "message"


@router.get("/agent/queue")
async def agent_queue(
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    """Pull approved drafts for the local LinkedIn browser agent to deliver.
    Only human-approved drafts on running campaigns are returned, each tagged
    with the action the agent should perform and the message text."""
    rows = (await db.execute(
        select(DraftQueueItem)
        .join(Campaign, Campaign.id == DraftQueueItem.campaign_id)
        .where(
            Campaign.workspace_id == workspace.id,
            Campaign.status == "running",
            DraftQueueItem.status.in_(["approved", "edited_and_approved"]),
        )
        .options(selectinload(DraftQueueItem.lead), selectinload(DraftQueueItem.sequence_step))
        .order_by(DraftQueueItem.scheduled_for.nulls_last(), DraftQueueItem.created_at)
        .limit(100)
    )).scalars().all()
    queue = []
    for draft in rows:
        lead = draft.lead
        if lead is None or not lead.linkedin_url:
            continue
        queue.append({
            "draft_id": str(draft.id),
            "action_type": _action_type(draft),
            "linkedin_url": lead.linkedin_url,
            "lead_name": lead.name,
            "content": draft.human_edit or draft.ai_draft,
            "scheduled_for": draft.scheduled_for.isoformat() if draft.scheduled_for else None,
        })
    return {"items": queue, "count": len(queue)}


@router.post("/{draft_id}/mark-sent")
async def mark_sent(
    draft_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """The local browser agent reports that it delivered this approved draft on
    LinkedIn. Records the send so analytics, safety counters and the inbox stay
    in sync. Idempotent: a draft already marked sent returns OK."""
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status == "sent":
        return _to_out(draft)
    if draft.status not in ("approved", "edited_and_approved"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Only approved drafts can be marked sent (this one is {draft.status})",
        )
    await _record_external_send(db, draft, workspace, _action_type(draft))
    await db.commit()
    return _to_out(draft)


@router.post("/{draft_id}/mark-failed")
async def mark_failed(
    draft_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """The local browser agent reports it could not deliver this draft (e.g. the
    person isn't connectable, or a selector/timeout failed). Leaves it visible
    for retry by flipping it back to pending_review."""
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status == "sent":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Draft already sent")
    draft.status = "pending_review"
    draft.updated_at = datetime.utcnow()
    await metrics.record_event(db, draft.campaign_id, "delivery_failed", {"draft_id": str(draft.id), "via": "browser_agent"})
    await db.commit()
    return _to_out(draft)


@router.post("/{draft_id}/skip")
async def skip_draft(
    draft_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    draft = await _get_draft(draft_id, workspace, db)
    if draft.status == "sent":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot skip a sent draft")
    draft.status = "skipped"
    draft.updated_at = datetime.utcnow()
    await db.commit()
    return _to_out(draft)


@router.post("/bulk-approve")
async def bulk_approve(
    payload: BulkApproveRequest,
    user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    approved = 0
    for draft_id in payload.draft_ids:
        try:
            draft = await _get_draft(draft_id, workspace, db)
        except HTTPException:
            continue
        if draft.status != "pending_review":
            continue
        edited = _approve(draft, user)
        await metrics.bump_metric(db, draft.campaign_id, "drafts_approved")
        if edited:
            await metrics.bump_metric(db, draft.campaign_id, "drafts_edited")
        approved += 1
    await db.commit()
    return {"approved": approved}
