"""Smart CSV parsing for lead import.

Real-world lead exports (Sales Navigator, Apollo, HubSpot, hand-built sheets)
never share one header convention. This module detects which columns mean
what, proposes a mapping the UI can show and let the user correct, and parses
rows through that mapping — including splitting a single "Full Name" column.
"""
import csv
import io
import re

TARGET_FIELDS = ["first_name", "last_name", "name", "linkedin_url", "title", "company", "industry", "location", "email"]

FIELD_SYNONYMS: dict[str, list[str]] = {
    "first_name": ["first name", "firstname", "first", "given name", "fname"],
    "last_name": ["last name", "lastname", "last", "surname", "family name", "lname"],
    "name": ["name", "full name", "fullname", "contact name", "lead name", "prospect name", "contact"],
    "linkedin_url": [
        "linkedin url", "linkedin", "linkedin profile", "linkedin profile url", "linkedin link",
        "profile url", "profile link", "li url", "person linkedin url", "url",
    ],
    "title": ["title", "job title", "position", "role", "designation", "job"],
    "company": ["company", "company name", "organization", "organisation", "employer", "account", "current company", "account name"],
    "industry": ["industry", "sector", "vertical"],
    "location": ["location", "city", "region", "country", "geo", "geography", "area", "state"],
    "email": ["email", "e-mail", "email address", "work email", "contact email", "business email"],
}

LINKEDIN_URL_RE = re.compile(r"linkedin\.com/(in|pub|company)/", re.IGNORECASE)


def _normalize(header: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_\-./]+", " ", (header or "").strip().lower())).strip()


def suggest_mapping(headers: list[str], sample_rows: list[dict] | None = None) -> dict[str, str]:
    """Returns {target_field: original_csv_header} for every field we can place."""
    normalized = {_normalize(h): h for h in headers if h}
    mapping: dict[str, str] = {}
    for field in TARGET_FIELDS:
        candidates = [_normalize(field)] + [_normalize(s) for s in FIELD_SYNONYMS.get(field, [])]
        for candidate in candidates:
            if candidate in normalized and normalized[candidate] not in mapping.values():
                mapping[field] = normalized[candidate]
                break
    # Content sniffing: find a LinkedIn URL column by its values if headers didn't say so.
    if "linkedin_url" not in mapping and sample_rows:
        for header in headers:
            if header in mapping.values():
                continue
            values = [str(row.get(header, "")) for row in sample_rows]
            if any(LINKEDIN_URL_RE.search(v) for v in values):
                mapping["linkedin_url"] = header
                break
    # A full-name column is only useful if we lack first/last.
    if "first_name" in mapping and "last_name" in mapping:
        mapping.pop("name", None)
    return mapping


def missing_required(mapping: dict[str, str]) -> list[str]:
    missing: list[str] = []
    if "first_name" not in mapping and "name" not in mapping:
        missing.append("first_name")
    if "last_name" not in mapping and "name" not in mapping:
        missing.append("last_name")
    if "linkedin_url" not in mapping:
        missing.append("linkedin_url")
    return missing


def read_csv(raw: bytes) -> tuple[list[str], list[dict]]:
    """Returns (headers, rows-as-dicts). Handles BOM and odd encodings."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip() for h in (reader.fieldnames or []) if h and h.strip()]
    rows = []
    for raw_row in reader:
        rows.append({(k or "").strip(): (v or "").strip() for k, v in raw_row.items()})
    return headers, rows


def split_full_name(full_name: str) -> tuple[str, str]:
    parts = full_name.strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def extract_lead(row: dict, mapping: dict[str, str]) -> dict:
    """Applies a mapping to one CSV row, returning canonical lead fields."""

    def value(field: str) -> str:
        header = mapping.get(field)
        return row.get(header, "").strip() if header else ""

    first, last = value("first_name"), value("last_name")
    if (not first or not last) and mapping.get("name"):
        split_first, split_last = split_full_name(value("name"))
        first = first or split_first
        last = last or split_last
    url = value("linkedin_url")
    if url and not url.lower().startswith("http"):
        url = f"https://{url.lstrip('/')}"
    return {
        "first_name": first,
        "last_name": last,
        "linkedin_url": url,
        "title": value("title") or None,
        "company": value("company") or None,
        "industry": value("industry") or None,
        "location": value("location") or None,
        "email": value("email") or None,
    }
