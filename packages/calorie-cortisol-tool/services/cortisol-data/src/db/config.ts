/**
 * TimescaleDB connection configuration for the Cortisol Data Service.
 *
 * The service owns the time-series store (design: Data Store Mapping). Writes
 * (lab-result ingestion, wearable sync, diurnal/CAR samples) go to the primary;
 * read-heavy trend queries (Req 12.1) are routed to read replicas so that
 * dashboard reads never contend with the ingestion write path.
 *
 * This module is connection-layer configuration only — it does not contain
 * query logic. It parses environment variables into a strongly-typed shape that
 * the connection layer (e.g. a `pg.Pool` per endpoint) is constructed from.
 */

/** A single physical TimescaleDB endpoint. */
export interface DbEndpoint {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** TLS 1.3 in transit (design: cross-cutting encryption). */
  ssl: boolean;
  /** Per-endpoint connection-pool ceiling. */
  maxConnections: number;
}

/**
 * Full store configuration: exactly one primary (writes + read-your-writes) and
 * zero or more read replicas (trend/analytical reads, Req 12.1).
 */
export interface TimescaleConfig {
  primary: DbEndpoint;
  /** Read replicas; empty → replica reads transparently fall back to primary. */
  replicas: DbEndpoint[];
}

const DEFAULT_PORT = 5432;
const DEFAULT_MAX_CONNECTIONS = 10;

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid TimescaleDB port: "${value}"`);
  }
  return parsed;
}

function parseMax(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid max connections: "${value}"`);
  }
  return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Build the primary endpoint from environment variables.
 *
 * Required: TIMESCALE_PRIMARY_HOST, TIMESCALE_DB, TIMESCALE_USER,
 * TIMESCALE_PASSWORD.
 */
export function loadPrimaryEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): DbEndpoint {
  const host = env.TIMESCALE_PRIMARY_HOST;
  const database = env.TIMESCALE_DB;
  const user = env.TIMESCALE_USER;
  const password = env.TIMESCALE_PASSWORD;

  if (!host) throw new Error('TIMESCALE_PRIMARY_HOST is required');
  if (!database) throw new Error('TIMESCALE_DB is required');
  if (!user) throw new Error('TIMESCALE_USER is required');
  if (password === undefined) throw new Error('TIMESCALE_PASSWORD is required');

  return {
    host,
    port: parsePort(env.TIMESCALE_PRIMARY_PORT, DEFAULT_PORT),
    database,
    user,
    password,
    ssl: parseBool(env.TIMESCALE_SSL, true),
    maxConnections: parseMax(env.TIMESCALE_PRIMARY_MAX, DEFAULT_MAX_CONNECTIONS),
  };
}

/**
 * Build read-replica endpoints from a comma-separated host list in
 * TIMESCALE_REPLICA_HOSTS. Replicas share the database/user/password/SSL of the
 * primary unless overridden. An empty/unset list yields no replicas, in which
 * case replica reads fall back to the primary at the routing layer.
 */
export function loadReplicaEndpoints(
  primary: DbEndpoint,
  env: NodeJS.ProcessEnv = process.env,
): DbEndpoint[] {
  const raw = env.TIMESCALE_REPLICA_HOSTS;
  if (!raw || raw.trim() === '') return [];

  const port = parsePort(env.TIMESCALE_REPLICA_PORT, primary.port);
  const max = parseMax(env.TIMESCALE_REPLICA_MAX, primary.maxConnections);

  return raw
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0)
    .map((host) => ({
      host,
      port,
      database: primary.database,
      user: env.TIMESCALE_REPLICA_USER ?? primary.user,
      password: env.TIMESCALE_REPLICA_PASSWORD ?? primary.password,
      ssl: primary.ssl,
      maxConnections: max,
    }));
}

/** Load the full TimescaleDB store configuration from the environment. */
export function loadTimescaleConfig(
  env: NodeJS.ProcessEnv = process.env,
): TimescaleConfig {
  const primary = loadPrimaryEndpoint(env);
  return { primary, replicas: loadReplicaEndpoints(primary, env) };
}
