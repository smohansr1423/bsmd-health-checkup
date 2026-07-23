/**
 * Calorie & Cortisol (CC) Routes
 *
 * ADDITIVE integration (Option A1): folds the calorie-cortisol-tool's TypeScript
 * capabilities into this single deployed gateway so everything is reachable
 * under one Railway URL. Mounted at `/api/cc` (protected by the gateway auth
 * middleware, like every other `/api/*` route).
 *
 * CROSS-PROJECT IMPORT — the CC packages are a SEPARATE npm project with their
 * own workspaces / lockfile / `@calorie-cortisol/*` path aliases. To avoid
 * pulling CC types into the gateway's TypeScript build, the compiled CC `dist/`
 * bundles are loaded at RUNTIME via `require(...) as any` (NOT via the gateway
 * tsconfig). The require is done lazily and guarded: if the CC bundles are not
 * present (e.g. not built), every `/api/cc/*` functional route responds 503
 * `CC_MODULE_UNAVAILABLE` and the gateway keeps serving `/health` and all other
 * routes unaffected — the require never runs at module top-level in a way that
 * can throw during app boot.
 *
 * The request shapes / function names below mirror the proven CC dev servers
 * (services/cortisol-data/src/server.ts, services/notification/src/server.ts).
 *
 * NOTE: only the CC TypeScript capabilities are included here. The CC Python
 * (food-vision, nutrition-lookup, insights-ml) and Go (user-profile) services
 * are NOT part of this single-Node-container integration.
 */

import { Router, type Response } from 'express';
import path from 'path';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * Public sub-router (mounted BEFORE the gateway auth guard) carrying only the
 * CC liveness check, so `/api/cc/health` can be probed without a token — like
 * the top-level public `/health`. All functional CC routes stay on the
 * protected `router` below.
 */
const publicRouter = Router();

// ─── Lazy runtime loader for the compiled CC dist bundles ────────────────────

/** The three CC bundles this router drives, typed as `any` on purpose. */
interface CcModules {
  cortisolData: any;
  notification: any;
  clientShared: any;
}

let ccCache: CcModules | null = null;
let ccLastError: Error | null = null;

/**
 * Resolve the CC compiled bundles from `process.cwd()` (the image/repo root)
 * lazily on first use. Returns the cached modules on success, or `null` when the
 * require fails — the caller then responds 503 without crashing the gateway.
 */
function loadCcModules(): CcModules | null {
  if (ccCache) {
    return ccCache;
  }
  try {
    const base = path.join(process.cwd(), 'packages', 'calorie-cortisol-tool');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cortisolData = require(path.join(base, 'services', 'cortisol-data', 'dist', 'index.js')) as any;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notification = require(path.join(base, 'services', 'notification', 'dist', 'index.js')) as any;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const clientShared = require(path.join(base, 'clients', 'shared', 'dist', 'index.js')) as any;
    ccCache = { cortisolData, notification, clientShared };
    ccLastError = null;
    return ccCache;
  } catch (error) {
    ccLastError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

/**
 * Respond 503 for a CC route when the compiled bundles could not be loaded.
 * Fail-safe contract: never throws, never affects other routes.
 */
function respondUnavailable(res: Response): void {
  res.status(503).json({
    error: {
      code: 'CC_MODULE_UNAVAILABLE',
      message:
        'The Calorie & Cortisol modules are not available in this deployment ' +
        `(the compiled dist could not be loaded${ccLastError ? `: ${ccLastError.message}` : ''}). ` +
        'Ensure the calorie-cortisol-tool TypeScript packages were built.',
    },
  });
}

// ─── Health (always available — does not require the CC bundles) ─────────────

/**
 * GET /health
 * Liveness of the CC router itself. Reports whether the CC bundles resolve.
 */
publicRouter.get('/health', (_req, res: Response) => {
  const cc = loadCcModules();
  res.status(200).json({ status: 'ok', module: 'calorie-cortisol', ccAvailable: cc !== null });
});

// ─── Cortisol Data Service capabilities ──────────────────────────────────────

/**
 * POST /questionnaire → handleQuestionnaireSubmission (PSS-10 / GAD-7 / PSQI
 * scoring + deterministic tier mapping, Req 10). Returns 200 with the scored
 * tier, or 422 for an incomplete/invalid submission (mirrors the CC dev server).
 */
router.post('/questionnaire', (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    const outcome = cc.cortisolData.handleQuestionnaireSubmission(req.body ?? {});
    res.status(outcome.ok ? 200 : 422).json(outcome);
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

/**
 * POST /wearable/sync → syncWearable (authorization-scoped import + per-reading
 * validation, Req 9). Pure/in-memory; returns the structured sync result.
 */
router.post('/wearable/sync', (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    res.status(200).json(cc.cortisolData.syncWearable(req.body ?? {}));
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

/**
 * POST /car → processCarSubmission (CAR window validation + diurnal deviation
 * classification, Req 11). Returns the CC `Result`; 200 on success, 422 on a
 * request-level validation rejection.
 */
router.post('/car', (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    const result = cc.cortisolData.processCarSubmission(req.body ?? {});
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

/**
 * GET /trend → queryTrend (7/30/90-day cortisol trend read path, Req 12).
 * Driven through the CC in-memory trend read ports + replica router, mirroring
 * the CC dev server (empty-by-default reads). Query params: userId, range,
 * asOf, overlay. Returns the CC `Result`; 200 on success, 422 on validation
 * rejection.
 */
router.get('/trend', async (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    const q = req.query as Record<string, string | undefined>;

    // In-memory read ports + replica router, matching the CC dev server wiring.
    const devEndpoint = {
      host: 'in-memory',
      port: 0,
      database: 'dev',
      user: 'dev',
      password: '',
      ssl: false,
      maxConnections: 1,
    };
    const router$ = new cc.cortisolData.ReplicaRouter({ primary: devEndpoint, replicas: [] });
    const reads = {
      fetchCortisolReadings: async () => [],
      fetchLifeEvents: async () => [],
      fetchOverlaySeries: async () => [],
    };

    const input = {
      userId: q.userId ?? 'dev-user',
      range: q.range ?? 30,
      asOf: q.asOf ?? new Date().toISOString(),
      overlay: q.overlay ?? null,
    };

    const result = await cc.cortisolData.queryTrend(input, { router: router$, reads });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

// ─── Notification Service capability ──────────────────────────────────────────

/**
 * POST /notify → NotificationDispatcher over the in-memory Fake transports
 * (Req 9.7, 15, 17, 27). Mirrors the CC notification dev server: dispatch a
 * NotificationEvent and return the delivery outcome + in-app inbox / push log.
 */
router.post('/notify', async (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    const event = (req.body ?? {}) as { type?: unknown };
    if (typeof event.type !== 'string') {
      res.status(400).json({
        error: {
          code: 'CC_INVALID_EVENT',
          message: 'A NotificationEvent with a "type" field is required.',
        },
        example: {
          type: 'deviationAlert',
          userId: 'dev-user',
          cause: 'flattenedCAR',
          detail: 'CAR rise below 50%.',
        },
      });
      return;
    }

    // Fresh in-memory transports per request (always-succeeding push + email +
    // in-app inbox), matching the CC dev server.
    const transports = {
      push: new cc.notification.FakePushTransport(0),
      email: new cc.notification.FakeEmailTransport(0),
      inApp: new cc.notification.FakeInAppStore(),
    };
    const dispatcher = new cc.notification.NotificationDispatcher(transports, {
      waitMinutes: async () => undefined,
    });

    const outcome = await dispatcher.dispatch(event);
    res.status(200).json({
      delivered: !outcome.fallbackPresented,
      fallbackPresented: outcome.fallbackPresented,
      eventType: outcome.eventType,
      userId: outcome.userId,
      inAppInbox: transports.inApp.saved,
      pushSent: transports.push.sent,
    });
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

// ─── Client-Shared capability: meal correction ───────────────────────────────

/**
 * POST /meal/correct → applyCorrectionToMeal (pure meal correction + totals
 * recomputation, Req 5). Body: `{ meal, op }`. setPortion / delete recompute
 * fully in-memory; swap / add-by-text / add-by-barcode consult a food-item
 * resolver — here it is a no-match stub (no Nutrition Lookup backend exists in
 * this single-Node container), so those ops cleanly leave the meal unchanged
 * (Req 5.6). Returns the CC `Result`; 200 on success, 422 on rejection.
 */
router.post('/meal/correct', async (req: AuthenticatedRequest, res: Response) => {
  const cc = loadCcModules();
  if (!cc) {
    respondUnavailable(res);
    return;
  }
  try {
    const { meal, op } = (req.body ?? {}) as { meal?: unknown; op?: unknown };
    if (!meal || !op) {
      res.status(400).json({
        error: {
          code: 'CC_INVALID_REQUEST',
          message: 'A body with both "meal" and "op" is required.',
        },
      });
      return;
    }

    // No-match resolver: no Nutrition Lookup backend is wired into this
    // container, so text/barcode swaps and adds resolve to a clean no-match,
    // leaving the meal unchanged (Req 5.6). setPortion/delete never call it.
    const resolver = {
      resolveByText: async () => ({ ok: true, value: null }),
      resolveByBarcode: async () => ({ ok: true, value: null }),
    };

    const result = await cc.clientShared.applyCorrectionToMeal(meal, op, resolver);
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error: unknown) {
    res.status(500).json({
      error: { code: 'CC_INTERNAL_ERROR', message: (error as Error).message },
    });
  }
});

export { publicRouter as calorieCortisolPublicRoutes };
export default router;
