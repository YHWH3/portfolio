import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_workspace, require_role
from app.database import get_db
from app.models import (
    Campaign,
    DailyMetric,
    Lead,
    ObjectionHandler,
    SendingAccount,
    SequenceStep,
)
from app.schemas import (
    CampaignCreate,
    CampaignDetailOut,
    CampaignOut,
    CampaignUpdate,
    ObjectionHandlerCreate,
    ObjectionHandlerOut,
    ObjectionHandlerUpdate,
    Paginated,
    SequenceStepCreate,
    SequenceStepOut,
    SequenceStepUpdate,
    StepReorderRequest,
    SuccessResponse,
)
from app.services.analytics import compute_campaign_metrics

router = APIRouter(prefix="/campaigns", tags=["campaigns"])


async def _get_campaign(campaign_id: uuid.UUID, workspace, db: AsyncSession, *, with_children: bool = False) -> Campaign:
    stmt = select(Campaign).where(Campaign.id == campaign_id, Campaign.workspace_id == workspace.id)
    if with_children:
        stmt = stmt.options(selectinload(Campaign.steps), selectinload(Campaign.objection_handlers))
    campaign = (await db.execute(stmt)).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return campaign


@router.get("", response_model=Paginated)
async def list_campaigns(
    status_filter: str | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    base = select(Campaign).where(Campaign.workspace_id == workspace.id)
    if status_filter:
        base = base.where(Campaign.status == status_filter)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(Campaign.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Paginated(
        items=[CampaignOut.model_validate(c).model_dump(mode="json") for c in rows],
        total=total, page=page, page_size=page_size,
    )


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = Campaign(
        workspace_id=workspace.id,
        name=payload.name,
        objective=payload.objective,
        persona_id=payload.persona_id,
        tone_profile_id=payload.tone_profile_id,
        target_audience=payload.target_audience,
        cta_type=payload.cta_type,
        cta_value=payload.cta_value,
        daily_send_limit=payload.daily_send_limit,
        safety_settings=payload.safety_settings,
    )
    if payload.schedule_config is not None:
        campaign.schedule_config = payload.schedule_config.model_dump()
    db.add(campaign)
    await db.commit()
    return campaign


@router.get("/{campaign_id}", response_model=CampaignDetailOut)
async def get_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return await _get_campaign(campaign_id, workspace, db, with_children=True)


@router.put("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: uuid.UUID,
    payload: CampaignUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    data = payload.model_dump(exclude_unset=True)
    if "schedule_config" in data and data["schedule_config"] is not None:
        data["schedule_config"] = payload.schedule_config.model_dump()
    for field, value in data.items():
        setattr(campaign, field, value)
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return campaign


@router.delete("/{campaign_id}", response_model=SuccessResponse)
async def archive_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    campaign.status = "archived"
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return SuccessResponse(detail="Campaign archived.")


@router.post("/{campaign_id}/duplicate", response_model=CampaignDetailOut, status_code=status.HTTP_201_CREATED)
async def duplicate_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    source = await _get_campaign(campaign_id, workspace, db, with_children=True)
    clone = Campaign(
        workspace_id=workspace.id,
        name=f"{source.name} (copy)",
        objective=source.objective,
        status="draft",
        persona_id=source.persona_id,
        tone_profile_id=source.tone_profile_id,
        target_audience=source.target_audience,
        cta_type=source.cta_type,
        cta_value=source.cta_value,
        schedule_config=source.schedule_config,
        daily_send_limit=source.daily_send_limit,
        safety_settings=source.safety_settings,
    )
    db.add(clone)
    await db.flush()
    for step in source.steps:
        db.add(SequenceStep(
            campaign_id=clone.id, step_order=step.step_order, step_type=step.step_type,
            message_template=step.message_template, delay_days=step.delay_days, condition_logic=step.condition_logic,
        ))
    for handler in source.objection_handlers:
        db.add(ObjectionHandler(
            campaign_id=clone.id, trigger_phrases=handler.trigger_phrases,
            response_template=handler.response_template, priority=handler.priority,
        ))
    await db.commit()
    return await _get_campaign(clone.id, workspace, db, with_children=True)


@router.post("/{campaign_id}/activate", response_model=CampaignOut)
async def activate_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db, with_children=True)
    if campaign.status not in ("draft", "ready", "paused"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot activate a {campaign.status} campaign")

    problems: list[str] = []
    if not campaign.steps:
        problems.append("At least one sequence step is required.")
    lead_count = (await db.execute(
        select(func.count()).select_from(Lead).where(Lead.campaign_id == campaign.id)
    )).scalar_one()
    if lead_count == 0:
        problems.append("At least one lead must be assigned to the campaign.")
    if campaign.persona_id is None and campaign.tone_profile_id is None:
        problems.append("Select a persona or a tone profile.")
    if campaign.cta_type is not None and not campaign.cta_value:
        problems.append("CTA value is required when a CTA type is set.")
    active_account = (await db.execute(
        select(SendingAccount).where(SendingAccount.workspace_id == workspace.id, SendingAccount.status == "active").limit(1)
    )).scalar_one_or_none()
    if active_account is None:
        problems.append("An active sending account is required.")
    if problems:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=" ".join(problems))

    campaign.status = "running"
    campaign.started_at = campaign.started_at or datetime.utcnow()
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return campaign


@router.post("/{campaign_id}/pause", response_model=CampaignOut)
async def pause_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    if campaign.status != "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only running campaigns can be paused")
    campaign.status = "paused"
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return campaign


@router.post("/{campaign_id}/resume", response_model=CampaignOut)
async def resume_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    if campaign.status != "paused":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only paused campaigns can be resumed")
    campaign.status = "running"
    campaign.updated_at = datetime.utcnow()
    await db.commit()
    return campaign


@router.get("/{campaign_id}/performance")
async def campaign_performance(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    return await compute_campaign_metrics(db, campaign)


# ---- Sequence steps ----

@router.post("/{campaign_id}/steps", response_model=SequenceStepOut, status_code=status.HTTP_201_CREATED)
async def add_step(
    campaign_id: uuid.UUID,
    payload: SequenceStepCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    step = SequenceStep(campaign_id=campaign.id, **payload.model_dump())
    db.add(step)
    await db.commit()
    return step


@router.put("/{campaign_id}/steps/reorder", response_model=list[SequenceStepOut])
async def reorder_steps(
    campaign_id: uuid.UUID,
    payload: StepReorderRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db, with_children=True)
    by_id = {step.id: step for step in campaign.steps}
    if set(payload.step_ids) != set(by_id.keys()):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="step_ids must contain exactly the campaign's steps")
    for order, step_id in enumerate(payload.step_ids, start=1):
        by_id[step_id].step_order = order
    await db.commit()
    return sorted(by_id.values(), key=lambda s: s.step_order)


@router.put("/{campaign_id}/steps/{step_id}", response_model=SequenceStepOut)
async def update_step(
    campaign_id: uuid.UUID,
    step_id: uuid.UUID,
    payload: SequenceStepUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    await _get_campaign(campaign_id, workspace, db)
    step = (await db.execute(
        select(SequenceStep).where(SequenceStep.id == step_id, SequenceStep.campaign_id == campaign_id)
    )).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(step, field, value)
    await db.commit()
    return step


@router.delete("/{campaign_id}/steps/{step_id}", response_model=SuccessResponse)
async def delete_step(
    campaign_id: uuid.UUID,
    step_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    await _get_campaign(campaign_id, workspace, db)
    step = (await db.execute(
        select(SequenceStep).where(SequenceStep.id == step_id, SequenceStep.campaign_id == campaign_id)
    )).scalar_one_or_none()
    if step is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    await db.delete(step)
    await db.commit()
    return SuccessResponse(detail="Step removed.")


# ---- Objection handlers ----

@router.post("/{campaign_id}/objections", response_model=ObjectionHandlerOut, status_code=status.HTTP_201_CREATED)
async def add_objection(
    campaign_id: uuid.UUID,
    payload: ObjectionHandlerCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = await _get_campaign(campaign_id, workspace, db)
    handler = ObjectionHandler(campaign_id=campaign.id, **payload.model_dump())
    db.add(handler)
    await db.commit()
    return handler


@router.put("/{campaign_id}/objections/{objection_id}", response_model=ObjectionHandlerOut)
async def update_objection(
    campaign_id: uuid.UUID,
    objection_id: uuid.UUID,
    payload: ObjectionHandlerUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    await _get_campaign(campaign_id, workspace, db)
    handler = (await db.execute(
        select(ObjectionHandler).where(ObjectionHandler.id == objection_id, ObjectionHandler.campaign_id == campaign_id)
    )).scalar_one_or_none()
    if handler is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Objection handler not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(handler, field, value)
    await db.commit()
    return handler


@router.delete("/{campaign_id}/objections/{objection_id}", response_model=SuccessResponse)
async def delete_objection(
    campaign_id: uuid.UUID,
    objection_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    await _get_campaign(campaign_id, workspace, db)
    handler = (await db.execute(
        select(ObjectionHandler).where(ObjectionHandler.id == objection_id, ObjectionHandler.campaign_id == campaign_id)
    )).scalar_one_or_none()
    if handler is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Objection handler not found")
    await db.delete(handler)
    await db.commit()
    return SuccessResponse(detail="Objection handler removed.")
