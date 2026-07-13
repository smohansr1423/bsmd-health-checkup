"""Local "dev mode" FastAPI app for the Nutrition Lookup Service.

ADDITIVE dev wiring only — no existing domain logic is modified. It exposes thin
JSON endpoints over the service's existing pure functions
(:func:`calculate_nutrition`, :func:`search_foods`, :func:`lookup_barcode`) plus
a ``/health`` probe, and enables permissive CORS for local development. The food
search / barcode lookups use small in-memory backends so no Elasticsearch or
external database is required.

Run:  PORT=8085 uvicorn app.main:app --port 8085
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.food_lookup import lookup_barcode, search_foods
from app.nutrition_calculation import (
    NutritionRequestItem,
    calculate_nutrition,
)
from app.result import Ok

SERVICE_NAME = "nutrition-lookup"

app = FastAPI(title="Nutrition Lookup Service — dev mode")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# In-memory backends for search / barcode (dev only)
# ---------------------------------------------------------------------------


class _InMemorySearchBackend:
    """Tiny in-memory Elasticsearch stand-in over a handful of foods."""

    _DOCS = [
        {"food_id": "rice_cooked", "name": "Cooked white rice", "popularity": 9},
        {"food_id": "chicken_breast", "name": "Chicken breast", "popularity": 8},
        {"food_id": "broccoli", "name": "Broccoli", "popularity": 6},
        {"food_id": "apple", "name": "Apple", "popularity": 7},
        {"food_id": "olive_oil", "name": "Olive oil", "popularity": 5},
    ]

    def search(self, index: str, body: dict) -> list:
        # Extract the user query from the built ES body and do a substring match.
        query = ""
        try:
            shoulds = body["query"]["bool"]["should"]
            query = shoulds[0]["multi_match"]["query"].lower()
        except Exception:  # pragma: no cover - defensive
            query = ""
        hits = []
        for doc in self._DOCS:
            if query and query not in doc["name"].lower():
                continue
            hits.append({"_id": doc["food_id"], "_score": float(doc["popularity"]), "_source": doc})
        return hits


class _InMemoryBarcodeBackend:
    _BY_CODE = {
        "0123456789012": {"food_id": "chicken_breast", "name": "Chicken breast", "brand": "DevFoods"},
    }

    def lookup(self, code: str) -> Optional[dict]:
        return self._BY_CODE.get(code)


_search_backend = _InMemorySearchBackend()
_barcode_backend = _InMemoryBarcodeBackend()


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class NutritionItemPayload(BaseModel):
    food_class: str = Field(..., min_length=1)
    volume_ml: float = Field(..., ge=0)
    portion_multiplier: float = 1.0
    error_pct: float = 0.0


class NutritionRequest(BaseModel):
    items: List[NutritionItemPayload]
    enable_micronutrient_overlay: bool = False
    nutrient_uncertainty_pct: float = 0.0


def _error_body(error) -> dict:
    return {
        "code": error.code,
        "message": error.message,
        "retryable": error.retryable,
        "retained_state": error.retained_state,
    }


def _nutrient(nv) -> dict:
    return {
        "value": nv.value,
        "unit": nv.unit,
        "lower": nv.lower,
        "upper": nv.upper,
        "available": nv.available,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": SERVICE_NAME}


@app.post("/nutrition")
def post_nutrition(body: NutritionRequest):
    items = [
        NutritionRequestItem(
            food_class=i.food_class,
            volume_ml=i.volume_ml,
            portion_multiplier=i.portion_multiplier,
            error_pct=i.error_pct,
        )
        for i in body.items
    ]
    result = calculate_nutrition(
        items,
        enable_micronutrient_overlay=body.enable_micronutrient_overlay,
        nutrient_uncertainty_pct=body.nutrient_uncertainty_pct,
    )
    if isinstance(result, Ok):
        r = result.value
        return {
            "primary": {k: _nutrient(v) for k, v in r.primary.items()},
            "secondary": {k: _nutrient(v) for k, v in r.secondary.items()},
            "micronutrients": (
                {k: _nutrient(v) for k, v in r.micronutrients.items()}
                if r.micronutrients
                else None
            ),
            "micronutrient_overlay_enabled": r.micronutrient_overlay_enabled,
            "micronutrient_message": r.micronutrient_message,
            "mass_g": r.mass_g,
        }
    return JSONResponse(status_code=422, content=_error_body(result.error))


@app.get("/search")
def get_search(q: str):
    result = search_foods(q, _search_backend)
    if isinstance(result, Ok):
        value = result.value
        # SearchSuccess or NoMatch
        if hasattr(value, "matches"):
            return {
                "kind": value.kind.value,
                "query": value.query,
                "matches": [
                    {"food_id": m.food_id, "name": m.name, "score": m.score, "brand": m.brand}
                    for m in value.matches
                ],
            }
        return {
            "kind": value.kind.value,
            "message": value.message,
            "fallback": value.fallback.value,
            "retained_state": value.retained_state,
        }
    return JSONResponse(status_code=422, content=_error_body(result.error))


@app.get("/barcode/{code}")
def get_barcode(code: str):
    result = lookup_barcode(code, _barcode_backend)
    if isinstance(result, Ok):
        value = result.value
        if hasattr(value, "match"):
            m = value.match
            return {
                "kind": value.kind.value,
                "code": value.code,
                "match": {"food_id": m.food_id, "name": m.name, "brand": m.brand},
            }
        return {
            "kind": value.kind.value,
            "message": value.message,
            "fallback": value.fallback.value,
            "retained_state": value.retained_state,
        }
    return JSONResponse(status_code=422, content=_error_body(result.error))
