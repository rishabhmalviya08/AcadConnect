# AcadConnect Backend

Node.js **Express** services (PostgreSQL via Knex) plus Python **FastAPI** services (OpenAI, optional MongoDB for stored AI feedback). Local development typically uses **Docker Compose** for databases and optionally for Python containers.

## Architecture

```
backend/
├── docker-compose.yml       # postgres, mongo, ai-feedback-service, recommendation-service
├── .env.example             # Copy to .env (repo root for compose: backend/.env)
└── services/
    ├── user-service/        # Port 3001 — auth, profiles, admin, notifications API, WebSocket
    ├── project-service/     # Port 3002 — groups, projects, requests, milestones/progress
    ├── ai-feedback-service/   # Port 8001 — AI project feedback, FAQ help chat
    └── recommendation-service/ # Port 8002 — faculty recommendations (embeddings + cosine similarity)
```

### User service (`3001`)

- **REST:** `/api/auth/*`, `/api/users/*`, `/api/admin/*`
- **Notifications:** `GET /api/users/notifications`, `PUT /api/users/notifications/:id/read`
- **WebSocket:** `ws://localhost:3001/ws?token=<JWT>` — pushes `notifications:update` when a row is inserted into `notifications` (Postgres `LISTEN` / `NOTIFY` on channel `acadconnect_notifications`)
- **Health:** `GET /health`

### Project service (`3002`)

- **Groups:** `POST /api/groups`, `GET /api/groups/me`, `PUT /api/groups/:id/accept-invite`
- **Projects:** `GET/POST /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id` (faculty: mark `closed`), `POST /api/projects/:id/ai-feedback` (proxies to AI service)
- **Requests:** `POST /api/requests` (body: `project_id`, `faculty_id` or `faculty_name`, `snippet`), `GET /api/requests/faculty`, `PUT /api/requests/:id/status`
- **Progress / milestones:** `GET/POST /api/projects/:id/progress`, `PUT /api/projects/:id/progress/:progressId`
- **Health:** `GET /health`

### AI feedback service (`8001`)

- **Feedback:** `POST /api/feedback/generate`, `GET /api/feedback/{request_id}`, `POST /api/feedback/generate-sync`
- **FAQ chat:** `POST /api/chat/faq` — onboarding-only answers from `faq_kb.md`; optional `Authorization: Bearer` for role-aware hints; rate limit `CHAT_RATE_LIMIT_PER_MINUTE` (default 20) per user id or client IP
- **CORS:** Dev origins for Vite (override with `CORS_ALLOW_ORIGINS` CSV)
- **Env:** `OPENAI_API_KEY`, `JWT_SECRET` (for chat + feedback rate-limit identity), `CHAT_RATE_LIMIT_PER_MINUTE` (FAQ), `OPENAI_FEEDBACK_RATE_LIMIT_PER_MINUTE` (project feedback OpenAI calls, default 8), optional `OPENAI_CHAT_MODEL`

### Recommendation service (`8002`)

- **Health:** `GET /health`
- **Index:** `POST /index/sync-all` — load faculty from Postgres into memory
- **Recommend:** `GET /recommend/faculty?skills=&interests=&student_id=&top_k=`

## Prerequisites

- Docker Desktop (for Postgres + MongoDB, optional Python containers)
- Node.js 20+ and npm
- Python 3.11+ if running FastAPI services locally without Docker

## Environment

```bash
cd backend
cp .env.example .env
# Set POSTGRES_*, MONGO_*, JWT_SECRET, OPENAI_API_KEY, etc.
```

Compose loads `backend/.env`. **Do not commit `.env`.**

Important variables:

| Variable | Used by |
|----------|---------|
| `JWT_SECRET` | user-service, project-service (JWT verify), ai-feedback-service (FAQ chat + optional role) |
| `OPENAI_API_KEY` | ai-feedback-service, recommendation-service |
| `CHAT_RATE_LIMIT_PER_MINUTE` | ai-feedback-service FAQ chat |
| `MONGO_URI` / `MONGO_DB` | ai-feedback-service (persisted feedback) |

## Start databases (Docker)

```bash
cd backend
docker compose up -d
docker compose ps   # postgres + mongo healthy
```

## Install & migrate (Node)

```bash
cd services/user-service && npm install
cd ../project-service && npm install

# Migrations live in user-service (single Knex DB)
cd ../user-service
npx knex migrate:latest
```

Migrations include (among others): users, student/faculty profiles, projects, project_requests, progress, groups, audit_logs, **notifications** + **snippet** on requests, **pg_notify** trigger for real-time notification delivery.

## Verify database

```bash
docker exec -it acadconnect-postgres psql -U acadconnect -d acadconnect -c "\dt"
```

You should see tables such as: `users`, `student_profiles`, `faculty_profiles`, `groups`, `group_members`, `projects`, `project_requests`, `progress`, `audit_logs`, `notifications`, etc.

## Run Node services (local)

```bash
# Terminal 1
cd services/user-service && npm run dev

# Terminal 2
cd services/project-service && npm run dev
```

Health:

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
```

## Run Python services

**Option A — Docker Compose** (after `docker compose up -d` including `ai-feedback-service` and `recommendation-service`):

- Ensure `JWT_SECRET` is passed into the AI service container (see `docker-compose.yml`).
- Rebuild/restart if `requirements.txt` changed (`pip install` runs on container start).

**Option B — Local venv**

```bash
cd services/ai-feedback-service
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001

cd ../recommendation-service
# same pattern on port 8002
```

## Schema overview (simplified)

- **Projects** belong to **groups** (`projects.group_id`). Status: `open` → `in_progress` (accepted request) → `closed`.
- **project_requests** link a **project** to **faculty_id**, with `snippet`, `status`: `pending` | `accepted` | `rejected`. Capacity enforced via `faculty_profiles.max_capacity` and derived mentee counts.
- **progress** rows are milestones per `project_id`.
- **notifications** store in-app alerts (`is_read`, `metadata` JSONB). Inserts trigger `NOTIFY` for WebSocket pushes.
- **audit_logs** record admin actions (e.g. eligibility changes).

Faculty mentee counts use **`project_requests.faculty_id`** with `status = 'accepted'` (not `projects.faculty_id`).

## Optional scripts

- `backend/test_recommendations.js` — smoke test recommendation flow (creates faculty users via user API, syncs recommendations service).

## Tech stack summary

| Layer | Technology |
|-------|-------------|
| API (core) | Node.js, Express, Knex, PostgreSQL |
| AI / chat | Python, FastAPI, OpenAI, Motor/MongoDB (feedback persistence) |
| Recommendations | Python, FastAPI, OpenAI embeddings, in-memory cosine similarity |
| Realtime | `ws` (user-service), Postgres `LISTEN` / `NOTIFY` |
| Containers | Docker Compose |
