/**
 * Route barrel export
 * All service route groups for the API Gateway.
 */

export { createAuthRoutes } from './auth.routes';
export type { AuthRoutesDeps } from './auth.routes';
export { default as registrationRoutes } from './registration.routes';
export { default as checkupPackageRoutes } from './checkup-package.routes';
export { default as schedulingRoutes } from './scheduling.routes';
export { default as testExecutionRoutes } from './test-execution.routes';
export { default as reportsRoutes } from './reports.routes';
export { default as followUpRoutes } from './follow-up.routes';
export { default as billingRoutes } from './billing.routes';
export { default as analyticsRoutes } from './analytics.routes';
export { default as notificationsRoutes } from './notifications.routes';
export { default as deviceReadingsRoutes } from './device-readings.routes';
export { default as healthRoutes } from './health.routes';
export { default as privacyRoutes } from './privacy.routes';

// --- Calorie & Cortisol (CC) integration (additive, Option A1) ---
export { default as calorieCortisolRoutes } from './calorie-cortisol.routes';

// --- API Copilot AI domain routes (one per domain) ---
export { default as apiCopilotAccountAuthRoutes } from './api-copilot-account-auth.routes';
export { default as apiCopilotWorkspaceRoutes } from './api-copilot-workspace.routes';
export { default as apiCopilotPlanQuotaRoutes } from './api-copilot-plan-quota.routes';
export { default as apiCopilotKnowledgeEngineRoutes } from './api-copilot-knowledge-engine.routes';
export { default as apiCopilotQueryEngineRoutes } from './api-copilot-query-engine.routes';
export { default as apiCopilotExecutionEngineRoutes } from './api-copilot-execution-engine.routes';
export { default as apiCopilotAuthAssistantRoutes } from './api-copilot-auth-assistant.routes';
export { default as apiCopilotCodeGeneratorRoutes } from './api-copilot-code-generator.routes';
export { default as apiCopilotTestingConsoleRoutes } from './api-copilot-testing-console.routes';
export { default as apiCopilotConversationRoutes } from './api-copilot-conversation.routes';
export { default as apiCopilotUsageAnalyticsRoutes } from './api-copilot-usage-analytics.routes';
