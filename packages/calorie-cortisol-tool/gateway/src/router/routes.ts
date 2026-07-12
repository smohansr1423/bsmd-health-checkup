/**
 * Route table: maps client-facing operations to the six backend services
 * (Task 16.1, design "API Gateway" / "Microservices").
 *
 * Two entry surfaces are described:
 *   - GraphQL — one operation per top-level Query/Mutation field.
 *   - REST    — authenticated client calls plus inbound third-party webhooks.
 *
 * The table is pure data so the {@link ServiceRouter} (and its tests) can
 * resolve a request to a {@link ServiceName} without any network access.
 *
 * Requirements: 18.1, 23.3, 25.2
 */

import type { RequestKind, ServiceName } from '../types';

/** A GraphQL field → service mapping. */
export interface GraphQLRoute {
  readonly operationType: 'query' | 'mutation';
  readonly fieldName: string;
  readonly service: ServiceName;
}

/** A REST/webhook path → service mapping (supports `:param` segments). */
export interface RestRoute {
  readonly method: string;
  /** Path pattern, e.g. `/barcode/:code`, `/webhooks/lab-results`. */
  readonly pattern: string;
  readonly service: ServiceName;
  readonly kind: RequestKind;
}

/**
 * GraphQL operation routing. `Meal`/`NutritionResult` reads and meal-item
 * mutations resolve to Nutrition Lookup (it owns meal aggregation + portion
 * recomputation); cortisol reads to Cortisol Data; insights to Insights & ML;
 * profile/consent to User & Profile.
 */
export const GRAPHQL_ROUTES: readonly GraphQLRoute[] = [
  { operationType: 'query', fieldName: 'meal', service: 'nutrition-lookup' },
  { operationType: 'query', fieldName: 'meals', service: 'nutrition-lookup' },
  { operationType: 'query', fieldName: 'cortisolTrend', service: 'cortisol-data' },
  { operationType: 'query', fieldName: 'diurnalProfile', service: 'cortisol-data' },
  { operationType: 'query', fieldName: 'insights', service: 'insights-ml' },
  { operationType: 'query', fieldName: 'profile', service: 'user-profile' },
  { operationType: 'query', fieldName: 'consentState', service: 'user-profile' },
  { operationType: 'mutation', fieldName: 'correctMealPortion', service: 'nutrition-lookup' },
  { operationType: 'mutation', fieldName: 'addMealItemByText', service: 'nutrition-lookup' },
  { operationType: 'mutation', fieldName: 'addMealItemByBarcode', service: 'nutrition-lookup' },
  { operationType: 'mutation', fieldName: 'deleteMealItem', service: 'nutrition-lookup' },
  { operationType: 'mutation', fieldName: 'updateConsent', service: 'user-profile' },
];

/**
 * REST + webhook routing. Webhooks are HMAC-verified downstream rather than
 * JWT-authenticated, so they carry `kind: 'webhook'`; all other REST calls are
 * JWT-authenticated client requests.
 */
export const REST_ROUTES: readonly RestRoute[] = [
  // Food Vision Service
  { method: 'POST', pattern: '/recognize', service: 'food-vision', kind: 'rest' },
  { method: 'POST', pattern: '/portion', service: 'food-vision', kind: 'rest' },

  // Nutrition Lookup Service
  { method: 'POST', pattern: '/nutrition', service: 'nutrition-lookup', kind: 'rest' },
  { method: 'GET', pattern: '/search', service: 'nutrition-lookup', kind: 'rest' },
  { method: 'GET', pattern: '/barcode/:code', service: 'nutrition-lookup', kind: 'rest' },

  // Cortisol Data Service (webhooks + authenticated REST)
  { method: 'POST', pattern: '/webhooks/lab-results', service: 'cortisol-data', kind: 'webhook' },
  { method: 'POST', pattern: '/webhooks/fhir', service: 'cortisol-data', kind: 'webhook' },
  { method: 'POST', pattern: '/kits/order', service: 'cortisol-data', kind: 'rest' },
  { method: 'POST', pattern: '/kits/link', service: 'cortisol-data', kind: 'rest' },
  { method: 'POST', pattern: '/wearable/sync', service: 'cortisol-data', kind: 'rest' },
  { method: 'POST', pattern: '/questionnaire', service: 'cortisol-data', kind: 'rest' },
  { method: 'POST', pattern: '/car', service: 'cortisol-data', kind: 'rest' },
  { method: 'GET', pattern: '/trend', service: 'cortisol-data', kind: 'rest' },
  { method: 'POST', pattern: '/lab-import', service: 'cortisol-data', kind: 'rest' },
  { method: 'GET', pattern: '/fhir/import', service: 'cortisol-data', kind: 'rest' },

  // Insights & ML Service
  { method: 'POST', pattern: '/correlate', service: 'insights-ml', kind: 'rest' },
  { method: 'POST', pattern: '/guidance', service: 'insights-ml', kind: 'rest' },
  { method: 'GET', pattern: '/digest', service: 'insights-ml', kind: 'rest' },

  // User & Profile Service
  { method: 'POST', pattern: '/onboarding/step', service: 'user-profile', kind: 'rest' },
  { method: 'GET', pattern: '/onboarding/resume', service: 'user-profile', kind: 'rest' },
  { method: 'PUT', pattern: '/consent', service: 'user-profile', kind: 'rest' },
  { method: 'POST', pattern: '/family/members', service: 'user-profile', kind: 'rest' },

  // Notification Service
  { method: 'POST', pattern: '/notifications/register', service: 'notification', kind: 'rest' },
  { method: 'POST', pattern: '/notifications/send', service: 'notification', kind: 'rest' },
];

/**
 * Match a concrete request path against a route pattern that may contain
 * `:param` segments. Returns the extracted params on match, or null otherwise.
 */
export function matchPathPattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const normalize = (p: string): string[] =>
    p.split('?')[0].split('/').filter((seg) => seg.length > 0);

  const patternSegs = normalize(pattern);
  const pathSegs = normalize(path);
  if (patternSegs.length !== pathSegs.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i += 1) {
    const ps = patternSegs[i];
    const actual = pathSegs[i];
    if (ps.startsWith(':')) {
      params[ps.slice(1)] = decodeURIComponent(actual);
    } else if (ps !== actual) {
      return null;
    }
  }
  return params;
}
