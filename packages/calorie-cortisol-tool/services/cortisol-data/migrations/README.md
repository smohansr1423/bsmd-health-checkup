# Cortisol Data Service — TimescaleDB migrations

The Cortisol Data Service owns the time-series store for the Calorie & Cortisol
Tool. Per the design's **Data Store Mapping**, TimescaleDB holds **cortisol
readings, wearable proxy series, and diurnal samples** as time-partitioned
hypertables.

## Migration files

Forward-only migrations use the `NNNN_description.up.sql` / `.down.sql`
convention and are applied in ascending numeric order:

| # | File | Creates | Requirements |
|---|------|---------|--------------|
| 0001 | `0001_enable_timescaledb` | `timescaledb` extension + shared enums (`cortisol_source`, `time_of_day_bucket`, `reference_sex`, `reference_classification`) | 8.5 |
| 0002 | `0002_cortisol_readings_hypertable` | `cortisol_readings` hypertable (partitioned by `measured_at`, 7-day chunks) | 8.4, 8.5, 12.1 |
| 0003 | `0003_wearable_proxy_series_hypertable` | `wearable_proxy_series` hypertable (partitioned by `captured_at`, 1-day chunks) | 9.3, 9.5, 9.4 |
| 0004 | `0004_diurnal_samples_hypertable` | `diurnal_samples` hypertable (partitioned by `sampled_at`, 7-day chunks) + `diurnal_sample_role` enum | 8.3, 11.1, 11.2 |

Each `up` migration has a matching `down` migration for rollback. Tables are
converted to hypertables with `create_hypertable(..., if_not_exists => TRUE)`, so
migrations are idempotent.

### Column alignment with shared domain types

Columns mirror the shared domain contracts in
`shared/src/domain/cortisol.ts`:

- **`cortisol_readings`** ↔ `CortisolReading` (+ embedded `ReferenceContext`).
  A `CHECK` constraint enforces that `ReferenceContext` is either fully present
  or fully absent and that `ref_lower <= ref_upper`.
- **`wearable_proxy_series`** ↔ imported wearable/patch readings tagged with
  `source_id` / `device_type` and a `captured_at` timestamp (Req 9.3/9.5).
  Invalid readings are retained with `valid = FALSE` and an `invalid_reason`
  (Req 9.4).
- **`diurnal_samples`** ↔ `CARMeasurement` / `CARSample`. Each row is one timed
  sample grouped by `measurement_id`, carrying the measurement's `wake_time`.
  Out-of-window samples are kept with `accepted = FALSE` so accepted samples are
  never lost (Req 11.2).

Every hypertable's primary key includes its time-partitioning column, as
required by TimescaleDB for unique indexes on hypertables.

## Read-replica routing (Req 12.1)

Writes (ingestion, wearable sync, sample linkage) target the **primary**;
read-heavy trend queries are routed to **read replicas**. Routing lives in the
connection layer, not in query logic:

- `src/db/config.ts` — parses TimescaleDB endpoints from the environment.
- `src/db/replica-router.ts` — `ReplicaRouter` selects primary vs. replica by
  `QueryIntent` (`write` / `readWrite` → primary; `trendRead` / `read` →
  round-robin replica, falling back to primary when none are configured).

### Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `TIMESCALE_PRIMARY_HOST` | Primary host (required) | — |
| `TIMESCALE_PRIMARY_PORT` | Primary port | `5432` |
| `TIMESCALE_DB` | Database name (required) | — |
| `TIMESCALE_USER` | Username (required) | — |
| `TIMESCALE_PASSWORD` | Password (required) | — |
| `TIMESCALE_SSL` | Enable TLS | `true` |
| `TIMESCALE_PRIMARY_MAX` | Primary pool ceiling | `10` |
| `TIMESCALE_REPLICA_HOSTS` | Comma-separated replica hosts (empty → reads use primary) | _(unset)_ |
| `TIMESCALE_REPLICA_PORT` | Replica port | primary port |
| `TIMESCALE_REPLICA_USER` | Replica username override | primary user |
| `TIMESCALE_REPLICA_PASSWORD` | Replica password override | primary password |
| `TIMESCALE_REPLICA_MAX` | Replica pool ceiling | primary max |

## Applying migrations

These are plain SQL files with no ORM lock-in. Apply them in numeric order with
any SQL migration runner or `psql`, for example:

```bash
for f in migrations/*.up.sql; do psql "$DATABASE_URL" -f "$f"; done
```

To roll back, apply the `*.down.sql` files in descending numeric order.
