"""
Recommendation Service — FastAPI Application
Recommends faculty mentors to student groups using OpenAI embeddings
and in-memory cosine similarity (no external vector DB required).
"""

import os
import math
import logging
from contextlib import asynccontextmanager

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from typing import Optional
import asyncio

from fastapi.middleware.cors import CORSMiddleware
from models import FacultyRecommendation, RecommendResponse, SyncResponse
from embeddings import embed_text

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("recommendation-service")

# ── In-memory vector store ───────────────────────────────────────────
# { faculty_id: { "name": str, "research_areas": list, "vector": list[float] } }
FACULTY_VECTORS: dict[str, dict] = {}


# ── Math helpers ─────────────────────────────────────────────────────
def cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ── Postgres helper ──────────────────────────────────────────────────
def get_pg_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=int(os.getenv("POSTGRES_PORT", 5432)),
        user=os.getenv("POSTGRES_USER", "acadconnect"),
        password=os.getenv("POSTGRES_PASSWORD", "yourStrongPassword"),
        database=os.getenv("POSTGRES_DB", "acadconnect"),
    )


def fetch_all_faculty() -> list[dict]:
    conn = get_pg_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT u.id, u.name, fp.research_areas
                FROM users u
                JOIN faculty_profiles fp ON u.id = fp.user_id
                WHERE u.role = 'faculty'
            """)
            return cur.fetchall()
    finally:
        conn.close()


def fetch_student_profile(student_id: str) -> dict | None:
    conn = get_pg_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT u.id, u.name, sp.skills, sp.interests
                FROM users u
                JOIN student_profiles sp ON u.id = sp.user_id
                WHERE u.id = %s AND u.role = 'student'
            """, (student_id,))
            return cur.fetchone()
    finally:
        conn.close()


# ── App ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Recommendation service started (in-memory mode).")
    # Trigger initial sync on startup
    try:
        # We use sync_all_faculty but call it as an async task so we don't block
        asyncio.create_task(sync_all_faculty())
    except Exception as e:
        logger.error(f"Initial startup sync failed: {e}")
    yield

app = FastAPI(
    title="AcadConnect Recommendation Service",
    description="Recommends faculty mentors using OpenAI embeddings + cosine similarity.",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────
_cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
_default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins if _cors_origins else _default_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "recommendation-service",
        "indexed_faculty": len(FACULTY_VECTORS),
    }


@app.post("/api/index/sync-all", response_model=SyncResponse)
async def sync_all_faculty():
    """Fetch all faculty from Postgres, embed research areas, store in memory."""
    faculty_list = fetch_all_faculty()
    indexed = 0

    for f in faculty_list:
        areas = f.get("research_areas") or []
        if not areas:
            continue
        text = ", ".join(areas)
        logger.info(f"Embedding faculty {f['id']} ({f['name']}): '{text}'")
        vector = embed_text(text)
        FACULTY_VECTORS[str(f["id"])] = {
            "name": f["name"],
            "research_areas": areas,
            "vector": vector,
        }
        indexed += 1

    return SyncResponse(
        indexed_count=indexed,
        message=f"Synced {indexed} faculty into memory.",
    )


@app.post("/api/index/sync-one/{faculty_id}", response_model=SyncResponse)
async def sync_one_faculty(faculty_id: str):
    """Fetch a single faculty from Postgres, embed, and update in memory."""
    conn = get_pg_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT u.id, u.name, fp.research_areas
                FROM users u
                JOIN faculty_profiles fp ON u.id = fp.user_id
                WHERE u.id = %s AND u.role = 'faculty'
            """, (faculty_id,))
            f = cur.fetchone()
    finally:
        conn.close()

    if not f:
        raise HTTPException(404, f"Faculty '{faculty_id}' not found")

    areas = f.get("research_areas") or []
    if not areas:
        FACULTY_VECTORS.pop(str(f["id"]), None)
        return SyncResponse(indexed_count=0, message="Faculty research areas cleared.")

    text = ", ".join(areas)
    logger.info(f"Sync-one faculty {f['id']} ({f['name']}): '{text}'")
    vector = embed_text(text)
    FACULTY_VECTORS[str(f["id"])] = {
        "name": f["name"],
        "research_areas": areas,
        "vector": vector,
    }

    return SyncResponse(indexed_count=1, message=f"Synced faculty {f['name']} into memory.")


@app.get("/api/recommend/faculty", response_model=RecommendResponse)
async def recommend_faculty(
    student_id: Optional[str] = Query(None),
    skills: Optional[str] = Query(None),
    interests: Optional[str] = Query(None),
    top_k: int = Query(5, ge=1, le=20),
):
    """Return top-K faculty ranked by cosine similarity to student profile."""

    if not FACULTY_VECTORS:
        # Lazy sync if empty
        logger.info("FACULTY_VECTORS empty, attempting lazy sync...")
        await sync_all_faculty()

    if not FACULTY_VECTORS:
        raise HTTPException(400, "No faculty indexed yet. Please register faculty profiles first.")

    # Build query text
    if student_id:
        profile = fetch_student_profile(student_id)
        if not profile:
            raise HTTPException(404, f"Student '{student_id}' not found")
        skill_list = profile.get("skills") or []
        interest_text = profile.get("interests") or ""
        query_text = ", ".join(skill_list)
        if interest_text:
            query_text += f"; {interest_text}"
    elif skills or interests:
        parts = []
        if skills:
            parts.append(skills)
        if interests:
            parts.append(interests)
        query_text = "; ".join(parts)
    else:
        raise HTTPException(400, "Provide student_id, or skills/interests query params")

    if not query_text.strip():
        raise HTTPException(400, "Student has no skills or interests to match")

    logger.info(f"Query: '{query_text}'")
    query_vector = embed_text(query_text)

    # Compute similarities
    scored = []
    for fid, data in FACULTY_VECTORS.items():
        score = cosine_similarity(query_vector, data["vector"])
        scored.append((fid, data, score))

    scored.sort(key=lambda x: x[2], reverse=True)

    recommendations = [
        FacultyRecommendation(
            faculty_id=fid,
            name=data["name"],
            research_areas=data["research_areas"],
            score=round(score, 4),
        )
        for fid, data, score in scored[:top_k]
    ]

    return RecommendResponse(recommendations=recommendations, query_text=query_text)
