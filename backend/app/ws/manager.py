"""WebSocket connection manager + Redis pub/sub bridge for /ws/inbox."""
import asyncio
import contextlib
import json
import logging
import uuid

from fastapi import WebSocket

from app.redis_client import WS_EVENTS_CHANNEL, async_redis

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, workspace_id: uuid.UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(str(workspace_id), set()).add(websocket)

    async def disconnect(self, workspace_id: uuid.UUID, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(str(workspace_id), set())
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(str(workspace_id), None)

    async def broadcast(self, workspace_id: str, payload: dict) -> None:
        sockets = list(self._connections.get(workspace_id, set()))
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                await self.disconnect(uuid.UUID(workspace_id), socket)


manager = ConnectionManager()


async def redis_listener() -> None:
    """Forward events published on Redis (by API processes and Celery workers)
    to the WebSocket clients of the target workspace."""
    pubsub = async_redis.pubsub()
    await pubsub.subscribe(WS_EVENTS_CHANNEL)
    try:
        async for raw in pubsub.listen():
            if raw.get("type") != "message":
                continue
            with contextlib.suppress(json.JSONDecodeError, KeyError):
                envelope = json.loads(raw["data"])
                await manager.broadcast(
                    envelope["workspace_id"],
                    {"event": envelope["event"], "data": envelope["data"]},
                )
    except asyncio.CancelledError:
        await pubsub.unsubscribe(WS_EVENTS_CHANNEL)
        raise
    except Exception:
        logger.exception("Redis WS listener crashed; restarting in 2s")
        await asyncio.sleep(2)
        asyncio.create_task(redis_listener())
