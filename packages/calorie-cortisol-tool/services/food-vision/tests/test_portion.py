"""Unit tests for portion estimation and plate calibration (Task 6.4).

Covers reference-object scaling, unscaled-but-retained estimates, atomic
rejection of unprocessable images, and plate-calibration persistence / override
with failure fallback, plus the ``POST /portion`` and calibration endpoints.

Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
"""

from fastapi.testclient import TestClient

from app.accuracy_eval import CaptureMode
from app.portion import (
    MULTI_ANGLE_ERROR_PCT,
    REFERENCE_SCALE_FACTORS,
    SINGLE_ANGLE_ERROR_PCT,
    InMemoryCalibrationStore,
    PortionRequest,
    ReferenceObject,
    calibrate_plate,
    estimate_portion,
    remove_calibration,
)
from app.portion_router import create_portion_app
from app.result import Err, Ok

_TS = "2024-01-01T00:00:00+00:00"


def _req(**kw) -> PortionRequest:
    base = dict(
        user_id="u1",
        capture_mode=CaptureMode.SINGLE_ANGLE,
        width=640,
        height=480,
        has_food_region=True,
        raw_volume_ml=200.0,
        reference_object=None,
    )
    base.update(kw)
    return PortionRequest(**base)


# --- Error band by capture mode (Req 3.1 / 3.2) ---------------------------


def test_single_angle_error_band_is_15pct() -> None:
    res = estimate_portion(_req(capture_mode=CaptureMode.SINGLE_ANGLE), InMemoryCalibrationStore())
    assert isinstance(res, Ok)
    assert res.value.error_pct == SINGLE_ANGLE_ERROR_PCT == 15.0


def test_multi_angle_error_band_is_8pct() -> None:
    res = estimate_portion(_req(capture_mode=CaptureMode.MULTI_ANGLE), InMemoryCalibrationStore())
    assert isinstance(res, Ok)
    assert res.value.error_pct == MULTI_ANGLE_ERROR_PCT == 8.0


# --- Reference-object scaling (Req 3.3 / 3.4) -----------------------------


def test_reference_object_present_flags_scaled() -> None:
    res = estimate_portion(
        _req(reference_object=ReferenceObject.PLATE, raw_volume_ml=100.0),
        InMemoryCalibrationStore(),
    )
    assert isinstance(res, Ok)
    est = res.value
    assert est.scaled is True
    assert est.accuracy_reduced is False
    assert est.reference_object is ReferenceObject.PLATE
    assert est.volume_ml == 100.0 * REFERENCE_SCALE_FACTORS[ReferenceObject.PLATE]


def test_no_reference_object_is_unscaled_but_retained() -> None:
    res = estimate_portion(_req(reference_object=None, raw_volume_ml=150.0), InMemoryCalibrationStore())
    assert isinstance(res, Ok)  # estimate NOT discarded (Req 3.4)
    est = res.value
    assert est.scaled is False
    assert est.accuracy_reduced is True
    assert est.volume_ml == 150.0
    assert "reduced" in est.message.lower()


# --- Atomic rejection of unprocessable images (Req 3.5) -------------------


def test_no_food_region_rejected_atomically() -> None:
    res = estimate_portion(_req(has_food_region=False), InMemoryCalibrationStore())
    assert isinstance(res, Err)
    assert res.error.code == "NO_FOOD_REGION"
    assert res.error.retained_state is True  # no partial estimate produced


def test_resolution_below_minimum_rejected() -> None:
    for w, h in [(639, 480), (640, 479), (320, 240)]:
        res = estimate_portion(_req(width=w, height=h), InMemoryCalibrationStore())
        assert isinstance(res, Err), (w, h)
        assert res.error.code == "RESOLUTION_TOO_LOW"


def test_exact_minimum_resolution_is_processable() -> None:
    res = estimate_portion(_req(width=640, height=480), InMemoryCalibrationStore())
    assert isinstance(res, Ok)


def test_negative_volume_signal_rejected() -> None:
    res = estimate_portion(_req(raw_volume_ml=-1.0), InMemoryCalibrationStore())
    assert isinstance(res, Err)
    assert res.error.code == "INVALID_VOLUME_SIGNAL"


def test_volume_is_never_negative() -> None:
    res = estimate_portion(_req(raw_volume_ml=0.0, reference_object=ReferenceObject.HAND), InMemoryCalibrationStore())
    assert isinstance(res, Ok)
    assert res.value.volume_ml >= 0.0


# --- Plate calibration persistence, override, application (Req 3.6) -------


def test_calibration_persisted_and_applied_to_subsequent_estimations() -> None:
    store = InMemoryCalibrationStore()
    saved = calibrate_plate("u1", 2.0, store, _TS)
    assert isinstance(saved, Ok)

    res = estimate_portion(_req(user_id="u1", raw_volume_ml=100.0, reference_object=None), store)
    assert isinstance(res, Ok)
    est = res.value
    assert est.calibration_applied is True
    assert est.scaled is True
    assert est.volume_ml == 100.0 * 2.0  # stored scale applied


def test_calibration_overrides_detected_reference_object() -> None:
    store = InMemoryCalibrationStore()
    calibrate_plate("u1", 3.0, store, _TS)
    res = estimate_portion(
        _req(user_id="u1", raw_volume_ml=100.0, reference_object=ReferenceObject.UTENSIL), store
    )
    assert isinstance(res, Ok)
    # Calibration (3.0) overrides the utensil factor (Req 3.6).
    assert res.value.calibration_applied is True
    assert res.value.volume_ml == 300.0


def test_recalibration_overrides_prior_value() -> None:
    store = InMemoryCalibrationStore()
    calibrate_plate("u1", 2.0, store, _TS)
    calibrate_plate("u1", 5.0, store, _TS)
    res = estimate_portion(_req(user_id="u1", raw_volume_ml=10.0), store)
    assert isinstance(res, Ok) and res.value.volume_ml == 50.0


def test_removed_calibration_no_longer_applied() -> None:
    store = InMemoryCalibrationStore()
    calibrate_plate("u1", 2.0, store, _TS)
    remove_calibration("u1", store)
    res = estimate_portion(_req(user_id="u1", raw_volume_ml=100.0, reference_object=None), store)
    assert isinstance(res, Ok)
    assert res.value.calibration_applied is False
    assert res.value.scaled is False


def test_invalid_calibration_scale_rejected() -> None:
    store = InMemoryCalibrationStore()
    for bad in (0.0, -1.0):
        res = calibrate_plate("u1", bad, store, _TS)
        assert isinstance(res, Err)
        assert res.error.code == "INVALID_CALIBRATION_SCALE"


# --- Calibration persistence failure fallback (Req 3.7) -------------------


def test_calibration_failure_keeps_prior_calibration() -> None:
    store = InMemoryCalibrationStore()
    calibrate_plate("u1", 2.0, store, _TS)  # prior good calibration

    store.fail_saves = True
    failed = calibrate_plate("u1", 9.0, store, _TS)
    assert isinstance(failed, Err)
    assert failed.error.code == "CALIBRATION_NOT_SAVED"
    assert failed.error.retained_state is True

    # Previously stored calibration (2.0) still in effect (Req 3.7).
    res = estimate_portion(_req(user_id="u1", raw_volume_ml=100.0), store)
    assert isinstance(res, Ok) and res.value.volume_ml == 200.0


def test_calibration_failure_with_no_prior_leaves_none() -> None:
    store = InMemoryCalibrationStore()
    store.fail_saves = True
    failed = calibrate_plate("u1", 4.0, store, _TS)
    assert isinstance(failed, Err)
    # No calibration in effect → estimate is unscaled but retained.
    res = estimate_portion(_req(user_id="u1", raw_volume_ml=100.0, reference_object=None), store)
    assert isinstance(res, Ok)
    assert res.value.calibration_applied is False


# --- Endpoint tests --------------------------------------------------------


def test_endpoint_portion_success() -> None:
    client = TestClient(create_portion_app())
    resp = client.post(
        "/portion",
        json={
            "user_id": "u1",
            "capture_mode": "multi-angle",
            "width": 1280,
            "height": 720,
            "has_food_region": True,
            "raw_volume_ml": 250.0,
            "reference_object": "plate",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["scaled"] is True
    assert body["error_pct"] == 8.0
    assert body["reference_object"] == "plate"


def test_endpoint_portion_rejects_low_resolution() -> None:
    client = TestClient(create_portion_app())
    resp = client.post(
        "/portion",
        json={
            "user_id": "u1",
            "capture_mode": "single-angle",
            "width": 320,
            "height": 240,
            "has_food_region": True,
            "raw_volume_ml": 100.0,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "RESOLUTION_TOO_LOW"
    assert resp.json()["retained_state"] is True


def test_endpoint_calibration_persist_then_apply() -> None:
    client = TestClient(create_portion_app())
    put = client.put("/portion/calibration", json={"user_id": "u1", "reference_scale": 2.0})
    assert put.status_code == 200

    post = client.post(
        "/portion",
        json={
            "user_id": "u1",
            "capture_mode": "single-angle",
            "width": 640,
            "height": 480,
            "has_food_region": True,
            "raw_volume_ml": 100.0,
        },
    )
    assert post.status_code == 200
    assert post.json()["calibration_applied"] is True
    assert post.json()["volume_ml"] == 200.0


def test_endpoint_calibration_failure_returns_atomic_error() -> None:
    store = InMemoryCalibrationStore()
    store.fail_saves = True
    client = TestClient(create_portion_app(store))
    put = client.put("/portion/calibration", json={"user_id": "u1", "reference_scale": 2.0})
    assert put.status_code == 500
    assert put.json()["code"] == "CALIBRATION_NOT_SAVED"
    assert put.json()["retained_state"] is True
