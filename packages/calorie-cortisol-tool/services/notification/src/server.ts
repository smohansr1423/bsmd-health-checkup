/**
 * Local "dev mode" HTTP server for the Notification Service.
 *
 * ADDITIVE dev wiring only — no existing domain logic is modified. Uses Node's
 * built-in `http` module (no new runtime dependencies) and drives the existing
 * {@link NotificationDispatcher} through the in-memory `Fake*` transports the
 * service already ships, so no SNS/FCM/SES/SQS or other infrastructure is
 * needed.
 *
 * Endpoints:
 *   - GET  /health   → 200 { status: "ok", service: "notification" }
 *   - POST /notify   → dispatch a NotificationEvent, returns the DeliveryOutcome
 *
 * Run (after `npm run build`):  PORT=8083 node dist/server.js
 * or directly:                 npm run dev  (tsx/ts-node not required — uses build)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  NotificationDispatcher,
  type NotificationEvent,
} from './notifications';
import {
  FakeEmailTransport,
  FakeInAppStore,
  FakePushTransport,
} from './transports';

const SERVICE_NAME = 'notification';
const DEFAULT_PORT = 8083;

/** Apply permissive CORS headers for local development. */
function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

/** Read and JSON-parse the request body. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim() === '') {
    return {};
  }
  return JSON.parse(raw);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  applyCors(res);
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

// In-memory transports: an always-succeeding push, plus email + in-app inbox.
const transports = {
  push: new FakePushTransport(0),
  email: new FakeEmailTransport(0),
  inApp: new FakeInAppStore(),
};
const dispatcher = new NotificationDispatcher(transports, {
  // Keep retries instant in dev so a failing event does not stall the request.
  waitMinutes: async () => undefined,
});

export function createNotificationServer(): ReturnType<typeof createServer> {
  return createServer((req, res) => {
    void (async () => {
      try {
        applyCors(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        const url = req.url ?? '/';

        if (req.method === 'GET' && url.startsWith('/health')) {
          sendJson(res, 200, { status: 'ok', service: SERVICE_NAME });
          return;
        }

        if (req.method === 'POST' && url.startsWith('/notify')) {
          const event = (await readJson(req)) as NotificationEvent;
          if (!event || typeof (event as { type?: unknown }).type !== 'string') {
            sendJson(res, 400, {
              error: 'A NotificationEvent with a "type" field is required.',
              example: {
                type: 'deviationAlert',
                userId: 'dev-user',
                cause: 'flattenedCAR',
                detail: 'CAR rise below 50%.',
              },
            });
            return;
          }
          const outcome = await dispatcher.dispatch(event);
          sendJson(res, 200, {
            delivered: !outcome.fallbackPresented,
            fallbackPresented: outcome.fallbackPresented,
            eventType: outcome.eventType,
            userId: outcome.userId,
            inAppInbox: transports.inApp.saved,
            pushSent: transports.push.sent,
          });
          return;
        }

        sendJson(res, 404, { error: `No route for ${req.method} ${url}` });
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
  });
}

const port = Number(process.env.PORT ?? DEFAULT_PORT);
createNotificationServer().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[notification] listening on http://localhost:${port} (in-memory dev mode)`);
});
