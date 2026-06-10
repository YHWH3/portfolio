"""Suggested reply generation: 3 options (direct / value-add / soft) for the inbox."""
import json

from sqlalchemy import select

from app.config import settings
from app.models import Campaign, Conversation, Message, ObjectionHandler
from app.services import ai, rag

REPLY_SYSTEM_PROMPT = """You draft LinkedIn reply suggestions for a human seller. The human reviews,
edits, and sends — you only suggest.

CAMPAIGN OBJECTIVE: {objective}
CTA: {cta_type} — {cta_value}
PROSPECT INTENT (classified): {intent}
OBJECTION HANDLER GUIDANCE: {objection_guidance}
KNOWLEDGE BASE CONTEXT:
{kb_context}

CONVERSATION SO FAR:
{history}

Produce exactly 3 reply options as a JSON array:
[
 {{"approach": "direct", "content": "<concise, straight to the point>"}},
 {{"approach": "value_add", "content": "<share an insight or proof point first>"}},
 {{"approach": "soft", "content": "<empathetic, zero pressure>"}}
]
Each reply: 1-3 sentences, natural, matches the seller's previous messages in tone.
Return ONLY the JSON array."""


def _mock_suggestions(campaign: Campaign, intent_name: str, last_prospect_message: str, objection_guidance: str | None) -> list[dict]:
    cta = campaign.cta_value or "a quick call"
    booking = cta if campaign.cta_type == "booking_link" else "a quick 15-minute chat"
    if intent_name == "booking_request":
        return [
            {"approach": "direct", "content": f"Great — here's my calendar: {booking}. Grab any slot that works."},
            {"approach": "value_add", "content": f"Happy to. I'll bring a couple of examples from similar teams so it's concrete — you can book here: {booking}."},
            {"approach": "soft", "content": f"Of course, no rush on timing. Whenever suits you: {booking}."},
        ]
    if intent_name.startswith("objection"):
        guidance = objection_guidance or "acknowledge the concern, then reframe around outcomes"
        return [
            {"approach": "direct", "content": f"Totally fair. Short version: {guidance[:120]}. Worth a quick look at the numbers together?"},
            {"approach": "value_add", "content": f"That's the most common question we get. One client had the same concern and saw payback in under a quarter — happy to share how. {guidance[:80]}"},
            {"approach": "soft", "content": "Completely understand — no pressure at all. If it's useful, I can send over a one-pager you can review whenever timing is better."},
        ]
    if intent_name in ("negative_mild", "negative_hostile", "opt_out"):
        return [
            {"approach": "direct", "content": "Understood — I'll close this out. Thanks for letting me know."},
            {"approach": "value_add", "content": "No problem at all. If priorities shift down the line, you know where to find me. All the best."},
            {"approach": "soft", "content": "Of course — apologies for the noise, and thanks for the direct answer. Wishing you a great quarter."},
        ]
    topic = last_prospect_message[:80].rstrip(".")
    return [
        {"approach": "direct", "content": f"Good question. The short answer: yes — and the fastest way to show you is {booking}. Open to it?"},
        {"approach": "value_add", "content": f"Glad you asked about that. Teams in your position usually care most about time-to-value — typically a couple of weeks, not months. Happy to walk through how that maps to \"{topic}\"."},
        {"approach": "soft", "content": "Happy to share more whenever useful — no agenda on my side. What would be most helpful to see first?"},
    ]


async def suggest_replies(db, conversation: Conversation, campaign: Campaign) -> list[dict]:
    messages = (await db.execute(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at)
    )).scalars().all()
    history = "\n".join(f"{'Prospect' if m.sender_type == 'prospect' else 'Seller'}: {m.content}" for m in messages[-12:])
    last_prospect = next((m for m in reversed(messages) if m.sender_type == "prospect"), None)
    intent_name = (last_prospect.intent_class if last_prospect else None) or "interest_exploring"
    last_text = last_prospect.content if last_prospect else ""

    objection_guidance = None
    if intent_name.startswith("objection") and last_text:
        handlers = (await db.execute(
            select(ObjectionHandler).where(ObjectionHandler.campaign_id == campaign.id).order_by(ObjectionHandler.priority.desc())
        )).scalars().all()
        lower = last_text.lower()
        for handler in handlers:
            if any(phrase.lower() in lower for phrase in handler.trigger_phrases):
                objection_guidance = handler.response_template
                break

    kb_chunks = []
    if intent_name.startswith("question") and last_text:
        kb_chunks = await rag.retrieve_kb_context(last_text, campaign.workspace_id, campaign.id, db=db)

    raw = await ai.complete(
        system="You suggest sales replies. Respond only with a valid JSON array.",
        user=REPLY_SYSTEM_PROMPT.format(
            objective=campaign.objective,
            cta_type=campaign.cta_type or "reply",
            cta_value=campaign.cta_value or "a short reply",
            intent=intent_name,
            objection_guidance=objection_guidance or "(none)",
            kb_context=rag.format_chunks_for_prompt(kb_chunks),
            history=history or "(no messages yet)",
        ),
        model=settings.ANTHROPIC_SONNET_MODEL,
        max_tokens=800,
        temperature=0.7,
        mock=lambda: json.dumps(_mock_suggestions(campaign, intent_name, last_text, objection_guidance)),
    )
    try:
        suggestions = json.loads(ai.extract_json(raw))
        valid = [s for s in suggestions if isinstance(s, dict) and s.get("approach") in ("direct", "value_add", "soft") and s.get("content")]
        if len(valid) == 3:
            return valid
    except (json.JSONDecodeError, TypeError):
        pass
    return _mock_suggestions(campaign, intent_name, last_text, objection_guidance)
