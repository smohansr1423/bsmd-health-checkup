-- Migration 0004 (down): drop diurnal_samples hypertable and its role enum.

DROP TABLE IF EXISTS diurnal_samples;
DROP TYPE IF EXISTS diurnal_sample_role;
