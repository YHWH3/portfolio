"""WebSocket event publishing via Redis pub/sub.

API processes and Celery workers both publish here; every API process runs a
subscriber (see app.ws.manager) that forwards events to connected clients in
the right workspace.
"""
import json

from app.redis_client import WS_EVENTS_CHANNEL, async_redis, sync_redis


def _envelope(workspace_id, event: str, data: dict) -> str:
    return json.dumps({"workspace_id": str(workspace_id), "event": event, "data": data}, default=str)


def publish_sync(workspace_id, event: str, data: dict) -> None:
    sync_redis.publish(WS_EVENTS_CHANNEL, _envelope(workspace_id, event, data))


async def publish(workspace_id, event: str, data: dict) -> None:
    await async_redis.publish(WS_EVENTS_CHANNEL, _envelope(workspace_id, event, data))
