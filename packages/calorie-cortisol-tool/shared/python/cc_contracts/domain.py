"""Core domain types — Python mirror of the TS source of truth.

Uses stdlib dataclasses + typing.Literal (no third-party dependency) so the
Food Vision, Nutrition Lookup, and Insights & ML services can share the same
contracts. Business logic lives in later tasks; these are data definitions only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

# ---------- Food domain ----------

NutrientUnit = Literal["kcal", "g", "mg"]
ReferenceObject = Literal["plate", "hand", "utensil"]
MealSource = Literal["photo", "barcode", "voice", "menuOCR", "textSearch", "manual"]
SyncStatus = Literal["local", "pending", "synced", "conflict"]


@dataclass
class BoundingBox:
    """Axis-aligned bounding box in normalized [0, 1] image coordinates."""

    x: float
    y: float
    width: float
    height: float


@dataclass
class FoodItem:
    """A recognized food item (Req 2.1/2.2)."""

    id: str
    label: str
    confidence: float  # 0..100 (Req 2.2)
    bbox: Optional[BoundingBox] = None


@dataclass
class PortionEstimate:
    """A portion/volume estimate for a detected food region (Req 3)."""

    volume_ml: float  # >= 0
    error_pct: float  # +/-15% single / +/-8% multi (Req 3.1/3.2)
    scaled: bool  # False -> accuracy reduced but still returned (Req 3.4)
    reference_object: Optional[ReferenceObject] = None


@dataclass
class NutrientValue:
    """A single nutrient value with its confidence range (Req 4.5/4.6)."""

    value: float  # >= 0
    unit: NutrientUnit
    lower: float  # lower <= value <= upper (Req 4.5)
    upper: float
    available: bool  # False -> "unavailable" (Req 4.6)


@dataclass
class MealItem:
    """A single item within a meal."""

    food_item: FoodItem
    portion_multiplier: float  # 0.25..3.0 step 0.25 (Req 5.1)
    nutrition: Dict[str, NutrientValue] = field(default_factory=dict)


@dataclass
class NutritionTotals:
    """Aggregated nutrition for a meal (Req 4.1-4.4)."""

    calories: NutrientValue
    protein: NutrientValue
    carbs: NutrientValue
    fat: NutrientValue
    secondary: Dict[str, NutrientValue] = field(default_factory=dict)
    micronutrients: Optional[Dict[str, NutrientValue]] = None


@dataclass
class Meal:
    """A logged meal (Req 5 — totals recomputed on every correction)."""

    id: str
    user_id: str
    logged_at: str  # ISO timestamp (local + offset)
    items: List[MealItem]  # 0..20
    totals: NutritionTotals
    source: MealSource
    sync_status: SyncStatus


@dataclass
class PlateCalibration:
    """Persisted personal plate calibration (Req 3.6/3.7)."""

    user_id: str
    reference_scale: float
    updated_at: str


@dataclass
class Correction:
    """Record of an applied correction and its training-queue status (Req 5.5/5.8)."""

    meal_id: str
    # Free-form operation descriptor mirrored from the TS CorrectionOp union.
    op: Dict[str, object]
    training_queued: bool


# ---------- Cortisol domain ----------

CortisolSource = Literal["lab", "patch", "wearableProxy", "questionnaireProxy"]
TimeOfDayBucket = Literal["morning", "noon", "afternoon", "evening"]
Sex = Literal["M", "F", "other"]
Classification = Literal["below", "normal", "above"]
QuestionnaireType = Literal["PSS-10", "GAD-7", "PSQI"]
BurdenTier = Literal["Low", "Moderate", "Elevated", "High"]


@dataclass
class ReferenceContext:
    """Age/sex/time-of-day reference context for a reading (Req 8.5)."""

    age_band: str
    sex: Sex
    ref_lower: float
    ref_upper: float
    classification: Classification


@dataclass
class CortisolReading:
    """A single normalized cortisol reading."""

    id: str
    user_id: str
    measured_at: str  # ISO timestamp
    value_nmol_l: float
    source: CortisolSource
    time_of_day_bucket: TimeOfDayBucket
    valid: bool  # False -> excluded from proxy calculations (Req 9.4)
    source_id: Optional[str] = None  # patch/device id (Req 9.3/9.5)
    contextualized: Optional[ReferenceContext] = None


@dataclass
class QuestionnaireResult:
    """Result of a scored questionnaire (Req 10)."""

    type: QuestionnaireType
    answers: List[int]  # all items required (Req 10.2)
    total_score: int  # within valid range (Req 10.1)
    tier: BurdenTier  # deterministic map (Req 10.3)


@dataclass
class CARSample:
    """A single timed CAR sample."""

    at: str
    value: float


@dataclass
class CARMeasurement:
    """Cortisol Awakening Response measurement (Req 11)."""

    user_id: str
    wake_time: str
    status: Literal["incomplete", "complete", "flattened"]
    sample1: Optional[CARSample] = None  # <=35 min after wake (Req 11.1)
    sample2: Optional[CARSample] = None  # 25..35 min after sample1 (Req 11.2)
    increase_pct: Optional[float] = None  # <50% -> flattened (Req 11.5)


@dataclass
class LifeEvent:
    """A user-recorded life event for trend annotation (Req 12.3/12.4)."""

    user_id: str
    date: str
    label: str


# ---------- Correlation / Insights ----------


@dataclass
class AlignedPair:
    """A food/cortisol pair aligned within +/-180 min (Req 15.1)."""

    meal_id: str
    reading_id: str
    delta_minutes: float


@dataclass
class CorrelationResult:
    """Result of a correlation significance test (Req 15.3/15.4)."""

    coefficient: float  # |r| >= 0.5 -> significant
    p_value: float  # < 0.05 -> significant
    pair_count: int  # >= 20 required to analyze
    significant: bool


ApprovalStatus = Literal["approved", "draft", "pending", "revoked"]


@dataclass
class Insight:
    """A surfaced wellness insight/recommendation (Req 13/15/29)."""

    id: str
    template_id: str
    approval_status: ApprovalStatus  # only "approved" displayed (Req 13.3/29.3)
    disclaimer_rendered: bool  # must be True to display (Req 29.2/29.5)
    rank_score: float  # descending correlation strength (Req 15.8)


# ---------- Account / Compliance ----------

FamilyRole = Literal["admin", "member"]
AuditAction = Literal["read", "create", "modify", "delete"]


@dataclass
class ConsentState:
    """Per-category consent state (Req 17 / 30.4)."""

    user_id: str
    categories: Dict[str, bool]  # per-category opt-in (Req 17)
    health_data_consent: bool  # affirmative health-data consent (Req 30.4)
    updated_at: str


@dataclass
class MemberProfile:
    """A single member profile within a family account."""

    id: str
    role: FamilyRole


@dataclass
class FamilyAccount:
    """A family account holding <=5 member profiles (Req 19.1)."""

    id: str
    admin_user_id: str
    members: List[MemberProfile]  # <= 5


@dataclass
class AuditEntry:
    """An append-only audit entry, retained >=6 years (Req 25.6)."""

    actor_id: str
    action: AuditAction
    record_id: str
    timestamp: str


@dataclass
class Residency:
    """Data-residency descriptor for a user (Req 30.6/30.7)."""

    user_id: str
    region: str
    eu_resident: bool
