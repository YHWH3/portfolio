import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.database import get_db
from app.models import User, Workspace
from app.schemas import (
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SuccessResponse,
    TokenResponse,
    UserOut,
    WorkspaceOut,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

TRIAL_DAYS = 7


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(select(User).where(User.email == payload.email.lower()))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    user = User(
        email=payload.email.lower(),
        password_hash=security.hash_password(payload.password),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role="owner",
        subscription_tier="trial",
        trial_ends_at=datetime.utcnow() + timedelta(days=TRIAL_DAYS),
    )
    db.add(user)
    await db.flush()
    workspace = Workspace(name=f"{payload.first_name}'s Workspace", owner_id=user.id)
    db.add(workspace)
    await db.commit()
    return AuthResponse(
        user=UserOut.model_validate(user),
        token=security.create_access_token(str(user.id)),
        refresh_token=await security.create_refresh_token(str(user.id)),
        workspace=WorkspaceOut.model_validate(workspace),
    )


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == payload.email.lower()))).scalar_one_or_none()
    if user is None or not security.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    return AuthResponse(
        user=UserOut.model_validate(user),
        token=security.create_access_token(str(user.id)),
        refresh_token=await security.create_refresh_token(str(user.id)),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest):
    user_id = await security.consume_refresh_token(payload.refresh_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    return TokenResponse(
        token=security.create_access_token(user_id),
        refresh_token=await security.create_refresh_token(user_id),
    )


@router.post("/forgot-password", response_model=SuccessResponse)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == payload.email.lower()))).scalar_one_or_none()
    if user is not None:
        token = await security.create_password_reset_token(str(user.id))
        # No email provider is wired up in this build — the reset link is
        # delivered via the application log instead.
        logger.info("Password reset token for %s: %s", user.email, token)
    # Always succeed so the endpoint can't be used to enumerate accounts.
    return SuccessResponse(detail="If that email exists, a reset link has been sent.")


@router.post("/reset-password", response_model=SuccessResponse)
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user_id = await security.consume_password_reset_token(payload.token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")
    import uuid as uuid_module

    user = await db.get(User, uuid_module.UUID(user_id))
    if user is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not found")
    user.password_hash = security.hash_password(payload.new_password)
    await db.commit()
    return SuccessResponse(detail="Password updated.")
