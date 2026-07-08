# Bitrix24 Local App — Client Communication & Project Management Dashboard

An integrated hub for managing client communications, projects, files, audio
recordings, and team operations. It centralizes multi-channel conversations
(WhatsApp, Upwork, Slack, Email, …), links clients to **Bitrix24** projects/tasks,
and layers **AI analysis** (chat summaries, sentiment, response-time metrics, audio
transcription + behavioral assessment) on top — all gated by a four-tier role system.

## Stack

| Layer     | Technology |
|-----------|------------|
| Backend   | Python · FastAPI · SQLAlchemy 2 |
| Frontend  | HTML + Bootstrap 5 + vanilla JS (no build step) |
| Database  | PostgreSQL · Redis |
| AI        | OpenAI (summaries/sentiment) · Deepgram (audio transcription) |
| Storage   | AWS S3 or local disk |
| Deploy    | Docker Compose · Nginx |
| Bitrix24  | OAuth local app + REST API |

## Features

- **Roles:** Super Admin · Admin · Team Lead · Employee (server-enforced).
- **Channels:** create/manage WhatsApp, Upwork, Slack, Email, Telegram, Other.
- **Clients:** manual entry; link channels + assign team members; full profile with
  tabs for Info, Conversations, Projects, Files, Audio, and Activity.
- **Conversations:** paste chat logs, categorize by channel, search, internal notes,
  assignment.
- **AI:** per-conversation summary, key points, pending actions, follow-ups, sentiment,
  and response-time metrics; per-audio transcript + summary + behavioral assessment.
- **Projects:** sync real Bitrix24 deals/tasks onto client profiles.
- **Activity log:** audit trail of key actions per client.

## Quick start (Docker — recommended)

```bash
cp .env.example .env          # then fill in OPENAI_API_KEY, DEEPGRAM_API_KEY, BITRIX_*
docker compose up --build
```

- App (via Nginx): http://localhost
- API directly: http://localhost:8000  · Swagger docs: http://localhost:8000/docs
- Log in with the seeded super admin from `.env`
  (`FIRST_SUPERADMIN_EMAIL` / `FIRST_SUPERADMIN_PASSWORD`).

## Local run (without Docker)

Requires a local PostgreSQL and Redis (or point `DATABASE_URL`/`REDIS_URL` elsewhere).

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
pip install -r requirements.txt
# set env vars (or create backend/.env); ensure DATABASE_URL points at your Postgres
uvicorn app.main:app --reload
```

Tables are auto-created and the super admin seeded on startup.

## Configuration

All settings live in `.env` (see `.env.example`). Key values:

- `OPENAI_API_KEY`, `OPENAI_MODEL` — AI analysis.
- `DEEPGRAM_API_KEY` — audio transcription.
- `STORAGE_BACKEND` — `local` (default) or `s3` (+ `S3_BUCKET`, AWS creds).
- `BITRIX_PORTAL_URL`, `BITRIX_CLIENT_ID`, `BITRIX_CLIENT_SECRET`, `BITRIX_REDIRECT_URI`.

## Bitrix24 setup

1. In your Bitrix24 portal, create a **Local application** (Developer resources →
   Other → Local application). Set the redirect URI to match `BITRIX_REDIRECT_URI`
   (default `http://localhost:8000/api/bitrix/callback`) and grant `crm` + `task` scopes.
2. Put the client id/secret + portal URL into `.env`.
3. In the app, open **Bitrix24 → Connect**, authorize, then use **Sync Bitrix24** on a
   client profile to pull deals/tasks.

> REST method mappings (`crm.deal.list`, `tasks.task.list`, …) live in
> `backend/app/services/bitrix_service.py` and can be adjusted per portal.

## Tests

```bash
cd backend
pytest                # unit tests for auth, RBAC, AI normalisation, metrics
```

## Project structure

```
backend/app/
  models/    SQLAlchemy ORM models
  schemas/   Pydantic request/response models
  routers/   FastAPI route modules (auth, clients, conversations, ai, audio, bitrix, …)
  services/  auth, ai (OpenAI), deepgram, bitrix, storage, metrics, activity
  rbac.py    role hierarchy + permission checks
  main.py    app wiring + startup seed
frontend/    HTML pages + Bootstrap + vanilla JS (served by FastAPI)
```

## Roles & permissions

| Capability                | Super Admin | Admin | Team Lead | Employee |
|---------------------------|:-----------:|:-----:|:---------:|:--------:|
| System config / super users |    ✅     |  —    |    —      |   —      |
| Manage users              |     ✅      |  ✅   |    —      |   —      |
| Manage channels           |     ✅      |  ✅   |    —      |   —      |
| Create/edit clients       |     ✅      |  ✅   |  assigned |   —      |
| Reply / notes / AI analyze|     ✅      |  ✅   |  assigned |   —      |
| View                      |     ✅      |  ✅   |  assigned | assigned |
```
