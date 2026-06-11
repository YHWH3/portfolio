import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_workspace, require_role
from app.config import settings
from app.database import get_db
from app.models import Campaign, CampaignSource, DocumentChunk, KnowledgeDocument
from app.schemas import (
    CampaignSourceCreate,
    CampaignSourceOut,
    KBChatRequest,
    KBChatResponse,
    KnowledgeDocumentOut,
    SuccessResponse,
)
from app.services import ai, rag

router = APIRouter(tags=["knowledge-base"])

ALLOWED_EXTENSIONS = {"pdf": "pdf", "docx": "docx", "txt": "txt"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


@router.post("/kb/upload", response_model=KnowledgeDocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    extension = (file.filename or "").rsplit(".", 1)[-1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type .{extension} — use pdf, docx, or txt",
        )
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File exceeds 20MB limit")

    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    document = KnowledgeDocument(
        workspace_id=workspace.id,
        filename=file.filename,
        file_type=ALLOWED_EXTENSIONS[extension],
        file_size=len(content),
    )
    db.add(document)
    await db.flush()
    file_path = os.path.join(settings.UPLOAD_DIR, f"{document.id}.{extension}")
    with open(file_path, "wb") as f:
        f.write(content)
    document.file_path = file_path
    await db.commit()

    from app.tasks import ingest_document_task

    ingest_document_task.delay(str(document.id))
    return document


@router.get("/kb/documents", response_model=list[KnowledgeDocumentOut])
async def list_documents(workspace=Depends(get_current_workspace), db: AsyncSession = Depends(get_db)):
    return (await db.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.workspace_id == workspace.id).order_by(KnowledgeDocument.created_at.desc())
    )).scalars().all()


@router.delete("/kb/documents/{document_id}", response_model=SuccessResponse)
async def delete_document(
    document_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    document = (await db.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.id == document_id, KnowledgeDocument.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    # Purge vectors and campaign attachments, then the document itself.
    await db.execute(DocumentChunk.__table__.delete().where(DocumentChunk.document_id == document.id))
    await db.execute(CampaignSource.__table__.delete().where(CampaignSource.document_id == document.id))
    if document.file_path and os.path.exists(document.file_path):
        os.remove(document.file_path)
    await db.delete(document)
    await db.commit()
    return SuccessResponse(detail="Document and vectors deleted.")


@router.post("/kb/chat", response_model=KBChatResponse)
async def kb_chat(
    payload: KBChatRequest,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    chunks = await rag.retrieve_kb_context(payload.query, workspace.id, payload.campaign_id, top_k=5, min_similarity=0.4, db=db)
    if not chunks:
        return KBChatResponse(
            answer="I couldn't find anything relevant in your knowledge base for that question. Try uploading documents that cover this topic.",
            sources=[],
        )

    def mock_answer() -> str:
        top = chunks[0]
        return (
            f"Based on your knowledge base ({top['filename']}): "
            f"{top['text'][:400].rstrip()}{'…' if len(top['text']) > 400 else ''}"
        )

    answer = await ai.complete(
        system=(
            "Answer the user's question using ONLY the provided knowledge base context. "
            "If the context doesn't contain the answer, say so. Be concise.\n\n"
            f"CONTEXT:\n{rag.format_chunks_for_prompt(chunks)}"
        ),
        user=payload.query,
        max_tokens=500,
        temperature=0.2,
        mock=mock_answer,
    )
    return KBChatResponse(answer=answer, sources=sorted({c["filename"] for c in chunks}))


# ---- Campaign sources ----

@router.post("/campaigns/{campaign_id}/sources", response_model=CampaignSourceOut, status_code=status.HTTP_201_CREATED)
async def attach_source(
    campaign_id: uuid.UUID,
    payload: CampaignSourceCreate,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    campaign = (await db.execute(
        select(Campaign).where(Campaign.id == campaign_id, Campaign.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if campaign is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    document = (await db.execute(
        select(KnowledgeDocument).where(KnowledgeDocument.id == payload.document_id, KnowledgeDocument.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    existing = (await db.execute(
        select(CampaignSource).where(CampaignSource.campaign_id == campaign_id, CampaignSource.document_id == payload.document_id)
    )).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document already attached")
    source = CampaignSource(campaign_id=campaign_id, document_id=payload.document_id, priority=payload.priority)
    db.add(source)
    await db.commit()
    return CampaignSourceOut(
        id=source.id, campaign_id=campaign_id, document_id=payload.document_id,
        priority=source.priority, filename=document.filename,
    )


@router.get("/campaigns/{campaign_id}/sources", response_model=list[CampaignSourceOut])
async def list_sources(
    campaign_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(CampaignSource, KnowledgeDocument.filename)
        .join(KnowledgeDocument, KnowledgeDocument.id == CampaignSource.document_id)
        .join(Campaign, Campaign.id == CampaignSource.campaign_id)
        .where(CampaignSource.campaign_id == campaign_id, Campaign.workspace_id == workspace.id)
        .order_by(CampaignSource.priority.desc())
    )).all()
    return [
        CampaignSourceOut(id=s.id, campaign_id=s.campaign_id, document_id=s.document_id, priority=s.priority, filename=filename)
        for s, filename in rows
    ]


@router.delete("/campaigns/{campaign_id}/sources/{source_id}", response_model=SuccessResponse)
async def remove_source(
    campaign_id: uuid.UUID,
    source_id: uuid.UUID,
    workspace=Depends(get_current_workspace),
    _role: str = Depends(require_role("member")),
    db: AsyncSession = Depends(get_db),
):
    source = (await db.execute(
        select(CampaignSource)
        .join(Campaign, Campaign.id == CampaignSource.campaign_id)
        .where(CampaignSource.id == source_id, CampaignSource.campaign_id == campaign_id, Campaign.workspace_id == workspace.id)
    )).scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")
    await db.delete(source)
    await db.commit()
    return SuccessResponse(detail="Source removed.")
