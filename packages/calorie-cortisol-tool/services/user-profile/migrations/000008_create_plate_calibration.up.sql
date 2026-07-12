-- Task 2.1 — plate_calibrations table.
--
-- Mirrors the shared PlateCalibration type (userId, referenceScale, updatedAt).
-- One calibration per user (primary key on user_id): persisted on calibration
-- and applied as the reference scale for all subsequent estimations until it is
-- changed or removed (Req 3.6). The Data Store Mapping places calibration in
-- PostgreSQL. reference_scale must be positive.
--
-- Requirements: 3.6

CREATE TABLE plate_calibrations (
    user_id         TEXT PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
    reference_scale DOUBLE PRECISION NOT NULL CHECK (reference_scale > 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
