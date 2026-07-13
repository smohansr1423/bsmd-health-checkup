# Running the Calorie & Cortisol Tool locally ("dev mode")

This is a **local, in-memory dev mode**: it boots the whole backend (6
microservices + API gateway) plus a small demo PWA with **one command**, using
only locally installed toolchains. **No external databases or queues are
required** — every service uses in-memory adapters / the pure domain functions
the packages already ship.

> Nothing here changes existing domain logic or tests. It only adds
> entrypoints, servers, scripts, and a minimal demo UI.

---

## 1. Prerequisites

| Toolchain     | Used for                         | Notes                                                            |
| ------------- | -------------------------------- | ---------------------------------------------------------------- |
| Node.js ≥ 18  | gateway, cortisol-data, notification, PWA | Node 24 verified. Needs global `fetch` (Node ≥ 18).      |
| Portable Go   | user-profile                     | Default path `C:\Users\P2775899\AppData\Local\goportable\go\bin\go.exe`. Override with `GO_BIN`. |
| Python 3.11+  | food-vision, nutrition-lookup, insights-ml | Python 3.12 verified.                                   |

### One-time setup

From `packages/calorie-cortisol-tool`:

```powershell
# Node deps (installs React/Vite for the demo PWA + workspace links)
npm install

# Python env for the FastAPI services (Poetry is NOT required — see note below)
python -m venv .venv
.\.venv\Scripts\python -m pip install fastapi uvicorn pydantic
```

> **Poetry note.** The Python `pyproject.toml` files now declare `fastapi` +
> `uvicorn`, so `poetry install && poetry run uvicorn app.main:app` works if you
> have Poetry. Poetry was **not** installed on this machine, so the default dev
> runner uses a local `.venv` instead. Set `USE_POETRY=1` to switch back to
> `poetry run uvicorn`.

---

## 2. One-command start

From `packages/calorie-cortisol-tool`:

```powershell
npm run dev
```

This runs `scripts/dev.mjs`, which:

1. Builds the TypeScript packages once (`tsc --build`).
2. Launches all 8 processes with labelled, colourised output.
3. Shuts every child down cleanly on **Ctrl+C**.

Then open the demo UI at **http://localhost:5173**.

### Configuration (env vars, all optional)

| Var            | Default                                                             | Purpose                              |
| -------------- | ------------------------------------------------------------------- | ------------------------------------ |
| `GO_BIN`       | `C:\Users\P2775899\AppData\Local\goportable\go\bin\go.exe`          | Portable Go binary                   |
| `PYTHON_BIN`   | `./.venv/Scripts/python.exe` (falls back to `python`)               | Interpreter for uvicorn              |
| `USE_POETRY`   | _unset_                                                             | `1` → run Python via `poetry run`    |
| `GATEWAY_DEV_TOKEN` | `dev-token`                                                    | Bearer token the gateway accepts     |
| `GATEWAY_ALLOW_ANON`| _unset_                                                        | `1` → accept any/missing token       |
| `SVC_*_URL`    | localhost ports below                                               | Downstream base URLs for the gateway |

---

## 3. Ports

| Service          | Port | Stack   | Health                          |
| ---------------- | ---- | ------- | ------------------------------- |
| API gateway      | 8080 | Node    | `GET http://localhost:8080/health` |
| user-profile     | 8081 | Go      | `GET http://localhost:8081/health` |
| cortisol-data    | 8082 | Node    | `GET http://localhost:8082/health` |
| notification     | 8083 | Node    | `GET http://localhost:8083/health` |
| food-vision      | 8084 | Python  | `GET http://localhost:8084/health` |
| nutrition-lookup | 8085 | Python  | `GET http://localhost:8085/health` |
| insights-ml      | 8086 | Python  | `GET http://localhost:8086/health` |
| PWA demo (Vite)  | 5173 | Node    | `http://localhost:5173`            |

Every server reads its port from `PORT` (with the default above) and exposes
`GET /health` → `200 {"status":"ok","service":"<name>"}` with permissive CORS.

---

## 4. Per-service manual commands

Run any single service on its own (each honours `PORT`):

```powershell
# Gateway (build first if needed: npm run build)
cd gateway;                node dist/server.js            # or: npm run dev

# Go user-profile
cd services/user-profile;  $env:PORT=8081; & "$env:GO_BIN" run .

# Node cortisol-data / notification
cd services/cortisol-data; node dist/server.js            # or: npm run dev
cd services/notification;  node dist/server.js            # or: npm run dev

# Python services (via the local venv)
cd services/food-vision;      ..\..\.venv\Scripts\python -m uvicorn app.main:app --port 8084
cd services/nutrition-lookup; ..\..\.venv\Scripts\python -m uvicorn app.main:app --port 8085
cd services/insights-ml;      ..\..\.venv\Scripts\python -m uvicorn app.main:app --port 8086

# PWA demo
cd clients/pwa;            npm run dev
```

With Poetry (if installed) the Python services also run via:

```bash
cd services/food-vision && poetry install && poetry run uvicorn app.main:app --port 8084
```

---

## 5. Example requests

The gateway runs the real middleware pipeline
(**TLS → auth → rate-limit → capacity → consent/residency → validation →
route**) and then reverse-proxies to the downstream service. REST calls need the
dev bearer token; inbound webhooks (`/webhooks/*`) bypass auth by design.

### Health

```powershell
curl.exe http://localhost:8080/health
```

### Through the gateway (note the `Authorization` header)

```powershell
# Stress questionnaire → cortisol-data (returns the burden tier)
curl.exe -X POST http://localhost:8080/questionnaire `
  -H "Content-Type: application/json" -H "Authorization: Bearer dev-token" `
  --data-binary '{ "type": "PSS-10", "answers": [2,3,1,2,2,3,1,2,2,3] }'

# Nutrition calculation → nutrition-lookup
curl.exe -X POST http://localhost:8080/nutrition `
  -H "Content-Type: application/json" -H "Authorization: Bearer dev-token" `
  --data-binary '{ "items": [ { "food_class": "rice_cooked", "volume_ml": 200 }, { "food_class": "chicken_breast", "volume_ml": 150 } ] }'

# Cortisol trend → cortisol-data (query string is preserved through the proxy)
curl.exe "http://localhost:8080/trend?range=30&userId=dev-user" -H "Authorization: Bearer dev-token"

# Cortisol guidance → insights-ml
curl.exe -X POST http://localhost:8080/guidance `
  -H "Content-Type: application/json" -H "Authorization: Bearer dev-token" `
  --data-binary '{ "user_id": "dev-user", "readings": [ { "id": "r1", "user_id": "dev-user", "measured_at": "2024-01-01T07:00:00Z", "value_nmol_l": 18, "classification": "above", "ref_lower": 5, "ref_upper": 15 } ], "referral_threshold_nmol_l": 15 }'
```

Without the token the gateway returns **401** (`GATEWAY_UNAUTHENTICATED`). To
disable auth entirely for a quick spike, start the gateway with
`GATEWAY_ALLOW_ANON=1`.

### Directly against a service (bypassing the gateway)

```powershell
# Notification dispatch (in-memory Fake* transports)
curl.exe -X POST http://localhost:8083/notify `
  -H "Content-Type: application/json" `
  --data-binary '{ "type": "deviationAlert", "userId": "u1", "cause": "flattenedCAR", "detail": "rise below 50%" }'

# Onboarding step (Go user-profile, in-memory store)
curl.exe -X POST http://localhost:8081/onboarding/step `
  -H "Content-Type: application/json" `
  --data-binary '{ "userId": "u1", "step": 1, "fields": { "health_goals": ["stress_management"] } }'
```

---

## 6. Optional real infrastructure (NOT needed for `npm run dev`)

For teams that later want real persistence, `docker-compose.yml` brings up
PostgreSQL, TimescaleDB, Redis, and Elasticsearch:

```powershell
docker compose up -d      # optional
docker compose down -v
```

The default `npm run dev` path is fully in-memory and does **not** read or
require any of these.

---

## 7. What each entrypoint wires

| Service          | Entrypoint (added)                      | Real logic it drives                                                        |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| user-profile     | `services/user-profile/dev_server.go`   | Onboarding, account export/delete, consent, family, biometric handlers (in-memory stores) |
| cortisol-data    | `services/cortisol-data/src/server.ts`  | `handleQuestionnaireSubmission`, `syncWearable`, `handleLabResultsWebhook`, `LabKitService`, `processCarSubmission`, `queryTrend` |
| notification     | `services/notification/src/server.ts`   | `NotificationDispatcher` over `Fake*` transports                            |
| food-vision      | `services/food-vision/app/main.py`      | `build_inference_router` + `build_portion_router`                           |
| nutrition-lookup | `services/nutrition-lookup/app/main.py` | `calculate_nutrition`, `search_foods`, `lookup_barcode`                     |
| insights-ml      | `services/insights-ml/app/main.py`      | `correlate`, `generate_guidance`, `handle_digest`                           |
| gateway          | `gateway/src/server.ts`                 | `buildGateway(...)` pipeline + per-service reverse proxy                     |
| PWA demo         | `clients/pwa/app/*` + `vite.config.ts`  | 4 panels calling real endpoints through the gateway                         |
