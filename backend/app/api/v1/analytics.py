import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace
from app.database import get_db
from app.models import Campaign, EngagementHeatmap, RestrictionEvent, SendingAccount
from app.services.analytics import compute_campaign_metrics, workspace_dashboard

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/dashboard")
async def dashboard(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return await workspace_dashboard(db, workspace.id)


@router.get("/heatmap")
async def heatmap(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(
            EngagementHeatmap.hour_of_day,
            EngagementHeatmap.day_of_week,
            func.avg(EngagementHeatmap.engagement_score),
            func.sum(EngagementHeatmap.sample_size),
        )
        .join(Campaign, Campaign.id == EngagementHeatmap.campaign_id)
        .where(Campaign.workspace_id == workspace.id)
        .group_by(EngagementHeatmap.hour_of_day, EngagementHeatmap.day_of_week)
    )).all()
    return {
        "cells": [
            {
                "hour_of_day": int(hour) if hour is not None else None,
                "day_of_week": int(day) if day is not None else None,
                "engagement_score": round(float(score), 3) if score is not None else 0,
                "sample_size": int(samples or 0),
            }
            for hour, day, score, samples in rows
        ]
    }


@router.get("/safety")
async def safety_trends(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    accounts = (await db.execute(
        select(SendingAccount).where(SendingAccount.workspace_id == workspace.id)
    )).scalars().all()
    since = date.today() - timedelta(days=30)
    restrictions = (await db.execute(
        select(RestrictionEvent)
        .where(RestrictionEvent.account_id.in_([a.id for a in accounts]) if accounts else False)
        .order_by(RestrictionEvent.detected_at.desc())
    )).scalars().all() if accounts else []
    return {
        "accounts": [
            {
                "id": str(account.id),
                "account_label": account.account_label,
                "health_score": float(account.health_score),
                "sends_today": account.sends_today,
                "sends_this_week": account.sends_this_week,
                "connections_this_week": account.connections_this_week,
            }
            for account in accounts
        ],
        "recent_restrictions": [
            {
                "id": str(r.id),
                "account_id": str(r.account_id),
                "restriction_type": r.restriction_type,
                "severity": r.severity,
                "detected_at": r.detected_at.isoformat(),
                "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
            }
            for r in restrictions
        ],
    }


@router.get("/campaigns/{campaign_id}")
async def campaign_metrics(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    campaign = (await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    return await compute_campaign_metrics(db, campaign)
