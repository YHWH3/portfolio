import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import ToneProfile, User, Workspace
from app.schemas import (
    SuccessResponse,
    ToneProfileCreate,
    ToneProfileOut,
    ToneProfileUpdate,
    ToneTestRequest,
    ToneTestResponse,
)
from app.services import tone

router = APIRouter(prefix="/tone-profiles", tags=["tone-profiles"])


async def _get_profile(profile_id: uuid.UUID, workspace: Workspace, db: AsyncSession) -> ToneProfile:
    profile = (await db.execute(
        select(ToneProfile).where(ToneProfile.id == profile_id, ToneProfile.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tone profile not found")
    return profile


async def _clear_other_defaults(db: AsyncSession, workspace_id: uuid.UUID, keep_id: uuid.UUID) -> None:
    await db.execute(
        update(ToneProfile).where(ToneProfile.workspace_id == workspace_id, ToneProfile.id != keep_id).values(is_default=False)
    )


@router.post("", response_model=ToneProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    payload: ToneProfileCreate,
    user: User = Depends(get_current_user),
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    style = await tone.extract_style(payload.sample_messages)
    profile = ToneProfile(
        user_id=user.id,
        workspace_id=workspace.id,
        name=payload.name,
        sample_messages=payload.sample_messages,
        extracted_style=style,
        system_prompt_addon=tone.build_system_prompt_addon(style),
        is_default=payload.is_default,
    )
    db.add(profile)
    await db.flush()
    if payload.is_default:
        await _clear_other_defaults(db, workspace.id, profile.id)
    await db.commit()
    return profile


@router.get("", response_model=list[ToneProfileOut])
async def list_profiles(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return (await db.execute(
        select(ToneProfile).where(ToneProfile.workspace_id == workspace.id).order_by(ToneProfile.created_at.desc())
    )).scalars().all()


@router.get("/{profile_id}", response_model=ToneProfileOut)
async def get_profile(
    profile_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return await _get_profile(profile_id, workspace, db)


@router.put("/{profile_id}", response_model=ToneProfileOut)
async def update_profile(
    profile_id: uuid.UUID,
    payload: ToneProfileUpdate,
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile(profile_id, workspace, db)
    if payload.name is not None:
        profile.name = payload.name
    if payload.sample_messages is not None:
        profile.sample_messages = payload.sample_messages
        style = await tone.extract_style(payload.sample_messages)
        profile.extracted_style = style
        profile.system_prompt_addon = tone.build_system_prompt_addon(style)
    if payload.is_default is not None:
        profile.is_default = payload.is_default
        if payload.is_default:
            await _clear_other_defaults(db, workspace.id, profile.id)
    profile.updated_at = datetime.utcnow()
    await db.commit()
    return profile


@router.delete("/{profile_id}", response_model=SuccessResponse)
async def delete_profile(
    profile_id: uuid.UUID,
    workspace: Workspace = Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile(profile_id, workspace, db)
    await db.delete(profile)
    await db.commit()
    return SuccessResponse(detail="Tone profile deleted.")


@router.post("/{profile_id}/test", response_model=ToneTestResponse)
async def test_profile(
    profile_id: uuid.UUID,
    payload: ToneTestRequest,
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    profile = await _get_profile(profile_id, workspace, db)
    message = await tone.generate_test_message(profile.system_prompt_addon or "", payload.prompt)
    return ToneTestResponse(message=message)
