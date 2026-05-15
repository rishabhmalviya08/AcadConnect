# AcadConnect 🎓

AcadConnect is a high-performance academic collaboration platform designed to bridge the gap between students, projects, and faculty. It features a robust microservices architecture, real-time notifications, and AI-powered project feedback and faculty recommendations.

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** (v18+) & **npm**
- **Python** (3.10+)
- **Docker** (for local databases)

### 2. Database Setup
Start the local PostgreSQL and MongoDB instances using Docker:
```bash
cd backend
docker compose up -d
```

### 3. Service Configuration
Each microservice requires its own environment variables. 
1. Copy `backend/.env.example` to `backend/.env`.
2. Fill in the following required variables:
   - `JWT_SECRET`: A random string for authentication.
   - `OPENAI_API_KEY`: Your OpenAI key (for AI Feedback and FAQ Chat).
   - `MONGO_URI`: `mongodb://localhost:27018` (if using Docker).

### 4. Database Migrations & Seeding
Initialize your schema and populate test data:
```bash
cd backend/services/user-service
npm install
npm run migrate
npm run seed:dev      # Adds test students/admins
npm run seed:faculty  # Adds faculty from faculty.json
```

### 5. Start the Backends
Run each service in its own terminal:
- **User Service**: `cd backend/services/user-service && npm run dev` (Port 3001)
- **Project Service**: `cd backend/services/project-service && npm run dev` (Port 3002)
- **AI Feedback**: `cd backend/services/ai-feedback-service && uvicorn main:app --port 8001`
- **Recommendations**: `cd backend/services/recommendation-service && uvicorn main:app --port 8002`

### 6. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173). Log in with:
- **Email**: `dev-student-01@acadconnect.test`
- **Password**: `12345678`

---

## ☁️ Cloud Deployment

AcadConnect is optimized for a hybrid deployment using **Vercel** and **Render**.

### **Backend (Render)**
The repository includes a `render.yaml` Blueprint.
1. Connect your repo to Render.
2. Select the `vercel_deploy` branch.
3. Render will automatically provision:
   - PostgreSQL Managed Database
   - 4 Microservices (User, Project, AI-Feedback, Recommendation)
4. **Environment Variables**: Add `MONGO_URI` (Atlas) and `OPENAI_API_KEY` in the Render dashboard.

### **Frontend (Vercel)**
1. Connect your repo to Vercel.
2. Set the **Root Directory** to `frontend`.
3. Set the **Branch** to `vercel_deploy`.
4. Add the following **Environment Variables**:
   - `VITE_USER_SERVICE_URL`: Your Render URL + `/api`
   - `VITE_USER_SERVICE_WS_URL`: Your Render URL (wss://...) + `/ws`
   - `VITE_PROJECT_SERVICE_URL`: Your Render URL + `/api`
   - `VITE_AI_FEEDBACK_SERVICE_URL`: Your Render URL + `/api`
   - `VITE_RECOMMENDATION_SERVICE_URL`: Your Render URL + `/api`

---

## 🏗 Architecture

| Service | Technology | Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend** | React, Vite | 5173 | SPA Interface |
| **User Service** | Node, Express, Knex | 3001 | Auth, Users, Notifications |
| **Project Service** | Node, Express, Knex | 3002 | Projects, Groups, Requests |
| **AI Feedback** | Python, FastAPI, OpenAI | 8001 | AI Code/Project Analysis |
| **Rec Service** | Python, FastAPI | 8002 | Faculty Matchmaking |

---

## 🛡️ Security & Privacy
- **JWT Auth**: Secured endpoints across all services.
- **Rate Limiting**: AI services are rate-limited to prevent abuse.
- **Secret Scanning**: All sensitive keys must be provided via environment variables.

---

## 📄 License
This project is for academic use as part of CMPE 295B.
