"""Intent classification and sentiment scoring for prospect replies (Claude Haiku)."""
import json

from app.config import settings
from app.services import ai

POSITIVE_WORDS = {
    "interested", "great", "good", "love", "sure", "yes", "thanks", "awesome",
    "perfect", "definitely", "happy", "keen", "curious", "sounds",
}
NEGATIVE_WORDS = {
    "not", "no", "never", "stop", "spam", "annoying", "busy", "expensive",
    "unsubscribe", "remove", "pass", "won't", "can't", "don't",
}

CLASSIFY_PROMPT = """Classify this LinkedIn reply from a prospect.

Available intents:
{intent_list}

Prospect reply:
\"\"\"{message}\"\"\"

Return ONLY a JSON object: {{"intent": "<intent name>", "sentiment": <float -1.0 to 1.0>}}"""


def _mock_sentiment(text: str) -> float:
    words = set(text.lower().split())
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    if pos == neg == 0:
        return 0.0
    return round(max(-1.0, min(1.0, (pos - neg) / max(pos + neg, 1))), 3)


def mock_classify(message: str, intents: list[dict]) -> dict:
    """Keyword matching against the intents table — the offline fallback."""
    lower = message.lower()
    best_name = "question_product"
    best_hits = 0
    for intent in intents:
        hits = sum(1 for pattern in (intent.get("trigger_patterns") or []) if pattern in lower)
        if hits > best_hits:
            best_hits = hits
            best_name = intent["name"]
    if best_hits == 0:
        sentiment = _mock_sentiment(message)
        best_name = "interest_positive" if sentiment > 0.3 else "interest_exploring"
    return {"intent": best_name, "sentiment": _mock_sentiment(message)}


def _parse(raw: str, message: str, intents: list[dict]) -> dict:
    try:
        data = json.loads(ai.extract_json(raw))
        names = {i["name"] for i in intents}
        if data.get("intent") not in names:
            return mock_classify(message, intents)
        data["sentiment"] = max(-1.0, min(1.0, float(data.get("sentiment", 0.0))))
        return data
    except (json.JSONDecodeError, TypeError, ValueError):
        return mock_classify(message, intents)


def _prompt(message: str, intents: list[dict]) -> str:
    intent_list = "\n".join(
        f"- {i['name']}: triggers like {', '.join((i.get('trigger_patterns') or [])[:5])}" for i in intents
    )
    return CLASSIFY_PROMPT.format(intent_list=intent_list, message=message)


def classify_sync(message: str, intents: list[dict]) -> dict:
    raw = ai.complete_sync(
        system="You classify sales messages. Respond only with valid JSON.",
        user=_prompt(message, intents),
        model=settings.ANTHROPIC_HAIKU_MODEL,
        max_tokens=200,
        temperature=0.0,
        mock=lambda: json.dumps(mock_classify(message, intents)),
    )
    return _parse(raw, message, intents)


async def classify(message: str, intents: list[dict]) -> dict:
    raw = await ai.complete(
        system="You classify sales messages. Respond only with valid JSON.",
        user=_prompt(message, intents),
        model=settings.ANTHROPIC_HAIKU_MODEL,
        max_tokens=200,
        temperature=0.0,
        mock=lambda: json.dumps(mock_classify(message, intents)),
    )
    return _parse(raw, message, intents)


# Priority scoring (spec: Reply Draft Generation, Stage 2)
BASE_SCORES = {
    "booking_request": 1.0,
    "interest_positive": 0.75,
    "contact_request": 0.70,
    "interest_exploring": 0.50,
    "objection_price": 0.40,
}
HOT_LEAD_THRESHOLD = 0.85


def compute_priority(intent_name: str, sentiment: float, turn_count: int) -> float:
    base = BASE_SCORES.get(intent_name, 0.30)
    priority = base + (max(0.0, sentiment) * 0.15) + min(turn_count / 10, 0.10)
    return round(min(priority, 1.0), 2)
