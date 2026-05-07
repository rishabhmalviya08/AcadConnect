"""
main.py — FastAPI application for the AcadConnect AI Feedback Service

Endpoints:
  POST /feedback/generate  — call OpenAI, store result in MongoDB
  GET  /feedback/{request_id}  — retrieve stored feedback
  POST /api/chat/faq  — onboarding FAQ chat (rate-limited, JWT role hint)
  GET  /health  — health check
"""
import os
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Annotated

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.middleware.cors import CORSMiddleware

from auth_jwt import decode_role_and_sub
from chat_faq import answer_faq_chat
from db import get_feedback_collection, close_client
from feedback import generate_feedback
from models import (
    FeedbackRequest,
    FeedbackCreatedResponse,
    FeedbackResponse,
    FeedbackSyncRequest,
    FeedbackSyncResponse,
    FAQChatRequest,
    FAQChatResponse,
)
from rate_limit import allow as rate_limit_allow


def _openai_client_key(request: Request, authorization: str | None) -> str:
    _role, user_id = decode_role_and_sub(authorization)
    if user_id:
        return f"uid:{user_id}"
    host = request.client.host if request.client else "unknown"
    return f"ip:{host}"

load_dotenv()


# ─── Lifespan ──────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing to do (Motor connects lazily)
    yield
    # Shutdown: close the MongoDB connection
    await close_client()


# ─── App ───────────────────────────────────────────────────────────
app = FastAPI(
    title="AcadConnect AI Feedback Service",
    description="Generates structured AI feedback on student research snippets using OpenAI.",
    version="1.0.0",
    lifespan=lifespan,
)

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


# ─── Routes ────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-feedback-service"}


@app.post("/feedback/generate", response_model=FeedbackCreatedResponse, status_code=201)
async def generate(
    payload: FeedbackRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    """
    Accepts a student snippet + project context, calls OpenAI for structured
    feedback, and persists it in MongoDB. Returns the feedback_id.
    """
    collection = get_feedback_collection()

    # Check for duplicate: don't regenerate if feedback already exists
    existing = await collection.find_one({"request_id": payload.request_id})
    if existing:
        return FeedbackCreatedResponse(
            feedback_id=str(existing["_id"]),
            status="already_exists",
        )

    bucket = _openai_client_key(request, authorization)
    if not rate_limit_allow(
        bucket,
        namespace="openai_feedback",
        env_var="OPENAI_FEEDBACK_RATE_LIMIT_PER_MINUTE",
        default=8,
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many AI feedback requests. Please wait a minute and try again.",
        )

    # Call OpenAI
    try:
        ai_result = await generate_feedback(
            project_title=payload.project_title,
            project_description=payload.project_description,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI call failed: {str(e)}")

    # Persist to MongoDB
    doc = {
        "request_id": payload.request_id,
        "group_id": payload.group_id,
        "project_id": payload.project_id,
        "snippet": payload.snippet,
        "relevance_score": ai_result["relevance_score"],
        "strengths": ai_result["strengths"],
        "gaps": ai_result["gaps"],
        "suggestions": ai_result["suggestions"],
        "summary": ai_result["summary"],
        "created_at": datetime.now(timezone.utc),
    }

    result = await collection.insert_one(doc)
    feedback_id = str(result.inserted_id)

    return FeedbackCreatedResponse(feedback_id=feedback_id, status="generated")


@app.get("/feedback/{request_id}", response_model=FeedbackResponse)
async def get_feedback(request_id: str):
    """
    Retrieves stored feedback for a given request_id.
    """
    collection = get_feedback_collection()
    doc = await collection.find_one({"request_id": request_id})

    if not doc:
        raise HTTPException(
            status_code=404,
            detail=f"No feedback found for request_id '{request_id}'"
        )

    return FeedbackResponse(
        feedback_id=str(doc["_id"]),
        request_id=doc["request_id"],
        group_id=doc["group_id"],
        project_id=doc["project_id"],
        relevance_score=doc["relevance_score"],
        strengths=doc["strengths"],
        gaps=doc["gaps"],
        suggestions=doc["suggestions"],
        summary=doc["summary"],
        created_at=doc["created_at"],
    )


@app.post("/feedback/generate-sync", response_model=FeedbackSyncResponse)
async def generate_sync(
    payload: FeedbackSyncRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    """
    Accepts a student project title and description, generates AI feedback,
    and returns it immediately without persisting to MongoDB.
    """
    bucket = _openai_client_key(request, authorization)
    if not rate_limit_allow(
        bucket,
        namespace="openai_feedback",
        env_var="OPENAI_FEEDBACK_RATE_LIMIT_PER_MINUTE",
        default=8,
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many AI feedback requests. Please wait a minute and try again.",
        )

    try:
        ai_result = await generate_feedback(
            project_title=payload.project_title,
            project_description=payload.project_description,
        )
        return FeedbackSyncResponse(
            relevance_score=ai_result["relevance_score"],
            strengths=ai_result["strengths"],
            gaps=ai_result["gaps"],
            suggestions=ai_result["suggestions"],
            summary=ai_result["summary"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI call failed: {str(e)}")


@app.post("/api/chat/faq", response_model=FAQChatResponse)
async def chat_faq(
    payload: FAQChatRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
):
    """
    FAQ-only help chat (onboarding). Optional JWT Bearer decodes role for tailored hints.
    Rate limit: CHAT_RATE_LIMIT_PER_MINUTE (default 20) per authenticated user id, else per client IP.
    """
    role, user_id = decode_role_and_sub(authorization)
    client_ip = request.client.host if request.client else "unknown"
    bucket_key = f"uid:{user_id}" if user_id else f"ip:{client_ip}"

    if not rate_limit_allow(
        bucket_key,
        namespace="chat",
        env_var="CHAT_RATE_LIMIT_PER_MINUTE",
        default=20,
    ):
        raise HTTPException(
            status_code=429,
            detail="Too many messages. Please wait a minute and try again.",
        )

    try:
        history = [t.model_dump() for t in payload.history]
        reply = await answer_faq_chat(
            user_message=payload.message,
            history=history,
            user_role=role,
        )
        return FAQChatResponse(reply=reply)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat failed: {str(e)}")


# ─── Local Dev Entry Point ──────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("AI_FEEDBACK_SERVICE_PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
