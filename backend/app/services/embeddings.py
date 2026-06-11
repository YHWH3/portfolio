"""Text embeddings via the Voyage AI API, with a deterministic local fallback.

The fallback hashes word-level features into a fixed 1024-dim vector, so
similar texts (sharing vocabulary) land near each other — good enough for
local development and demos without an API key.
"""
import hashlib
import math
import re

import httpx

from app.config import settings

VOYAGE_URL = "https://api.voyageai.com/v1/embeddings"
VOYAGE_MODEL = "voyage-3.5"
DIM = settings.EMBEDDING_DIM


def mock_embedding(text: str) -> list[float]:
    vector = [0.0] * DIM
    words = re.findall(r"[a-z0-9']+", text.lower())
    for word in words:
        digest = hashlib.sha256(word.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def _parse_response(data: dict) -> list[list[float]]:
    return [item["embedding"] for item in data["data"]]


def embed_texts_sync(texts: list[str]) -> list[list[float]]:
    if not settings.VOYAGE_API_KEY:
        return [mock_embedding(t) for t in texts]
    with httpx.Client(timeout=60) as client:
        response = client.post(
            VOYAGE_URL,
            headers={"Authorization": f"Bearer {settings.VOYAGE_API_KEY}"},
            json={"input": texts, "model": VOYAGE_MODEL, "output_dimension": DIM},
        )
        response.raise_for_status()
        return _parse_response(response.json())


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not settings.VOYAGE_API_KEY:
        return [mock_embedding(t) for t in texts]
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(
            VOYAGE_URL,
            headers={"Authorization": f"Bearer {settings.VOYAGE_API_KEY}"},
            json={"input": texts, "model": VOYAGE_MODEL, "output_dimension": DIM},
        )
        response.raise_for_status()
        return _parse_response(response.json())


async def embed_single(text: str) -> list[float]:
    return (await embed_texts([text]))[0]


def embed_single_sync(text: str) -> list[float]:
    return embed_texts_sync([text])[0]
