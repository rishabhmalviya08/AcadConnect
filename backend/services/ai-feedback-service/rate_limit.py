"""
In-memory sliding-window rate limiter (per process).
Use separate namespaces so chat vs OpenAI feedback do not share counters.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict

# full_key -> sorted timestamps (seconds)
_buckets: dict[str, list[float]] = defaultdict(list)


def _window_sec() -> float:
    return 60.0


def allow(
    key_suffix: str,
    *,
    namespace: str,
    env_var: str,
    default: int,
) -> bool:
    """
    key_suffix: e.g. uid:<uuid> or ip:<host>
    namespace: isolates buckets (e.g. 'chat', 'openai_feedback')
    env_var: env name for max requests per rolling minute
    """
    full_key = f"{namespace}:{key_suffix}"
    limit = max(1, int(os.getenv(env_var, str(default))))

    now = time.time()
    window = _window_sec()
    cutoff = now - window

    bucket = _buckets[full_key]
    while bucket and bucket[0] < cutoff:
        bucket.pop(0)

    if len(bucket) >= limit:
        return False

    bucket.append(now)
    return True
