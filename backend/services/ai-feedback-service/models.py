"""
models.py — Pydantic schemas for the AI Feedback Service
"""
from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal
from datetime import datetime


class FeedbackRequest(BaseModel):
    request_id: str
    group_id: str
    project_id: str
    snippet: str
    project_title: str
    project_description: str
    project_abstract: Optional[str] = None


class FeedbackResponse(BaseModel):
    feedback_id: str
    request_id: str
    group_id: str
    project_id: str
    relevance_score: int          # 1–10
    strengths: list[str]
    gaps: list[str]
    suggestions: list[str]
    summary: str
    created_at: datetime


class FeedbackCreatedResponse(BaseModel):
    feedback_id: str
    status: str = "generated"

class FeedbackSyncRequest(BaseModel):
    project_title: str
    project_description: str
    project_abstract: Optional[str] = None

class FeedbackSyncResponse(BaseModel):
    relevance_score: int
    strengths: list[str]
    gaps: list[str]
    suggestions: list[str]
    summary: str


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class FAQChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatTurn] = Field(default_factory=list)

    @field_validator("history", mode="before")
    @classmethod
    def cap_history(cls, v):
        if not isinstance(v, list):
            return []
        return v[-20:]


class FAQChatResponse(BaseModel):
    reply: str
