import json
import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_workspace, require_role
from app.database import get_db
from app.models import (
    Campaign,
    DailyMetric,
    Lead,
    ObjectionHandler,
    Persona,
    SendingAccount,
    SequenceStep,
    ToneProfile,
)
from app.schemas import (
    CampaignBriefRequest,
    CampaignBriefResponse,
    CampaignCreate,
    CampaignDetailOut,
    CampaignOut,
    CampaignUpdate,
    GeneratedStep,
    ObjectionHandlerCreate,
    ObjectionHandlerOut,
    ObjectionHandlerUpdate,
    Paginated,
    SequenceGenerateRequest,
    SequenceGenerateResponse,
    SequenceStepCreate,
    SequenceStepOut,
    SequenceStepUpdate,
    StepReorderRequest,
    SuccessResponse,
)
from app.services import ai
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


SEQUENCE_GENERATOR_PROMPT = """You design LinkedIn outreach sequences that a human will review and edit.

CAMPAIGN OBJECTIVE: {objective}
TARGET AUDIENCE: {target_audience}
PERSONA APPROACH: {persona}
SENDER'S WRITING STYLE:
{tone_addon}

Produce exactly {num_steps} sequence steps as a JSON array. Each element:
{{"step_order": <1-based int>, "step_type": "connection_request"|"message"|"follow_up", "message_template": "<2-4 sentences>", "delay_days": <int, 0 for the first step>}}

Rules:
- A typical 3-step arc: connection request → follow-up message → value-add message.
- Templates MUST use these smart variables where natural: {{{{first_name}}}}, {{{{company}}}}, {{{{title}}}}, {{{{industry}}}}, {{{{personalization_hook}}}}, {{{{cta_link}}}}.
- Connection requests stay under 280 characters.
- Sound like a real person, not a template. No placeholder brackets like [Company].
Return ONLY the JSON array."""


def goal_phrase(text: str, limit: int = 70) -> str:
    """Turn an objective into a phrase that reads naturally mid-sentence:
    collapse whitespace, cut at a word boundary, lowercase the first letter."""
    clean = re.sub(r"\s+", " ", (text or "").strip()).rstrip(".!,;: ")
    if len(clean) > limit:
        clean = clean[:limit].rsplit(" ", 1)[0].rstrip(".!,;: ")
    return clean[:1].lower() + clean[1:] if clean else "what we discussed"


def _mock_sequence(objective: str, num_steps: int) -> list[dict]:
    goal = goal_phrase(objective)
    steps = [
        {"step_order": 1, "step_type": "connection_request", "delay_days": 0,
         "message_template": "Hi {{first_name}} — {{personalization_hook}} caught my eye. I work with {{title}}s in {{industry}} on " + goal + ". Would be glad to connect."},
        {"step_order": 2, "step_type": "follow_up", "delay_days": 3,
         "message_template": "Thanks for connecting, {{first_name}}. Curious how {{company}} is approaching this right now — we've helped similar teams with " + goal + ". Open to a quick exchange? {{cta_link}}"},
        {"step_order": 3, "step_type": "message", "delay_days": 4,
         "message_template": "{{first_name}}, one thing that's worked well for {{industry}} teams like {{company}}: leading with a concrete win story rather than a pitch. Happy to share the details — grab a slot here if useful: {{cta_link}}"},
        {"step_order": 4, "step_type": "follow_up", "delay_days": 5,
         "message_template": "Floating this back up, {{first_name}} — I know quarters get busy at {{company}}. If " + goal + " is still on your radar, the door's open: {{cta_link}}"},
        {"step_order": 5, "step_type": "follow_up", "delay_days": 7,
         "message_template": "Last note from me, {{first_name}} — if the timing's wrong I'll close the loop here. If it ever makes sense to revisit {{personalization_hook}}, you know where to find me."},
    ]
    return steps[:num_steps]


@router.post("/generate-sequence", response_model=SequenceGenerateResponse)
async def generate_sequence(
    payload: SequenceGenerateRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    persona = await db.get(Persona, payload.persona_id) if payload.persona_id else None
    tone = None
    if payload.tone_profile_id is not None:
        tone = (await db.execute(
            select(ToneProfile).where(ToneProfile.id == payload.tone_profile_id, ToneProfile.workspace_id == workspace.id)
        )).scalar_one_or_none()

    raw = await ai.complete(
        system="You design B2B outreach sequences. Respond only with a valid JSON array.",
        user=SEQUENCE_GENERATOR_PROMPT.format(
            objective=payload.objective,
            target_audience=payload.target_audience or "(not specified)",
            persona=persona.system_prompt_template if persona else "Helpful peer reaching out with relevant value.",
            tone_addon=(tone.system_prompt_addon if tone else None) or "Professional, warm, concise.",
            num_steps=payload.num_steps,
        ),
        max_tokens=1500,
        temperature=0.7,
        mock=lambda: json.dumps(_mock_sequence(payload.objective, payload.num_steps)),
    )
    valid_types = {"connection_request", "message", "follow_up"}
    try:
        parsed = json.loads(ai.extract_json(raw))
        steps = [
            GeneratedStep(
                step_order=i + 1,
                step_type=s["step_type"] if s.get("step_type") in valid_types else "message",
                message_template=str(s["message_template"]),
                delay_days=max(0, int(s.get("delay_days", 0))),
            )
            for i, s in enumerate(parsed)
            if isinstance(s, dict) and s.get("message_template")
        ][: payload.num_steps]
        if not steps:
            raise ValueError("no usable steps")
    except (json.JSONDecodeError, TypeError, ValueError, KeyError):
        steps = [GeneratedStep(**s) for s in _mock_sequence(payload.objective, payload.num_steps)]
    return SequenceGenerateResponse(steps=steps)


BRIEF_PARSER_PROMPT = """A user described an outreach campaign in their own words. Turn it into a complete campaign configuration.

USER'S DESCRIPTION:
\"\"\"{brief}\"\"\"

AVAILABLE PERSONAS (pick the best fit by name):
{persona_list}

Return ONLY a JSON object:
{{
  "name": "<short campaign name, max 6 words>",
  "objective": "<one-sentence campaign objective>",
  "target_audience": "<who is being contacted, or null>",
  "cta_type": "booking_link" | "reply" | "custom",
  "cta_value": "<booking URL if one appears in the description, otherwise a short reply ask>",
  "persona": "<exact persona name from the list>",
  "steps": [
    {{"step_order": 1, "step_type": "connection_request"|"message"|"follow_up", "message_template": "<2-4 sentences>", "delay_days": <int>}},
    ... exactly {num_steps} steps, typical arc: connection request → follow-up → value-add message
  ]
}}

Template rules: use smart variables {{{{first_name}}}}, {{{{company}}}}, {{{{title}}}}, {{{{industry}}}}, {{{{personalization_hook}}}}, {{{{cta_link}}}} where natural; connection requests under 280 chars; sound human, no placeholder brackets."""

PERSONA_KEYWORDS = [
    ("Friendly Advisor", ["friendly", "warm", "relationship", "coach", "advisor", "helpful"]),
    ("Direct Closer", ["direct", "close", "closing", "sales call", "high-ticket", "aggressive", "results"]),
    ("Educational Guide", ["educat", "teach", "course", "webinar", "content", "insight", "learn"]),
    ("Peer Colleague", ["founder", "peer", "startup", "casual", "community", "fellow"]),
]

URL_RE = re.compile(r"https?://\S+")


def _mock_brief(brief: str, num_steps: int, personas: list[Persona]) -> dict:
    lower = brief.lower()
    persona_name = "Professional Consultant"
    for name, keywords in PERSONA_KEYWORDS:
        if any(k in lower for k in keywords):
            persona_name = name
            break
    url_match = URL_RE.search(brief)
    if url_match:
        cta_type, cta_value = "booking_link", url_match.group(0).rstrip(".,)")
    elif any(k in lower for k in ("call", "demo", "meeting", "book")):
        cta_type, cta_value = "reply", "a quick reply to set up a call"
    else:
        cta_type, cta_value = "reply", "a short reply"
    words = [w for w in re.sub(r"[^a-zA-Z0-9 ]", " ", brief).split() if len(w) > 2][:5]
    audience_match = re.search(
        r"(founders?|ceos?|ctos?|cmos?|vps?[a-z ]*|heads? of [a-z]+|directors?[a-z ]*|managers?|recruiters?|owners?)[^.,;]*",
        lower,
    )
    return {
        "name": (" ".join(words).title() or "New Campaign")[:60],
        "objective": brief.strip()[:300],
        "target_audience": audience_match.group(0).strip().capitalize() if audience_match else None,
        "cta_type": cta_type,
        "cta_value": cta_value,
        "persona": persona_name if any(p.name == persona_name for p in personas) else (personas[0].name if personas else None),
        "steps": _mock_sequence(brief.strip()[:120], num_steps),
    }


@router.post("/parse-brief", response_model=CampaignBriefResponse)
async def parse_brief(
    payload: CampaignBriefRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """Conversational campaign creation: the user describes the campaign in
    plain language; AI fills in every field of the wizard for review."""
    personas = (await db.execute(
        select(Persona).where(or_(Persona.workspace_id.is_(None), Persona.workspace_id == workspace.id))
    )).scalars().all()
    default_tone = (await db.execute(
        select(ToneProfile).where(ToneProfile.workspace_id == workspace.id).order_by(ToneProfile.is_default.desc(), ToneProfile.created_at.desc()).limit(1)
    )).scalar_one_or_none()

    raw = await ai.complete(
        system="You turn campaign descriptions into structured configurations. Respond only with valid JSON.",
        user=BRIEF_PARSER_PROMPT.format(
            brief=payload.brief,
            persona_list="\n".join(f"- {p.name}: {p.system_prompt_template[:100]}" for p in personas),
            num_steps=payload.num_steps,
        ),
        max_tokens=2000,
        temperature=0.5,
        mock=lambda: json.dumps(_mock_brief(payload.brief, payload.num_steps, personas)),
    )
    try:
        data = json.loads(ai.extract_json(raw))
        if not data.get("objective") or not isinstance(data.get("steps"), list) or not data["steps"]:
            raise ValueError("incomplete parse")
    except (json.JSONDecodeError, TypeError, ValueError):
        data = _mock_brief(payload.brief, payload.num_steps, personas)

    persona = next((p for p in personas if p.name == data.get("persona")), None)
    valid_types = {"connection_request", "message", "follow_up"}
    steps = [
        GeneratedStep(
            step_order=i + 1,
            step_type=s["step_type"] if s.get("step_type") in valid_types else "message",
            message_template=str(s["message_template"]),
            delay_days=max(0, int(s.get("delay_days", 0))),
        )
        for i, s in enumerate(data["steps"])
        if isinstance(s, dict) and s.get("message_template")
    ][: payload.num_steps]
    if not steps:
        steps = [GeneratedStep(**s) for s in _mock_sequence(data["objective"], payload.num_steps)]

    cta_type = data.get("cta_type") if data.get("cta_type") in ("booking_link", "reply", "custom") else "reply"
    return CampaignBriefResponse(
        name=(data.get("name") or "New Campaign")[:255],
        objective=data["objective"],
        target_audience=data.get("target_audience"),
        cta_type=cta_type,
        cta_value=(data.get("cta_value") or None),
        persona_id=persona.id if persona else None,
        persona_name=persona.name if persona else None,
        tone_profile_id=default_tone.id if default_tone else None,
        steps=steps,
    )


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


@router.post("/{campaign_id}/launch", response_model=CampaignOut)
async def launch_campaign(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """Alias of activate: validates readiness, sets status to running and started_at."""
    return await activate_campaign(campaign_id, workspace, _role, db)


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
