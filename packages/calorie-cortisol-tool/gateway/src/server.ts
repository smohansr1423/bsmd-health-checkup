/**
 * Local "dev mode" HTTP server for the API Gateway.
 *
 * ADDITIVE dev wiring only — no existing gateway logic is modified. It runs the
 * real {@link buildGateway} middleware pipeline
 *
 *   TLS termination → JWT auth → rate limiter → capacity shedding
 *     → consent/residency guard → request validation → route
 *
 * with permissive local-dev dependencies:
 *   - PassthroughTlsTerminator + AllowAllConsentResidencyGuard (defaults)
 *   - a dev {@link AuthVerifier} that accepts the static bearer token
 *     `GATEWAY_DEV_TOKEN` (default "dev-token"); set GATEWAY_ALLOW_ANON=1 to
 *     accept any or missing token
 *   - in-memory {@link TokenBucketStore} rate limiter + in-memory
 *     {@link ConcurrencyCapacityController}
 *
 * Each resolved {@link ServiceName} is forwarded to the corresponding
 * downstream service base URL (from env, localhost defaults) using global
 * `fetch`, so the gateway is a real reverse proxy that still enforces
 * auth + rate-limit + capacity before forwarding.
 *
 * Run (after `npm run build`):  PORT=8080 node dist/server.js
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { buildGateway } from './gateway';
import { TokenBucketStore } from './middleware/rate-limiter';
import { ConcurrencyCapacityController } from './middleware/capacity';
import type { ServiceHandlers } from './router/service-router';
import type {
  AuthVerifier,
  AuthVerification,
  GatewayRequest,
  GatewayResponse,
  RequestContext,
  RequestKind,
  ServiceName,
} from './types';

const SERVICE_NAME = 'gateway';
const DEFAULT_PORT = 8080;

const DEV_TOKEN = process.env.GATEWAY_DEV_TOKEN ?? 'dev-token';
const ALLOW_ANON = process.env.GATEWAY_ALLOW_ANON === '1';

/** Downstream service base URLs (env-overridable, localhost defaults). */
const SERVICE_BASE_URLS: Record<ServiceName, string> = {
  'food-vision': process.env.SVC_FOOD_VISION_URL ?? 'http://localhost:8084',
  'nutrition-lookup': process.env.SVC_NUTRITION_URL ?? 'http://localhost:8085',
  'cortisol-data': process.env.SVC_CORTISOL_URL ?? 'http://localhost:8082',
  'insights-ml': process.env.SVC_INSIGHTS_URL ?? 'http://localhost:8086',
  'user-profile': process.env.SVC_USER_PROFILE_URL ?? 'http://localhost:8081',
  notification: process.env.SVC_NOTIFICATION_URL ?? 'http://localhost:8083',
};

// ---------------------------------------------------------------------------
// Dev gateway dependencies
// ---------------------------------------------------------------------------

/** Dev JWT verifier: accepts the static dev token (or any when ALLOW_ANON). */
const devAuthVerifier: AuthVerifier = {
  verify(token: string): AuthVerification {
    if (ALLOW_ANON || token === DEV_TOKEN) {
      return {
        valid: true,
        principal: {
          userId: 'dev-user',
          roles: ['user'],
          region: 'us',
          consentedCategories: ['meals', 'cortisol', 'insights'],
        },
      };
    }
    return { valid: false, reason: 'invalid dev token' };
  },
};

/**
 * Build a {@link ServiceHandler} for each backend that reverse-proxies the
 * request to that service's base URL, preserving method/path/body.
 */
function makeServiceHandler(service: ServiceName) {
  return async (ctx: RequestContext): Promise<GatewayResponse> => {
    const base = SERVICE_BASE_URLS[service];
    const { method, path, body } = ctx.request;
    const target = `${base}${path}`;
    try {
      const init: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (method !== 'GET' && method !== 'HEAD' && body !== undefined) {
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const upstream = await fetch(target, init);
      const text = await upstream.text();
      let parsed: unknown = text;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        /* leave as text */
      }
      return {
        status: upstream.status,
        ok: upstream.ok,
        body: parsed,
        headers: { 'X-Proxied-To': service },
      };
    } catch (err) {
      return {
        status: 502,
        ok: false,
        error: {
          code: 'GATEWAY_UPSTREAM_UNAVAILABLE',
          message: `Downstream ${service} (${target}) is unavailable: ${(err as Error).message}`,
          retryable: true,
          retainedState: true,
        },
      };
    }
  };
}

const serviceHandlers: ServiceHandlers = {
  'food-vision': makeServiceHandler('food-vision'),
  'nutrition-lookup': makeServiceHandler('nutrition-lookup'),
  'cortisol-data': makeServiceHandler('cortisol-data'),
  'insights-ml': makeServiceHandler('insights-ml'),
  'user-profile': makeServiceHandler('user-profile'),
  notification: makeServiceHandler('notification'),
};

const gateway = buildGateway({
  authVerifier: devAuthVerifier,
  rateLimitStore: new TokenBucketStore({ capacity: 1000, refillPerSecond: 100 }),
  capacityController: new ConcurrencyCapacityController({
    maxConcurrent: 256,
    maxQueue: 256,
  }),
  serviceHandlers,
});

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Signature,X-User-Id',
  );
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeHeaders(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.join(',');
  }
  return out;
}

function kindForPath(path: string): RequestKind {
  if (path === '/graphql') return 'graphql';
  if (path.startsWith('/webhooks/')) return 'webhook';
  return 'rest';
}

let requestCounterSeed = 0;

export function createGatewayServer(): ReturnType<typeof createServer> {
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

        // Gateway's own health probe (not routed through the pipeline).
        if (method === 'GET' && path === '/health') {
          applyCors(res);
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME }));
          return;
        }

        const raw = await readRaw(req);
        let body: unknown;
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
        }

        requestCounterSeed += 1;
        const gatewayRequest: GatewayRequest = {
          id: `req-${Date.now()}-${requestCounterSeed}`,
          kind: kindForPath(path),
          method,
          // preserve the query string on the path so downstream GETs (e.g.
          // /trend?range=30) forward intact
          path: url,
          headers: normalizeHeaders(req),
          body,
        };

        const gwRes = await gateway.handle(gatewayRequest);

        applyCors(res);
        if (gwRes.headers) {
          for (const [k, v] of Object.entries(gwRes.headers)) {
            res.setHeader(k, v);
          }
        }
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = gwRes.status;
        res.end(JSON.stringify(gwRes.ok ? gwRes.body : { error: gwRes.error }));
      } catch (err) {
        applyCors(res);
        res.setHeader('Content-Type', 'application/json');
        res.statusCode = 500;
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    })();
  });
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
createGatewayServer().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[gateway] listening on http://localhost:${port} (dev token: "${DEV_TOKEN}"${ALLOW_ANON ? ', anon allowed' : ''})`,
  );
});
