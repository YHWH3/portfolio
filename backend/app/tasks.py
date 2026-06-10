"""Celery tasks: draft generation, enrichment, KB ingestion, delivery dispatch,
and the safety/analytics beat jobs."""
import logging
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.celery_app import celery_app
from app.database import get_sync_session
from app.models import (
    Campaign,
    Conversation,
    DocumentChunk,
    DraftQueueItem,
    EngagementHeatmap,
    ICPDefinition,
    KnowledgeDocument,
    Lead,
    LinkedInSignal,
    Message,
    SafetyLog,
    SendingAccount,
    SequenceStep,
    Workspace,
)
from app.services import draft_engine, embeddings, enrichment, events, ingestion, metrics, safety, scheduling

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.generate_drafts_task")
def generate_drafts_task(campaign_id: str) -> int:
    session = get_sync_session()
    try:
        campaign = session.get(Campaign, uuid.UUID(campaign_id))
        if campaign is None:
            return 0
        first_step = session.execute(
            select(SequenceStep).where(SequenceStep.campaign_id == campaign.id).order_by(SequenceStep.step_order).limit(1)
        ).scalar_one_or_none()
        if first_step is None:
            return 0
        leads = draft_engine.leads_pending_first_step(session, campaign)
        for position, lead in enumerate(leads):
            draft_engine.generate_draft(session, campaign, lead, first_step, queue_position=position)
            lead.status = "queued"
            metrics.bump_metric_sync(session, campaign.id, "drafts_generated")
        metrics.record_event_sync(session, campaign.id, "drafts_generated", {"count": len(leads)})
        session.commit()
        if leads:
            events.publish_sync(campaign.workspace_id, "drafts.ready", {"campaign_id": str(campaign.id), "count": len(leads)})
        return len(leads)
    finally:
        session.close()


@celery_app.task(name="app.tasks.generate_followup_drafts")
def generate_followup_drafts() -> int:
    """For every sent draft: if the next sequence step's delay has elapsed and
    the prospect has not replied, queue a follow-up draft for human review."""
    session = get_sync_session()
    generated = 0
    try:
        campaigns = session.execute(select(Campaign).where(Campaign.status == "running")).scalars().all()
        for campaign in campaigns:
            steps = sorted(campaign.steps, key=lambda s: s.step_order)
            step_index = {step.id: i for i, step in enumerate(steps)}
            sent_drafts = session.execute(
                select(DraftQueueItem).where(DraftQueueItem.campaign_id == campaign.id, DraftQueueItem.status == "sent")
            ).scalars().all()
            for sent in sent_drafts:
                idx = step_index.get(sent.sequence_step_id)
                if idx is None or idx + 1 >= len(steps):
                    continue
                next_step = steps[idx + 1]
                if sent.sent_at is None or datetime.utcnow() < sent.sent_at + timedelta(days=max(next_step.delay_days, 0)):
                    continue
                existing = session.execute(
                    select(DraftQueueItem.id).where(
                        DraftQueueItem.lead_id == sent.lead_id,
                        DraftQueueItem.sequence_step_id == next_step.id,
                    ).limit(1)
                ).scalar_one_or_none()
                if existing is not None:
                    continue
                replied = session.execute(
                    select(Message.id)
                    .join(Conversation, Conversation.id == Message.conversation_id)
                    .where(
                        Conversation.lead_id == sent.lead_id,
                        Conversation.campaign_id == campaign.id,
                        Message.sender_type == "prospect",
                        Message.created_at >= sent.sent_at,
                    ).limit(1)
                ).scalar_one_or_none()
                if replied is not None:
                    continue
                lead = session.get(Lead, sent.lead_id)
                draft_engine.generate_draft(session, campaign, lead, next_step, queue_position=generated)
                metrics.bump_metric_sync(session, campaign.id, "drafts_generated")
                generated += 1
            if generated:
                events.publish_sync(campaign.workspace_id, "drafts.ready", {"campaign_id": str(campaign.id), "count": generated})
        session.commit()
        return generated
    finally:
        session.close()


@celery_app.task(name="app.tasks.enrich_lead_task")
def enrich_lead_task(lead_id: str) -> bool:
    from app.services.quality import compute_quality_score

    session = get_sync_session()
    try:
        lead = session.get(Lead, uuid.UUID(lead_id))
        if lead is None:
            return False
        data = enrichment.enrich_lead_data(lead)
        lead.title = lead.title or data["title"]
        lead.industry = lead.industry or data["industry"]
        lead.headline = data["headline"]
        lead.about_summary = data["about_summary"]
        lead.recent_posts = data["recent_posts"]
        lead.mutual_connections = data["mutual_connections"]
        lead.email = lead.email or data["email"]
        for signal in data["signals"]:
            session.add(LinkedInSignal(lead_id=lead.id, **signal))
        icp = session.execute(
            select(ICPDefinition).where(ICPDefinition.workspace_id == lead.workspace_id).order_by(ICPDefinition.created_at).limit(1)
        ).scalar_one_or_none()
        quality, icp_pct = compute_quality_score(lead, icp)
        lead.quality_score = Decimal(str(quality))
        lead.icp_match_pct = Decimal(str(icp_pct))
        lead.enriched_at = datetime.utcnow()
        session.commit()
        return True
    finally:
        session.close()


@celery_app.task(name="app.tasks.ingest_document_task")
def ingest_document_task(document_id: str) -> bool:
    session = get_sync_session()
    try:
        document = session.get(KnowledgeDocument, uuid.UUID(document_id))
        if document is None:
            return False
        try:
            url = document.file_path if document.file_type == "url" else None
            raw = ingestion.extract_text(document.file_path, document.file_type, url=url)
            cleaned = ingestion.clean_text(raw)
            chunks = ingestion.chunk_text(cleaned)
            if not chunks:
                raise ValueError("Document produced no text chunks")
            vectors = embeddings.embed_texts_sync(chunks)
            for order, (chunk, vector) in enumerate(zip(chunks, vectors)):
                session.add(DocumentChunk(
                    document_id=document.id,
                    chunk_text=chunk,
                    embedding=vector,
                    metadata_={"filename": document.filename},
                    chunk_order=order,
                ))
            document.upload_status = "ready"
            document.vector_status = "indexed"
            session.commit()
            return True
        except Exception:
            logger.exception("Document ingestion failed for %s", document_id)
            session.rollback()
            document.upload_status = "failed"
            document.vector_status = "failed"
            session.commit()
            return False
    finally:
        session.close()


@celery_app.task(name="app.tasks.dispatch_approved_drafts")
def dispatch_approved_drafts() -> int:
    """Deliver human-approved drafts whose scheduled time has arrived.

    Delivery itself is a mock of the LinkedIn send integration — only messages
    a human explicitly approved ever reach this point, and soft limits are
    checked per account before each send."""
    session = get_sync_session()
    dispatched = 0
    try:
        due = session.execute(
            select(DraftQueueItem)
            .where(
                DraftQueueItem.status.in_(["approved", "edited_and_approved"]),
                DraftQueueItem.scheduled_for <= datetime.utcnow(),
            )
            .order_by(DraftQueueItem.scheduled_for)
            .limit(100)
        ).scalars().all()
        for draft in due:
            campaign = session.get(Campaign, draft.campaign_id)
            if campaign is None or campaign.status != "running":
                continue
            step = session.get(SequenceStep, draft.sequence_step_id)
            action_type = "connection_request" if step and step.step_type == "connection_request" else "message"
            account = session.execute(
                select(SendingAccount).where(
                    SendingAccount.workspace_id == campaign.workspace_id,
                    SendingAccount.status == "active",
                ).order_by(SendingAccount.created_at).limit(1)
            ).scalar_one_or_none()
            if account is None:
                continue
            allowed, reason = safety.check_soft_block(account, action_type)
            if not allowed:
                # Push to tomorrow's window instead of failing the draft.
                draft.scheduled_for = scheduling.next_send_slot(
                    campaign.schedule_config, 0, now=datetime.utcnow().replace(hour=0, minute=0) + timedelta(days=1)
                )
                events.publish_sync(campaign.workspace_id, "safety.warning", {
                    "account_id": str(account.id), "message": reason, "health_score": float(account.health_score),
                })
                continue
            if reason:
                events.publish_sync(campaign.workspace_id, "safety.warning", {
                    "account_id": str(account.id), "message": reason, "health_score": float(account.health_score),
                })

            # Mock LinkedIn delivery of the approved message.
            content = draft.human_edit or draft.ai_draft
            draft.status = "sent"
            draft.sent_at = datetime.utcnow()
            account.sends_today += 1
            account.sends_this_week += 1
            if action_type == "connection_request":
                account.connections_this_week += 1
            session.add(SafetyLog(
                account_id=account.id,
                action_type=action_type,
                details={"draft_id": str(draft.id), "campaign_id": str(campaign.id)},
                daily_count_at_time=account.sends_today,
                weekly_count_at_time=account.sends_this_week,
            ))

            conversation = session.execute(
                select(Conversation).where(
                    Conversation.campaign_id == campaign.id, Conversation.lead_id == draft.lead_id
                ).limit(1)
            ).scalar_one_or_none()
            if conversation is None:
                conversation = Conversation(campaign_id=campaign.id, lead_id=draft.lead_id)
                session.add(conversation)
                session.flush()
            session.add(Message(conversation_id=conversation.id, sender_type="user", content=content))
            conversation.last_message_at = datetime.utcnow()

            lead = session.get(Lead, draft.lead_id)
            if lead is not None and lead.status in ("new", "queued"):
                lead.status = "contacted"
            workspace = session.get(Workspace, campaign.workspace_id)
            if workspace is not None:
                workspace.current_month_usage += 1
            metrics.bump_metric_sync(session, campaign.id, "messages_sent")
            metrics.record_event_sync(session, campaign.id, "message_sent", {"draft_id": str(draft.id), "action_type": action_type})
            dispatched += 1
        session.commit()
        return dispatched
    finally:
        session.close()


@celery_app.task(name="app.tasks.reset_daily_counts")
def reset_daily_counts() -> int:
    session = get_sync_session()
    try:
        accounts = session.execute(select(SendingAccount)).scalars().all()
        for account in accounts:
            account.sends_today = 0
            account.last_reset_date = date.today()
        session.commit()
        return len(accounts)
    finally:
        session.close()


@celery_app.task(name="app.tasks.reset_weekly_counts")
def reset_weekly_counts() -> int:
    session = get_sync_session()
    try:
        accounts = session.execute(select(SendingAccount)).scalars().all()
        for account in accounts:
            account.sends_this_week = 0
            account.connections_this_week = 0
        session.commit()
        return len(accounts)
    finally:
        session.close()


@celery_app.task(name="app.tasks.compute_health_scores")
def compute_health_scores() -> int:
    session = get_sync_session()
    try:
        accounts = session.execute(select(SendingAccount)).scalars().all()
        for account in accounts:
            reply_rate = safety.reply_rate_sync(session, account.workspace_id)
            restrictions = session.execute(safety.recent_restrictions_stmt(account.id)).scalars().all()
            previous = float(account.health_score)
            score = safety.compute_health_score(account, reply_rate, restrictions)
            account.health_score = Decimal(str(score))
            if score < 70 <= previous:
                events.publish_sync(account.workspace_id, "safety.warning", {
                    "account_id": str(account.id),
                    "message": f"Account health dropped to {score}. Consider reducing volume for a few days.",
                    "health_score": score,
                })
        session.commit()
        return len(accounts)
    finally:
        session.close()


@celery_app.task(name="app.tasks.check_engagement_rates")
def check_engagement_rates() -> int:
    """Daily: rebuild engagement heatmaps from reply timestamps and flag
    low-performing campaigns."""
    session = get_sync_session()
    try:
        campaigns = session.execute(select(Campaign).where(Campaign.status.in_(["running", "paused"]))).scalars().all()
        for campaign in campaigns:
            rows = session.execute(
                select(
                    func.extract("hour", Message.created_at),
                    func.extract("dow", Message.created_at),
                    func.count(),
                )
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.campaign_id == campaign.id, Message.sender_type == "prospect")
                .group_by(func.extract("hour", Message.created_at), func.extract("dow", Message.created_at))
            ).all()
            if rows:
                session.execute(
                    EngagementHeatmap.__table__.delete().where(EngagementHeatmap.campaign_id == campaign.id)
                )
                max_count = max(count for _, _, count in rows)
                for hour, dow, count in rows:
                    session.add(EngagementHeatmap(
                        campaign_id=campaign.id,
                        hour_of_day=int(hour),
                        day_of_week=int(dow),
                        engagement_score=Decimal(str(round(count / max_count, 3))),
                        sample_size=count,
                    ))
            # Reply-rate check from recent daily metrics.
            week_rate = safety.reply_rate_sync(session, campaign.workspace_id)
            if week_rate < 0.05:
                metrics.record_event_sync(session, campaign.id, "low_engagement_flag", {"reply_rate": round(week_rate, 3)})
        session.commit()
        return len(campaigns)
    finally:
        session.close()
