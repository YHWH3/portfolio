import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_workspace, require_role
from app.database import get_db
from app.models import Campaign, Conversation, Intent, Lead, Message
from app.schemas import (
    ConversationDetail,
    ConversationListItem,
    InboxStats,
    LeadBrief,
    MessageOut,
    PriorityUpdate,
    ProspectMessageRequest,
    ReplyRequest,
    SuggestionsResponse,
)
from app.services import events, intent as intent_service, metrics, replies

router = APIRouter(prefix="/inbox", tags=["inbox"])


async def _get_conversation(conversation_id: uuid.UUID, workspace, db: AsyncSession) -> Conversation:
    conversation = (await db.execute(
        select(Conversation)
        .join(Campaign, Campaign.id == Conversation.campaign_id)
        .where(Conversation.id == conversation_id, Campaign.workspace_id == workspace.id)
        .options(selectinload(Conversation.lead))
    )).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


async def _to_list_item(conversation: Conversation, db: AsyncSession) -> ConversationListItem:
    last_message = (await db.execute(
        select(Message.content).where(Message.conversation_id == conversation.id).order_by(Message.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    return ConversationListItem(
        id=conversation.id,
        campaign_id=conversation.campaign_id,
        lead=LeadBrief.model_validate(conversation.lead, from_attributes=True) if conversation.lead else None,
        status=conversation.status,
        priority_score=float(conversation.priority_score),
        pipeline_value=float(conversation.pipeline_value) if conversation.pipeline_value is not None else None,
        last_message_at=conversation.last_message_at,
        last_message_preview=last_message[:120] if last_message else None,
    )


@router.get("", response_model=list[ConversationListItem])
async def list_conversations(
    status_filter: str | None = Query(default=None, alias="status"),
    campaign_id: uuid.UUID | None = None,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Conversation)
        .join(Campaign, Campaign.id == Conversation.campaign_id)
        .where(Campaign.workspace_id == workspace.id)
        .options(selectinload(Conversation.lead))
    )
    if status_filter:
        stmt = stmt.where(Conversation.status == status_filter)
    if campaign_id is not None:
        stmt = stmt.where(Conversation.campaign_id == campaign_id)
    conversations = (await db.execute(
        stmt.order_by(Conversation.priority_score.desc(), Conversation.last_message_at.desc().nulls_last()).limit(200)
    )).scalars().all()
    return [await _to_list_item(c, db) for c in conversations]


@router.get("/stats", response_model=InboxStats)
async def inbox_stats(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    base = select(Conversation.status, func.count()).join(Campaign, Campaign.id == Conversation.campaign_id).where(
        Campaign.workspace_id == workspace.id
    ).group_by(Conversation.status)
    counts = dict((await db.execute(base)).all())
    attention_intents = select(Intent.name).where(Intent.requires_attention.is_(True))
    needs_attention = (await db.execute(
        select(func.count(func.distinct(Message.conversation_id)))
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .join(Campaign, Campaign.id == Conversation.campaign_id)
        .where(Campaign.workspace_id == workspace.id, Message.intent_class.in_(attention_intents))
    )).scalar_one()
    return InboxStats(
        active=counts.get("active", 0) + counts.get("hot_lead", 0),
        hot_leads=counts.get("hot_lead", 0),
        needs_attention=needs_attention,
    )


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation(
    conversation_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    conversation = await _get_conversation(conversation_id, workspace, db)
    messages = (await db.execute(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.created_at)
    )).scalars().all()
    return ConversationDetail(
        conversation=await _to_list_item(conversation, db),
        messages=[MessageOut.model_validate(m) for m in messages],
    )


@router.post("/{conversation_id}/reply", response_model=MessageOut)
async def send_reply(
    conversation_id: uuid.UUID,
    payload: ReplyRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """Human-written (or human-edited AI suggestion) reply. The human pressed
    send — this is the explicit approval step for inbox replies."""
    conversation = await _get_conversation(conversation_id, workspace, db)
    message = Message(conversation_id=conversation.id, sender_type="user", content=payload.content)
    db.add(message)
    conversation.last_message_at = datetime.utcnow()
    conversation.updated_at = datetime.utcnow()
    await metrics.bump_metric(db, conversation.campaign_id, "messages_sent")
    await metrics.record_event(db, conversation.campaign_id, "reply_sent", {"conversation_id": str(conversation.id)})
    await db.commit()
    return MessageOut.model_validate(message)


@router.post("/{conversation_id}/prospect-message", response_model=MessageOut)
async def record_prospect_message(
    conversation_id: uuid.UUID,
    payload: ProspectMessageRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """Ingestion point for a prospect's reply (logged manually by the user, or
    by a future inbox integration). Classifies intent, scores priority, and
    runs hot-lead detection."""
    conversation = await _get_conversation(conversation_id, workspace, db)
    intents = [
        {"name": i.name, "trigger_patterns": i.trigger_patterns, "requires_attention": i.requires_attention}
        for i in (await db.execute(select(Intent))).scalars().all()
    ]
    classification = await intent_service.classify(payload.content, intents)
    intent_name = classification["intent"]
    sentiment = classification["sentiment"]

    message = Message(
        conversation_id=conversation.id,
        sender_type="prospect",
        content=payload.content,
        sentiment_score=Decimal(str(round(sentiment, 3))),
        intent_class=intent_name,
    )
    db.add(message)
    conversation.last_message_at = datetime.utcnow()

    turn_count = (await db.execute(
        select(func.count()).select_from(Message).where(Message.conversation_id == conversation.id)
    )).scalar_one()
    priority = intent_service.compute_priority(intent_name, sentiment, turn_count)
    conversation.priority_score = Decimal(str(priority))

    lead = conversation.lead
    await metrics.bump_metric(db, conversation.campaign_id, "replies_received")
    if sentiment > 0.2 or intent_name in ("interest_positive", "booking_request"):
        await metrics.bump_metric(db, conversation.campaign_id, "positive_replies")
    if intent_name == "booking_request":
        await metrics.bump_metric(db, conversation.campaign_id, "meetings_booked")
        conversation.status = "booked"
        if lead is not None:
            lead.status = "booked"
    elif intent_name in ("negative_hostile", "opt_out"):
        conversation.status = "archived"
        if lead is not None:
            lead.status = "skipped"
    elif priority >= intent_service.HOT_LEAD_THRESHOLD:
        conversation.status = "hot_lead"
        if lead is not None:
            lead.status = "hot"
    elif lead is not None and lead.status == "contacted":
        lead.status = "engaged"
    await db.commit()

    await events.publish(workspace.id, "inbox.new_reply", {
        "conversation_id": str(conversation.id),
        "message": payload.content,
        "lead_name": lead.name if lead else None,
        "intent": intent_name,
    })
    if conversation.status == "hot_lead" or intent_name == "booking_request":
        await events.publish(workspace.id, "inbox.hot_lead", {
            "conversation_id": str(conversation.id),
            "lead": {"name": lead.name if lead else None, "company": lead.company if lead else None},
            "priority_score": priority,
        })
    return MessageOut.model_validate(message)


@router.put("/{conversation_id}/priority", response_model=ConversationListItem)
async def update_priority(
    conversation_id: uuid.UUID,
    payload: PriorityUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    conversation = await _get_conversation(conversation_id, workspace, db)
    old_status = conversation.status
    conversation.priority_score = Decimal(str(payload.priority_score))
    if payload.priority_score >= intent_service.HOT_LEAD_THRESHOLD and conversation.status == "active":
        conversation.status = "hot_lead"
    conversation.updated_at = datetime.utcnow()
    await db.commit()
    if conversation.status != old_status:
        await events.publish(workspace.id, "inbox.status_change", {
            "conversation_id": str(conversation.id), "old_status": old_status, "new_status": conversation.status,
        })
    return await _to_list_item(conversation, db)


@router.get("/{conversation_id}/suggestions", response_model=SuggestionsResponse)
async def get_suggestions(
    conversation_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    conversation = await _get_conversation(conversation_id, workspace, db)
    campaign = await db.get(Campaign, conversation.campaign_id)
    suggestions = await replies.suggest_replies(db, conversation, campaign)
    return SuggestionsResponse(suggestions=suggestions)
