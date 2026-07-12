/**
 * Capacity shedding (Task 16.1, Req 23.3).
 *
 * Beyond the configured concurrency ceiling, excess requests are shed —
 * *rejected* outright, or *queued* when queue headroom remains — with a
 * capacity-exceeded response, while requests already admitted are never
 * dropped. The controller tracks only integer in-flight / queued counts, so it
 * is pure and deterministic (no timers), and each admission returns a
 * `release()` handle the middleware calls once the request completes.
 *
 * Requirements: 23.3, 25.2
 */

import { capacityShed } from '../responses';
import type {
  CapacityAdmission,
  CapacityController,
  GatewayRequest,
  Middleware,
  NextFn,
  RequestContext,
} from '../types';

export interface CapacityConfig {
  /** Maximum concurrently in-flight admitted requests. */
  readonly maxConcurrent: number;
  /**
   * Additional slots for queueing excess requests before they are rejected.
   * When 0, all excess is rejected (never queued). Defaults to 0.
   */
  readonly maxQueue?: number;
}

/**
 * Concurrency-based admission controller. `tryAdmit` admits while in-flight is
 * below `maxConcurrent`; beyond that it queues (if queue headroom remains) or
 * rejects. `release()` frees the slot and is idempotent so double-release from
 * a caller cannot corrupt the counts.
 */
export class ConcurrencyCapacityController implements CapacityController {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private inFlight = 0;
  private queued = 0;

  constructor(config: CapacityConfig) {
    if (config.maxConcurrent <= 0) {
      throw new Error('ConcurrencyCapacityController: maxConcurrent must be > 0');
    }
    this.maxConcurrent = config.maxConcurrent;
    this.maxQueue = Math.max(0, config.maxQueue ?? 0);
  }

  /** Current in-flight admitted count (for tests / metrics). */
  get inFlightCount(): number {
    return this.inFlight;
  }

  tryAdmit(_request: GatewayRequest): CapacityAdmission {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      let released = false;
      return {
        admitted: true,
        queued: false,
        release: () => {
          if (!released) {
            released = true;
            this.inFlight = Math.max(0, this.inFlight - 1);
          }
        },
      };
    }

    // Over the concurrency ceiling: shed. Queue when headroom remains, else
    // reject. Either way, admitted in-progress requests are preserved.
    const queued = this.queued < this.maxQueue;
    return { admitted: false, queued, release: () => undefined };
  }
}

export interface CapacityMiddlewareOptions {
  readonly controller: CapacityController;
}

/** Build the capacity-shedding middleware. */
export function capacityMiddleware(options: CapacityMiddlewareOptions): Middleware {
  const { controller } = options;
  return {
    name: 'capacity',
    async handle(ctx: RequestContext, next: NextFn) {
      const admission = await controller.tryAdmit(ctx.request);
      if (!admission.admitted) {
        return capacityShed(admission.queued);
      }
      try {
        return await next(ctx);
      } finally {
        admission.release();
      }
    },
  };
}
