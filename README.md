# LinkedIn Outreach Copilot

A **human-in-the-loop LinkedIn outreach copilot** for B2B sales teams. The AI handles research, personalization, and message drafting. The human reviews, edits, and approves every message before it sends — **nothing goes out without explicit human approval**.

This is not an autonomous bot. It is a drafting and campaign management tool that keeps the human in control while removing the grunt work of researching prospects, writing personalized messages, and managing follow-up sequences.

**Channel: LinkedIn only.**

## Architecture

```
[Next.js Frontend] ←── REST + WebSocket ──→ [FastAPI Backend]
                                                    │
                                    ┌───────────────┤
                                    │               │
                           [AI Draft Engine]  [Lead Enrichment]
                           (Claude API)       (Profile data)
                                    │               │
                                    └──── PostgreSQL + Redis ────┘
                                                │
                                         [Celery Workers]
                                  (Draft generation, enrichment,
                                   safety monitoring, scheduling)
```

- **Backend**: FastAPI + SQLAlchemy 2 (async) + PostgreSQL 16 with pgvector + Redis + Celery
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **AI**: Anthropic Claude exclusively — Sonnet (`claude-sonnet-4-20250514`) for drafting, tone cloning, RAG answers, and suggested replies; Haiku (`claude-haiku-4-5-20251001`) for intent classification and sentiment scoring. Embeddings via Voyage AI.

> **Offline mode:** if no AI provider is configured, every AI call falls back to a realistic deterministic mock so the entire product flow works locally with no external services. The same applies to the lead-enrichment provider and the LinkedIn delivery integration, which are mocked.

## AI providers — API key or your Claude subscription

The provider is selected with `AI_PROVIDER` in `.env`:

| Mode | What it uses | Needs |
|---|---|---|
| `api` | Anthropic API (Sonnet + Haiku via SDK) | `ANTHROPIC_API_KEY` |
| `claude_cli` | **Your Claude Pro/Max subscription** through headless Claude Code (`claude -p`) | a `CLAUDE_CODE_OAUTH_TOKEN` |
| `mock` | Deterministic local mocks | nothing |
| `auto` (default) | `api` if a key is set, else `claude_cli` if the CLI is available, else `mock` | — |

### Running on your Claude subscription (no API key)

1. On your own machine, install Claude Code and log in with your Claude account, then run:
   ```bash
   claude setup-token
   ```
   This prints a long-lived OAuth token tied to your subscription.
2. Put it in `.env`:
   ```
   AI_PROVIDER=claude_cli
   CLAUDE_CODE_OAUTH_TOKEN=<paste the token here>
   ```
3. `docker compose up --build` — the backend image ships with the Claude Code CLI, and all drafting/classification calls now run on your subscription. Model selection (Sonnet for drafting, Haiku for intent classification) is passed through via `--model`.

Notes: headless Claude Code doesn't expose temperature/max_tokens, so those tuning hints only apply in `api` mode. Subscription usage is fine for your own local instance; for production, multi-user, or commercial deployments use `api` mode — Anthropic doesn't permit offering your subscription's access to other users. Keep the token secret (treat it like a password), and never commit `.env`.

## Quick start

```bash
cp .env.example .env       # fill in DB_PASSWORD, JWT secrets, and (optionally) API keys
docker compose up --build
```

- Frontend: http://localhost:3000
- API: http://localhost:8000 (OpenAPI docs at `/docs`)

Migrations run automatically when the `api` container starts (`alembic upgrade head`), and seed five default personas plus the intent taxonomy.

## Core flow

1. Import leads (CSV with `first_name,last_name,linkedin_url` or manual entry)
2. Enrich leads (profile data, recent posts, job-change signals) — Celery task
3. Create a campaign (objective, persona/tone, sequence steps, schedule)
4. The AI Draft Engine generates personalized drafts for each lead (5-stage pipeline: context assembly → prompt assembly → generation → personalization tagging → review queue)
5. Human reviews the draft queue — approves, edits, or skips every message
6. Approved messages are queued for delivery inside the configured working-hours window, respecting per-account soft limits
7. Safety intelligence tracks all sends, computes account health scores, and surfaces recommendations
8. When prospects reply, intent is classified (greeting/interest/objection/booking/opt-out…), priority is scored, and hot leads are flagged in real time over WebSocket
9. The inbox suggests 3 reply options (direct / value-add / soft); the human picks, edits, and sends

## Repository layout

```
backend/
  alembic/                 # migrations (full schema + seeds in 0001)
  app/
    api/v1/                # auth, workspace, tone-profiles, personas, campaigns,
                           # drafts, leads, inbox, kb, safety, analytics routers
    core/security.py       # bcrypt (12 rounds), JWT HS256, refresh rotation (Redis)
    services/              # ai client, draft engine, intent, replies, rag, embeddings,
                           # ingestion, enrichment, quality, safety, scheduling, analytics
    tasks.py               # Celery tasks: draft generation, follow-ups, enrichment,
                           # KB ingestion, dispatch, daily/weekly resets, health scores
    ws/manager.py          # WebSocket manager + Redis pub/sub bridge
frontend/
  app/                     # Next.js App Router pages (drafts review queue, campaigns,
                           # inbox, leads, knowledge, safety, analytics, settings)
  components/              # hand-rolled Tailwind UI components
  lib/                     # typed API client with token refresh, auth + WS providers
```

## Key endpoints

| Area | Endpoints |
|---|---|
| Auth | `POST /api/v1/auth/{register,login,refresh,forgot-password,reset-password}` |
| Drafts | `POST /api/v1/drafts/generate`, `GET /api/v1/drafts`, `PUT /api/v1/drafts/{id}`, `POST /api/v1/drafts/{id}/{approve,skip}`, `POST /api/v1/drafts/bulk-approve` |
| Campaigns | full CRUD + `activate/pause/resume/duplicate`, steps + reorder, objection handlers, performance |
| Leads | CRUD, CSV import/export, enrichment, curated list, ICP definitions, signals |
| Inbox | conversations, replies, prospect-message ingestion, priority, 3 AI suggestions, `WS /ws/inbox` |
| Knowledge | upload (pdf/docx/txt), ingestion → pgvector, campaign sources, RAG chat |
| Safety | dashboard, accounts, limits, restriction events, history, recommendations |
| Analytics | dashboard, per-campaign metrics, engagement heatmap, safety trends |

## Safety model

Safety intelligence is **advisory with soft blocks, not autonomous evasion**:

- Configurable per-account daily/weekly limits with sensible defaults (50 messages/day, 100 connections/week)
- Health score (0–100) computed from volume utilization, reply rates, and logged restriction events
- Soft blocks before dispatch: outside working hours → reschedule; daily limit reached → queue for tomorrow; low health → warn
- Users log restriction events manually; the system automatically reduces recommended limits in response
- Every send is logged to `safety_logs` with the counts at send time

## Development

```bash
# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
celery -A app.celery_app worker --loglevel=info
celery -A app.celery_app beat --loglevel=info

# Frontend
cd frontend
npm install
npm run dev
```
