"""
Decode AcadConnect JWT from Authorization bearer (same secret as Node services).
Returns (role, user_id) for optional rate-limit + FAQ personalization.
"""
from __future__ import annotations

import os

import jwt as pyjwt


def decode_role_and_sub(authorization: str | None) -> tuple[str | None, str | None]:
    if not authorization or not authorization.startswith("Bearer "):
        return None, None

    token = authorization.split(" ", 1)[1].strip()
    secret = os.getenv("JWT_SECRET")
    if not secret:
        return None, None

    try:
        payload = pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"verify_exp": True},
        )
        role = payload.get("role")
        if role not in ("student", "faculty", "admin", None):
            role = None
        user_id = payload.get("id") or payload.get("sub")
        if isinstance(user_id, str):
            return role if isinstance(role, str) else None, user_id
        return None, None
    except Exception:
        return None, None
