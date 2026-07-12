"""Unit tests for the model-runtime integration layer (Task 17.1).

Covers the feature-flag runtime routing (on-device vs. cloud), the MLflow-style
registry descriptors, the depth/reference adapter wiring into portion
estimation, and that the runtime layer feeds — and never bypasses — the existing
pure recognition/portion gating logic.

Requirements: 2.1, 3.1, 3.2, 3.3
"""

from fastapi.testclient import TestClient

from app.accuracy_eval import CaptureMode
from app.model_runtime import (
    DepthBackend,
    DetectionBundle,
    ImageInput,
    ModelFormat,
    PORTION_MODEL_NAME,
    RECOGNIZER_MODEL_NAME,
    RolloutContext,
    RuntimeLocation,
    ScriptedDepthEstimator,
    ScriptedInferenceRuntime,
    ScriptedReferenceObjectDetector,
    StaticFeatureFlagRouter,
    StubModelRegistry,
    build_default_runtime_router,
)
from app.inference_router import create_inference_app
from app.portion import ReferenceObject
from app.recognition import Candidate, RawDetection, RecognitionMode
from app.result import Err, Ok


# ---------------------------------------------------------------------------
# Feature-flag routing (on-device vs cloud)
# ---------------------------------------------------------------------------


def test_offline_context_always_selects_on_device() -> None:
    flag = StaticFeatureFlagRouter(cloud_rollout_percentage=100)
    loc = flag.resolve_runtime(RolloutContext(user_id="u1", online=False))
    assert loc is RuntimeLocation.ON_DEVICE


def test_default_rollout_keeps_online_users_on_device() -> None:
    flag = StaticFeatureFlagRouter()  # 0% rollout, no allowlist
    loc = flag.resolve_runtime(RolloutContext(user_id="anyone", online=True))
    assert loc is RuntimeLocation.ON_DEVICE


def test_full_rollout_selects_cloud_when_online() -> None:
    flag = StaticFeatureFlagRouter(cloud_rollout_percentage=100)
    loc = flag.resolve_runtime(RolloutContext(user_id="u1", online=True))
    assert loc is RuntimeLocation.CLOUD


def test_allowlisted_user_selects_cloud() -> None:
    flag = StaticFeatureFlagRouter(cloud_enabled_users=frozenset({"vip"}))
    assert flag.resolve_runtime(RolloutContext("vip", online=True)) is RuntimeLocation.CLOUD
    assert flag.resolve_runtime(RolloutContext("other", online=True)) is RuntimeLocation.ON_DEVICE


def test_override_takes_precedence_over_percentage() -> None:
    flag = StaticFeatureFlagRouter(cloud_rollout_percentage=100)
    ctx = RolloutContext(user_id="u1", online=True, cloud_rollout_override=False)
    assert flag.resolve_runtime(ctx) is RuntimeLocation.ON_DEVICE


def test_percentage_bucketing_is_deterministic() -> None:
    flag = StaticFeatureFlagRouter(cloud_rollout_percentage=50)
    ctx = RolloutContext(user_id="stable-user", online=True)
    first = flag.resolve_runtime(ctx)
    for _ in range(20):
        assert flag.resolve_runtime(ctx) is first


def test_invalid_percentage_rejected() -> None:
    for bad in (-1, 101):
        try:
            StaticFeatureFlagRouter(cloud_rollout_percentage=bad)
        except ValueError:
            continue
        raise AssertionError(f"expected ValueError for percentage {bad}")


# ---------------------------------------------------------------------------
# MLflow-style registry descriptors
# ---------------------------------------------------------------------------


def test_registry_cloud_descriptor_uses_triton() -> None:
    reg = StubModelRegistry()
    desc = reg.resolve(RECOGNIZER_MODEL_NAME, RuntimeLocation.CLOUD)
    assert desc.model_format is ModelFormat.TRITON
    assert desc.stage == "Production"
    assert desc.location is RuntimeLocation.CLOUD


def test_registry_on_device_descriptor_is_quantized_format() -> None:
    reg = StubModelRegistry(on_device_format=ModelFormat.CORE_ML)
    desc = reg.resolve(RECOGNIZER_MODEL_NAME, RuntimeLocation.ON_DEVICE)
    assert desc.model_format is ModelFormat.CORE_ML

    reg_tflite = StubModelRegistry(on_device_format=ModelFormat.TFLITE)
    assert (
        reg_tflite.resolve(RECOGNIZER_MODEL_NAME, RuntimeLocation.ON_DEVICE).model_format
        is ModelFormat.TFLITE
    )


def test_registry_rejects_non_quantized_on_device_format() -> None:
    try:
        StubModelRegistry(on_device_format=ModelFormat.TRITON)
    except ValueError:
        return
    raise AssertionError("expected ValueError for non-quantized on-device format")


def test_registry_returns_seeded_version() -> None:
    reg = StubModelRegistry(versions={(RECOGNIZER_MODEL_NAME, RuntimeLocation.CLOUD): "7"})
    assert reg.resolve(RECOGNIZER_MODEL_NAME, RuntimeLocation.CLOUD).version == "7"


# ---------------------------------------------------------------------------
# RuntimeRouter construction guards
# ---------------------------------------------------------------------------


def test_router_requires_both_locations() -> None:
    from app.model_runtime import RuntimeRouter

    try:
        RuntimeRouter(
            registry=StubModelRegistry(),
            flag_router=StaticFeatureFlagRouter(),
            inference_runtimes={
                RuntimeLocation.CLOUD: ScriptedInferenceRuntime(RuntimeLocation.CLOUD)
            },  # missing ON_DEVICE
            depth_estimators={
                RuntimeLocation.CLOUD: ScriptedDepthEstimator(RuntimeLocation.CLOUD),
                RuntimeLocation.ON_DEVICE: ScriptedDepthEstimator(RuntimeLocation.ON_DEVICE),
            },
            reference_detector=ScriptedReferenceObjectDetector(),
        )
    except ValueError:
        return
    raise AssertionError("expected ValueError when a runtime location is missing")


# ---------------------------------------------------------------------------
# Recognition wiring — runtime feeds the pure gating logic
# ---------------------------------------------------------------------------


def _bundle_high_conf() -> DetectionBundle:
    return DetectionBundle(
        detections=(
            RawDetection(region_id="r1", candidates=(Candidate("apple", 92.0),)),
        )
    )


def test_recognize_routes_to_selected_runtime_and_reports_model() -> None:
    cloud = ScriptedInferenceRuntime(
        RuntimeLocation.CLOUD, scripted={"img": _bundle_high_conf()}
    )
    on_device = ScriptedInferenceRuntime(RuntimeLocation.ON_DEVICE, scripted={})
    router = build_default_runtime_router(
        flag_router=StaticFeatureFlagRouter(cloud_rollout_percentage=100),
        cloud_inference=cloud,
        on_device_inference=on_device,
    )
    res = router.recognize_image(
        ImageInput("img", 1280, 720), RolloutContext("u1", online=True)
    )
    assert isinstance(res, Ok)
    assert res.value.location is RuntimeLocation.CLOUD
    assert res.value.model.name == RECOGNIZER_MODEL_NAME
    assert res.value.model.model_format is ModelFormat.TRITON
    assert res.value.result.recognized is True
    assert res.value.result.items[0].label == "apple"


def test_offline_recognition_uses_on_device_runtime() -> None:
    on_device = ScriptedInferenceRuntime(
        RuntimeLocation.ON_DEVICE, scripted={"img": _bundle_high_conf()}
    )
    router = build_default_runtime_router(
        flag_router=StaticFeatureFlagRouter(cloud_rollout_percentage=100),
        on_device_inference=on_device,
    )
    res = router.recognize_image(
        ImageInput("img", 640, 480), RolloutContext("u1", online=False)
    )
    assert isinstance(res, Ok)
    assert res.value.location is RuntimeLocation.ON_DEVICE
    assert res.value.result.recognized is True


def test_unknown_image_yields_no_food_recognized() -> None:
    router = build_default_runtime_router()
    res = router.recognize_image(
        ImageInput("never-seen", 640, 480), RolloutContext("u1", online=True)
    )
    assert isinstance(res, Ok)
    # Empty bundle -> pure recognizer returns the "no food recognized" outcome.
    assert res.value.result.recognized is False
    assert res.value.result.image_retained is True


def test_recognize_propagates_pure_validation_error() -> None:
    # An out-of-range confidence must be rejected by the pure recognizer,
    # surfaced unchanged through the runtime layer (not swallowed).
    bad = DetectionBundle(
        detections=(RawDetection(region_id="r1", candidates=(Candidate("x", 150.0),)),)
    )
    router = build_default_runtime_router(
        flag_router=StaticFeatureFlagRouter(cloud_rollout_percentage=100),
        cloud_inference=ScriptedInferenceRuntime(
            RuntimeLocation.CLOUD, scripted={"img": bad}
        ),
    )
    res = router.recognize_image(
        ImageInput("img", 640, 480), RolloutContext("u1", online=True)
    )
    assert isinstance(res, Err)
    assert res.error.code == "INVALID_CONFIDENCE"


def test_restaurant_mode_prefers_menu_detections() -> None:
    bundle = DetectionBundle(
        detections=(RawDetection("r1", (Candidate("generic-dish", 88.0),)),),
        menu_detections=(RawDetection("m1", (Candidate("menu-burger", 95.0),)),),
    )
    router = build_default_runtime_router(
        flag_router=StaticFeatureFlagRouter(cloud_rollout_percentage=100),
        cloud_inference=ScriptedInferenceRuntime(
            RuntimeLocation.CLOUD, scripted={"img": bundle}
        ),
    )
    res = router.recognize_image(
        ImageInput("img", 640, 480),
        RolloutContext("u1", online=True),
        mode=RecognitionMode.RESTAURANT,
    )
    assert isinstance(res, Ok)
    assert res.value.result.items[0].label == "menu-burger"
    assert res.value.result.source.value == "menuOCR"


# ---------------------------------------------------------------------------
# Portion wiring — depth + reference adapters feed the pure estimator
# ---------------------------------------------------------------------------


def test_portion_single_angle_uses_dpt_and_15pct_band() -> None:
    router = build_default_runtime_router(
        cloud_depth=None,
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (200.0, True)}
        ),
        reference_detector=ScriptedReferenceObjectDetector(
            scripted={"img": ReferenceObject.PLATE}
        ),
    )
    res = router.estimate_portion_image(
        [ImageInput("img", 640, 480)],
        RolloutContext("u1", online=True),
        CaptureMode.SINGLE_ANGLE,
        user_id="u1",
    )
    assert isinstance(res, Ok)
    assert res.value.depth_backend is DepthBackend.DPT
    assert res.value.estimate.error_pct == 15.0
    assert res.value.estimate.scaled is True
    assert res.value.model.name == PORTION_MODEL_NAME


def test_portion_multi_angle_uses_photogrammetry_and_8pct_band() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (300.0, True)}
        ),
    )
    res = router.estimate_portion_image(
        [ImageInput("img", 1280, 720, angles_deg=(0.0, 45.0, 90.0))],
        RolloutContext("u1", online=True),
        CaptureMode.MULTI_ANGLE,
        user_id="u1",
    )
    assert isinstance(res, Ok)
    assert res.value.depth_backend is DepthBackend.PHOTOGRAMMETRY
    assert res.value.estimate.error_pct == 8.0
    # No reference object detected -> unscaled but retained (Req 3.4).
    assert res.value.estimate.scaled is False
    assert res.value.estimate.accuracy_reduced is True


def test_portion_missing_reference_object_is_unscaled_not_discarded() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (150.0, True)}
        ),
        reference_detector=ScriptedReferenceObjectDetector(scripted={}),
    )
    res = router.estimate_portion_image(
        [ImageInput("img", 640, 480)],
        RolloutContext("u1", online=True),
        CaptureMode.SINGLE_ANGLE,
        user_id="u1",
    )
    assert isinstance(res, Ok)
    assert res.value.estimate.scaled is False
    assert res.value.estimate.volume_ml == 150.0


def test_portion_low_resolution_rejected_atomically() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (150.0, True)}
        ),
    )
    res = router.estimate_portion_image(
        [ImageInput("img", 320, 240)],
        RolloutContext("u1", online=True),
        CaptureMode.SINGLE_ANGLE,
        user_id="u1",
    )
    assert isinstance(res, Err)
    assert res.error.code == "RESOLUTION_TOO_LOW"
    assert res.error.retained_state is True


def test_portion_no_food_region_rejected_atomically() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (0.0, False)}
        ),
    )
    res = router.estimate_portion_image(
        [ImageInput("img", 640, 480)],
        RolloutContext("u1", online=True),
        CaptureMode.SINGLE_ANGLE,
        user_id="u1",
    )
    assert isinstance(res, Err)
    assert res.error.code == "NO_FOOD_REGION"


# ---------------------------------------------------------------------------
# Endpoint wiring
# ---------------------------------------------------------------------------


def test_endpoint_recognize_reports_runtime_metadata() -> None:
    router = build_default_runtime_router(
        flag_router=StaticFeatureFlagRouter(cloud_rollout_percentage=100),
        cloud_inference=ScriptedInferenceRuntime(
            RuntimeLocation.CLOUD, scripted={"img": _bundle_high_conf()}
        ),
    )
    client = TestClient(create_inference_app(router))
    resp = client.post(
        "/recognize",
        json={
            "image": {"image_id": "img", "width": 640, "height": 480},
            "context": {"user_id": "u1", "online": True},
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["recognized"] is True
    assert body["runtime"]["location"] == "cloud"
    assert body["runtime"]["format"] == "triton"


def test_endpoint_portion_estimate_success() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (250.0, True)}
        ),
        reference_detector=ScriptedReferenceObjectDetector(
            scripted={"img": ReferenceObject.PLATE}
        ),
    )
    client = TestClient(create_inference_app(router))
    resp = client.post(
        "/portion/estimate",
        json={
            "images": [{"image_id": "img", "width": 1280, "height": 720}],
            "context": {"user_id": "u1", "online": True},
            "capture_mode": "single-angle",
            "user_id": "u1",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["scaled"] is True
    assert body["runtime"]["depth_backend"] == "dpt"
    assert body["runtime"]["location"] == "on-device"


def test_endpoint_portion_estimate_rejects_low_resolution() -> None:
    router = build_default_runtime_router(
        on_device_depth=ScriptedDepthEstimator(
            RuntimeLocation.ON_DEVICE, scripted={"img": (100.0, True)}
        ),
    )
    client = TestClient(create_inference_app(router))
    resp = client.post(
        "/portion/estimate",
        json={
            "images": [{"image_id": "img", "width": 320, "height": 240}],
            "context": {"user_id": "u1", "online": True},
            "capture_mode": "single-angle",
            "user_id": "u1",
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "RESOLUTION_TOO_LOW"
    assert resp.json()["retained_state"] is True
