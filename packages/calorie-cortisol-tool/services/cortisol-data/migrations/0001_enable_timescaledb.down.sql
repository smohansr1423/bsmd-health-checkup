-- Migration 0001 (down): Drop shared enum types.
--
-- Note: the timescaledb extension is intentionally NOT dropped here; extensions
-- are managed at the database-provisioning layer and may be shared. Enum types
-- can only be dropped once the dependent hypertables (0002–0004) are removed.

DROP TYPE IF EXISTS reference_classification;
DROP TYPE IF EXISTS reference_sex;
DROP TYPE IF EXISTS time_of_day_bucket;
DROP TYPE IF EXISTS cortisol_source;
