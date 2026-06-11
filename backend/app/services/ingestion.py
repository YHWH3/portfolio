"""Knowledge document ingestion: extract → clean → chunk."""
import re

import httpx

CHUNK_TOKENS = 512
OVERLAP_TOKENS = 128
WORDS_PER_TOKEN = 0.75  # Approximation: 512 tokens ≈ 384 words.

CHUNK_WORDS = int(CHUNK_TOKENS * WORDS_PER_TOKEN)
OVERLAP_WORDS = int(OVERLAP_TOKENS * WORDS_PER_TOKEN)


def extract_text(file_path: str | None, file_type: str, url: str | None = None) -> str:
    if file_type == "pdf":
        import pdfplumber

        pages = []
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                pages.append(page.extract_text() or "")
        return "\n\n".join(pages)
    if file_type == "docx":
        import docx

        document = docx.Document(file_path)
        return "\n\n".join(p.text for p in document.paragraphs)
    if file_type == "txt":
        with open(file_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    if file_type == "url":
        from bs4 import BeautifulSoup

        response = httpx.get(url, timeout=30, follow_redirects=True)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()
        return soup.get_text(separator="\n")
    raise ValueError(f"Unsupported file type: {file_type}")


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\x00", "")
    # Collapse runs of blank lines and excessive whitespace.
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Drop very short repeated lines (typical headers/footers/page numbers).
    lines = [line.strip() for line in text.split("\n")]
    counts: dict[str, int] = {}
    for line in lines:
        if 0 < len(line) < 60:
            counts[line] = counts.get(line, 0) + 1
    cleaned = [line for line in lines if not (0 < len(line) < 60 and counts.get(line, 0) >= 4) and not re.fullmatch(r"page \d+( of \d+)?", line.lower())]
    return "\n".join(cleaned).strip()


def chunk_text(text: str) -> list[str]:
    """Paragraph-aware chunking: pack paragraphs up to ~512 tokens, with
    ~128 tokens of trailing overlap carried into the next chunk."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    current_words: list[str] = []

    def flush():
        if current_words:
            chunks.append(" ".join(current_words))

    for paragraph in paragraphs:
        words = paragraph.split()
        if len(words) > CHUNK_WORDS:
            # Oversized paragraph — split it on word boundaries.
            flush()
            current_words = []
            start = 0
            while start < len(words):
                piece = words[start : start + CHUNK_WORDS]
                chunks.append(" ".join(piece))
                start += CHUNK_WORDS - OVERLAP_WORDS
            continue
        if len(current_words) + len(words) > CHUNK_WORDS:
            flush()
            current_words = current_words[-OVERLAP_WORDS:] if OVERLAP_WORDS else []
        current_words.extend(words)
    flush()
    return [c for c in chunks if c.strip()]
