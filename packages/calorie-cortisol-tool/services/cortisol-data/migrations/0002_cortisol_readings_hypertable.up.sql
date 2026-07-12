-- Migration 0002 (up): cortisol_readings hypertable.
--
-- Backs lab-result ingestion (Req 8.4), reference-range contextualization
-- (Req 8.5), and the trend query series (Req 12.1). Columns mirror the shared
-- `CortisolReading` and embedded `ReferenceContext` domain types (cortisol.ts).
--
-- Time partitioning: hypertable on `measured_at`. The composite primary key
-- includes the partitioning column because TimescaleDB requires every unique
-- index/PK to contain the time dimension.

CREATE TABLE IF NOT EXISTS cortisol_readings (
  -- CortisolReading.id (client/service-generated UUID).
  id                  UUID                     NOT NULL,
  -- CortisolReading.userId — tenant/owner scope for all trend + reference reads.
  user_id             UUID                     NOT NULL,
  -- CortisolReading.measuredAt (ISO timestamp) — hypertable time dimension.
  measured_at         TIMESTAMPTZ              NOT NULL,
  -- CortisolReading.valueNmolL (normalized nmol/L). Domain range 0.01..100.
  value_nmol_l        DOUBLE PRECISION         NOT NULL,
  -- CortisolReading.source.
  source              cortisol_source          NOT NULL,
  -- CortisolReading.sourceId (patch/device id; Req 9.3/9.5). Optional.
  source_id           TEXT,
  -- CortisolReading.timeOfDayBucket (Req 8.3).
  time_of_day_bucket  time_of_day_bucket       NOT NULL,
  -- CortisolReading.valid — false → excluded from proxy calculations (Req 9.4).
  valid               BOOLEAN                  NOT NULL DEFAULT TRUE,

  -- Embedded ReferenceContext (Req 8.5); all-or-nothing (contextualized?).
  ref_age_band        TEXT,
  ref_sex             reference_sex,
  ref_lower           DOUBLE PRECISION,
  ref_upper           DOUBLE PRECISION,
  ref_classification  reference_classification,

  created_at          TIMESTAMPTZ              NOT NULL DEFAULT now(),

  CONSTRAINT pk_cortisol_readings PRIMARY KEY (id, measured_at),
  -- Domain constraint: normalized reading value must be positive.
  CONSTRAINT ck_cortisol_readings_value_positive CHECK (value_nmol_l > 0),
  -- ReferenceContext is either fully present or fully absent, and the range is
  -- ordered (refLower <= refUpper) to match ReferenceContext semantics.
  CONSTRAINT ck_cortisol_readings_reference_context CHECK (
    (
      ref_age_band IS NULL AND ref_sex IS NULL AND ref_lower IS NULL
      AND ref_upper IS NULL AND ref_classification IS NULL
    )
    OR
    (
      ref_age_band IS NOT NULL AND ref_sex IS NOT NULL AND ref_lower IS NOT NULL
      AND ref_upper IS NOT NULL AND ref_classification IS NOT NULL
      AND ref_lower <= ref_upper
    )
  )
);

-- Convert to a hypertable partitioned by time (7-day chunks) — Req 8.4/12.1.
SELECT create_hypertable(
  'cortisol_readings',
  'measured_at',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists       => TRUE
);

-- Trend queries filter by user + range and order by time (Req 12.1). This index
-- is the primary access path for the read-replica-served trend endpoint.
CREATE INDEX IF NOT EXISTS ix_cortisol_readings_user_time
  ON cortisol_readings (user_id, measured_at DESC);

-- Only valid readings feed proxy/trend math (Req 9.4); partial index keeps the
-- common "valid readings in range" scan tight.
CREATE INDEX IF NOT EXISTS ix_cortisol_readings_user_valid_time
  ON cortisol_readings (user_id, measured_at DESC)
  WHERE valid;
