/**
 * Read-replica routing for the Cortisol Data Service.
 *
 * Chooses which configured endpoint a unit of work should run against, so that
 * write-path work (ingestion, sync, sample linkage) targets the primary and
 * read-heavy trend queries (Req 12.1) are spread across read replicas. This is
 * connection-layer routing only — it selects an endpoint/pool, it does not build
 * or execute SQL.
 */

import type { DbEndpoint, TimescaleConfig } from './config';

/**
 * Intent of a unit of database work.
 * - `write`         → mutations; must hit the primary.
 * - `readWrite`     → reads that must observe the caller's own recent writes
 *                     (read-your-writes); routed to the primary to avoid replica
 *                     lag.
 * - `trendRead`     → range/analytical reads (Req 12.1); prefer a replica.
 * - `read`          → general reads that tolerate replica lag; prefer a replica.
 */
export type QueryIntent = 'write' | 'readWrite' | 'trendRead' | 'read';

/** Endpoint kind actually selected, after fallback resolution. */
export type EndpointRole = 'primary' | 'replica';

export interface RoutingDecision {
  role: EndpointRole;
  endpoint: DbEndpoint;
}

const REPLICA_ELIGIBLE: ReadonlySet<QueryIntent> = new Set<QueryIntent>([
  'read',
  'trendRead',
]);

/**
 * Routes database work to the appropriate endpoint based on its intent.
 *
 * Replica selection is round-robin across the configured replicas. When an
 * intent is replica-eligible but no replicas are configured, routing falls back
 * to the primary so reads always succeed.
 */
export class ReplicaRouter {
  private readonly config: TimescaleConfig;

  private nextReplicaIndex = 0;

  constructor(config: TimescaleConfig) {
    this.config = config;
  }

  /** True when the given intent should be served by a read replica. */
  static prefersReplica(intent: QueryIntent): boolean {
    return REPLICA_ELIGIBLE.has(intent);
  }

  /** Resolve the endpoint for a unit of work with the given intent. */
  route(intent: QueryIntent): RoutingDecision {
    if (ReplicaRouter.prefersReplica(intent) && this.config.replicas.length > 0) {
      return { role: 'replica', endpoint: this.nextReplica() };
    }
    return { role: 'primary', endpoint: this.config.primary };
  }

  private nextReplica(): DbEndpoint {
    const replicas = this.config.replicas;
    const endpoint = replicas[this.nextReplicaIndex % replicas.length];
    this.nextReplicaIndex =
      (this.nextReplicaIndex + 1) % Math.max(replicas.length, 1);
    return endpoint;
  }
}
