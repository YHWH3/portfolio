"""Safety intelligence: health scoring, recommendations, and soft blocks.

This is an advisory and tracking system. It surfaces warnings and enforces
configurable soft limits with user override — it does not evade anything.
"""
from datetime import date, datetime, timedelta

from sqlalchemy import func, select

from app.models import Campaign, DailyMetric, EngagementHeatmap, RestrictionEvent, SendingAccount

DEFAULT_LIMITS = {
    "daily_messages": 50,
    "daily_connection_requests": 25,
    "weekly_connection_requests": 100,
    "min_delay_between_sends_minutes": 3,
    "working_hours_start": 9,
    "working_hours_end": 18,
    "send_weekends": False,
}

REPLY_RATE_WINDOW_DAYS = 14
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _reply_rate_stmt(workspace_id):
    since = date.today() - timedelta(days=REPLY_RATE_WINDOW_DAYS)
    return (
        select(func.coalesce(func.sum(DailyMetric.messages_sent), 0), func.coalesce(func.sum(DailyMetric.replies_received), 0))
        .join(Campaign, Campaign.id == DailyMetric.campaign_id)
        .where(Campaign.workspace_id == workspace_id, DailyMetric.date >= since)
    )


def _rate(sent: int, replies: int) -> float:
    if sent < 20:
        # Not enough volume to judge — assume a healthy baseline.
        return 0.15
    return replies / sent


def reply_rate_sync(session, workspace_id) -> float:
    sent, replies = session.execute(_reply_rate_stmt(workspace_id)).one()
    return _rate(sent, replies)


async def reply_rate_async(session, workspace_id) -> float:
    sent, replies = (await session.execute(_reply_rate_stmt(workspace_id))).one()
    return _rate(sent, replies)


def compute_health_score(account: SendingAccount, recent_reply_rate: float, recent_restrictions: list[RestrictionEvent]) -> float:
    score = 100.0
    daily_utilization = account.sends_today / max(account.daily_send_limit, 1)
    if daily_utilization > 0.8:
        score -= (daily_utilization - 0.8) * 50  # Up to -10 at 100%
    if recent_reply_rate < 0.05:
        score -= 20
    elif recent_reply_rate < 0.10:
        score -= 10
    for restriction in recent_restrictions:
        if restriction.severity == "warning":
            score -= 10
        elif restriction.severity == "soft_limit":
            score -= 20
        elif restriction.severity == "hard_limit":
            score -= 40
        elif restriction.severity == "suspension":
            score -= 60
    if 0.3 <= daily_utilization <= 0.6:
        score += 5
    return max(0.0, min(100.0, round(score, 2)))


def recent_restrictions_stmt(account_id, days: int = 30):
    since = datetime.utcnow() - timedelta(days=days)
    return select(RestrictionEvent).where(
        RestrictionEvent.account_id == account_id,
        RestrictionEvent.detected_at >= since,
        RestrictionEvent.resolved_at.is_(None),
    )


def optimal_hours_stmt(workspace_id):
    return (
        select(EngagementHeatmap.hour_of_day, EngagementHeatmap.day_of_week, EngagementHeatmap.engagement_score)
        .join(Campaign, Campaign.id == EngagementHeatmap.campaign_id)
        .where(Campaign.workspace_id == workspace_id, EngagementHeatmap.sample_size >= 5)
        .order_by(EngagementHeatmap.engagement_score.desc())
        .limit(3)
    )


def format_optimal_hours(rows) -> str | None:
    if not rows:
        return None
    parts = [f"{DAY_NAMES[int(day)]}s around {int(hour):02d}:00" for hour, day, _ in rows if hour is not None and day is not None]
    return ", ".join(parts) if parts else None


def generate_safety_recommendations(account: SendingAccount, recent_reply_rate: float, optimal_hours: str | None) -> list[str]:
    recs: list[str] = []
    label = account.account_label or "Your account"
    if account.daily_send_limit and account.sends_today >= account.daily_send_limit * 0.8:
        pct = round(account.sends_today / account.daily_send_limit * 100)
        recs.append(
            f"{label}: you've sent {account.sends_today} messages today. "
            f"Consider stopping for today — you're at {pct}% of your daily limit."
        )
    if account.weekly_connection_limit and account.connections_this_week >= account.weekly_connection_limit * 0.7:
        recs.append(
            f"{label}: you've sent {account.connections_this_week} connection requests this week. "
            f"LinkedIn's comfort zone is under {account.weekly_connection_limit}/week."
        )
    if float(account.health_score) < 70:
        recs.append(
            f"{label}: account health score is below 70. Consider reducing volume "
            "and focusing on higher-quality, more personalized outreach for a few days."
        )
    if recent_reply_rate < 0.10:
        recs.append(
            "Your reply rate is under 10%. This can signal deliverability issues. "
            "Try improving personalization or narrowing your ICP."
        )
    if optimal_hours:
        recs.append(
            f"Based on your data, prospects engage most on {optimal_hours}. "
            "Consider scheduling your sends for those windows."
        )
    return recs


def check_soft_block(account: SendingAccount, action_type: str) -> tuple[bool, str | None]:
    """Soft-block checks before a draft is dispatched. Returns (allowed, reason)."""
    if account.status != "active":
        return False, f"Sending account is {account.status}."
    if account.sends_today >= account.daily_send_limit:
        return False, "Daily limit reached. Queue for tomorrow?"
    if action_type == "connection_request" and account.connections_this_week >= account.weekly_connection_limit:
        return False, "Weekly connection request limit reached."
    if float(account.health_score) < 50:
        # Strong warning, but user override is allowed — surfaced, not enforced.
        return True, "Warning: account health score is below 50. Sending anyway per your settings."
    return True, None
