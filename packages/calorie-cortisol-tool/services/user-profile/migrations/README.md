# User & Profile Service — PostgreSQL migrations

The User & Profile Service owns the PostgreSQL/RDS store. Per the design's Data
Store Mapping, PostgreSQL holds **profiles, consent, family, billing,
calibration, and audit metadata**. These migrations define that schema.

## Format & tooling

Plain SQL migrations following the [`golang-migrate`](https://github.com/golang-migrate/migrate)
convention — the standard choice for a Go service:

```
{version}_{title}.up.sql    -- forward migration
{version}_{title}.down.sql  -- reverse migration
```

Versions are zero-padded and applied in ascending order. Each `up` has a
matching `down` so the schema is fully reversible.

Apply with the `migrate` CLI:

```sh
migrate -path ./migrations -database "$DATABASE_URL" up
migrate -path ./migrations -database "$DATABASE_URL" down 1
```

## Migrations

| Version | Table(s) | Purpose | Requirements |
|---|---|---|---|
| 000001 | — | Enable `pgcrypto` (`gen_random_uuid()`) | — |
| 000002 | `profiles` | Central per-user record + onboarding responses; `wake_time` as `TIME` enforces 00:00–23:59; `sex`/`date_of_birth` back reference-range contextualisation | 16.6 |
| 000003 | `residencies` | EU/region residency metadata | 30.6/30.7 |
| 000004 | `onboarding_sessions` | In-progress step responses for resume/retry | 16.6/16.7/16.8 |
| 000005 | `consent_states`, `consent_categories` | Master health-data consent + per-category opt-in (one row per category) | 17.1, 30.4 |
| 000006 | `family_accounts`, `family_members` | ≤5 members via `member_slot` (1–5) unique per account; one admin per account; roles `admin`/`member` | 19.1 |
| 000007 | `billing_accounts`, `billing_transactions` | Subscription + transaction records incl. pending/no-charge states | 8.6 |
| 000008 | `plate_calibrations` | One persisted calibration per user | 3.6 |
| 000009 | `audit_entries` | Append-only audit log; required fields NOT NULL; ≥6-year retention intent | 25.6 |

## Schema-level constraints of note

- **Per-category consent** — `consent_categories(user_id, category)` composite
  primary key gives each category exactly one opt-in row.
- **≤5 family members** — `member_slot SMALLINT CHECK (member_slot BETWEEN 1 AND 5)`
  with `UNIQUE (family_account_id, member_slot)` caps membership at 5 using
  constraints alone (no trigger). A partial unique index enforces one admin per
  account.
- **Audit required fields + retention** — all `audit_entries` columns are
  `NOT NULL`; `retain_until` defaults to `now() + 6 years` to express the
  minimum retention intent (Req 25.6).

Column names/types and enum check constraints are aligned with the shared
domain types in `shared/go` (`ConsentState`, `FamilyAccount`, `MemberProfile`,
`PlateCalibration`, `AuditEntry`, `Residency`, and the `Sex`/`FamilyRole`/
`AuditAction` enums).
