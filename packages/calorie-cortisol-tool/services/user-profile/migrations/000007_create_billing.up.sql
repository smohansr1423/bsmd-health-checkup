-- Task 2.1 — billing (accounts + transactions).
--
-- The Data Store Mapping places billing in PostgreSQL. Payment providers match
-- the design's integrations (Stripe / Apple Pay / Google Pay). Transaction
-- statuses include 'pending'/'authorized'/'voided' so a lab-kit order can be
-- held pending with no charge applied when the lab is unavailable (Req 8.6).
--
-- Requirements: 25.6

CREATE TABLE billing_accounts (
    user_id              TEXT PRIMARY KEY REFERENCES profiles (user_id) ON DELETE CASCADE,
    payment_provider     TEXT CHECK (payment_provider IN ('stripe', 'apple_pay', 'google_pay')),
    external_customer_id  TEXT,
    subscription_status  TEXT NOT NULL DEFAULT 'none'
        CHECK (subscription_status IN ('none', 'trialing', 'active', 'past_due', 'canceled')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_transactions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL REFERENCES profiles (user_id) ON DELETE CASCADE,
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
    currency     CHAR(3) NOT NULL DEFAULT 'USD',
    status       TEXT NOT NULL
        CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded', 'voided')),
    description  TEXT,
    external_ref TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_transactions_user ON billing_transactions (user_id, created_at DESC);
