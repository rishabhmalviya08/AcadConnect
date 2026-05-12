"""
feedback.py — OpenAI prompt logic for generating structured feedback
"""
import os
import json
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()


class OpenAIKeyConfigurationError(Exception):
    """Raised when OPENAI_API_KEY is missing/placeholder and mock mode is off."""


def _normalized_api_key() -> str:
    raw = os.getenv("OPENAI_API_KEY") or ""
    return str(raw).strip().strip('"').strip("'")


def _is_placeholder_or_missing_key(key: str) -> bool:
    if not key:
        return True
    low = key.lower()
    if len(low) < 8:
        return True
    # Common .env.example placeholders (OpenAI returns 401 for these)
    bad_substrings = (
        "your-openai-api-key-here",
        "your_openai_api_key_here",
        "your-openai-key",
        "replace_with",
        "paste_your",
    )
    if any(s in low for s in bad_substrings):
        return True
    if low.startswith("your-") and "here" in low:
        return True
    return False


def _mock_feedback(project_title: str, project_description: str, project_abstract: str | None) -> dict:
    """Deterministic stub when OPENAI_FEEDBACK_MOCK=1 or for tests."""
    title = (project_title or "Untitled")[:80]
    return {
        "relevance_score": 6,
        "strengths": [
            "Mock mode: project title and description were received by the feedback service.",
            "You can iterate on UI and similarity features without a live OpenAI key.",
        ],
        "gaps": [
            "This is not real model output — set a valid OPENAI_API_KEY and OPENAI_FEEDBACK_MOCK=0 for authentic feedback.",
        ],
        "suggestions": [
            "Add OPENAI_API_KEY from https://platform.openai.com/account/api-keys to backend/.env (same file Docker loads for ai-feedback-service).",
            "Restart the ai-feedback-service container or process after changing .env.",
        ],
        "summary": (
            f"Stub AI feedback for “{title}”. "
            "Enable a real API key to get mentor-style scoring and narrative; mock mode exists for local development only."
        ),
    }

SYSTEM_PROMPT = """
You are an academic mentor evaluating a student group's proposed research project from its title, full description, and (when provided) a short abstract.
Your job is to provide honest, constructive, structured feedback on their pitch, highlighting if it's clear, technically sound, and well scoped for an academic setting.
Use the abstract as a concise summary of intent when present; use the description for scope and technical detail.

Always respond with ONLY a valid JSON object with exactly these fields:
{
  "relevance_score": <integer 1-10>,
  "strengths": [<list of concise strings>],
  "gaps": [<list of concise strings>],
  "suggestions": [<list of actionable strings>],
  "summary": "<one paragraph plain English summary>"
}

Guidelines:
- relevance_score: The overall quality and viability of the project (1=very poor, 10=excellent)
- strengths: What the proposed project outlines well (2-4 items)
- gaps: Missing clarity, scope definition, or fundamental requirements (1-4 items)
- suggestions: Concrete advice for improving the project proposal (2-4 items)
- summary: A balanced, professional summary suitable for the student to read
"""


async def generate_feedback(
    project_title: str,
    project_description: str,
    project_abstract: str | None = None,
) -> dict:
    """
    Calls OpenAI gpt-4o-mini and returns parsed feedback as a dict.
    Raises OpenAIKeyConfigurationError if the API key is missing/placeholder (unless OPENAI_FEEDBACK_MOCK=1).
    Raises ValueError if the model returns non-JSON or missing fields.
    """
    key = _normalized_api_key()
    mock = os.getenv("OPENAI_FEEDBACK_MOCK", "").strip().lower() in ("1", "true", "yes")

    if mock:
        return _mock_feedback(project_title, project_description, project_abstract)

    if _is_placeholder_or_missing_key(key):
        raise OpenAIKeyConfigurationError(
            "OPENAI_API_KEY is missing or still the .env.example placeholder (OpenAI returns 401). "
            "Add a real key from https://platform.openai.com/account/api-keys to the env file used by "
            "ai-feedback-service (e.g. AcadConnect/backend/.env), or set OPENAI_FEEDBACK_MOCK=1 for stubbed "
            "feedback during local development."
        )

    client = AsyncOpenAI(api_key=key)

    abstract_block = ""
    if project_abstract and str(project_abstract).strip():
        abstract_block = f"\nPROJECT ABSTRACT (short summary):\n{str(project_abstract).strip()}\n"

    user_message = f"""
PROJECT TITLE: {project_title}
PROJECT DESCRIPTION: {project_description}
{abstract_block}"""

    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT.strip()},
            {"role": "user", "content": user_message.strip()},
        ],
        temperature=0.4,
        response_format={"type": "json_object"},
    )

    raw = response.choices[0].message.content
    parsed = json.loads(raw)

    # Validate required fields
    required = {"relevance_score", "strengths", "gaps", "suggestions", "summary"}
    missing = required - parsed.keys()
    if missing:
        raise ValueError(f"OpenAI response missing fields: {missing}")

    # Coerce types
    parsed["relevance_score"] = int(parsed["relevance_score"])
    parsed["strengths"] = list(parsed.get("strengths", []))
    parsed["gaps"] = list(parsed.get("gaps", []))
    parsed["suggestions"] = list(parsed.get("suggestions", []))
    parsed["summary"] = str(parsed.get("summary", ""))

    return parsed


def log_startup_feedback_mode() -> None:
    """One-line hint for operators (printed from FastAPI lifespan)."""
    key = _normalized_api_key()
    mock = os.getenv("OPENAI_FEEDBACK_MOCK", "").strip().lower() in ("1", "true", "yes")
    if mock:
        print(
            "[ai-feedback-service] OPENAI_FEEDBACK_MOCK=1 — project AI feedback returns stubbed JSON (no OpenAI calls)."
        )
    elif _is_placeholder_or_missing_key(key):
        print(
            "[ai-feedback-service] WARN: OPENAI_API_KEY missing or looks like a placeholder. "
            "POST /api/feedback/* will return 503 until you set a real key or OPENAI_FEEDBACK_MOCK=1."
        )
    else:
        print("[ai-feedback-service] OpenAI project feedback enabled (gpt-4o-mini).")
