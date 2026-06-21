/**
 * API Gateway Rate Limiter Middleware
 * In-memory sliding window rate limiter with per-endpoint configuration.
 * Validates: Requirements 18.4
 *
 * Design:
 * - Uses in-memory store (development) with interface for Redis (production)
 * - Sliding window approach: tracks request timestamps per user+endpoint
 * - Configurable max requests and window duration per route
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest, RateLimitConfig } from '../types';

/** Rate limit entry tracking request timestamps */
interface RateLimitEntry {
  timestamps: number[];
}

/** In-memory store for rate limiting. In production, swap for Redis-based store. */
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

/** Cleanup interval to prevent memory leaks (every 5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic cleanup of expired rate limit entries.
 */
export function startRateLimitCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      // Remove entries with no recent timestamps (older than 2 minutes)
      const recent = entry.timestamps.filter((ts) => now - ts < 2 * 60 * 1000);
      if (recent.length === 0) {
        rateLimitStore.delete(key);
      } else {
        entry.timestamps = recent;
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the cleanup timer (for testing/shutdown).
 */
export function stopRateLimitCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Clear the entire rate limit store (for testing).
 */
export function clearRateLimitStore(): void {
  rateLimitStore.clear();
}

/**
 * Generates a rate limit key from the request context.
 * Uses userId (if authenticated) or IP address + endpoint path.
 */
function getRateLimitKey(req: AuthenticatedRequest, prefix?: string): string {
  const identity = req.auth?.userId || req.ip || 'unknown';
  const endpoint = prefix || req.path;
  return `ratelimit:${identity}:${endpoint}`;
}

/**
 * Creates rate limiting middleware with the given configuration.
 *
 * @param config - Rate limit configuration (maxRequests, windowMs)
 * @returns Express middleware that enforces rate limits
 */
export function createRateLimiter(config: RateLimitConfig) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = getRateLimitKey(req, config.keyPrefix);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create entry
    let entry = rateLimitStore.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      rateLimitStore.set(key, entry);
    }

    // Remove timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Check if limit exceeded
    if (entry.timestamps.length >= config.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(oldestInWindow + config.windowMs).toISOString());
      res.setHeader('Retry-After', retryAfterSec.toString());

      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many requests. Please try again in ${retryAfterSec} seconds.`,
          details: {
            limit: config.maxRequests,
            windowMs: config.windowMs,
            retryAfterSeconds: retryAfterSec,
          },
        },
      });
      return;
    }

    // Record this request
    entry.timestamps.push(now);

    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', config.maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (config.maxRequests - entry.timestamps.length).toString());
    res.setHeader('X-RateLimit-Reset', new Date(now + config.windowMs).toISOString());

    next();
  };
}
