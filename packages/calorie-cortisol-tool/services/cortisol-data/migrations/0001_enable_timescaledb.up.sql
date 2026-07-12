-- Migration 0001 (up): Enable TimescaleDB and shared enum types.
--
-- The Cortisol Data Service owns the time-series store (design: Data Store
-- Mapping — "TimescaleDB holds cortisol readings, wearable proxy series, diurnal
-- samples"). This migration prepares the database extension and the enum types
-- shared across the three hypertables so that columns stay aligned with the
-- shared domain contracts (CortisolReading, CARMeasurement/CARSample,
-- ReferenceContext).

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- CortisolSource (shared domain: cortisol.ts `CortisolSource`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cortisol_source') THEN
    CREATE TYPE cortisol_source AS ENUM (
      'lab',
      'patch',
      'wearableProxy',
      'questionnaireProxy'
    );
  END IF;
END$$;

-- TimeOfDayBucket (shared domain: cortisol.ts `TimeOfDayBucket`, Req 8.3).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'time_of_day_bucket') THEN
    CREATE TYPE time_of_day_bucket AS ENUM (
      'morning',
      'noon',
      'afternoon',
      'evening'
    );
  END IF;
END$$;

-- Sex (shared domain: cortisol.ts `Sex`, used by ReferenceContext, Req 8.5).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reference_sex') THEN
    CREATE TYPE reference_sex AS ENUM ('M', 'F', 'other');
  END IF;
END$$;

-- Classification (shared domain: cortisol.ts `Classification`, Req 8.5).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reference_classification') THEN
    CREATE TYPE reference_classification AS ENUM ('below', 'normal', 'above');
  END IF;
END$$;
