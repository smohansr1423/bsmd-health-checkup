-- Migration 0004 (up): diurnal_samples hypertable.
--
-- Backs the diurnal 4-sample protocol (Req 8.3) and the CAR window
-- (Req 11.1/11.2). Columns mirror the shared `CARMeasurement` and `CARSample`
-- domain types (cortisol.ts): each row is one timed sample, grouped by
-- `measurement_id`, carrying the measurement's `wake_time`. Out-of-window
-- samples are recorded with accepted = FALSE so previously accepted samples are
-- retained (Req 11.2).
--
-- Time partitioning: hypertable on `sampled_at` (CARSample.at); PK includes the
-- time dimension per TimescaleDB's unique-index requirement.

-- Role of a sample within a diurnal/CAR collection.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diurnal_sample_role') THEN
    CREATE TYPE diurnal_sample_role AS ENUM (
      'car_wake',    -- CARMeasurement.sample1: within 30 min of wake (Req 11.1)
      'car_plus30',  -- CARMeasurement.sample2: 25..35 min after sample1 (Req 11.2)
      'noon',        -- diurnal noon window 11:00–13:00 (Req 8.3)
      'afternoon',   -- diurnal afternoon window 15:00–17:00 (Req 8.3)
      'evening'      -- diurnal evening window 22:00–00:00 (Req 8.3)
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS diurnal_samples (
  id                  UUID                  NOT NULL,
  -- Groups samples belonging to one CAR/diurnal collection (CARMeasurement).
  measurement_id      UUID                  NOT NULL,
  user_id             UUID                  NOT NULL,
  -- CARMeasurement.wakeTime — anchor for CAR window validation (Req 11.1).
  wake_time           TIMESTAMPTZ           NOT NULL,
  -- CARSample.at — collection time of this sample; hypertable time dimension.
  sampled_at          TIMESTAMPTZ           NOT NULL,
  -- CARSample.value (nmol/L).
  value               DOUBLE PRECISION      NOT NULL,
  sample_role         diurnal_sample_role   NOT NULL,
  time_of_day_bucket  time_of_day_bucket    NOT NULL,
  -- FALSE when the sample fell outside its required window (Req 11.2, 8.3);
  -- retained rather than discarded so accepted samples are preserved.
  accepted            BOOLEAN               NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT now(),

  CONSTRAINT pk_diurnal_samples PRIMARY KEY (id, sampled_at),
  CONSTRAINT ck_diurnal_samples_value_positive CHECK (value > 0)
);

-- Convert to a hypertable partitioned by time (7-day chunks).
SELECT create_hypertable(
  'diurnal_samples',
  'sampled_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- Reassemble a measurement's samples (CAR pattern + diurnal curve) in order.
CREATE INDEX IF NOT EXISTS ix_diurnal_samples_measurement
  ON diurnal_samples (measurement_id, sampled_at);

-- Per-user diurnal history for trend/reference overlays (Req 12.1).
CREATE INDEX IF NOT EXISTS ix_diurnal_samples_user_time
  ON diurnal_samples (user_id, sampled_at DESC);
