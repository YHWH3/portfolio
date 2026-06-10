"""LinkedIn delivery providers.

The human approves every message in the review queue (or clicks Send in the
inbox); this module is only the transport for that explicitly approved action.

Providers:
- "manual"  — default. The platform queues, tracks, and logs the send; the
              human delivers it from LinkedIn themselves. No external calls.
- "unipile" — real delivery through the Unipile messaging API: the user's
              LinkedIn account is connected via Unipile's hosted auth wizard,
              and approved sends go out from that account (connection
              requests via POST /users/invite, messages via POST /chats).

Requires UNIPILE_DSN + UNIPILE_API_KEY, and the sending account linked
(provider="unipile", provider_account_id set).
"""
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

TIMEOUT = 30


class DeliveryError(Exception):
    """Raised when a provider could not deliver an approved message."""


def unipile_configured() -> bool:
    return bool(settings.UNIPILE_DSN and settings.UNIPILE_API_KEY)


def uses_real_delivery(account) -> bool:
    return account.provider == "unipile" and bool(account.provider_account_id) and unipile_configured()


def _base() -> str:
    return settings.UNIPILE_DSN.rstrip("/")


def _headers() -> dict:
    return {"X-API-KEY": settings.UNIPILE_API_KEY, "accept": "application/json"}


def linkedin_identifier(linkedin_url: str | None) -> str | None:
    """Extract the public identifier from a LinkedIn profile URL."""
    if not linkedin_url:
        return None
    match = re.search(r"linkedin\.com/(?:in|pub)/([^/?#]+)", linkedin_url, re.IGNORECASE)
    return match.group(1) if match else None


def _raise_for(response: httpx.Response, action: str) -> None:
    if response.status_code >= 400:
        raise DeliveryError(f"{action} failed ({response.status_code}): {response.text[:300]}")


def _resolve_provider_id(client: httpx.Client, account, lead) -> str:
    identifier = linkedin_identifier(lead.linkedin_url)
    if not identifier:
        raise DeliveryError(f"Lead has no usable LinkedIn URL: {lead.linkedin_url!r}")
    response = client.get(
        f"{_base()}/api/v1/users/{identifier}",
        params={"account_id": account.provider_account_id},
        headers=_headers(),
    )
    _raise_for(response, "Profile lookup")
    provider_id = response.json().get("provider_id")
    if not provider_id:
        raise DeliveryError("Profile lookup returned no provider_id")
    return provider_id


def deliver_sync(account, lead, content: str, action_type: str) -> dict:
    """Deliver one approved message. Returns provider metadata for the audit log."""
    if not uses_real_delivery(account):
        # Manual provider: the platform records the send; the human delivers it
        # on LinkedIn. Mirrors the mock behavior the product had from day one.
        return {"provider": "manual", "delivered": False}

    with httpx.Client(timeout=TIMEOUT) as client:
        provider_id = _resolve_provider_id(client, account, lead)
        if action_type == "connection_request":
            response = client.post(
                f"{_base()}/api/v1/users/invite",
                headers=_headers(),
                json={
                    "account_id": account.provider_account_id,
                    "provider_id": provider_id,
                    "message": content[:280],
                },
            )
            _raise_for(response, "Connection request")
        else:
            response = client.post(
                f"{_base()}/api/v1/chats",
                headers=_headers(),
                json={
                    "account_id": account.provider_account_id,
                    "attendees_ids": [provider_id],
                    "text": content,
                },
            )
            _raise_for(response, "Message send")
    return {"provider": "unipile", "delivered": True, "provider_user_id": provider_id}


async def deliver(account, lead, content: str, action_type: str) -> dict:
    """Async variant used by API endpoints (inbox replies, send-now)."""
    if not uses_real_delivery(account):
        return {"provider": "manual", "delivered": False}

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        identifier = linkedin_identifier(lead.linkedin_url)
        if not identifier:
            raise DeliveryError(f"Lead has no usable LinkedIn URL: {lead.linkedin_url!r}")
        response = await client.get(
            f"{_base()}/api/v1/users/{identifier}",
            params={"account_id": account.provider_account_id},
            headers=_headers(),
        )
        _raise_for(response, "Profile lookup")
        provider_id = response.json().get("provider_id")
        if not provider_id:
            raise DeliveryError("Profile lookup returned no provider_id")
        if action_type == "connection_request":
            response = await client.post(
                f"{_base()}/api/v1/users/invite",
                headers=_headers(),
                json={"account_id": account.provider_account_id, "provider_id": provider_id, "message": content[:280]},
            )
            _raise_for(response, "Connection request")
        else:
            response = await client.post(
                f"{_base()}/api/v1/chats",
                headers=_headers(),
                json={"account_id": account.provider_account_id, "attendees_ids": [provider_id], "text": content},
            )
            _raise_for(response, "Message send")
    return {"provider": "unipile", "delivered": True, "provider_user_id": provider_id}


async def create_hosted_auth_link(success_redirect_url: str | None = None) -> str:
    """Returns a Unipile hosted-auth URL where the user logs into LinkedIn to
    link their account. After linking, the Unipile account id is pasted into
    the sending account (or delivered via webhook in a hosted deployment)."""
    if not unipile_configured():
        raise DeliveryError(
            "No delivery provider configured. Set UNIPILE_DSN and UNIPILE_API_KEY in .env to enable real delivery."
        )
    payload: dict = {"type": "create", "providers": ["LINKEDIN"], "api_url": _base()}
    if success_redirect_url:
        payload["success_redirect_url"] = success_redirect_url
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(f"{_base()}/api/v1/hosted/accounts/link", headers=_headers(), json=payload)
        _raise_for(response, "Hosted auth link creation")
        url = response.json().get("url")
        if not url:
            raise DeliveryError("Provider returned no hosted auth URL")
        return url
