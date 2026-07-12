-- Task 2.1 — onboarding_sessions table.
--
-- Persists in-progress onboarding responses so a user who exits before
-- completing all 5 steps resumes at the first incomplete step, without
-- re-entering data (Req 16.7), and so profile creation can be retried on
-- failure without data loss (Req 16.6/16.8). `current_step` is constrained to
-- the 5-step flow; `responses` holds the accumulated per-step answers.
--
-- Requirements: 16.6

CREATE TABLE onboarding_sessions (
    user_id      TEXT PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
    current_step SMALLINT NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
    responses    JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
