-- Task 2.1 — consent state (per-category opt-in + master health-data consent).
--
-- Mirrors the shared ConsentState type (userId, categories map, healthDataConsent,
-- updatedAt). Health data is local-first: nothing egresses without a recorded
-- per-category opt-in (Req 17.1), and the first health-data submission requires
-- an affirmative master consent (Req 30.4).
--
-- Per-category consent is modelled as a child table with a composite primary key
-- (user_id, category) so each category has exactly one opt-in row — the
-- constraint that enforces "per-category consent" at the schema level.
--
-- Requirements: 17.1

CREATE TABLE consent_states (
    user_id             TEXT PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
    health_data_consent BOOLEAN NOT NULL DEFAULT FALSE,   -- Req 30.4 affirmative master consent
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_categories (
    user_id    TEXT NOT NULL REFERENCES consent_states (user_id) ON DELETE CASCADE,
    category   TEXT NOT NULL,
    opted_in   BOOLEAN NOT NULL DEFAULT FALSE,             -- explicit opt-in gate (Req 17.1)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, category)                        -- one opt-in row per category
);
