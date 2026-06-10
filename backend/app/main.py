import asyncio
import contextlib
import os
import uuid as uuid_module

import jwt as pyjwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api.v1 import api_router
from app.config import settings
from app.core.security import decode_access_token
from app.database import async_session_maker
from app.models import TeamMember, Workspace
from app.ws.manager import manager, redis_listener

app = FastAPI(title="LinkedIn Outreach Copilot", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

_listener_task: asyncio.Task | None = None


@app.on_event("startup")
async def startup() -> None:
    global _listener_task
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    _listener_task = asyncio.create_task(redis_listener())


@app.on_event("shutdown")
async def shutdown() -> None:
    if _listener_task is not None:
        _listener_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _listener_task


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


async def _resolve_workspace_id(user_id: uuid_module.UUID) -> uuid_module.UUID | None:
    async with async_session_maker() as db:
        workspace_id = (await db.execute(
            select(Workspace.id).where(Workspace.owner_id == user_id).limit(1)
        )).scalar_one_or_none()
        if workspace_id is not None:
            return workspace_id
        return (await db.execute(
            select(TeamMember.workspace_id).where(TeamMember.user_id == user_id).limit(1)
        )).scalar_one_or_none()


@app.websocket("/ws/inbox")
async def inbox_websocket(websocket: WebSocket, token: str = "") -> None:
    try:
        payload = decode_access_token(token)
        if payload.get("type") != "access":
            raise pyjwt.PyJWTError("wrong token type")
        user_id = uuid_module.UUID(payload["sub"])
    except (pyjwt.PyJWTError, KeyError, ValueError):
        await websocket.close(code=4401)
        return
    workspace_id = await _resolve_workspace_id(user_id)
    if workspace_id is None:
        await websocket.close(code=4403)
        return
    await manager.connect(workspace_id, websocket)
    try:
        while True:
            # Clients only listen; we just keep the connection alive.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(workspace_id, websocket)
