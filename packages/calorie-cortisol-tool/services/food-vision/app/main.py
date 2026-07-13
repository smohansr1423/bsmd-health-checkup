"""Local "dev mode" FastAPI app for the Food Vision Service.

ADDITIVE dev wiring only — no existing domain logic is modified. It mounts the
service's existing routers (:func:`build_inference_router` and
:func:`build_portion_router`) plus a ``/health`` probe, and enables permissive
CORS for local development. Everything runs on the in-memory defaults the
routers already ship (in-memory calibration store, default runtime router), so
no Triton / Core ML / external infrastructure is required.

Run:  PORT=8084 uvicorn app.main:app --port 8084
      (or via the repo dev runner / poetry run uvicorn app.main:app)
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.inference_router import build_inference_router
from app.portion_router import build_portion_router

SERVICE_NAME = "food-vision"

app = FastAPI(title="Food Vision Service — dev mode")

# Permissive CORS for local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": SERVICE_NAME}


# Existing routers, backed by their in-memory defaults.
app.include_router(build_inference_router())
app.include_router(build_portion_router())
