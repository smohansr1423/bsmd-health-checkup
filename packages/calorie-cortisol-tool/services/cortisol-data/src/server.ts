/**
 * Local "dev mode" HTTP server for the Cortisol Data Service.
 *
 * ADDITIVE dev wiring only — no existing domain logic is modified. Uses Node's
 * built-in `http` module (no new runtime dependencies) and drives the service's
 * existing exported pure functions / services through in-memory adapters, so no
 * TimescaleDB / Redis / external partners are required.
 *
 * Endpoints (thin JSON wrappers over existing exported logic):
 *   - GET  /health                 → 200 { status:"ok", service:"cortisol-data" }
 *   - POST /questionnaire          → handleQuestionnaireSubmission
 *   - POST /wearable/sync          → syncWearable
 *   - POST /webhooks/lab-results   → handleLabResultsWebhook (HMAC-verified)
 *   - POST /kits/order             → LabKitService.orderKit (in-memory ports)
 *   - POST /kits/link              → LabKitService.linkSample (in-memory ports)
 *   - POST /car                    → processCarSubmission
 *   - GET  /trend                  → queryTrend (in-memory read ports)
 *
 * Run (after `npm run build`):  PORT=8082 node dist/server.js
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHmac } from 'node:crypto';

import { handleQuestionnaireSubmission } from './questionnaire';
import { syncWearable, type WearableSyncRequest } from './wearable-sync';
import { handleLabResultsWebhook, type LabIngestionDeps } from './lab-ingestion';
import { processCarSubmission, type CarSubmission } from './car';
import { queryTrend, type TrendQueryInput, type TrendDeps } from './trend';
import { LabKitService } from './lab';
import type {
  KitOrder,
  KitOrderStore,
  LabKitDeps,
  PaymentAuthorization,
  PaymentPort,
  LabPartnerPort,
  LabShipmentResult,
  SampleLinkStore,
  SampleRecord,
  IdGenerator,
  Clock,
} from './lab/ports';
import { ReplicaRouter } from './db/replica-router';
import type { TimescaleConfig, DbEndpoint } from './db/config';
import type {
  OverlayMetric,
  OverlayPoint,
  TimeWindow,
  TrendReadPort,
} from './trend/ports';
import type { CortisolReading, LifeEvent } from '@calorie-cortisol/shared';

const SERVICE_NAME = 'cortisol-data';
const DEFAULT_PORT = 8082;
const DEV_WEBHOOK_SECRET = process.env.LAB_WEBHOOK_SECRET ?? 'dev-lab-webhook-secret';

// ---------------------------------------------------------------------------
// In-memory adapters for the LabKitService (dev only)
// ---------------------------------------------------------------------------

class DevClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

class DevIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `dev-${Date.now()}-${this.n}`;
  }
}

class DevPayment implements PaymentPort {
  private seq = 0;
  async authorize(): Promise<PaymentAuthorization> {
    this.seq += 1;
    return { ok: true, authorizationId: `auth-${this.seq}` };
  }
  async capture(): Promise<void> {}
  async voidAuthorization(): Promise<void> {}
}

class DevLabPartner implements LabPartnerPort {
  private seq = 0;
  async initiateShipment(): Promise<LabShipmentResult> {
    this.seq += 1;
    return { ok: true, shipmentId: `ship-${this.seq}` };
  }
}

class DevOrderStore implements KitOrderStore {
  readonly orders = new Map<string, KitOrder>();
  async save(order: KitOrder): Promise<void> {
    this.orders.set(order.id, order);
  }
}

/**
 * In-memory sample registry. Codes are auto-registered as unused the first time
 * they are seen, so a dev caller can link any well-formed code once.
 */
class DevSampleStore implements SampleLinkStore {
  private readonly records = new Map<string, SampleRecord>();
  async findByCode(code: string): Promise<SampleRecord | null> {
    if (!this.records.has(code)) {
      this.records.set(code, { code, linkedUserId: null, linkedAt: null });
    }
    return this.records.get(code) ?? null;
  }
  async link(code: string, userId: string, linkedAt: string): Promise<SampleRecord> {
    const rec: SampleRecord = { code, linkedUserId: userId, linkedAt };
    this.records.set(code, rec);
    return rec;
  }
}

const labDeps: LabKitDeps = {
  payment: new DevPayment(),
  labPartner: new DevLabPartner(),
  orders: new DevOrderStore(),
  samples: new DevSampleStore(),
  ids: new DevIds(),
  clock: new DevClock(),
};
const labKitService = new LabKitService(labDeps);

// ---------------------------------------------------------------------------
// In-memory trend read ports + replica router (dev only)
// ---------------------------------------------------------------------------

const devEndpoint: DbEndpoint = {
  host: 'in-memory',
  port: 0,
  database: 'dev',
  user: 'dev',
  password: '',
  ssl: false,
  maxConnections: 1,
};
const devTimescaleConfig: TimescaleConfig = { primary: devEndpoint, replicas: [] };
const devRouter = new ReplicaRouter(devTimescaleConfig);

/** Empty-by-default in-memory trend read port (returns no rows). */
class DevTrendReads implements TrendReadPort {
  async fetchCortisolReadings(): Promise<readonly CortisolReading[]> {
    return [];
  }
  async fetchLifeEvents(): Promise<readonly LifeEvent[]> {
    return [];
  }
  async fetchOverlaySeries(): Promise<readonly OverlayPoint[]> {
    return [];
  }
}
const trendDeps: TrendDeps = { router: devRouter, reads: new DevTrendReads() };

// Lab ingestion dev deps: verify HMAC against the dev secret and resolve a
// generic demographic context.
const labIngestionDeps: LabIngestionDeps = {
  webhookSecret: DEV_WEBHOOK_SECRET,
  resolveUser: (orderId: string) => ({
    userId: `user-for-${orderId}`,
    age: 35,
    sex: 'M',
  }),
};

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Signature',
  );
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?');
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '');
}

export function createCortisolDataServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void (async () => {
      try {
        applyCors(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const method = req.method ?? 'GET';
        const url = req.url ?? '/';
        const path = url.split('?')[0];

        if (method === 'GET' && path === '/health') {
          sendJson(res, 200, { status: 'ok', service: SERVICE_NAME });
          return;
        }

        if (method === 'POST' && path === '/questionnaire') {
          const body = JSON.parse((await readRaw(req)) || '{}');
          const outcome = handleQuestionnaireSubmission(body);
          sendJson(res, outcome.ok ? 200 : 422, outcome);
          return;
        }

        if (method === 'POST' && path === '/wearable/sync') {
          const body = JSON.parse((await readRaw(req)) || '{}') as WearableSyncRequest;
          sendJson(res, 200, syncWearable(body));
          return;
        }

        if (method === 'POST' && path === '/webhooks/lab-results') {
          const raw = (await readRaw(req)) || '{}';
          // Dev convenience: sign the body with the dev secret when the caller
          // omits a signature so the HMAC gate can be exercised locally.
          const provided =
            (req.headers['x-signature'] as string | undefined) ??
            createHmac('sha256', DEV_WEBHOOK_SECRET).update(raw).digest('hex');
          const outcome = handleLabResultsWebhook(raw, provided, labIngestionDeps);
          sendJson(res, outcome.statusCode, outcome.body);
          return;
        }

        if (method === 'POST' && path === '/kits/order') {
          const body = JSON.parse((await readRaw(req)) || '{}');
          sendJson(res, 200, await labKitService.orderKit(body));
          return;
        }

        if (method === 'POST' && path === '/kits/link') {
          const body = JSON.parse((await readRaw(req)) || '{}');
          sendJson(res, 200, await labKitService.linkSample(body));
          return;
        }

        if (method === 'POST' && path === '/car') {
          const body = JSON.parse((await readRaw(req)) || '{}') as CarSubmission;
          sendJson(res, 200, processCarSubmission(body));
          return;
        }

        if (method === 'GET' && path === '/trend') {
          const q = parseQuery(url);
          const input: TrendQueryInput = {
            userId: q.get('userId') ?? 'dev-user',
            range: q.get('range') ?? 30,
            asOf: q.get('asOf') ?? new Date().toISOString(),
            overlay: q.get('overlay'),
          };
          sendJson(res, 200, await queryTrend(input, trendDeps));
          return;
        }

        sendJson(res, 404, { error: `No route for ${method} ${path}` });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
  });
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
createCortisolDataServer().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[cortisol-data] listening on http://localhost:${port} (in-memory dev mode)`,
  );
});
