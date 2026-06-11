"""Tone cloning: extract a writing-style profile from sample messages and
turn it into a system-prompt addon for the draft engine."""
import json
import re
import statistics

from app.config import settings
from app.services import ai

STYLE_EXTRACTION_PROMPT = """Analyze these LinkedIn messages written by the same person. Extract their writing style as a structured profile:
1. Average sentence length (short/medium/long)
2. Greeting style (formal/casual/none)
3. Sign-off style (formal/casual/none)
4. Emoji usage (never/rare/moderate/frequent)
5. Question usage pattern (leads with question / ends with question / both / rarely)
6. Formality level (1-5 scale)
7. Humor usage (never/occasional/frequent)
8. Key phrases they repeat
9. How they reference the prospect (by name / title / company)
10. Paragraph structure (single block / short paragraphs / bullet points)

Messages:
{sample_messages}

Return as JSON with keys: avg_sentence_length, greeting_style, sign_off_style, emoji_usage, question_pattern, formality_level, humor_usage, key_phrases (array), prospect_reference, paragraph_structure. Return ONLY the JSON object."""

EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F02F✀-➿]"
)


def _heuristic_style(samples: list[str]) -> dict:
    """Offline style extraction — analyzes the samples directly."""
    sentences: list[str] = []
    for sample in samples:
        sentences.extend(s for s in re.split(r"[.!?]+\s*", sample) if s.strip())
    word_counts = [len(s.split()) for s in sentences] or [10]
    avg_words = statistics.mean(word_counts)
    if avg_words < 9:
        length = "short"
    elif avg_words < 16:
        length = "medium"
    else:
        length = "long"

    text = "\n".join(samples)
    lower = text.lower()
    emoji_count = len(EMOJI_RE.findall(text))
    per_message = emoji_count / max(len(samples), 1)
    if per_message == 0:
        emoji = "never"
    elif per_message < 0.5:
        emoji = "rare"
    elif per_message < 1.5:
        emoji = "moderate"
    else:
        emoji = "frequent"

    greeting = "none"
    if any(re.match(r"\s*(dear|hello)\b", s.lower()) for s in samples):
        greeting = "formal"
    elif any(re.match(r"\s*(hi|hey|yo)\b", s.lower()) for s in samples):
        greeting = "casual"

    sign_off = "none"
    if re.search(r"(best regards|sincerely|kind regards)", lower):
        sign_off = "formal"
    elif re.search(r"(cheers|thanks|talk soon|best,)", lower):
        sign_off = "casual"

    leads = sum(1 for s in samples if s.strip().split(".")[0].strip().endswith("?"))
    ends = sum(1 for s in samples if s.strip().endswith("?"))
    if leads and ends:
        question = "both"
    elif ends:
        question = "ends with question"
    elif leads:
        question = "leads with question"
    else:
        question = "rarely"

    formal_markers = len(re.findall(r"\b(regarding|furthermore|pleased|opportunity|sincerely)\b", lower))
    casual_markers = len(re.findall(r"\b(hey|cool|awesome|gonna|stuff|btw|lol)\b", lower)) + emoji_count
    formality = max(1, min(5, 3 + (1 if formal_markers > casual_markers else -1 if casual_markers > formal_markers else 0)))

    words = re.findall(r"[a-z']{4,}", lower)
    counts: dict[str, int] = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    key_phrases = [w for w, c in sorted(counts.items(), key=lambda x: -x[1]) if c >= 2][:5]

    has_paragraph_breaks = any("\n\n" in s for s in samples)
    has_bullets = bool(re.search(r"^\s*[-•*]\s", text, re.MULTILINE))
    structure = "bullet points" if has_bullets else "short paragraphs" if has_paragraph_breaks else "single block"

    return {
        "avg_sentence_length": length,
        "greeting_style": greeting,
        "sign_off_style": sign_off,
        "emoji_usage": emoji,
        "question_pattern": question,
        "formality_level": formality,
        "humor_usage": "occasional" if casual_markers > 2 else "never",
        "key_phrases": key_phrases,
        "prospect_reference": "by name",
        "paragraph_structure": structure,
    }


def build_system_prompt_addon(style: dict) -> str:
    lines = [
        "Match this sender's writing style exactly:",
        f"- Sentence length: {style.get('avg_sentence_length', 'medium')}",
        f"- Greeting style: {style.get('greeting_style', 'casual')}",
        f"- Sign-off style: {style.get('sign_off_style', 'none')}",
        f"- Emoji usage: {style.get('emoji_usage', 'never')}",
        f"- Question pattern: {style.get('question_pattern', 'ends with question')}",
        f"- Formality: {style.get('formality_level', 3)}/5",
        f"- Humor: {style.get('humor_usage', 'never')}",
        f"- References the prospect: {style.get('prospect_reference', 'by name')}",
        f"- Paragraph structure: {style.get('paragraph_structure', 'short paragraphs')}",
    ]
    phrases = style.get("key_phrases") or []
    if phrases:
        lines.append(f"- Phrases this sender naturally uses: {', '.join(phrases)}")
    return "\n".join(lines)


async def extract_style(samples: list[str]) -> dict:
    numbered = "\n\n".join(f"Message {i + 1}:\n{m}" for i, m in enumerate(samples))
    raw = await ai.complete(
        system="You are a writing-style analyst. You respond only with valid JSON.",
        user=STYLE_EXTRACTION_PROMPT.format(sample_messages=numbered),
        model=settings.ANTHROPIC_SONNET_MODEL,
        max_tokens=1024,
        temperature=0.0,
        mock=lambda: json.dumps(_heuristic_style(samples)),
    )
    try:
        return json.loads(ai.extract_json(raw))
    except json.JSONDecodeError:
        return _heuristic_style(samples)


async def generate_test_message(style_addon: str, prompt: str) -> str:
    def mock() -> str:
        return (
            f"Hi there — saw your note about {prompt.strip().rstrip('.')[:60]}. "
            "I've been working on exactly that with a few teams lately and have a couple of ideas worth sharing. "
            "Open to a quick exchange this week?"
        )

    return await ai.complete(
        system=(
            "You draft LinkedIn messages that a human will review before sending.\n"
            f"{style_addon}\n"
            "Write 2-4 sentences. Output ONLY the message text."
        ),
        user=f"Draft a short LinkedIn message about: {prompt}",
        model=settings.ANTHROPIC_SONNET_MODEL,
        max_tokens=300,
        temperature=0.7,
        mock=mock,
    )
