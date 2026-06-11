import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.core import security
from app.database import get_db
from app.models import TeamMember, User, Workspace
from app.schemas import SuccessResponse, TeamInvite, TeamMemberOut, WorkspaceOut, WorkspaceUpdate

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("", response_model=WorkspaceOut)
async def get_workspace(workspace: Workspace = Depends(get_current_workspace)):
    return workspace


@router.put("", response_model=WorkspaceOut)
async def update_workspace(
    payload: WorkspaceUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    if payload.name is not None:
        workspace.name = payload.name
    if payload.settings is not None:
        workspace.settings = payload.settings
    if payload.monthly_outreach_limit is not None:
        workspace.monthly_outreach_limit = payload.monthly_outreach_limit
    workspace.updated_at = datetime.utcnow()
    await db.commit()
    return workspace


@router.get("/team", response_model=list[TeamMemberOut])
async def list_team(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(TeamMember, User).join(User, User.id == TeamMember.user_id).where(TeamMember.workspace_id == workspace.id)
    )).all()
    members = [
        TeamMemberOut(
            id=member.id, user_id=user.id, email=user.email, first_name=user.first_name,
            last_name=user.last_name, role=member.role, invited_at=member.invited_at, accepted_at=member.accepted_at,
        )
        for member, user in rows
    ]
    owner = await db.get(User, workspace.owner_id)
    if owner is not None:
        members.insert(0, TeamMemberOut(
            id=workspace.id, user_id=owner.id, email=owner.email, first_name=owner.first_name,
            last_name=owner.last_name, role="owner", invited_at=workspace.created_at, accepted_at=workspace.created_at,
        ))
    return members


@router.post("/team", response_model=TeamMemberOut, status_code=status.HTTP_201_CREATED)
async def invite_member(
    payload: TeamInvite,
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    member_count = len((await db.execute(select(TeamMember).where(TeamMember.workspace_id == workspace.id))).scalars().all())
    # The owner occupies one implicit seat; invited members consume the rest.
    if member_count + 1 >= workspace.team_seats:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail="No team seats left on this plan")
    user = (await db.execute(select(User).where(User.email == payload.email.lower()))).scalar_one_or_none()
    if user is None:
        # Invited user gets a placeholder account; they claim it via password reset.
        user = User(
            email=payload.email.lower(),
            password_hash=security.hash_password(uuid.uuid4().hex),
            role="member",
        )
        db.add(user)
        await db.flush()
    if user.id == workspace.owner_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That user owns this workspace")
    existing = (await db.execute(
        select(TeamMember).where(TeamMember.workspace_id == workspace.id, TeamMember.user_id == user.id)
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a team member")
    member = TeamMember(workspace_id=workspace.id, user_id=user.id, role=payload.role)
    db.add(member)
    await db.commit()
    return TeamMemberOut(
        id=member.id, user_id=user.id, email=user.email, first_name=user.first_name,
        last_name=user.last_name, role=member.role, invited_at=member.invited_at, accepted_at=member.accepted_at,
    )


@router.delete("/team/{member_id}", response_model=SuccessResponse)
async def remove_member(
    member_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_db),
):
    member = (await db.execute(
        select(TeamMember).where(TeamMember.id == member_id, TeamMember.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team member not found")
    await db.delete(member)
    await db.commit()
    return SuccessResponse(detail="Member removed.")
