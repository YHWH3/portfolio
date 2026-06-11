import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import RestrictionEvent, SafetyLog, SendingAccount, User
from app.schemas import (
    ConnectAccountRequest,
    ConnectAccountResponse,
    SendingAccountCreate,
    SendingAccountOut,
    SendingAccountUpdate,
    SuccessResponse,
)
from app.services import delivery

router = APIRouter(prefix="/sending-accounts", tags=["sending-accounts"])


@router.get("", response_model=list[SendingAccountOut])
async def list_accounts(
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return (await db.execute(
        select(SendingAccount).where(SendingAccount.workspace_id == workspace.id).order_by(SendingAccount.created_at)
    )).scalars().all()


@router.post("", response_model=SendingAccountOut, status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: SendingAccountCreate,
    user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    account = SendingAccount(user_id=user.id, workspace_id=workspace.id, **payload.model_dump())
    db.add(account)
    await db.commit()
    return account


@router.put("/{account_id}", response_model=SendingAccountOut)
async def update_account(
    account_id: uuid.UUID,
    payload: SendingAccountUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    account = (await db.execute(
        select(SendingAccount).where(SendingAccount.id == account_id, SendingAccount.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sending account not found")
    data = payload.model_dump(exclude_unset=True)
    # Pasting a provider account id implies the unipile provider.
    if data.get("provider_account_id") and "provider" not in data:
        data["provider"] = "unipile"
    for field, value in data.items():
        setattr(account, field, value)
    await db.commit()
    return account


@router.post("/{account_id}/connect", response_model=ConnectAccountResponse)
async def connect_account(
    account_id: uuid.UUID,
    payload: ConnectAccountRequest,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    """Start linking this sending account to the delivery provider: returns a
    hosted login page where the user signs into LinkedIn. After linking, the
    provider account id is saved on this account (paste it via the edit form,
    or a webhook fills it in hosted deployments)."""
    account = (await db.execute(
        select(SendingAccount).where(SendingAccount.id == account_id, SendingAccount.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sending account not found")
    try:
        url = await delivery.create_hosted_auth_link(payload.success_redirect_url)
    except delivery.DeliveryError as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    return ConnectAccountResponse(
        url=url,
        instructions=(
            "Open the link and sign in to LinkedIn to connect this account. "
            "Then paste the provider account id from your Unipile dashboard into this account's settings — "
            "approved sends will be delivered from your LinkedIn automatically."
        ),
    )


@router.delete("/{account_id}", response_model=SuccessResponse)
async def delete_account(
    account_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    account = (await db.execute(
        select(SendingAccount).where(SendingAccount.id == account_id, SendingAccount.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sending account not found")
    # safety_logs and restriction_events reference the account without cascade.
    await db.execute(SafetyLog.__table__.delete().where(SafetyLog.account_id == account.id))
    await db.execute(RestrictionEvent.__table__.delete().where(RestrictionEvent.account_id == account.id))
    await db.delete(account)
    await db.commit()
    return SuccessResponse(detail="Sending account removed.")
