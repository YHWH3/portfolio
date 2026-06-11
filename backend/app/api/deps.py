import uuid

import jwt as pyjwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.database import get_db
from app.models import TeamMember, User, Workspace

bearer_scheme = HTTPBearer(auto_error=False)

# Role hierarchy: higher value = more privilege.
ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_access_token(credentials.credentials)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_current_workspace(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Workspace:
    """Resolve the user's workspace: owned workspace first, else team membership."""
    result = await db.execute(select(Workspace).where(Workspace.owner_id == user.id).limit(1))
    workspace = result.scalar_one_or_none()
    if workspace is not None:
        return workspace
    result = await db.execute(
        select(Workspace).join(TeamMember, TeamMember.workspace_id == Workspace.id).where(TeamMember.user_id == user.id).limit(1)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No workspace for this user")
    return workspace


async def get_workspace_role(
    user: User = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
) -> str:
    if workspace.owner_id == user.id:
        return "owner"
    result = await db.execute(
        select(TeamMember).where(TeamMember.workspace_id == workspace.id, TeamMember.user_id == user.id)
    )
    member = result.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this workspace")
    return member.role


def require_role(minimum: str):
    """RBAC dependency: owner > admin > member > viewer."""

    async def checker(role: str = Depends(get_workspace_role)) -> str:
        if ROLE_RANK.get(role, -1) < ROLE_RANK[minimum]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Requires {minimum} role or higher")
        return role

    return checker
