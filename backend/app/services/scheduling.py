"""Suggested send-time calculation: campaign working hours + engagement heatmap."""
from datetime import datetime, timedelta

MIN_DELAY_BETWEEN_SENDS_MINUTES = 3


def next_send_slot(
    schedule_config: dict,
    queue_position: int = 0,
    best_hour: int | None = None,
    now: datetime | None = None,
) -> datetime:
    """Next timestamp inside the campaign's send window, spaced by the minimum
    delay per queued message. If the engagement heatmap has a best hour inside
    the window, aim for it."""
    config = schedule_config or {}
    start_hour = int(config.get("working_hours_start", 9))
    end_hour = int(config.get("working_hours_end", 18))
    send_weekends = bool(config.get("send_weekends", False))

    candidate = (now or datetime.utcnow()) + timedelta(minutes=MIN_DELAY_BETWEEN_SENDS_MINUTES * (queue_position + 1))

    if best_hour is not None and start_hour <= best_hour < end_hour and candidate.hour != best_hour:
        target = candidate.replace(hour=best_hour, minute=candidate.minute, second=0, microsecond=0)
        if target > candidate:
            candidate = target

    for _ in range(14):  # At most two weeks of scanning forward.
        if not send_weekends and candidate.weekday() >= 5:
            candidate = (candidate + timedelta(days=1)).replace(hour=start_hour, minute=0, second=0, microsecond=0)
            continue
        if candidate.hour < start_hour:
            candidate = candidate.replace(hour=start_hour, minute=0, second=0, microsecond=0)
        elif candidate.hour >= end_hour:
            candidate = (candidate + timedelta(days=1)).replace(hour=start_hour, minute=0, second=0, microsecond=0)
            continue
        return candidate
    return candidate
