-- Task 2.1 — residencies table.
--
-- Mirrors the shared Residency type (userId, region, euResident). EU-resident
-- users have their data pinned to EU regions; a residency violation blocks
-- further processing (Req 30.6/30.7). Stored here as account-scoped compliance
-- metadata in PostgreSQL.
--
-- Requirements: 25.6

CREATE TABLE residencies (
    user_id     TEXT PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
    region      TEXT NOT NULL,
    eu_resident BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
