"""Local LinkedIn browser agent for the Outreach Copilot.

This drives a real, logged-in Chromium session to deliver messages YOU already
approved in the app — connection requests for people you're not yet connected
to, and direct messages for 1st-degree connections.

  ┌────────────────────────────────────────────────────────────────────┐
  │  READ THIS FIRST                                                    │
  │  Browser automation of LinkedIn violates LinkedIn's User Agreement  │
  │  and can get your account RESTRICTED OR PERMANENTLY BANNED. The     │
  │  delays and limits here reduce that risk but do not remove it. Use  │
  │  on your own account, at your own risk, in full knowledge of this.  │
  │  DRY_RUN is ON by default — nothing is actually sent until you      │
  │  explicitly turn it off.                                            │
  └────────────────────────────────────────────────────────────────────┘

Two modes:
  --from-api   Log in to your running Copilot instance, pull the approved
               draft queue (GET /drafts/agent/queue), deliver each item, then
               report back (POST /drafts/{id}/mark-sent or /mark-failed).
  --leads-file Standalone: read a JSON list of {url, action, message} and
               process it without the app (handy for a quick test).

Setup:
  pip install -r requirements.txt
  python -m playwright install chromium
  python agent.py --from-api            # uses .env / env vars below
  python agent.py --leads-file leads.json
"""
import argparse
import json
import logging
import os
import random
import sys
import time
from dataclasses import dataclass

import requests
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright

# ==========================================
# CONFIGURATION
# ==========================================
STATE_FILE = os.environ.get("LINKEDIN_STATE_FILE", "linkedin_state.json")
HEADLESS = os.environ.get("HEADLESS", "false").lower() == "true"
# Sends for real by default. Set DRY_RUN=true to rehearse without clicking send.
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"
MAX_ACTIONS_PER_RUN = int(os.environ.get("MAX_ACTIONS_PER_RUN", "15"))
COOLDOWN_MIN_MINUTES = float(os.environ.get("COOLDOWN_MIN_MINUTES", "8"))
COOLDOWN_MAX_MINUTES = float(os.environ.get("COOLDOWN_MAX_MINUTES", "20"))
# Automatic mode: keep polling the app queue and deliver as drafts get approved.
LOOP = os.environ.get("LOOP", "false").lower() == "true"
POLL_INTERVAL_MINUTES = float(os.environ.get("POLL_INTERVAL_MINUTES", "15"))

# --from-api settings
API_URL = os.environ.get("API_URL", "http://localhost:8000")
API_EMAIL = os.environ.get("API_EMAIL", "")
API_PASSWORD = os.environ.get("API_PASSWORD", "")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("linkedin-agent")


@dataclass
class Action:
    url: str
    action_type: str  # "connection_request" or "message"
    message: str
    draft_id: str | None = None  # set in --from-api mode


# ==========================================
# HELPERS
# ==========================================
def human_delay(min_sec: float = 2.0, max_sec: float = 5.0) -> None:
    """Pause to simulate human reading/typing."""
    time.sleep(random.uniform(min_sec, max_sec))


def type_like_human(locator, text: str) -> None:
    """Type into a Playwright locator with variable per-character delays."""
    locator.click()
    human_delay(0.4, 1.0)
    for char in text:
        locator.type(char, delay=random.randint(40, 150))


def _visible(locator) -> bool:
    """True if the locator matches at least one visible element. Never raises."""
    try:
        return locator.count() > 0 and locator.first.is_visible()
    except PlaywrightError:
        return False


# ==========================================
# CONNECTION REQUESTS
# ==========================================
def _open_connect(page: Page) -> bool:
    """Click the Connect control, whether it's on the top card or tucked inside
    the 'More' menu. Returns True if a Connect dialog/flow was opened."""
    direct = page.get_by_role("button", name="Connect", exact=True)
    if _visible(direct):
        direct.first.click()
        return True
    # Otherwise it's usually under the "More actions" overflow menu.
    more = page.get_by_role("button", name="More actions")
    if not _visible(more):
        more = page.get_by_role("button", name="More", exact=True)
    if _visible(more):
        more.first.click()
        human_delay(1, 2)
        menu_item = page.get_by_role("menuitem", name="Connect")
        if not _visible(menu_item):
            menu_item = page.get_by_role("button", name="Connect")
        if _visible(menu_item):
            menu_item.first.click()
            return True
    return False


def send_connection_request(page: Page, action: Action) -> bool:
    if not _open_connect(page):
        logger.warning("No Connect option on %s (already connected or pending?).", action.url)
        return False
    human_delay(1, 2)

    note = (action.message or "").strip()
    if note:
        add_note = page.get_by_role("button", name="Add a note")
        if _visible(add_note):
            add_note.first.click()
            human_delay(1, 2)
            box = page.locator("textarea#custom-message")
            if not _visible(box):
                box = page.get_by_role("textbox").first
            # LinkedIn caps connection notes at 300 characters.
            type_like_human(box, note[:300])
            human_delay(1, 2)

    send = page.get_by_role("button", name="Send invitation", exact=False)
    if not _visible(send):
        send = page.get_by_role("button", name="Send", exact=True)
    if not _visible(send):
        logger.warning("Connect dialog opened but no Send button found for %s.", action.url)
        return False

    if DRY_RUN:
        logger.info("[DRY RUN] Would send connection request to %s", action.url)
        # Dismiss the dialog so the next lead starts clean.
        dismiss = page.get_by_role("button", name="Dismiss")
        if _visible(dismiss):
            dismiss.first.click()
        return True

    send.first.click()
    logger.info("Sent connection request to %s", action.url)
    return True


# ==========================================
# DIRECT MESSAGES (1st-degree)
# ==========================================
def send_message(page: Page, action: Action) -> bool:
    message_btn = page.get_by_role("button", name="Message", exact=False)
    if not _visible(message_btn):
        logger.warning(
            "No Message button on %s — likely not a 1st-degree connection yet. "
            "Send a connection request first.", action.url,
        )
        return False
    message_btn.first.click()
    human_delay(2, 4)

    chat_box = page.locator("div.msg-form__contenteditable")
    if not _visible(chat_box):
        chat_box = page.get_by_role("textbox", name="Write a message")
    if not _visible(chat_box):
        logger.warning("Could not find the message box for %s.", action.url)
        return False

    type_like_human(chat_box, action.message)
    human_delay(2, 4)

    send_btn = page.get_by_role("button", name="Send", exact=True)
    if DRY_RUN:
        logger.info("[DRY RUN] Would send message to %s", action.url)
    elif _visible(send_btn):
        send_btn.first.click()
        logger.info("Sent message to %s", action.url)
    else:
        logger.warning("Message box filled but no Send button for %s.", action.url)
        return False

    # Close the chat overlay so the UI is clean for the next lead.
    close_btn = page.get_by_role("button", name="Close your conversation")
    if _visible(close_btn):
        close_btn.first.click()
    return True


def process_action(page: Page, action: Action) -> bool:
    logger.info("Navigating to %s (%s)", action.url, action.action_type)
    try:
        page.goto(action.url, timeout=30000, wait_until="domcontentloaded")
        human_delay(3, 7)  # "read" the profile
        if action.action_type == "connection_request":
            return send_connection_request(page, action)
        return send_message(page, action)
    except PlaywrightError as exc:
        logger.error("Playwright error on %s: %s", action.url, exc)
        return False
    except Exception as exc:  # noqa: BLE001 — never let one lead kill the run
        logger.error("Unexpected error on %s: %s", action.url, exc)
        return False


# ==========================================
# APP API CLIENT (--from-api)
# ==========================================
class CopilotApi:
    def __init__(self, base_url: str, email: str, password: str):
        self.base = base_url.rstrip("/") + "/api/v1"
        resp = requests.post(f"{self.base}/auth/login", json={"email": email, "password": password}, timeout=30)
        resp.raise_for_status()
        self.token = resp.json()["token"]

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def fetch_queue(self) -> list[Action]:
        resp = requests.get(f"{self.base}/drafts/agent/queue", headers=self._headers, timeout=30)
        resp.raise_for_status()
        return [
            Action(url=i["linkedin_url"], action_type=i["action_type"], message=i["content"], draft_id=i["draft_id"])
            for i in resp.json()["items"]
        ]

    def mark_sent(self, draft_id: str) -> None:
        requests.post(f"{self.base}/drafts/{draft_id}/mark-sent", headers=self._headers, timeout=30)

    def mark_failed(self, draft_id: str) -> None:
        requests.post(f"{self.base}/drafts/{draft_id}/mark-failed", headers=self._headers, timeout=30)


# ==========================================
# SESSION / LOGIN
# ==========================================
def ensure_logged_in(context, page: Page) -> None:
    page.goto("https://www.linkedin.com/feed/", timeout=30000)
    if "login" in page.url or "checkpoint" in page.url or "authwall" in page.url:
        logger.info("No active LinkedIn session. Opening the login page — sign in manually.")
        page.goto("https://www.linkedin.com/login", timeout=30000)
        input("Press Enter here once you've finished logging in (and any 2FA)...")
        context.storage_state(path=STATE_FILE)
        logger.info("Session saved to %s", STATE_FILE)


# ==========================================
# MAIN
# ==========================================
def load_actions(args) -> tuple[list[Action], CopilotApi | None]:
    if args.from_api:
        if not API_EMAIL or not API_PASSWORD:
            logger.error("Set API_EMAIL and API_PASSWORD (env or .env) to use --from-api.")
            sys.exit(1)
        api = CopilotApi(API_URL, API_EMAIL, API_PASSWORD)
        actions = api.fetch_queue()
        logger.info("Pulled %d approved item(s) from the app queue.", len(actions))
        return actions, api
    with open(args.leads_file, encoding="utf-8") as f:
        raw = json.load(f)
    actions = [
        Action(url=r["url"], action_type=r.get("action", "message"), message=r.get("message", ""))
        for r in raw
    ]
    return actions, None


def deliver_batch(page, actions: list[Action], api: "CopilotApi | None") -> int:
    """Process one batch of actions with cooldowns; report results to the app."""
    success = 0
    for index, action in enumerate(actions):
        logger.info("-" * 50)
        ok = process_action(page, action)
        if ok:
            success += 1
            if api and action.draft_id and not DRY_RUN:
                api.mark_sent(action.draft_id)
        elif api and action.draft_id and not DRY_RUN:
            api.mark_failed(action.draft_id)
        # Cooldown between profiles — skip it after the final one.
        if index < len(actions) - 1:
            minutes = random.uniform(COOLDOWN_MIN_MINUTES, COOLDOWN_MAX_MINUTES)
            logger.info("Cooling down %.1f min before the next profile...", minutes)
            time.sleep(minutes * 60)
    return success


def main() -> None:
    parser = argparse.ArgumentParser(description="Local LinkedIn browser agent")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--from-api", action="store_true", help="Pull approved drafts from the running Copilot app")
    group.add_argument("--leads-file", help="Path to a JSON file of {url, action, message}")
    parser.add_argument("--loop", action="store_true",
                        help="Run automatically: keep polling the app queue and deliver as drafts are approved")
    args = parser.parse_args()

    loop_mode = (args.loop or LOOP) and args.from_api
    if (args.loop or LOOP) and not args.from_api:
        logger.error("--loop only works with --from-api.")
        sys.exit(1)

    actions, api = load_actions(args)
    if DRY_RUN:
        logger.warning("DRY_RUN is ON — drafting only, nothing will actually be sent. "
                       "Set DRY_RUN=false to send for real.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS, args=["--disable-blink-features=AutomationControlled"])
        context_kwargs = {"viewport": {"width": 1440, "height": 900}, "user_agent": USER_AGENT}
        if os.path.exists(STATE_FILE):
            logger.info("Loading saved session from %s", STATE_FILE)
            context_kwargs["storage_state"] = STATE_FILE
        context = browser.new_context(**context_kwargs)
        # Strip the automation fingerprint that the launch flag alone misses.
        context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")
        page = context.new_page()

        try:
            ensure_logged_in(context, page)
            if loop_mode:
                logger.info("Automatic mode: polling the approved queue every %.0f min. Ctrl+C to stop.",
                            POLL_INTERVAL_MINUTES)
                while True:
                    batch = (api.fetch_queue() if api else [])[:MAX_ACTIONS_PER_RUN]
                    if batch:
                        logger.info("Delivering %d approved item(s).", len(batch))
                        deliver_batch(page, batch, api)
                    else:
                        logger.info("Queue empty — nothing approved yet.")
                    logger.info("Sleeping %.0f min before the next check...", POLL_INTERVAL_MINUTES)
                    time.sleep(POLL_INTERVAL_MINUTES * 60)
            else:
                batch = actions[:MAX_ACTIONS_PER_RUN]
                if not batch:
                    logger.info("Nothing to do. Exiting.")
                else:
                    done = deliver_batch(page, batch, api)
                    logger.info("Done. Delivered %d of %d.", done, len(batch))
        except KeyboardInterrupt:
            logger.info("Interrupted by user. Stopping.")
        finally:
            logger.info("Saving session and cleaning up...")
            try:
                context.storage_state(path=STATE_FILE)
            except PlaywrightError:
                pass
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
