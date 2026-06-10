"""Lead enrichment provider.

In production this would call an API-based enrichment provider (e.g. a
LinkedIn data API for public profile data and Hunter.io for email discovery).
No provider credentials are configured in this build, so it ships with a
deterministic mock that produces realistic, stable data per lead — the rest of
the pipeline (quality scoring, signals, draft personalization) runs unchanged.
"""
import hashlib
import random
from datetime import datetime, timedelta

INDUSTRIES = ["SaaS", "Fintech", "Healthcare Tech", "E-commerce", "Cybersecurity", "MarTech", "EdTech", "Logistics"]
POST_TOPICS = [
    "scaling outbound without burning your domain",
    "lessons from moving upmarket to enterprise",
    "why personalization beats volume in 2026",
    "hiring their first RevOps lead",
    "AI copilots in the sales workflow",
    "building a partner-led growth motion",
    "the death of the cold email template",
    "customer retention as the new acquisition",
]
COMPANY_NEWS = [
    "announced a new product line",
    "opened a new office",
    "was featured in an industry report",
    "closed a Series B round",
    "launched a partner program",
]
FIRST_NAMES = ["Jordan", "Sam", "Alex", "Priya", "Marcus", "Elena", "Chris", "Dana"]


def _rng_for(lead) -> random.Random:
    seed_source = (lead.linkedin_url or lead.email or f"{lead.first_name}{lead.last_name}{lead.company}") or str(lead.id)
    seed = int.from_bytes(hashlib.sha256(seed_source.encode()).digest()[:8], "big")
    return random.Random(seed)


def enrich_lead_data(lead) -> dict:
    """Returns enriched profile fields + detected signals for a lead."""
    rng = _rng_for(lead)
    title = lead.title or rng.choice(["Head of Sales", "VP Marketing", "Founder", "Director of Growth", "CRO"])
    company = lead.company or "their company"
    industry = lead.industry or rng.choice(INDUSTRIES)

    headline = f"{title} at {company} | {rng.choice(['Helping B2B teams grow', 'Building modern GTM', industry + ' operator', 'Revenue leader'])}"
    about = (
        f"{lead.first_name or 'They'} leads {rng.choice(['growth', 'revenue', 'go-to-market', 'sales'])} at {company}, "
        f"focused on {rng.choice(POST_TOPICS)}. Previously spent {rng.randint(3, 12)} years in {industry}."
    )

    recent_posts = []
    for i in range(rng.randint(1, 3)):
        days_ago = rng.randint(1, 21)
        recent_posts.append({
            "topic": rng.choice(POST_TOPICS),
            "posted_at": (datetime.utcnow() - timedelta(days=days_ago)).date().isoformat(),
            "engagement": rng.randint(5, 400),
        })

    mutual_connections = [
        {"name": f"{rng.choice(FIRST_NAMES)} {rng.choice(['Lee', 'Patel', 'Garcia', 'Kim', 'Novak'])}",
         "title": rng.choice(["Account Executive", "Founder", "CTO", "Growth Advisor"])}
        for _ in range(rng.randint(0, 3))
    ]

    signals = []
    if rng.random() < 0.35:
        signals.append({
            "signal_type": "job_change",
            "signal_data": {"summary": f"Started a new role as {title} at {company} {rng.randint(1, 5)} months ago"},
            "relevance_score": round(rng.uniform(0.7, 0.95), 2),
        })
    if recent_posts:
        signals.append({
            "signal_type": "post_engagement",
            "signal_data": {"summary": f"Recently posted about {recent_posts[0]['topic']}", "topic": recent_posts[0]["topic"]},
            "relevance_score": round(rng.uniform(0.6, 0.9), 2),
        })
    if rng.random() < 0.25:
        signals.append({
            "signal_type": "company_news",
            "signal_data": {"summary": f"{company} {rng.choice(COMPANY_NEWS)}"},
            "relevance_score": round(rng.uniform(0.5, 0.85), 2),
        })

    email = lead.email
    if not email and lead.first_name and lead.company:
        domain = "".join(c for c in lead.company.lower() if c.isalnum()) or "example"
        email = f"{lead.first_name.lower()}.{(lead.last_name or 'x').lower()}@{domain}.com"

    return {
        "title": title if not lead.title else lead.title,
        "industry": industry,
        "headline": headline,
        "about_summary": about,
        "recent_posts": recent_posts,
        "mutual_connections": mutual_connections,
        "email": email,
        "signals": signals,
    }
