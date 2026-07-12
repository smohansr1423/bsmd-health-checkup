/**
 * Service router (Task 16.1) — the terminal step of the middleware chain.
 *
 * Resolves a normalized {@link GatewayRequest} to one of the six backend
 * {@link ServiceName}s (via the pure {@link routes} table) and dispatches to an
 * injected {@link ServiceHandler}. Handlers are injected so unit tests can
 * substitute in-memory fakes with no network access.
 *
 * Requirements: 18.1, 25.2
 */

import { noRoute } from '../responses';
import type {
  GatewayRequest,
  GatewayResponse,
  RequestContext,
  RouteResolution,
  ServiceHandler,
  ServiceName,
  ServiceRouter,
} from '../types';
import {
  GRAPHQL_ROUTES,
  REST_ROUTES,
  matchPathPattern,
} from './routes';

/** Per-service downstream handlers (injectable; in-memory fakes in tests). */
export type ServiceHandlers = Readonly<Record<ServiceName, ServiceHandler>>;

/** Path used for the GraphQL entry point. */
export const GRAPHQL_PATH = '/graphql';

/**
 * A {@link ServiceRouter} backed by the static route table. Construction takes
 * the map of per-service handlers; `resolve` performs pure lookup and `route`
 * dispatches to the resolved handler (attaching the resolution to the context).
 */
export class TableServiceRouter implements ServiceRouter {
  constructor(private readonly handlers: ServiceHandlers) {}

  resolve(request: GatewayRequest): RouteResolution | null {
    if (request.kind === 'graphql' || request.path === GRAPHQL_PATH) {
      return this.resolveGraphQL(request);
    }
    return this.resolveRest(request);
  }

  private resolveGraphQL(request: GatewayRequest): RouteResolution | null {
    const op = request.graphql;
    if (!op) {
      return null;
    }
    const match = GRAPHQL_ROUTES.find(
      (r) => r.operationType === op.operationType && r.fieldName === op.fieldName,
    );
    if (!match) {
      return null;
    }
    return {
      service: match.service,
      operation: `${op.operationType}.${op.fieldName}`,
      kind: 'graphql',
    };
  }

  private resolveRest(request: GatewayRequest): RouteResolution | null {
    const method = request.method.toUpperCase();
    for (const route of REST_ROUTES) {
      if (route.method !== method) {
        continue;
      }
      const params = matchPathPattern(route.pattern, request.path);
      if (params) {
        return {
          service: route.service,
          operation: `${route.method} ${route.pattern}`,
          kind: route.kind,
        };
      }
    }
    return null;
  }

  async route(ctx: RequestContext): Promise<GatewayResponse> {
    const resolution = ctx.route ?? this.resolve(ctx.request);
    if (!resolution) {
      return noRoute(ctx.request.path);
    }
    ctx.route = resolution;
    const handler = this.handlers[resolution.service];
    return Promise.resolve(handler(ctx));
  }
}
