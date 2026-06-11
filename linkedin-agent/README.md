# LinkedIn Browser Agent (local, optional)

Delivers messages **you already approved in the Outreach Copilot** by driving a
real, logged-in Chromium session on your own machine — connection requests for
people you aren't connected to yet, and direct messages for 1st-degree
connections.

This runs **on your Mac/PC**, not in the cloud container, because it needs a
visible browser and your live LinkedIn session.

## ⚠️ Read this before using

Automating LinkedIn through a browser **violates LinkedIn's User Agreement** and
can get your account **restricted or permanently banned**. The pacing and limits
here lower that risk but do not remove it. This is provided for use on your own
account, at your own risk. If account safety matters to you, prefer the official
**Unipile** delivery integration (Settings → LinkedIn Accounts → Enable
auto-delivery), which uses a sanctioned API.

By default the agent **sends for real**. Set `DRY_RUN=true` to rehearse (it opens
profiles and fills in messages but never clicks the final Send/Connect) — do a
dry run at least once to confirm the selectors work on your account.

## Setup

```bash
cd linkedin-agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
```

## Mode A — pull approved drafts from the app (recommended)

The agent logs into your running Copilot, pulls the approved-draft queue,
delivers each item from your LinkedIn, and reports back (so the app's analytics,
inbox, and safety counters stay correct). It only ever sees messages you clicked
**Approve** on.

```bash
export API_URL=http://localhost:8000
export API_EMAIL=you@example.com
export API_PASSWORD=your-app-password

# One pass over whatever is approved right now:
python agent.py --from-api

# Fully automatic: keep running, deliver new approvals as they appear:
python agent.py --from-api --loop
```

In `--loop` mode the agent stays open, checks the approved queue every
`POLL_INTERVAL_MINUTES` (default 15), delivers anything new with the usual
cooldowns between profiles, and reports each result back to the app. It keeps
going until you stop it with Ctrl+C. This is the "set it and forget it" mode:
you just keep approving drafts in the app and they go out from your LinkedIn
automatically.

> Tip: do one `DRY_RUN=true` pass first to confirm the LinkedIn selectors work
> on your account, then drop the flag to send for real.

Flow it follows, matching the app's model:
- `connection_request` steps → sends a connection request (with your approved note).
- `message` steps → sends a direct message (only works once they've accepted, which the app already gates for you).
- On success it calls `mark-sent`; on failure `mark-failed` (the draft returns to your review queue).

## Mode B — standalone from a file

```bash
export DRY_RUN=true
python agent.py --leads-file leads.example.json
```

Each entry: `{"url": "...", "action": "connection_request" | "message", "message": "..."}`.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DRY_RUN` | `false` | When true, never clicks the final send/connect (rehearsal) |
| `LOOP` | `false` | Same as `--loop`: run automatically and keep polling |
| `POLL_INTERVAL_MINUTES` | `15` | How often loop mode checks for newly approved drafts |
| `HEADLESS` | `false` | Keep false so you can watch it and pass any 2FA/checkpoint |
| `MAX_ACTIONS_PER_RUN` | `15` | Hard cap per cycle |
| `COOLDOWN_MIN_MINUTES` / `COOLDOWN_MAX_MINUTES` | `8` / `20` | Random wait between profiles |
| `LINKEDIN_STATE_FILE` | `linkedin_state.json` | Where the logged-in session is cached |
| `API_URL` / `API_EMAIL` / `API_PASSWORD` | — | For `--from-api` |

First run with no saved session: the agent opens LinkedIn's login page and waits
for you to sign in (handle 2FA yourself), then caches the session so later runs
skip login.

## Honest limitations

- LinkedIn changes its HTML often; the selectors here target stable ARIA roles
  ("Connect", "Message", "Send invitation") but may still need occasional updates.
- Keep volumes low (a few dozen actions/day at most) and the cooldowns long.
- This was code-reviewed but **not** test-run against live LinkedIn — verify with
  `DRY_RUN=true` and `HEADLESS=false` first and watch what it does.

`linkedin_state.json` holds your logged-in session — treat it like a password and
never commit it. It is already covered by the repo's `.gitignore`.
