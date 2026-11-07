"""Rx Radar API. Run: python -m uvicorn server.main:app --port 8000

Every feature router is optional: if one fails to import, the API still starts and the
frontend falls back to cached data for that feature. The demo must never break on stage.
"""
from __future__ import annotations

import importlib
import logging
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web" / "public" / "data"  # shared JSON the frontend also reads

try:  # .env at repo root may hold ANTHROPIC_API_KEY
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:
    pass

log = logging.getLogger("rxradar")
app = FastAPI(title="Rx Radar API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ROUTERS = ("server.sim.api", "server.equity.api", "server.copilot.api", "server.live")
loaded: dict[str, str] = {}
for mod in ROUTERS:
    try:
        app.include_router(importlib.import_module(mod).router, prefix="/api")
        loaded[mod] = "ok"
    except Exception as e:  # noqa: BLE001 - a broken feature must not take the API down
        loaded[mod] = f"unavailable: {e.__class__.__name__}: {e}"
        log.warning("router %s unavailable: %s", mod, e)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY")), "routers": loaded}
