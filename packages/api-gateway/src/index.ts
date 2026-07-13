/**
 * @health-checkup/api-gateway
 * Express-based API Gateway (BFF pattern) for the Senior Citizen Health Checkup System.
 *
 * Middleware pipeline: cors → json parsing → auth (protected routes) → rate limit → validate → route → error handler
 * Validates: Requirements 18.1, 18.4, 18.5
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { execSync } from 'child_process';
import path from 'path';
import {
  createGatewayAuthMiddleware,
  createTlsEnforcement,
  errorHandler,
  notFoundHandler,
  startRateLimitCleanup,
} from './middleware';
import type { AuthMiddlewareConfig, TlsEnforcementConfig } from './middleware';
import {
  createAuthRoutes,
  registrationRoutes,
  checkupPackageRoutes,
  schedulingRoutes,
  testExecutionRoutes,
  reportsRoutes,
  followUpRoutes,
  billingRoutes,
  analyticsRoutes,
  notificationsRoutes,
  deviceReadingsRoutes,
  healthRoutes,
  privacyRoutes,
  apiCopilotAccountAuthRoutes,
  apiCopilotWorkspaceRoutes,
  apiCopilotPlanQuotaRoutes,
  apiCopilotKnowledgeEngineRoutes,
  apiCopilotQueryEngineRoutes,
  apiCopilotExecutionEngineRoutes,
  apiCopilotAuthAssistantRoutes,
  apiCopilotCodeGeneratorRoutes,
  apiCopilotTestingConsoleRoutes,
  apiCopilotConversationRoutes,
  apiCopilotUsageAnalyticsRoutes,
  calorieCortisolRoutes,
} from './routes';
import { createServiceRegistry } from './service-registry';
import { createGatewayAuth } from './auth/gateway-auth';
import type { AuthService } from '@health-checkup/services';

export interface GatewayConfig {
  /** Auth middleware configuration (token validation + session refresh). */
  auth: AuthMiddlewareConfig;
  /** AuthService backing the /api/auth login/logout/refresh endpoints. */
  authService: AuthService;
  /** Port to listen on (default: 3000) */
  port?: number;
  /** CORS origin (default: *) */
  corsOrigin?: string;
  /** TLS enforcement configuration (defaults: enabled in production) */
  tls?: TlsEnforcementConfig;
}

/**
 * Creates and configures the API Gateway Express application.
 */
export function createGatewayApp(config: GatewayConfig) {
  const app = express();

  // --- Create service registry (composition root) ---
  const services = createServiceRegistry();
  app.locals.services = services;

  // --- Global middleware ---

  // TLS enforcement — refuse unencrypted connections before any data is read
  // or transmitted (Req 18.2, 18.3). Runs first so plaintext requests are
  // rejected up front.
  app.use(createTlsEnforcement(config.tls));

  // CORS headers
  app.use((_req: Request, res: Response, next: NextFunction) => {
    const origin = config.corsOrigin || '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // JSON body parser
  app.use(express.json({ limit: '1mb' }));

  // Request ID for tracing
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).requestId =
      req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    next();
  });

  // Health check (public) — underpins the availability measurement (Req 19.1)
  app.use('/health', healthRoutes);

  // --- Public routes (no auth required) ---
  app.use('/api/auth', createAuthRoutes({ authService: config.authService }));

  // API Copilot AI account sign-up/sign-in establish authentication, so they
  // are public and must be mounted before the gateway auth middleware.
  app.use('/api/copilot/account', apiCopilotAccountAuthRoutes);

  // --- Protected routes (auth required) ---
  const authMiddleware = createGatewayAuthMiddleware(config.auth);
  app.use('/api', authMiddleware);

  // Service routes
  app.use('/api/registration', registrationRoutes);
  app.use('/api/checkup-packages', checkupPackageRoutes);
  app.use('/api/scheduling', schedulingRoutes);
  app.use('/api/test-execution', testExecutionRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/follow-up', followUpRoutes);
  app.use('/api/billing', billingRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/device-readings', deviceReadingsRoutes);

  // Personal-data deletion (auth required) — confirms completion within 30 days (Req 18.7)
  app.use('/api/privacy', privacyRoutes);

  // --- Calorie & Cortisol (CC) integration (additive, Option A1) ---
  // Folds the calorie-cortisol-tool's TypeScript capabilities into this single
  // deployed gateway under /api/cc (protected by the auth middleware above).
  // The CC compiled bundles are loaded lazily at runtime; if they are absent
  // the CC routes fail safe with 503 and never affect any other route.
  app.use('/api/cc', calorieCortisolRoutes);

  // --- API Copilot AI domain routes (protected; auth enforced by /api guard) ---
  // Each domain is mounted under /api/copilot/*, protected by the auth
  // middleware above plus per-route createRoleGuard. Domain errors are mapped
  // to their HTTP status by the shared api-copilot-support mapper.
  app.use('/api/copilot/workspaces', apiCopilotWorkspaceRoutes);
  app.use('/api/copilot/plan-quota', apiCopilotPlanQuotaRoutes);
  app.use('/api/copilot/knowledge-engine', apiCopilotKnowledgeEngineRoutes);
  app.use('/api/copilot/query-engine', apiCopilotQueryEngineRoutes);
  app.use('/api/copilot/execution-engine', apiCopilotExecutionEngineRoutes);
  app.use('/api/copilot/auth-assistant', apiCopilotAuthAssistantRoutes);
  app.use('/api/copilot/code-generator', apiCopilotCodeGeneratorRoutes);
  app.use('/api/copilot/testing-console', apiCopilotTestingConsoleRoutes);
  app.use('/api/copilot/conversations', apiCopilotConversationRoutes);
  app.use('/api/copilot/usage-analytics', apiCopilotUsageAnalyticsRoutes);

  // --- Error handling ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Start rate limit cleanup
  startRateLimitCleanup();

  return app;
}

/**
 * Runs pending Prisma database migrations using `prisma migrate deploy`.
 * Uses the schema located in the services package.
 *
 * Validates: Requirement 9.5
 */
function runMigrations(): void {
  const schemaPath = path.resolve(__dirname, '../../services/prisma/schema.prisma');
  console.log('[API Gateway] Running database migrations...');
  execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
    stdio: 'inherit',
    env: { ...process.env },
  });
  console.log('[API Gateway] Database migrations completed successfully.');
}

/**
 * Performs async startup tasks before the server starts accepting requests:
 * 1. Runs pending database migrations
 * 2. Seeds default Normal Range values
 *
 * Validates: Requirements 5.3, 9.5
 */
async function performStartupTasks(app: express.Application): Promise<void> {
  try {
    // Step 1: Run pending database migrations
    runMigrations();
  } catch (error) {
    console.error('[API Gateway] Migration failed — continuing with startup (graceful degradation):', error);
  }

  try {
    // Step 2: Seed default Normal Range values on initial deployment
    const services = app.locals.services as import('./service-registry').ServiceRegistry;
    await services.normalRangeService.seedDefaults();
    console.log('[API Gateway] Default Normal Range values seeded successfully.');
  } catch (error) {
    console.error('[API Gateway] Normal Range seeding failed — continuing with startup:', error);
  }
}

/**
 * Starts the API Gateway server.
 * Runs database migrations and seeds defaults before accepting requests.
 *
 * Validates: Requirements 5.3, 9.5
 */
export async function startGateway(config: GatewayConfig): Promise<void> {
  const app = createGatewayApp(config);
  const port = config.port || 3000;

  // Run startup tasks (migrations + seeding) before accepting requests
  await performStartupTasks(app);

  app.listen(port, () => {
    console.log(`[API Gateway] Running on port ${port}`);
  });
}

// Re-export types and middleware for external use
export * from './types';
export * from './middleware';
export { createServiceRegistry } from './service-registry';
export type { ServiceRegistry } from './service-registry';
export { wireEventSubscriptions } from './event-wiring';
export type { EventWiringDependencies } from './event-wiring';

// --- Auto-start when run directly ---
if (require.main === module) {
  // Resolve auth from the environment. This FAILS FAST in production when
  // JWT_SECRET is missing/weak, and never accepts arbitrary tokens unless the
  // explicit AUTH_DEV_BYPASS opt-in is set outside production.
  let gatewayAuth: ReturnType<typeof createGatewayAuth>;
  try {
    gatewayAuth = createGatewayAuth(process.env);
  } catch (err) {
    console.error('[API Gateway] Auth configuration error:', (err as Error).message);
    process.exit(1);
    throw err; // unreachable; satisfies control-flow analysis
  }

  startGateway({
    auth: {
      validateToken: gatewayAuth.validateToken,
      refreshSession: gatewayAuth.refreshSession,
    },
    authService: gatewayAuth.authService,
    port: parseInt(process.env.PORT || '3000', 10),
    corsOrigin: process.env.CORS_ORIGIN || '*',
  }).catch((err) => {
    console.error('[API Gateway] Fatal startup error:', err);
    process.exit(1);
  });
}
