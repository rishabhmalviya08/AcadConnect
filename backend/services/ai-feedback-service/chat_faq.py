"""
FAQ-only help chat using OpenAI — answers must stay grounded in faq_kb.md.
"""
from __future__ import annotations

import os
from pathlib import Path

from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

FAQ_PATH = Path(__file__).resolve().parent / "faq_kb.md"


def load_faq_markdown() -> str:
    text = FAQ_PATH.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError("FAQ knowledge file is empty.")
    return text


def build_system_prompt(user_role: str | None) -> str:
    kb = load_faq_markdown()

    role_hint = ""
    if user_role in ("student", "faculty", "admin"):
        role_hint = (
            f"\nThe user is signed in with role: **{user_role}**. "
            f"Tailor examples and next steps to this role when relevant; do not invent permissions.\n"
        )

    return f"""You are **AcadConnect Help**, an onboarding assistant.

You may ONLY answer using the FAQ knowledge below plus general UI navigation that is explicitly implied there.
If the user asks for anything not covered (account fixes, bugs, grades, custom policy, legal, medical, or anything requiring real data you do not have), reply briefly that you cannot help and tell them to contact their **admin** or **instructor**.

Rules:
- Keep answers short (under ~120 words unless the user asks for a list).
- Use clear bullet points when listing steps.
- Never ask for passwords or tokens. Never claim you changed data in the system.

{role_hint}

--- BEGIN FAQ (markdown) ---
{kb}
--- END FAQ ---
"""


async def answer_faq_chat(
    *,
    user_message: str,
    history: list[dict[str, str]],
    user_role: str | None,
) -> str:
    """
    Returns assistant plain-text reply (no markdown requirement).
    """
    sys = build_system_prompt(user_role)

    messages: list[dict[str, str]] = [{"role": "system", "content": sys}]

    for turn in history[-10:]:
        role = turn.get("role")
        content = turn.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content.strip()})

    messages.append({"role": "user", "content": user_message.strip()})

    response = await client.chat.completions.create(
        model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
        messages=messages,
        temperature=0.3,
        max_tokens=400,
    )

    raw = response.choices[0].message.content or ""
    text = raw.strip()
    if not text:
        raise ValueError("Empty model response")

    return text
