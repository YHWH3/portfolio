from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery("copilot", broker=settings.REDIS_URL, backend=settings.REDIS_URL, include=["app.tasks"])

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    beat_schedule={
        "reset-daily-counts": {
            "task": "app.tasks.reset_daily_counts",
            "schedule": crontab(hour=0, minute=0),
        },
        "reset-weekly-counts": {
            "task": "app.tasks.reset_weekly_counts",
            "schedule": crontab(day_of_week=1, hour=0, minute=0),
        },
        "compute-health-scores": {
            "task": "app.tasks.compute_health_scores",
            "schedule": crontab(minute="*/15"),
        },
        "check-engagement-rates": {
            "task": "app.tasks.check_engagement_rates",
            "schedule": crontab(hour=1, minute=0),
        },
        "dispatch-approved-drafts": {
            "task": "app.tasks.dispatch_approved_drafts",
            "schedule": crontab(minute="*/5"),
        },
        "generate-followup-drafts": {
            "task": "app.tasks.generate_followup_drafts",
            "schedule": crontab(minute=10),
        },
        "check-connection-acceptances": {
            "task": "app.tasks.check_connection_acceptances",
            "schedule": crontab(minute="*/30"),
        },
    },
)
