from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace
from app.database import get_db
from app.models import Persona, Workspace
from app.schemas import PersonaOut

router = APIRouter(prefix="/personas", tags=["personas"])


@router.get("", response_model=list[PersonaOut])
async def list_personas(
    workspace: Workspace = Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    return (await db.execute(
        select(Persona).where(or_(Persona.workspace_id.is_(None), Persona.workspace_id == workspace.id)).order_by(Persona.created_at)
    )).scalars().all()
