-- Migration 0003 (up): wearable_proxy_series hypertable.
--
-- Backs wearable/patch proxy import (Req 9.3, 9.5): every imported reading is
-- tagged with a source identifier (patch id / device type) and a capture
-- timestamp, and invalid readings are recorded (not discarded) while valid ones
-- are retained (Req 9.4). This is a high-cardinality time series feeding the
-- cortisol-proxy calculation and the trend overlays (Req 12.1/12.5).
--
-- Time partitioning: hypertable on `captured_at`; PK includes the time
-- dimension per TimescaleDB's unique-index requirement.

CREATE TABLE IF NOT EXISTS wearable_proxy_series (
  id                  UUID              NOT NULL,
  user_id             UUID              NOT NULL,
  -- Capture timestamp of the source reading (Req 9.3/9.5) — time dimension.
  captured_at         TIMESTAMPTZ       NOT NULL,
  -- Source tagging (Req 9.5): device_type for WHOOP/Oura/Garmin proxies,
  -- source_id for the patch/device identifier (Req 9.3).
  device_type         TEXT,
  source_id           TEXT              NOT NULL,
  -- Proxy metric name (e.g. 'hrv', 'restingHr', 'sleep', 'patchCortisol') and
  -- its raw value/unit as reported by the source platform.
  metric_type         TEXT              NOT NULL,
  value               DOUBLE PRECISION  NOT NULL,
  unit                TEXT              NOT NULL,
  -- valid = false → excluded from cortisol-proxy calculations but retained as an
  -- invalid reading (Req 9.4).
  valid               BOOLEAN           NOT NULL DEFAULT TRUE,
  -- Reason captured for invalid readings (e.g. out-of-range, missing timestamp).
  invalid_reason      TEXT,
  created_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT pk_wearable_proxy_series PRIMARY KEY (id, captured_at),
  -- A reading is invalid iff a reason is recorded, keeping Req 9.4 bookkeeping
  -- internally consistent.
  CONSTRAINT ck_wearable_proxy_valid_reason CHECK (
    (valid = TRUE AND invalid_reason IS NULL)
    OR (valid = FALSE AND invalid_reason IS NOT NULL)
  )
);

-- Convert to a hypertable partitioned by time (1-day chunks: proxy data is
-- higher-frequency than lab readings, synced at <=15 min intervals, Req 9.6).
SELECT create_hypertable(
  'wearable_proxy_series',
  'captured_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists       => TRUE
);

-- Trend overlay + proxy aggregation access path (user + metric over a range).
CREATE INDEX IF NOT EXISTS ix_wearable_proxy_user_metric_time
  ON wearable_proxy_series (user_id, metric_type, captured_at DESC);

-- Only valid readings participate in proxy math (Req 9.4).
CREATE INDEX IF NOT EXISTS ix_wearable_proxy_user_valid_time
  ON wearable_proxy_series (user_id, captured_at DESC)
  WHERE valid;
