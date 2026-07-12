/**
 * Per-user / per-IP token-bucket rate limiting (Task 16.1).
 *
 * Implements the design's "per-user/per-IP token bucket ... capacity shedding"
 * (Req 23). The bucket is a pure, deterministic {@link RateLimitStore}: tokens
 * refill continuously at `refillPerSecond` up to `capacity`, and each request
 * consumes `cost` tokens. Time is supplied by an injected {@link Clock}, so the
 * refill maths are fully unit-testable without real delays.
 *
 * Requirements: 23.3, 25.2
 */

import { GATEWAY_ERROR, STATUS, respondError } from '../responses';
import { capacityExceeded } from '@calorie-cortisol/shared';
import type {
  Middleware,
  NextFn,
  RateLimitDecision,
  RateLimitStore,
  RequestContext,
} from '../types';
import { type Clock, systemClock } from './jwt';

export interface TokenBucketConfig {
  /** Maximum tokens in a bucket (burst size). */
  readonly capacity: number;
  /** Tokens replenished per second. */
  readonly refillPerSecond: number;
  /** Clock injected for deterministic refill. Defaults to {@link systemClock}. */
  readonly clock?: Clock;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

/**
 * In-memory token-bucket store. Production wires an equivalent Redis-backed
 * store (design), but the refill/consume algorithm is identical and lives here
 * so it can be tested in isolation.
 */
export class TokenBucketStore implements RateLimitStore {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly clock: Clock;
  private readonly buckets = new Map<string, BucketState>();

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0) {
      throw new Error('TokenBucketStore: capacity must be > 0');
    }
    if (config.refillPerSecond < 0) {
      throw new Error('TokenBucketStore: refillPerSecond must be >= 0');
    }
    this.capacity = config.capacity;
    this.refillPerSecond = config.refillPerSecond;
    this.clock = config.clock ?? systemClock;
  }

  private refill(state: BucketState, nowMs: number): void {
    if (nowMs <= state.lastRefillMs) {
      return;
    }
    const elapsedSeconds = (nowMs - state.lastRefillMs) / 1000;
    const replenished = elapsedSeconds * this.refillPerSecond;
    state.tokens = Math.min(this.capacity, state.tokens + replenished);
    state.lastRefillMs = nowMs;
  }

  consume(key: string, cost = 1): RateLimitDecision {
    const nowMs = this.clock();
    let state = this.buckets.get(key);
    if (!state) {
      state = { tokens: this.capacity, lastRefillMs: nowMs };
      this.buckets.set(key, state);
    } else {
      this.refill(state, nowMs);
    }

    if (state.tokens >= cost) {
      state.tokens -= cost;
      return {
        allowed: true,
        limit: this.capacity,
        remaining: Math.floor(state.tokens),
      };
    }

    // Not enough tokens: compute seconds until `cost` tokens are available.
    const deficit = cost - state.tokens;
    const retryAfterSeconds =
      this.refillPerSecond > 0 ? Math.ceil(deficit / this.refillPerSecond) : undefined;
    return {
      allowed: false,
      limit: this.capacity,
      remaining: Math.floor(state.tokens),
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    };
  }
}

/** Derive the rate-limit key: authenticated user id, else remote IP, else path. */
export function rateLimitKey(ctx: RequestContext): string {
  if (ctx.auth) {
    return `user:${ctx.auth.principal.userId}`;
  }
  const ip = ctx.request.connection?.remoteIp;
  if (ip) {
    return `ip:${ip}`;
  }
  return `anon:${ctx.request.path}`;
}

export interface RateLimiterOptions {
  readonly store: RateLimitStore;
  /** Tokens consumed per request. Defaults to 1. */
  readonly cost?: number;
  /** Key derivation strategy. Defaults to {@link rateLimitKey}. */
  readonly keyOf?: (ctx: RequestContext) => string;
}

/** Build the rate-limiter middleware. */
export function rateLimiterMiddleware(options: RateLimiterOptions): Middleware {
  const { store, cost = 1 } = options;
  const keyOf = options.keyOf ?? rateLimitKey;
  return {
    name: 'rate-limiter',
    async handle(ctx: RequestContext, next: NextFn) {
      const decision = await store.consume(keyOf(ctx), cost);
      if (!decision.allowed) {
        const error = capacityExceeded(
          GATEWAY_ERROR.RATE_LIMITED,
          'Rate limit exceeded; please retry later.',
        );
        const headers: Record<string, string> = {
          'X-RateLimit-Limit': String(decision.limit),
          'X-RateLimit-Remaining': String(decision.remaining),
        };
        if (decision.retryAfterSeconds !== undefined) {
          headers['Retry-After'] = String(decision.retryAfterSeconds);
        }
        return respondError(STATUS.TOO_MANY_REQUESTS, error, headers);
      }
      return next(ctx);
    },
  };
}
