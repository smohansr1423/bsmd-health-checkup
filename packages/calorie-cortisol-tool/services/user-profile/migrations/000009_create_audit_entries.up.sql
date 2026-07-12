-- Task 2.1 — audit_entries table (audit metadata).
--
-- Mirrors the shared AuditEntry type (actorId, action, recordId, timestamp).
-- Every read/create/modify/delete of health data records an entry, and each
-- entry is retained for at least 6 years (Req 25.6). All four fields are
-- required (NOT NULL) to enforce the audit-entry contract at the schema level;
-- `action` is constrained to the shared AuditAction enum.
--
-- The table is intended to be append-only. `retain_until` defaults to 6 years
-- past the entry time to express the minimum retention intent; enforcing
-- append-only (revoking UPDATE/DELETE) is handled via role grants outside the
-- schema.
--
-- Requirements: 25.6

CREATE TABLE audit_entries (
    id           BIGSERIAL PRIMARY KEY,
    actor_id     TEXT NOT NULL,
    action       TEXT NOT NULL CHECK (action IN ('read', 'create', 'modify', 'delete')),
    record_id    TEXT NOT NULL,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    retain_until TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '6 years')  -- ≥6yr retention
);

CREATE INDEX idx_audit_entries_actor ON audit_entries (actor_id, occurred_at DESC);
CREATE INDEX idx_audit_entries_record ON audit_entries (record_id, occurred_at DESC);
CREATE INDEX idx_audit_entries_retain_until ON audit_entries (retain_until);
