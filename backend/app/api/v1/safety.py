import uuid
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import RestrictionEvent, SafetyLog, SendingAccount, User
from app.schemas import (
    AccountHistory,
    RestrictionEventCreate,
    RestrictionEventOut,
    SafetyDashboard,
    SafetyLogOut,
    SendingAccountCreate,
    SendingAccountOut,
    SendingAccountUpdate,
)
from app.services import safety

router = APIRouter(prefix="/safety", tags=["safety"])

# Logging a restriction automatically tightens recommended limits.
SEVERITY_LIMIT_FACTOR = {"warning": 0.9, "soft_limit": 0.75, "hard_limit": 0.5, "suspension": 0.25}


async def _get_account(account_id: uuid.UUID, workspace, db: AsyncSession) -> SendingAccount:
    account = (await db.execute(
        select(SendingAccount).where(SendingAccount.id == account_id, SendingAccount.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sending account not found")
    return account


async def _workspace_accounts(workspace, db: AsyncSession) -> list[SendingAccount]:
    return (await db.execute(
        select(SendingAccount).where(SendingAccount.workspace_id == workspace.id).order_by(SendingAccount.created_at)
    )).scalars().all()


async def _recommendations(workspace, accounts: list[SendingAccount], db: AsyncSession) -> list[str]:
    reply_rate = await safety.reply_rate_async(db, workspace.id)
    optimal_rows = (await db.execute(safety.optimal_hours_stmt(workspace.id))).all()
    optimal = safety.format_optimal_hours(optimal_rows)
    recs: list[str] = []
    for account in accounts:
        recs.extend(safety.generate_safety_recommendations(account, reply_rate, None))
    if optimal:
        recs.append(
            f"Based on your data, prospects engage most on {optimal}. Consider scheduling your sends for those windows."
        )
    if not accounts:
        recs.append("Add a sending account to start tracking account health and send volume.")
    # De-duplicate while preserving order (workspace-level recs can repeat per account).
    seen: set[str] = set()
    return [r for r in recs if not (r in seen or seen.add(r))]


@router.get("/dashboard", response_model=SafetyDashboard)
async def safety_dashboard(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    accounts = await _workspace_accounts(workspace, db)
    return SafetyDashboard(
        accounts=[SendingAccountOut.model_validate(a) for a in accounts],
        recommendations=await _recommendations(workspace, accounts, db),
    )


@router.get("/recommendations")
async def recommendations(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    accounts = await _workspace_accounts(workspace, db)
    return {"recommendations": await _recommendations(workspace, accounts, db)}


@router.get("/accounts", response_model=list[SendingAccountOut])
async def list_accounts(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return await _workspace_accounts(workspace, db)


@router.post("/accounts", response_model=SendingAccountOut, status_code=status.HTTP_201_CREATED)
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


@router.put("/accounts/{account_id}", response_model=SendingAccountOut)
async def update_account(
    account_id: uuid.UUID,
    payload: SendingAccountUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(account_id, workspace, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    account.updated_at = datetime.utcnow()
    await db.commit()
    return account


@router.post("/accounts/{account_id}/restriction", response_model=RestrictionEventOut, status_code=status.HTTP_201_CREATED)
async def log_restriction(
    account_id: uuid.UUID,
    payload: RestrictionEventCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(account_id, workspace, db)
    event = RestrictionEvent(account_id=account.id, **payload.model_dump())
    db.add(event)

    # Automatically reduce recommended limits based on severity.
    factor = SEVERITY_LIMIT_FACTOR[payload.severity]
    account.daily_send_limit = max(5, int(account.daily_send_limit * factor))
    account.weekly_connection_limit = max(10, int(account.weekly_connection_limit * factor))
    if payload.severity == "suspension":
        account.status = "restricted"

    reply_rate = await safety.reply_rate_async(db, workspace.id)
    restrictions = (await db.execute(safety.recent_restrictions_stmt(account.id))).scalars().all()
    account.health_score = Decimal(str(safety.compute_health_score(account, reply_rate, list(restrictions) + [event])))
    account.updated_at = datetime.utcnow()
    await db.commit()
    return event


@router.get("/accounts/{account_id}/history", response_model=AccountHistory)
async def account_history(
    account_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    account = await _get_account(account_id, workspace, db)
    logs = (await db.execute(
        select(SafetyLog).where(SafetyLog.account_id == account.id).order_by(SafetyLog.action_timestamp.desc()).limit(200)
    )).scalars().all()
    events = (await db.execute(
        select(RestrictionEvent).where(RestrictionEvent.account_id == account.id).order_by(RestrictionEvent.detected_at.desc())
    )).scalars().all()
    return AccountHistory(
        safety_logs=[SafetyLogOut.model_validate(l) for l in logs],
        restriction_events=[RestrictionEventOut.model_validate(e) for e in events],
    )
