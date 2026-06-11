import redis as redis_sync
import redis.asyncio as redis_async

from app.config import settings

# Async client — FastAPI request path and WebSocket pub/sub.
async_redis = redis_async.from_url(settings.REDIS_URL, decode_responses=True)

# Sync client — Celery workers.
sync_redis = redis_sync.from_url(settings.REDIS_URL, decode_responses=True)

WS_EVENTS_CHANNEL = "ws_events"
