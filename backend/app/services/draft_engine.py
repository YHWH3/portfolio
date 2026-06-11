"""AI Draft Engine — the 5-stage pipeline from the spec.

Runs inside Celery workers (sync DB session, sync Anthropic client).
Stage 1: context assembly  → Stage 2: prompt assembly  → Stage 3: generation
→ Stage 4: personalization tagging  → Stage 5: queue for review.
"""
import re
from datetime import datetime

from sqlalchemy import func, select

from app.config import settings
from app.models import (
    Campaign,
    DraftQueueItem,
    EngagementHeatmap,
    Lead,
    LinkedInSignal,
    Persona,
    SequenceStep,
    ToneProfile,
)
from app.services import ai, rag, scheduling

DRAFT_SYSTEM_PROMPT = """
You are a message drafting assistant for LinkedIn outreach. You draft messages
that a human will review, edit, and send from their own LinkedIn account.
Your job is to produce a draft that sounds like the sender wrote it themselves.
SENDER'S WRITING STYLE:
{tone_profile_addon}
CAMPAIGN CONTEXT:
- Objective: {campaign_objective}
- Persona approach: {persona_description}
- CTA: {cta_type} — {cta_value}
PROSPECT INFORMATION:
- Name: {lead_name}
- Title: {lead_title} at {lead_company}
- Industry: {lead_industry}
- Headline: {lead_headline}
- Recent activity: {recent_signals}
RELEVANT KNOWLEDGE BASE CONTEXT:
{kb_chunks}
SEQUENCE STEP GUIDANCE:
{step_template}
RULES:
- Write 2-4 sentences. LinkedIn messages should be concise.
- Sound like a real person, not a template. Use the sender's actual style.
- Reference something specific about the prospect (their post, role, company news).
- Do not use generic phrases like "I came across your profile" unless the sender actually uses those.
- If this is a follow-up, acknowledge the previous message naturally.
- End with a clear but non-pushy next step aligned with the CTA.
- Do not use placeholder brackets like [Company] — use actual values or omit.
Draft the message now. Output ONLY the message text, no commentary.
"""


def _goal_phrase(text: str, limit: int = 70) -> str:
    """Objective as a phrase that reads naturally mid-sentence."""
    clean = re.sub(r"\s+", " ", (text or "").strip()).rstrip(".!,;: ")
    if len(clean) > limit:
        clean = clean[:limit].rsplit(" ", 1)[0].rstrip(".!,;: ")
    return clean[:1].lower() + clean[1:] if clean else "what we discussed"


def resolve_variables(template: str, lead: Lead, hooks: dict, campaign: Campaign | None = None) -> str:
    """Resolve smart variables ({{first_name}}, {{company}}, ...) against the lead."""
    custom = lead.custom_fields or {}
    best_hook = hooks.get("signal") or hooks.get("recent_post") or hooks.get("company_news") or ""
    values = {
        "first_name": lead.first_name or (lead.name or "").split(" ")[0],
        "last_name": lead.last_name or "",
        "company": lead.company or "",
        "title": lead.title or "",
        "industry": lead.industry or "",
        "headline": lead.headline or "",
        "recent_post_topic": hooks.get("recent_post", ""),
        "mutual_connection": hooks.get("mutual_connection", ""),
        "signal_hook": hooks.get("signal", ""),
        "personalization_hook": best_hook,
        "cta_link": (campaign.cta_value if campaign else "") or "",
    }
    for i in range(1, 6):
        values[f"custom_field_{i}"] = str(custom.get(f"custom_field_{i}", ""))

    def repl(match: re.Match) -> str:
        return values.get(match.group(1), "")

    return re.sub(r"\{\{\s*(\w+)\s*\}\}", repl, template)


def collect_hooks(lead: Lead, signals: list[LinkedInSignal]) -> dict:
    """Stage 4 input: which personalization hooks are available for this lead."""
    hooks: dict = {}
    posts = lead.recent_posts or []
    if posts:
        hooks["recent_post"] = posts[0].get("topic", "")
    mutuals = lead.mutual_connections or []
    if mutuals:
        hooks["mutual_connection"] = mutuals[0].get("name", "")
    for signal in signals:
        data = signal.signal_data or {}
        summary = data.get("summary", "")
        if signal.signal_type == "job_change":
            hooks["job_change"] = summary
        elif signal.signal_type == "company_news":
            hooks["company_news"] = summary
        if "signal" not in hooks and summary:
            hooks["signal"] = summary
    if lead.headline:
        hooks["headline"] = lead.headline
    return hooks


def _mock_draft(lead: Lead, campaign: Campaign, step: SequenceStep, hooks: dict, persona: Persona | None) -> str:
    first = lead.first_name or "there"
    company = lead.company or "your team"
    opener_hook = hooks.get("recent_post") or hooks.get("job_change") or hooks.get("company_news")
    if step.step_type == "connection_request":
        if opener_hook:
            return f"Hi {first} — your recent note on {opener_hook} resonated with what we're seeing in {lead.industry or 'the space'}. Would be glad to connect."
        return f"Hi {first} — I work with {lead.industry or 'B2B'} leaders on {_goal_phrase(campaign.objective, 60)}. Would be glad to connect."
    if step.step_type == "follow_up":
        cta = campaign.cta_value or "a quick chat"
        return (
            f"Hi {first}, just floating my last note back up — I know things move fast at {company}. "
            f"If {_goal_phrase(campaign.objective, 50)} is still on your radar, happy to share what's worked for similar teams. "
            f"Worth {cta if campaign.cta_type == 'reply' else 'a quick look at ' + cta}?"
        )
    hook_line = f"Saw your post about {hooks['recent_post']} — sharp take. " if hooks.get("recent_post") else (
        f"Noticed {hooks['company_news'].lower()}. " if hooks.get("company_news") else ""
    )
    mutual = f"{hooks['mutual_connection']} and I are connected, and your name came up. " if hooks.get("mutual_connection") else ""
    cta_line = {
        "booking_link": f"If it's useful, grab a slot here: {campaign.cta_value}",
        "reply": "Worth a quick reply if this is on your radar?",
        "custom": campaign.cta_value or "Open to comparing notes?",
    }.get(campaign.cta_type or "reply", "Open to comparing notes?")
    return (
        f"Hi {first} — {hook_line}{mutual}"
        f"We're helping {lead.title or 'leaders'} at companies like {company} with {_goal_phrase(campaign.objective, 70)}. "
        f"{cta_line}"
    )


def generate_draft(session, campaign: Campaign, lead: Lead, step: SequenceStep, queue_position: int = 0) -> DraftQueueItem:
    # Stage 1 — context assembly
    persona = session.get(Persona, campaign.persona_id) if campaign.persona_id else None
    tone = session.get(ToneProfile, campaign.tone_profile_id) if campaign.tone_profile_id else None
    signals = session.execute(
        select(LinkedInSignal).where(LinkedInSignal.lead_id == lead.id).order_by(LinkedInSignal.relevance_score.desc())
    ).scalars().all()
    kb_query = f"{campaign.objective} {lead.title or ''} {lead.industry or ''}".strip()
    kb_chunks = rag.retrieve_kb_context_sync(session, kb_query, campaign.workspace_id, campaign.id)

    hooks = collect_hooks(lead, signals)

    # Stage 2 — prompt assembly
    recent_signals = "; ".join(filter(None, [hooks.get("recent_post") and f"posted about {hooks['recent_post']}",
                                             hooks.get("job_change"), hooks.get("company_news")])) or "none on record"
    step_template = resolve_variables(step.message_template, lead, hooks, campaign)
    system_prompt = DRAFT_SYSTEM_PROMPT.format(
        tone_profile_addon=(tone.system_prompt_addon if tone else None) or "Professional, warm, concise. No emoji.",
        campaign_objective=campaign.objective,
        persona_description=persona.system_prompt_template if persona else "Helpful peer reaching out with relevant value.",
        cta_type=campaign.cta_type or "reply",
        cta_value=campaign.cta_value or "a short reply",
        lead_name=lead.name or f"{lead.first_name or ''} {lead.last_name or ''}".strip(),
        lead_title=lead.title or "Unknown title",
        lead_company=lead.company or "their company",
        lead_industry=lead.industry or "unknown",
        lead_headline=lead.headline or "(none)",
        recent_signals=recent_signals,
        kb_chunks=rag.format_chunks_for_prompt(kb_chunks),
        step_template=step_template,
    )

    # Stage 3 — generation
    draft_text = ai.complete_sync(
        system=system_prompt,
        user=f"Draft the {step.step_type.replace('_', ' ')} for this prospect now.",
        model=settings.ANTHROPIC_SONNET_MODEL,
        max_tokens=300,
        temperature=0.7,
        mock=lambda: _mock_draft(lead, campaign, step, hooks, persona),
    )

    # Stage 4 — personalization tagging
    used_hooks = {k: v for k, v in hooks.items() if v and (str(v)[:40].lower() in draft_text.lower() or k in ("headline",))}
    if not used_hooks:
        used_hooks = hooks
    if kb_chunks:
        used_hooks["kb_sources"] = ", ".join(sorted({c["filename"] for c in kb_chunks}))
    for signal in signals:
        signal.used_in_draft = True

    # Stage 5 — queue for review
    best = session.execute(
        select(EngagementHeatmap.hour_of_day)
        .where(EngagementHeatmap.campaign_id == campaign.id, EngagementHeatmap.sample_size >= 5)
        .order_by(EngagementHeatmap.engagement_score.desc())
        .limit(1)
    ).scalar_one_or_none()
    scheduled_for = scheduling.next_send_slot(campaign.schedule_config, queue_position, best_hour=best)

    draft = DraftQueueItem(
        campaign_id=campaign.id,
        lead_id=lead.id,
        sequence_step_id=step.id,
        ai_draft=draft_text,
        personalization_hooks=used_hooks,
        status="pending_review",
        scheduled_for=scheduled_for,
    )
    session.add(draft)
    return draft


def leads_pending_first_step(session, campaign: Campaign) -> list[Lead]:
    first_step = session.execute(
        select(SequenceStep).where(SequenceStep.campaign_id == campaign.id).order_by(SequenceStep.step_order).limit(1)
    ).scalar_one_or_none()
    if first_step is None:
        return []
    drafted_lead_ids = select(DraftQueueItem.lead_id).where(DraftQueueItem.campaign_id == campaign.id)
    return session.execute(
        select(Lead).where(
            Lead.campaign_id == campaign.id,
            Lead.status.in_(["new", "queued"]),
            Lead.id.not_in(drafted_lead_ids),
        )
    ).scalars().all()
