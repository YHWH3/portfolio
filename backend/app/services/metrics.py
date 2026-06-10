"""Daily metric counters and analytics events."""
from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models import AnalyticsEvent, DailyMetric


def _upsert_stmt(campaign_id, field: str, amount: int):
    column = getattr(DailyMetric.__table__.c, field)
    stmt = pg_insert(DailyMetric.__table__).values(campaign_id=campaign_id, date=date.today(), **{field: amount})
    return stmt.on_conflict_do_update(
        index_elements=["campaign_id", "date"],
        set_={field: column + amount},
    )


def bump_metric_sync(session, campaign_id, field: str, amount: int = 1) -> None:
    session.execute(_upsert_stmt(campaign_id, field, amount))


async def bump_metric(db, campaign_id, field: str, amount: int = 1) -> None:
    await db.execute(_upsert_stmt(campaign_id, field, amount))


def record_event_sync(session, campaign_id, event_type: str, data: dict | None = None) -> None:
    session.add(AnalyticsEvent(campaign_id=campaign_id, event_type=event_type, event_data=data or {}))


async def record_event(db, campaign_id, event_type: str, data: dict | None = None) -> None:
    db.add(AnalyticsEvent(campaign_id=campaign_id, event_type=event_type, event_data=data or {}))


def get_metric_rows_stmt(campaign_ids: list):
    return select(DailyMetric).where(DailyMetric.campaign_id.in_(campaign_ids))
