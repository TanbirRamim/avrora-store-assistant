"""Write the read-only API responses to one JSON file for the Cloudflare deployment.

The store data is synthetic and fixed, so every GET route can be computed once at build
time. Only decisions change at runtime; the Worker keeps those in D1.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from avrora.api.main import _plan, app


def main(out: Path) -> None:
    client = TestClient(app)
    get = lambda path: client.get(path).raise_for_status().json()
    plan = _plan()
    snapshot = {
        "overview": get("/api/overview"),
        "briefing": get("/api/briefing"),
        "actions": get("/api/actions"),
        "evaluation": get("/api/evaluation"),
        "products": {pid: get(f"/api/products/{pid}") for pid in sorted({a.product_id for a in plan.actions})},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB, {len(snapshot['products'])} products)")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
