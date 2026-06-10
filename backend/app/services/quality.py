"""Lead quality scoring: profile completeness + ICP match."""
from app.models import ICPDefinition, Lead

WEIGHTS = {
    "has_linkedin_url": 0.15,
    "has_title": 0.10,
    "has_company": 0.10,
    "has_headline": 0.05,
    "has_about": 0.05,
    "has_recent_posts": 0.10,
    "title_matches_icp": 0.15,
    "industry_matches_icp": 0.10,
    "company_size_matches_icp": 0.10,
    "geography_matches_icp": 0.10,
}


def _matches_any(value: str | None, options: list[str] | None) -> bool:
    if not value or not options:
        return False
    lower = value.lower()
    return any(option.lower() in lower or lower in option.lower() for option in options)


def compute_quality_score(lead: Lead, icp: ICPDefinition | None) -> tuple[float, float]:
    """Returns (quality_score 0-1, icp_match_pct 0-100)."""
    score = 0.0
    if lead.linkedin_url:
        score += WEIGHTS["has_linkedin_url"]
    if lead.title:
        score += WEIGHTS["has_title"]
    if lead.company:
        score += WEIGHTS["has_company"]
    if lead.headline:
        score += WEIGHTS["has_headline"]
    if lead.about_summary:
        score += WEIGHTS["has_about"]
    if lead.recent_posts:
        score += WEIGHTS["has_recent_posts"]

    icp_hits = 0
    icp_criteria = 0
    if icp is not None:
        company_size = (lead.custom_fields or {}).get("company_size")
        checks = [
            ("title_matches_icp", _matches_any(lead.title, icp.titles), bool(icp.titles)),
            ("industry_matches_icp", _matches_any(lead.industry, icp.industries), bool(icp.industries)),
            ("company_size_matches_icp", _matches_any(company_size, icp.company_sizes), bool(icp.company_sizes)),
            ("geography_matches_icp", _matches_any(lead.location, icp.geographies), bool(icp.geographies)),
        ]
        for key, matched, defined in checks:
            if not defined:
                continue
            icp_criteria += 1
            if matched:
                icp_hits += 1
                score += WEIGHTS[key]
        if icp.exclusion_list and (
            _matches_any(lead.company, icp.exclusion_list) or _matches_any(lead.title, icp.exclusion_list)
        ):
            score = max(0.0, score - 0.5)
    else:
        # No ICP defined — award partial credit so completeness still dominates.
        if lead.title:
            score += WEIGHTS["title_matches_icp"] * 0.5
        if lead.industry:
            score += WEIGHTS["industry_matches_icp"] * 0.5

    icp_match_pct = round((icp_hits / icp_criteria) * 100, 2) if icp_criteria else 0.0
    return round(min(score, 1.0), 2), icp_match_pct
