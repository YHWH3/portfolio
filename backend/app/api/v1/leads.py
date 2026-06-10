import csv
import io
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_current_workspace, require_role
from app.database import get_db
from app.models import ICPDefinition, Lead, LinkedInSignal, User
from app.schemas import (
    ICPCreate,
    ICPOut,
    LeadCreate,
    LeadImportResult,
    LeadOut,
    LeadSearchRequest,
    LeadUpdate,
    Paginated,
    SignalOut,
    SuccessResponse,
)

router = APIRouter(tags=["leads"])

REQUIRED_CSV_COLUMNS = {"first_name", "last_name", "linkedin_url"}
OPTIONAL_CSV_COLUMNS = {"title", "company", "industry", "location", "email"} | {f"custom_field_{i}" for i in range(1, 6)}
EXPORT_COLUMNS = [
    "first_name", "last_name", "linkedin_url", "title", "company", "industry",
    "location", "email", "status", "quality_score", "icp_match_pct",
]


async def _get_lead(lead_id: uuid.UUID, workspace, db: AsyncSession) -> Lead:
    lead = (await db.execute(
        select(Lead).where(Lead.id == lead_id, Lead.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if lead is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found")
    return lead


def _make_lead(workspace_id, data: dict, source: str) -> Lead:
    custom_fields = data.pop("custom_fields", {}) or {}
    lead = Lead(
        workspace_id=workspace_id,
        source=source,
        name=f"{data.get('first_name', '')} {data.get('last_name', '')}".strip(),
        custom_fields=custom_fields,
        **data,
    )
    return lead


@router.get("/leads", response_model=Paginated)
async def list_leads(
    campaign_id: uuid.UUID | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    min_score: float | None = Query(default=None, ge=0, le=1),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    base = select(Lead).where(Lead.workspace_id == workspace.id)
    if campaign_id is not None:
        base = base.where(Lead.campaign_id == campaign_id)
    if status_filter:
        base = base.where(Lead.status == status_filter)
    else:
        base = base.where(Lead.status != "archived")
    if min_score is not None:
        base = base.where(Lead.quality_score >= min_score)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    rows = (await db.execute(
        base.order_by(Lead.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    return Paginated(items=[LeadOut.model_validate(l).model_dump(mode="json") for l in rows], total=total, page=page, page_size=page_size)


@router.post("/leads", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
async def create_lead(
    payload: LeadCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    lead = _make_lead(workspace.id, payload.model_dump(), source="manual")
    db.add(lead)
    await db.commit()
    return lead


@router.post("/leads/import", response_model=LeadImportResult)
async def import_leads(
    file: UploadFile = File(...),
    campaign_id: uuid.UUID | None = Form(default=None),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty CSV file")
    headers = {h.strip().lower() for h in reader.fieldnames if h}
    missing = REQUIRED_CSV_COLUMNS - headers
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing required columns: {', '.join(sorted(missing))}",
        )

    existing_urls = set((await db.execute(
        select(Lead.linkedin_url).where(Lead.workspace_id == workspace.id, Lead.linkedin_url.is_not(None))
    )).scalars().all())

    imported, skipped, errors = 0, 0, []
    for row_number, raw_row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw_row.items()}
        if not row.get("first_name") or not row.get("last_name") or not row.get("linkedin_url"):
            skipped += 1
            errors.append(f"Row {row_number}: missing required values")
            continue
        if row["linkedin_url"] in existing_urls:
            skipped += 1
            errors.append(f"Row {row_number}: duplicate linkedin_url")
            continue
        existing_urls.add(row["linkedin_url"])
        custom_fields = {key: row[key] for key in row if key.startswith("custom_field_") and row[key]}
        lead = Lead(
            workspace_id=workspace.id,
            campaign_id=campaign_id,
            source="csv_import",
            first_name=row["first_name"],
            last_name=row["last_name"],
            name=f"{row['first_name']} {row['last_name']}",
            linkedin_url=row["linkedin_url"],
            title=row.get("title") or None,
            company=row.get("company") or None,
            industry=row.get("industry") or None,
            location=row.get("location") or None,
            email=row.get("email") or None,
            custom_fields=custom_fields,
        )
        db.add(lead)
        imported += 1
    await db.commit()
    return LeadImportResult(imported=imported, skipped=skipped, errors=errors[:50])


@router.get("/leads/curated", response_model=list[LeadOut])
async def curated_leads(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return (await db.execute(
        select(Lead).where(
            Lead.workspace_id == workspace.id,
            Lead.quality_score >= 0.80,
            Lead.status != "archived",
        ).order_by(Lead.quality_score.desc()).limit(200)
    )).scalars().all()


@router.get("/leads/export")
async def export_leads(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    leads = (await db.execute(
        select(Lead).where(Lead.workspace_id == workspace.id, Lead.status != "archived").order_by(Lead.created_at)
    )).scalars().all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for lead in leads:
        writer.writerow([
            lead.first_name, lead.last_name, lead.linkedin_url, lead.title, lead.company,
            lead.industry, lead.location, lead.email, lead.status,
            float(lead.quality_score) if lead.quality_score is not None else "",
            float(lead.icp_match_pct) if lead.icp_match_pct is not None else "",
        ])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads_export.csv"},
    )


@router.post("/leads/search", response_model=list[LeadOut])
async def search_leads(
    payload: LeadSearchRequest,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    titles, industries, geographies = payload.titles, payload.industries, payload.geographies
    if payload.icp_id is not None:
        icp = (await db.execute(
            select(ICPDefinition).where(ICPDefinition.id == payload.icp_id, ICPDefinition.workspace_id == workspace.id)
        )).scalar_one_or_none()
        if icp is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ICP not found")
        titles = titles or icp.titles
        industries = industries or icp.industries
        geographies = geographies or icp.geographies
    stmt = select(Lead).where(Lead.workspace_id == workspace.id, Lead.status != "archived")
    if titles:
        stmt = stmt.where(func.lower(Lead.title).in_([t.lower() for t in titles]) | Lead.title.ilike(f"%{titles[0]}%"))
    if industries:
        stmt = stmt.where(Lead.industry.in_(industries))
    if geographies:
        stmt = stmt.where(Lead.location.in_(geographies))
    if payload.min_quality_score is not None:
        stmt = stmt.where(Lead.quality_score >= payload.min_quality_score)
    return (await db.execute(stmt.order_by(Lead.quality_score.desc().nulls_last()).limit(200))).scalars().all()


@router.get("/leads/{lead_id}")
async def get_lead(
    lead_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    lead = await _get_lead(lead_id, workspace, db)
    signals = (await db.execute(
        select(LinkedInSignal).where(LinkedInSignal.lead_id == lead.id).order_by(LinkedInSignal.detected_at.desc())
    )).scalars().all()
    return {
        **LeadOut.model_validate(lead).model_dump(mode="json"),
        "signals": [SignalOut.model_validate(s).model_dump(mode="json") for s in signals],
    }


@router.put("/leads/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: uuid.UUID,
    payload: LeadUpdate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    lead = await _get_lead(lead_id, workspace, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(lead, field, value)
    if payload.first_name or payload.last_name:
        lead.name = f"{lead.first_name or ''} {lead.last_name or ''}".strip()
    lead.updated_at = datetime.utcnow()
    await db.commit()
    return lead


@router.delete("/leads/{lead_id}", response_model=SuccessResponse)
async def archive_lead(
    lead_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    lead = await _get_lead(lead_id, workspace, db)
    lead.status = "archived"
    lead.updated_at = datetime.utcnow()
    await db.commit()
    return SuccessResponse(detail="Lead archived.")


@router.post("/leads/{lead_id}/enrich")
async def enrich_lead(
    lead_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    lead = await _get_lead(lead_id, workspace, db)
    from app.tasks import enrich_lead_task

    enrich_lead_task.delay(str(lead.id))
    return {"queued": True}


# ---- ICP definitions ----

@router.post("/icp", response_model=ICPOut, status_code=status.HTTP_201_CREATED)
async def create_icp(
    payload: ICPCreate,
    user: User = Depends(get_current_user),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    icp = ICPDefinition(user_id=user.id, workspace_id=workspace.id, **payload.model_dump())
    db.add(icp)
    await db.commit()
    return icp


@router.get("/icp", response_model=list[ICPOut])
async def list_icps(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return (await db.execute(
        select(ICPDefinition).where(ICPDefinition.workspace_id == workspace.id).order_by(ICPDefinition.created_at)
    )).scalars().all()


# ---- Signals ----

@router.get("/signals", response_model=list[SignalOut])
async def list_signals(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return (await db.execute(
        select(LinkedInSignal)
        .join(Lead, Lead.id == LinkedInSignal.lead_id)
        .where(Lead.workspace_id == workspace.id)
        .order_by(LinkedInSignal.relevance_score.desc().nulls_last(), LinkedInSignal.detected_at.desc())
        .limit(200)
    )).scalars().all()
