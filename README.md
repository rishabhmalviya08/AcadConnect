# AcadConnect

Academic collaboration app for **student groups**, **projects**, **faculty mentorship requests**, **AI-assisted project feedback**, **faculty recommendations**, **milestones**, **in-app notifications**, and an **FAQ help chat**.

## Repo layout

| Path | Purpose |
|------|---------|
| [`backend/`](backend/README.md) | Docker Compose (Postgres, MongoDB), Node microservices (user, project), Python services (AI feedback, recommendations), migrations |
| [`frontend/`](frontend/README.md) | React + TypeScript + Vite SPA |

## Quick start (development)

1. **Backend:** Follow [`backend/README.md`](backend/README.md) — copy `backend/.env.example` → `.env`, start databases (`docker compose up -d`), run **Knex migrations** from `user-service`, then start Node and Python services (or use Compose for DB + Python).
2. **Frontend:** From `frontend/`, run `npm install` and `npm run dev` (default Vite: `http://localhost:5173`).
3. Ensure `.env` includes **`JWT_SECRET`** (shared by user-service and AI FAQ chat) and **`OPENAI_API_KEY`** for AI features.

## Default ports

| Service | Port |
|---------|------|
| User & auth API | `3001` |
| Projects / groups / requests / milestones API | `3002` |
| AI feedback + FAQ chat | `8001` |
| Recommendation API | `8002` |
| PostgreSQL | `5432` |
| MongoDB (mapped in Compose) | `27018` → container `27017` |

## Feature pointers

- **Admin UI:** `/admin` (admin role) — users, student eligibility, audit logs.
- **Help chat:** floating **Help** button — `POST /api/chat/faq` on the AI service (FAQ-only, rate-limited, optional JWT role hint).
- **Live notifications:** Dashboard subscribes to `ws://localhost:3001/ws?token=…`; server pushes on new rows in `notifications` (Postgres `NOTIFY`).

For API details and migration list, see [`backend/README.md`](backend/README.md).
