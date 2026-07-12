/**
 * API Copilot AI — Event Bus Wiring
 *
 * Inter-service communication reuses the `EventBus` / `InMemoryEventBus`
 * abstraction from `@health-checkup/shared`. This module re-exports that
 * abstraction for the new product domains and adds a focused,
 * usage-analytics-oriented product event bus that mirrors the same
 * publish/subscribe and `Subscription` semantics.
 *
 * The Usage Analytics service subscribes to `UsageEvent`s emitted by the Query,
 * Execution, and Code-generation flows (Req 16.1, 16.2).
 *
 * Validates: Requirements 16.1, 16.2, 16.3
 */

import { InMemoryEventBus } from '@health-checkup/shared';
import type { EventBus, EventHandler, Subscription } from '@health-checkup/shared';
import type { UsageEvent } from './shared.types';

// Re-export the shared abstraction so product domains depend on a single
// event-bus concept.
export { InMemoryEventBus };
export type { EventBus, EventHandler, Subscription };

/** Handler invoked for a published product usage event. */
export type UsageEventHandler = (event: UsageEvent) => void | Promise<void>;

/**
 * Product event bus for API Copilot AI usage events. Kept separate from the
 * health-checkup `SystemEvent` union (whose `EventMap` is closed) so the two
 * products stay cleanly separable, while reusing the shared `Subscription`
 * contract.
 */
export interface ProductEventBus {
  /** Publish a usage event to all registered subscribers. */
  publishUsage(event: UsageEvent): Promise<void>;
  /** Subscribe a handler to usage events; returns a Subscription handle. */
  subscribeUsage(handler: UsageEventHandler): Subscription;
  /** Remove all subscriptions (testing/cleanup). */
  clear(): void;
}

/**
 * In-memory product event bus. Delivery is synchronous-awaited and failure of
 * one handler does not prevent others from receiving the event, matching the
 * non-blocking analytics recording contract (Req 16.2).
 */
export class InMemoryProductEventBus implements ProductEventBus {
  private handlers: Set<UsageEventHandler> = new Set();

  async publishUsage(event: UsageEvent): Promise<void> {
    for (const handler of [...this.handlers]) {
      try {
        await handler(event);
      } catch {
        // A failing subscriber must not block the originating operation or
        // other subscribers (Req 16.2). Recording retries/drops are the
        // analytics service's responsibility.
      }
    }
  }

  subscribeUsage(handler: UsageEventHandler): Subscription {
    this.handlers.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.delete(handler);
      },
    };
  }

  clear(): void {
    this.handlers.clear();
  }
}
