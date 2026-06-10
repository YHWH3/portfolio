import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import Campaign, DraftQueueItem, Lead, SequenceStep, User
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
