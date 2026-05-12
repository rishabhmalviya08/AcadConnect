"""Pydantic models for request/response validation."""

from pydantic import BaseModel
from typing import List, Optional


class FacultyIndexRequest(BaseModel):
    """Request to index a single faculty member."""
    faculty_id: str
    name: str
    research_areas: List[str]


class FacultyRecommendation(BaseModel):
    """A single faculty recommendation result."""
    faculty_id: str
    name: str
    research_areas: List[str]
    score: float  # cosine similarity 0.0 – 1.0


class RecommendResponse(BaseModel):
    """Response from the recommendation endpoint."""
    recommendations: List[FacultyRecommendation]
    query_text: str


class SyncResponse(BaseModel):
    """Response from the sync-all endpoint."""
    indexed_count: int
    message: str


class FacultyListItem(BaseModel):
    """One faculty row for directory listing."""
    faculty_id: str
    name: str
    research_areas: List[str]


class FacultyListResponse(BaseModel):
    """All faculty from Postgres (for UI directory)."""
    faculty: List[FacultyListItem]
