-- Task 2.1 — family accounts and member profiles.
--
-- Mirrors the shared FamilyAccount / MemberProfile types. A family account has
-- one admin and up to 5 isolated member profiles (Req 19.1). Roles are
-- 'admin' | 'member' matching the shared FamilyRole enum (Req 19.4–19.6).
--
-- The ≤5 capacity is enforced purely with constraints (no trigger): each member
-- occupies a member_slot in 1..5 that is unique per family account, so a 6th
-- insert has no valid slot. A partial unique index guarantees exactly one admin
-- member row per account.
--
-- Requirements: 19.1

CREATE TABLE family_accounts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id TEXT NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_family_accounts_admin ON family_accounts (admin_user_id);

CREATE TABLE family_members (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_account_id UUID NOT NULL REFERENCES family_accounts (id) ON DELETE CASCADE,
    member_user_id    TEXT NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
    role              TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    member_slot       SMALLINT NOT NULL CHECK (member_slot BETWEEN 1 AND 5),  -- Req 19.1 ≤5
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (family_account_id, member_slot),        -- ≤5 members per account
    UNIQUE (family_account_id, member_user_id)      -- a profile joins an account once
);

-- Exactly one admin member row per family account.
CREATE UNIQUE INDEX idx_family_members_one_admin
    ON family_members (family_account_id)
    WHERE role = 'admin';
