"""Campaign and workspace metric aggregation."""
from collections import Counter
from datetime import date, timedelta

from sqlalchemy import func, select

from app.models import (
    Campaign,
    Conversation,
    DailyMetric,
    DraftQueueItem,
    Message,
    SendingAccount,
)


async def _metric_sums(db, campaign_ids: list) -> dict:
    row = (await db.execute(
        select(
            func.coalesce(func.sum(DailyMetric.drafts_generated), 0),
            func.coalesce(func.sum(DailyMetric.drafts_approved), 0),
            func.coalesce(func.sum(DailyMetric.drafts_edited), 0),
            func.coalesce(func.sum(DailyMetric.messages_sent), 0),
            func.coalesce(func.sum(DailyMetric.replies_received), 0),
            func.coalesce(func.sum(DailyMetric.positive_replies), 0),
            func.coalesce(func.sum(DailyMetric.meetings_booked), 0),
        ).where(DailyMetric.campaign_id.in_(campaign_ids))
    )).one()
    keys = ["drafts_generated", "drafts_approved", "drafts_edited", "messages_sent", "replies_received", "positive_replies", "meetings_booked"]
    return dict(zip(keys, (int(v) for v in row)))


def _pct(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


async def _avg_reply_time_hours(db, campaign_id) -> float | None:
    conversations = (await db.execute(
        select(Conversation.id).where(Conversation.campaign_id == campaign_id).limit(500)
    )).scalars().all()
    if not conversations:
        return None
    deltas: list[float] = []
    for conversation_id in conversations:
        messages = (await db.execute(
            select(Message.sender_type, Message.created_at)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at)
        )).all()
        last_user_at = None
        for sender, created_at in messages:
            if sender == "user":
                last_user_at = created_at
            elif sender == "prospect" and last_user_at is not None:
                deltas.append((created_at - last_user_at).total_seconds() / 3600)
                last_user_at = None
    return round(sum(deltas) / len(deltas), 1) if deltas else None


async def _top_performing_signals(db, campaign_id) -> list[dict]:
    replied_leads = set((await db.execute(
        select(Conversation.lead_id)
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.campaign_id == campaign_id, Message.sender_type == "prospect")
    )).scalars().all())
    if not replied_leads:
        return []
    drafts = (await db.execute(
        select(DraftQueueItem.lead_id, DraftQueueItem.personalization_hooks)
        .where(DraftQueueItem.campaign_id == campaign_id, DraftQueueItem.status == "sent")
    )).all()
    counter: Counter = Counter()
    for lead_id, hooks in drafts:
        if lead_id in replied_leads:
            counter.update(k for k in (hooks or {}) if k != "kb_sources")
    return [{"signal": name, "replies": count} for name, count in counter.most_common(3)]


async def compute_campaign_metrics(db, campaign: Campaign) -> dict:
    sums = await _metric_sums(db, [campaign.id])
    health_avg = (await db.execute(
        select(func.avg(SendingAccount.health_score)).where(SendingAccount.workspace_id == campaign.workspace_id)
    )).scalar_one()
    return {
        "drafts_generated": sums["drafts_generated"],
        "drafts_approved": sums["drafts_approved"],
        "drafts_edited_pct": _pct(sums["drafts_edited"], sums["drafts_approved"]),
        "messages_sent": sums["messages_sent"],
        "reply_rate": _pct(sums["replies_received"], sums["messages_sent"]),
        "positive_reply_rate": _pct(sums["positive_replies"], sums["replies_received"]),
        "meetings_booked": sums["meetings_booked"],
        "avg_reply_time_hours": await _avg_reply_time_hours(db, campaign.id),
        "top_performing_signals": await _top_performing_signals(db, campaign.id),
        "account_health_avg": round(float(health_avg), 1) if health_avg is not None else None,
    }


async def workspace_dashboard(db, workspace_id) -> dict:
    campaigns = (await db.execute(
        select(Campaign).where(Campaign.workspace_id == workspace_id, Campaign.status != "archived")
    )).scalars().all()
    campaign_ids = [c.id for c in campaigns]
    totals = await _metric_sums(db, campaign_ids) if campaign_ids else {
        "drafts_generated": 0, "drafts_approved": 0, "drafts_edited": 0,
        "messages_sent": 0, "replies_received": 0, "positive_replies": 0, "meetings_booked": 0,
    }

    per_campaign = []
    for campaign in campaigns:
        sums = await _metric_sums(db, [campaign.id])
        per_campaign.append({
            "id": str(campaign.id),
            "name": campaign.name,
            "status": campaign.status,
            "messages_sent": sums["messages_sent"],
            "reply_rate": _pct(sums["replies_received"], sums["messages_sent"]),
            "meetings_booked": sums["meetings_booked"],
        })

    since = date.today() - timedelta(days=29)
    trend_rows = (await db.execute(
        select(
            DailyMetric.date,
            func.sum(DailyMetric.messages_sent),
            func.sum(DailyMetric.replies_received),
        )
        .where(DailyMetric.campaign_id.in_(campaign_ids) if campaign_ids else False, DailyMetric.date >= since)
        .group_by(DailyMetric.date)
        .order_by(DailyMetric.date)
    )).all() if campaign_ids else []
    trend = [
        {"date": d.isoformat(), "messages_sent": int(sent), "replies_received": int(replies)}
        for d, sent, replies in trend_rows
    ]

    return {
        "totals": {
            "messages_sent": totals["messages_sent"],
            "replies_received": totals["replies_received"],
            "reply_rate": _pct(totals["replies_received"], totals["messages_sent"]),
            "meetings_booked": totals["meetings_booked"],
            "drafts_generated": totals["drafts_generated"],
            "drafts_edited_pct": _pct(totals["drafts_edited"], totals["drafts_approved"]),
        },
        "campaigns": per_campaign,
        "trend": trend,
    }
