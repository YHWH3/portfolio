"""RAG retrieval over the knowledge base (pgvector cosine search)."""
from sqlalchemy import select, text

from app.config import settings
from app.models import CampaignSource, DocumentChunk, KnowledgeDocument
from app.services.embeddings import embed_single, embed_single_sync

TOP_K = 3
MIN_SIMILARITY = 0.70
# The local hash-based fallback embeddings produce much lower absolute cosine
# similarities than a real embedding model, so the cutoff is scaled down when
# no Voyage API key is configured.
MOCK_SIMILARITY_FACTOR = 0.35


def _effective_min(min_similarity: float) -> float:
    return min_similarity if settings.VOYAGE_API_KEY else min_similarity * MOCK_SIMILARITY_FACTOR


def _search_stmt(query_embedding: list[float], workspace_id, campaign_id, top_k: int):
    distance = DocumentChunk.embedding.cosine_distance(query_embedding)
    stmt = (
        select(DocumentChunk.chunk_text, KnowledgeDocument.filename, (1 - distance).label("similarity"))
        .join(KnowledgeDocument, KnowledgeDocument.id == DocumentChunk.document_id)
        .where(
            KnowledgeDocument.workspace_id == workspace_id,
            KnowledgeDocument.vector_status == "indexed",
            DocumentChunk.embedding.is_not(None),
        )
        .order_by(distance)
        .limit(top_k)
    )
    if campaign_id is not None:
        stmt = stmt.where(
            KnowledgeDocument.id.in_(select(CampaignSource.document_id).where(CampaignSource.campaign_id == campaign_id))
        )
    return stmt


def _filter_rows(rows, min_similarity: float) -> list[dict]:
    return [
        {"text": text, "filename": filename, "similarity": round(float(similarity), 3)}
        for text, filename, similarity in rows
        if float(similarity) >= min_similarity
    ]


# The ivfflat index has poor recall while the table is small (it is created
# before any data exists). Scanning all lists keeps results exact; revisit the
# probe count once the corpus is large enough that approximate search matters.
_PROBES_SQL = text("SET LOCAL ivfflat.probes = 100")


async def retrieve_kb_context(query: str, workspace_id, campaign_id=None, top_k: int = TOP_K, min_similarity: float = MIN_SIMILARITY, db=None) -> list[dict]:
    query_embedding = await embed_single(query)
    await db.execute(_PROBES_SQL)
    rows = (await db.execute(_search_stmt(query_embedding, workspace_id, campaign_id, top_k))).all()
    return _filter_rows(rows, _effective_min(min_similarity))


def retrieve_kb_context_sync(session, query: str, workspace_id, campaign_id=None, top_k: int = TOP_K, min_similarity: float = MIN_SIMILARITY) -> list[dict]:
    query_embedding = embed_single_sync(query)
    session.execute(_PROBES_SQL)
    rows = session.execute(_search_stmt(query_embedding, workspace_id, campaign_id, top_k)).all()
    return _filter_rows(rows, _effective_min(min_similarity))


def format_chunks_for_prompt(chunks: list[dict]) -> str:
    if not chunks:
        return "(no knowledge base context available)"
    return "\n\n".join(f"[Source: {c['filename']}]\n{c['text']}" for c in chunks)
