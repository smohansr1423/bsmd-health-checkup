-- Task 2.1 — profiles table (User & Profile Service owns PostgreSQL).
--
-- The profile is the central per-user record. A shell row exists from account
-- creation; onboarding_completed flips to TRUE once the 5-step onboarding flow
-- finishes and a full profile is created from the collected responses
-- (Req 16.6). `user_id` is the external auth subject and the anchor that all
-- other account-scoped tables reference.
--
-- Columns capture the onboarding responses (Req 16.1: health goals, dietary
-- restrictions/preferences, connected devices, cortisol testing intent, daily
-- routine incl. wake time and meal patterns). `date_of_birth` and `sex` back
-- the age/sex/time-of-day reference-range contextualisation used elsewhere
-- (Req 8.5). `sex` mirrors the shared Sex enum ('M','F','other').
--
-- `wake_time` uses the TIME type, which structurally enforces a valid time of
-- day (00:00–23:59) per Req 16.4.
--
-- Requirements: 16.6

CREATE TABLE profiles (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT NOT NULL UNIQUE,
    email                   TEXT,
    display_name            TEXT,
    date_of_birth           DATE,
    sex                     TEXT CHECK (sex IN ('M', 'F', 'other')),

    -- Onboarding responses (Req 16.1, steps 1–5).
    health_goals            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- step 1
    dietary_preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- step 2
    connected_devices       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- step 3
    cortisol_testing_intent TEXT,                                 -- step 4
    wake_time               TIME,                                 -- step 5 (00:00–23:59)
    meal_patterns           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- step 5

    onboarding_completed    BOOLEAN NOT NULL DEFAULT FALSE,       -- Req 16.6
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_user_id ON profiles (user_id);
