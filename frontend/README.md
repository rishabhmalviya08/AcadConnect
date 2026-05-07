# AcadConnect Frontend

React 19 + TypeScript + Vite SPA for **AcadConnect**: authentication, student groups and projects, faculty requests, recommendations, profile settings, **admin dashboard**, dashboard notifications, milestones in project details, and a floating **FAQ help** chat.

## Prerequisites

- Node.js 20+
- Backend services running (see [`../backend/README.md`](../backend/README.md))

## Setup

```bash
cd frontend
npm install
npm run dev
```

Default dev server: **http://localhost:5173**

## Scripts

| Command | Description |
|---------|--------------|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Typecheck (`tsc -b`) + production build |
| `npm run preview` | Preview production build locally |
| `npm run lint` | ESLint |

## API bases

Configured in `src/services/api.ts` (defaults point at localhost):

| Client | Base URL | Purpose |
|--------|----------|---------|
| `authApi` | `http://localhost:3001/api` | Login, register, `/users/*`, `/admin/*` |
| `projectApi` | `http://localhost:3002/api` | Groups, projects, requests, progress |
| `aiApi` | `http://localhost:8001/api` | AI feedback sync, **FAQ chat** (`POST /chat/faq`) |
| `recommendationApi` | `http://localhost:8002/api` | Faculty recommendations |

Axios attaches `Authorization: Bearer <token>` from the Zustand auth store when present.

## Main routes

| Path | Who | Notes |
|------|-----|--------|
| `/login`, `/register` | Public | |
| `/dashboard` | Authenticated | Profile summary, stats, recent notifications; subscribes to **WebSocket** on user-service for live notification updates |
| `/groups` | Student | Create group, accept invites |
| `/projects` | Authenticated | List/create projects, project detail modal (AI feedback, milestones) |
| `/recommendations` | Student | Faculty search; request mentor |
| `/requests` | Faculty | Pending requests, accept/reject, mark project complete |
| `/admin` | Admin | Users, eligibility, audit logs |
| `/settings` | Authenticated | Profile (skills, interests, research areas, capacity) |

## UI features

- **Help chat:** FAB on all main-layout pages → calls FAQ endpoint on the AI service (CORS must allow the Vite origin; see backend AI service `CORS_ALLOW_ORIGINS`).
- **Notifications:** Dashboard loads `GET /users/notifications`; WebSocket refreshes unread count and recent list when the backend inserts notifications.

## Env / tooling

No `.env` is required for the default localhost API URLs; change `src/services/api.ts` if your ports differ.

---

## Vite template note

This project uses Vite’s React TS template. To extend ESLint with type-aware rules, see [Vite + React TS ESLint docs](https://vite.dev/guide/).
