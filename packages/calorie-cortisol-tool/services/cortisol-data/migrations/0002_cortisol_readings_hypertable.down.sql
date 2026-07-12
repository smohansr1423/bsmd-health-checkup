-- Migration 0002 (down): drop cortisol_readings hypertable.
-- Dropping the table also drops its hypertable chunks and indexes.

DROP TABLE IF EXISTS cortisol_readings;
