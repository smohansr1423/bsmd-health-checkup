"""Model-runtime integration layer for the Food Vision Service (Task 17.1).

This module wires the AI/ML *runtimes* and *model registry* described in the
design's *AI/ML Model Design* / *ML Ops* sections into the service's existing
**pure** endpoint logic:

    * Recognition gating       -> :func:`app.recognition.recognize`
    * Portion estimation       -> :func:`app.portion.estimate_portion`

Per the design, cloud inference runs full-precision on **Triton** (GPU) while
the client runs an **INT8-quantized Core ML / TFLite** variant; portion volume
comes from **DPT/MiDaS** monocular depth (single-angle) or **multi-angle
photogrammetry**, reference objects are found by **YOLOv9**, models are resolved
through the **MLflow** registry, and rollout between on-device and cloud is
gated by a **LaunchDarkly** feature flag.

Real Triton / Core ML / TFLite / YOLOv9 / MLflow / LaunchDarkly runtimes are
infrastructure that lives outside this repository, so this module defines the
**ports** (abstract protocols) each of those systems plugs into, ships small
**deterministic default/stub adapters** that emit exactly the structured
outputs the pure functions consume, and provides a :class:`RuntimeRouter` that
selects the on-device vs. cloud runtime via a :class:`FeatureFlagRouter`. Every
adapter is injectable, so production wiring swaps the stubs for the real
clients without touching the pure recognition/portion logic.

Design references:
    * "Cloud runs full-precision on Triton (GPU); on-device runs an
      INT8-quantized (<80 MB) Core ML / TFLite variant."
    * "DPT monocular depth (MiDaS fallback) for single-angle; multi-angle
      photogrammetry for 3-shot. YOLOv9 detects plate/hand/utensil for scaling."
    * "NVIDIA Triton (primary) + SageMaker MME (fallback); MLflow model
      registry; LaunchDarkly feature flags for model rollout."

Requirements: 2.1, 3.1, 3.2, 3.3
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping, Optional, Protocol, Sequence

from app.accuracy_eval import CaptureMode
from app.portion import (
    CalibrationStore,
    InMemoryCalibrationStore,
    PortionEstimate,
    PortionRequest,
    ReferenceObject,
    estimate_portion,
)
from app.recognition import (
    RawDetection,
    RecognitionMode,
    RecognitionResult,
    recognize,
)
from app.result import Err, Ok

# ---------------------------------------------------------------------------
# Runtime / backend enumerations
# ---------------------------------------------------------------------------


class RuntimeLocation(str, Enum):
    """Where inference executes for a request.

    ``CLOUD`` is the full-precision Triton (GPU) runtime; ``ON_DEVICE`` is the
    INT8-quantized Core ML / TFLite variant that also serves offline capture.
    """

    CLOUD = "cloud"
    ON_DEVICE = "on-device"


class ModelFormat(str, Enum):
    """Serialized model format served by a runtime (design AI/ML section)."""

    TRITON = "triton"  # cloud full-precision
    CORE_ML = "coreml"  # iOS on-device INT8
    TFLITE = "tflite"  # Android on-device INT8


class DepthBackend(str, Enum):
    """Volume-reconstruction backend used for a portion request.

    Single-angle uses DPT monocular depth (MiDaS as fallback); a 3-shot
    multi-angle capture uses photogrammetry (Req 3.1/3.2).
    """

    DPT = "dpt"
    MIDAS = "midas"  # single-angle fallback
    PHOTOGRAMMETRY = "photogrammetry"  # multi-angle


#: Model formats considered valid for each runtime location. Used by the
#: registry stub to keep on-device descriptors quantized (Core ML / TFLite) and
#: cloud descriptors on Triton.
_LOCATION_FORMATS: dict[RuntimeLocation, tuple[ModelFormat, ...]] = {
    RuntimeLocation.CLOUD: (ModelFormat.TRITON,),
    RuntimeLocation.ON_DEVICE: (ModelFormat.CORE_ML, ModelFormat.TFLITE),
}


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ImageInput:
    """An abstract handle to a submitted image (or multi-angle shot set).

    The runtime layer does not manipulate raw pixels itself; it hands this
    handle to the injected runtime adapters (Triton / Core ML / TFLite / DPT /
    YOLOv9), which perform the actual inference. ``resolution`` gates portion
    processing (Req 3.5) and ``image_id`` lets deterministic stub adapters look
    up scripted model outputs.
    """

    image_id: str
    width: int
    height: int
    angles_deg: tuple[float, ...] = ()  # populated for multi-angle captures


@dataclass(frozen=True)
class ModelDescriptor:
    """A resolved model version from the MLflow model registry.

    Mirrors the identity an MLflow registry entry carries: registered ``name``,
    numeric ``version``, lifecycle ``stage`` (e.g. "Production"), the runtime
    ``location`` it targets, and its serialized ``format``.
    """

    name: str
    version: str
    stage: str
    location: RuntimeLocation
    model_format: ModelFormat


@dataclass(frozen=True)
class DetectionBundle:
    """Structured recognition output produced by an inference runtime.

    ``detections`` are standard image-classification detections; ``menu_detections``
    are the restaurant menu-OCR / point-of-sale detections (Req 2.4/2.5). Both
    are the ranked :class:`~app.recognition.RawDetection` payloads the pure
    :func:`~app.recognition.recognize` function consumes unchanged.
    """

    detections: tuple[RawDetection, ...] = ()
    menu_detections: tuple[RawDetection, ...] = ()


@dataclass(frozen=True)
class DepthResult:
    """Structured depth/volume output produced by a depth estimator.

    Carries the un-scaled ``raw_volume_ml`` signal plus the food-region and
    resolution facts the pure :func:`~app.portion.estimate_portion` function
    needs to apply its Req 3.5 processability gate. ``backend`` records which
    depth model produced the estimate (DPT / MiDaS / photogrammetry).
    """

    raw_volume_ml: float
    has_food_region: bool
    width: int
    height: int
    backend: DepthBackend


@dataclass(frozen=True)
class RolloutContext:
    """Inputs the feature-flag router uses to pick a runtime.

    ``online`` reflects connectivity: an offline capture can only use the
    on-device runtime regardless of the flag. ``cloud_rollout_override`` lets a
    caller force cloud-eligibility for a user (e.g. an internal tester),
    matching a LaunchDarkly targeting rule.
    """

    user_id: str
    online: bool = True
    cloud_rollout_override: Optional[bool] = None


# ---------------------------------------------------------------------------
# Ports (abstract adapter boundaries)
# ---------------------------------------------------------------------------


class ModelRegistry(Protocol):
    """MLflow-style registry that resolves a model version for a runtime."""

    def resolve(self, name: str, location: RuntimeLocation) -> ModelDescriptor:
        """Return the production :class:`ModelDescriptor` for ``name``/``location``."""
        ...


class FeatureFlagRouter(Protocol):
    """LaunchDarkly-style flag evaluator selecting the runtime for a request."""

    def resolve_runtime(self, context: RolloutContext) -> RuntimeLocation:
        """Return the :class:`RuntimeLocation` to serve ``context`` from."""
        ...


class InferenceRuntime(Protocol):
    """A recognition backend (Triton cloud, or Core ML / TFLite on-device)."""

    location: RuntimeLocation

    def recognize(self, image: ImageInput, mode: RecognitionMode) -> DetectionBundle:
        """Run detection and return the structured :class:`DetectionBundle`."""
        ...


class DepthEstimator(Protocol):
    """A volume backend (DPT/MiDaS single-angle, or multi-angle photogrammetry)."""

    location: RuntimeLocation

    def estimate(
        self, images: Sequence[ImageInput], capture_mode: CaptureMode
    ) -> DepthResult:
        """Return the un-scaled volume signal + processability facts."""
        ...


class ReferenceObjectDetector(Protocol):
    """A YOLOv9-style detector locating a plate/hand/utensil reference object."""

    def detect(self, image: ImageInput) -> Optional[ReferenceObject]:
        """Return the detected reference object, or ``None`` if none is present."""
        ...


# ---------------------------------------------------------------------------
# Default / stub adapters (deterministic, injectable)
# ---------------------------------------------------------------------------


class StubModelRegistry:
    """Deterministic default :class:`ModelRegistry`.

    Stands in for MLflow: returns a fixed production descriptor per
    ``(name, location)``, using a Triton format for cloud and a quantized
    Core ML / TFLite format for on-device. Registered versions can be seeded to
    emulate a promoted registry state.
    """

    def __init__(
        self,
        versions: Optional[Mapping[tuple[str, RuntimeLocation], str]] = None,
        on_device_format: ModelFormat = ModelFormat.TFLITE,
    ) -> None:
        if on_device_format not in _LOCATION_FORMATS[RuntimeLocation.ON_DEVICE]:
            raise ValueError("on_device_format must be Core ML or TFLite")
        self._versions = dict(versions or {})
        self._on_device_format = on_device_format

    def resolve(self, name: str, location: RuntimeLocation) -> ModelDescriptor:
        version = self._versions.get((name, location), "1")
        model_format = (
            ModelFormat.TRITON
            if location is RuntimeLocation.CLOUD
            else self._on_device_format
        )
        return ModelDescriptor(
            name=name,
            version=version,
            stage="Production",
            location=location,
            model_format=model_format,
        )


class StaticFeatureFlagRouter:
    """Deterministic default :class:`FeatureFlagRouter` (LaunchDarkly-style).

    Rollout rules, evaluated in order:

    1. An **offline** context always resolves to the on-device runtime — cloud
       inference is unreachable without connectivity.
    2. ``RolloutContext.cloud_rollout_override`` (when not ``None``) wins next,
       matching an explicit LaunchDarkly targeting rule for a user.
    3. Users in ``cloud_enabled_users`` are served from the cloud.
    4. Otherwise a stable percentage bucket (hash of ``flag_key`` + user id)
       decides: buckets below ``cloud_rollout_percentage`` get the cloud
       runtime, everyone else stays on-device.

    The default configuration (0% rollout, no allowlist) keeps every online user
    on-device, so enabling cloud is an explicit opt-in.
    """

    def __init__(
        self,
        cloud_rollout_percentage: int = 0,
        cloud_enabled_users: frozenset[str] = frozenset(),
        flag_key: str = "food-vision-cloud-runtime",
    ) -> None:
        if not 0 <= cloud_rollout_percentage <= 100:
            raise ValueError("cloud_rollout_percentage must be within 0..100")
        self._percentage = cloud_rollout_percentage
        self._enabled_users = cloud_enabled_users
        self._flag_key = flag_key

    def _bucket(self, user_id: str) -> int:
        digest = hashlib.sha1(f"{self._flag_key}:{user_id}".encode()).hexdigest()
        return int(digest, 16) % 100

    def resolve_runtime(self, context: RolloutContext) -> RuntimeLocation:
        if not context.online:
            return RuntimeLocation.ON_DEVICE
        if context.cloud_rollout_override is not None:
            return (
                RuntimeLocation.CLOUD
                if context.cloud_rollout_override
                else RuntimeLocation.ON_DEVICE
            )
        if context.user_id in self._enabled_users:
            return RuntimeLocation.CLOUD
        if self._bucket(context.user_id) < self._percentage:
            return RuntimeLocation.CLOUD
        return RuntimeLocation.ON_DEVICE


@dataclass
class ScriptedInferenceRuntime:
    """Default :class:`InferenceRuntime` returning pre-scripted detections.

    Emulates a Triton / Core ML / TFLite model by returning the
    :class:`DetectionBundle` seeded for an image id. Unknown images yield an
    empty bundle, which the pure recognizer turns into the "no food recognized"
    outcome (Req 2.7). This keeps the adapter fully deterministic for tests
    while producing exactly the structure a real runtime would.
    """

    location: RuntimeLocation
    scripted: dict[str, DetectionBundle] = field(default_factory=dict)

    def recognize(self, image: ImageInput, mode: RecognitionMode) -> DetectionBundle:
        return self.scripted.get(image.image_id, DetectionBundle())


@dataclass
class ScriptedDepthEstimator:
    """Default :class:`DepthEstimator` returning a scripted volume signal.

    Emulates DPT/MiDaS (single-angle) or photogrammetry (multi-angle) by
    returning the ``raw_volume_ml`` and food-region facts seeded for an image
    id. The reported ``backend`` follows the capture mode (photogrammetry for
    multi-angle, DPT otherwise) unless overridden per image. Resolution is taken
    from the submitted :class:`ImageInput` so the Req 3.5 gate stays authoritative.
    """

    location: RuntimeLocation
    scripted: dict[str, tuple[float, bool]] = field(default_factory=dict)
    default_volume_ml: float = 0.0
    default_has_food_region: bool = False

    def estimate(
        self, images: Sequence[ImageInput], capture_mode: CaptureMode
    ) -> DepthResult:
        if not images:
            raise ValueError("at least one image is required for depth estimation")
        primary = images[0]
        raw_volume_ml, has_food_region = self.scripted.get(
            primary.image_id,
            (self.default_volume_ml, self.default_has_food_region),
        )
        backend = (
            DepthBackend.PHOTOGRAMMETRY
            if capture_mode is CaptureMode.MULTI_ANGLE
            else DepthBackend.DPT
        )
        return DepthResult(
            raw_volume_ml=raw_volume_ml,
            has_food_region=has_food_region,
            width=primary.width,
            height=primary.height,
            backend=backend,
        )


@dataclass
class ScriptedReferenceObjectDetector:
    """Default YOLOv9-style :class:`ReferenceObjectDetector`.

    Returns the reference object seeded for an image id, or ``None`` when no
    reference object was "detected" — driving the unscaled-but-retained path in
    :func:`~app.portion.estimate_portion` (Req 3.4).
    """

    scripted: dict[str, ReferenceObject] = field(default_factory=dict)

    def detect(self, image: ImageInput) -> Optional[ReferenceObject]:
        return self.scripted.get(image.image_id)


# ---------------------------------------------------------------------------
# Runtime router / facade
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RecognitionOutcome:
    """A recognition result annotated with the runtime that produced it."""

    result: RecognitionResult
    location: RuntimeLocation
    model: ModelDescriptor


@dataclass(frozen=True)
class PortionOutcome:
    """A portion estimate annotated with the runtime that produced it."""

    estimate: PortionEstimate
    location: RuntimeLocation
    depth_backend: DepthBackend
    model: ModelDescriptor


#: Registered model names in the MLflow registry (design AI/ML section).
RECOGNIZER_MODEL_NAME = "food-recognizer"
PORTION_MODEL_NAME = "portion-depth"


class RuntimeRouter:
    """Selects on-device vs. cloud runtimes and feeds the pure endpoint logic.

    The router holds one :class:`InferenceRuntime` and one :class:`DepthEstimator`
    per :class:`RuntimeLocation`, a shared YOLOv9 reference detector, the MLflow
    registry, and the LaunchDarkly-style flag router. For each request it asks
    the flag router which location to use, resolves the model descriptor from
    the registry, runs the corresponding adapter, and then delegates the
    *decision logic* to the existing pure functions
    (:func:`~app.recognition.recognize` / :func:`~app.portion.estimate_portion`),
    which remain the single source of truth for gating and validation.
    """

    def __init__(
        self,
        *,
        registry: ModelRegistry,
        flag_router: FeatureFlagRouter,
        inference_runtimes: Mapping[RuntimeLocation, InferenceRuntime],
        depth_estimators: Mapping[RuntimeLocation, DepthEstimator],
        reference_detector: ReferenceObjectDetector,
        calibration_store: Optional[CalibrationStore] = None,
    ) -> None:
        missing_inf = set(RuntimeLocation) - set(inference_runtimes)
        if missing_inf:
            raise ValueError(
                f"inference runtime(s) missing for: "
                f"{', '.join(sorted(loc.value for loc in missing_inf))}"
            )
        missing_depth = set(RuntimeLocation) - set(depth_estimators)
        if missing_depth:
            raise ValueError(
                f"depth estimator(s) missing for: "
                f"{', '.join(sorted(loc.value for loc in missing_depth))}"
            )
        self._registry = registry
        self._flag_router = flag_router
        self._inference_runtimes = dict(inference_runtimes)
        self._depth_estimators = dict(depth_estimators)
        self._reference_detector = reference_detector
        self._calibration_store = calibration_store or InMemoryCalibrationStore()

    def select_location(self, context: RolloutContext) -> RuntimeLocation:
        """Resolve the runtime location for ``context`` via the feature flag."""
        return self._flag_router.resolve_runtime(context)

    def recognize_image(
        self,
        image: ImageInput,
        context: RolloutContext,
        mode: RecognitionMode = RecognitionMode.STANDARD,
    ) -> Ok[RecognitionOutcome] | Err:
        """Run recognition end-to-end: select runtime -> infer -> gate.

        Selects the runtime via the feature flag (Req 2.1 model routing),
        resolves the recognizer model from the registry, invokes the selected
        inference runtime to obtain structured detections, and applies the pure
        confidence-gating logic. Returns ``Ok(RecognitionOutcome)`` on success or
        the pure function's ``Err`` (e.g. a malformed-detection rejection),
        propagated unchanged.
        """
        location = self.select_location(context)
        model = self._registry.resolve(RECOGNIZER_MODEL_NAME, location)
        runtime = self._inference_runtimes[location]
        bundle = runtime.recognize(image, mode)
        result = recognize(bundle.detections, mode, bundle.menu_detections)
        if isinstance(result, Err):
            return result
        return Ok(
            RecognitionOutcome(
                result=result.value, location=location, model=model
            )
        )

    def estimate_portion_image(
        self,
        images: Sequence[ImageInput],
        context: RolloutContext,
        capture_mode: CaptureMode,
        user_id: str,
    ) -> Ok[PortionOutcome] | Err:
        """Run portion estimation end-to-end: select runtime -> depth -> scale.

        Selects the runtime via the feature flag, resolves the depth model,
        runs the depth estimator (DPT/MiDaS or photogrammetry) and the YOLOv9
        reference detector, assembles a :class:`~app.portion.PortionRequest`, and
        delegates to the pure :func:`~app.portion.estimate_portion` for the
        Req 3.1–3.6 logic (error bands, reference scaling, calibration override,
        atomic rejection). The pure function's ``Err`` is propagated unchanged so
        unprocessable images are rejected atomically (Req 3.5).
        """
        if not images:
            raise ValueError("at least one image is required for portion estimation")
        location = self.select_location(context)
        model = self._registry.resolve(PORTION_MODEL_NAME, location)
        depth = self._depth_estimators[location].estimate(images, capture_mode)
        reference_object = self._reference_detector.detect(images[0])
        request = PortionRequest(
            user_id=user_id,
            capture_mode=capture_mode,
            width=depth.width,
            height=depth.height,
            has_food_region=depth.has_food_region,
            raw_volume_ml=depth.raw_volume_ml,
            reference_object=reference_object,
        )
        result = estimate_portion(request, self._calibration_store)
        if isinstance(result, Err):
            return result
        return Ok(
            PortionOutcome(
                estimate=result.value,
                location=location,
                depth_backend=depth.backend,
                model=model,
            )
        )


# ---------------------------------------------------------------------------
# Convenience wiring
# ---------------------------------------------------------------------------


def build_default_runtime_router(
    *,
    flag_router: Optional[FeatureFlagRouter] = None,
    registry: Optional[ModelRegistry] = None,
    cloud_inference: Optional[InferenceRuntime] = None,
    on_device_inference: Optional[InferenceRuntime] = None,
    cloud_depth: Optional[DepthEstimator] = None,
    on_device_depth: Optional[DepthEstimator] = None,
    reference_detector: Optional[ReferenceObjectDetector] = None,
    calibration_store: Optional[CalibrationStore] = None,
) -> RuntimeRouter:
    """Assemble a :class:`RuntimeRouter` from the default stub adapters.

    Any adapter can be overridden to inject a real client (Triton, Core ML,
    TFLite, DPT, YOLOv9, MLflow, LaunchDarkly) while leaving the rest stubbed.
    With no overrides the router is fully deterministic and keeps every online
    user on the on-device runtime (0% cloud rollout).
    """
    return RuntimeRouter(
        registry=registry or StubModelRegistry(),
        flag_router=flag_router or StaticFeatureFlagRouter(),
        inference_runtimes={
            RuntimeLocation.CLOUD: cloud_inference
            or ScriptedInferenceRuntime(RuntimeLocation.CLOUD),
            RuntimeLocation.ON_DEVICE: on_device_inference
            or ScriptedInferenceRuntime(RuntimeLocation.ON_DEVICE),
        },
        depth_estimators={
            RuntimeLocation.CLOUD: cloud_depth
            or ScriptedDepthEstimator(RuntimeLocation.CLOUD),
            RuntimeLocation.ON_DEVICE: on_device_depth
            or ScriptedDepthEstimator(RuntimeLocation.ON_DEVICE),
        },
        reference_detector=reference_detector or ScriptedReferenceObjectDetector(),
        calibration_store=calibration_store,
    )
