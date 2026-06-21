/**
 * In-memory implementation of the EventBus interface.
 * Suitable for development, testing, and single-process deployments.
 *
 * For production, replace with a BullMQ-backed implementation that
 * provides persistence, retry semantics, and distributed processing.
 *
 * Validates: Requirements 5.4, 6.2, 7.1, 19.1
 */

import { DomainEvent, EventMap, EventType, SystemEvent } from './event-types';
import { EventBus, EventHandler, Subscription } from './event-bus';

export class InMemoryEventBus implements EventBus {
  private handlers: Map<EventType, Set<EventHandler<any>>> = new Map();
  private globalHandlers: Set<EventHandler<SystemEvent>> = new Set();

  async publish<T extends SystemEvent>(event: T): Promise<void> {
    const typeHandlers = this.handlers.get(event.type);

    // Execute type-specific handlers (errors are swallowed)
    if (typeHandlers) {
      const promises = Array.from(typeHandlers).map((handler) => {
        try {
          return Promise.resolve(handler(event));
        } catch (err) {
          return Promise.resolve();
        }
      });
      await Promise.allSettled(promises);
    }

    // Execute global handlers (errors are swallowed)
    if (this.globalHandlers.size > 0) {
      const globalPromises = Array.from(this.globalHandlers).map((handler) => {
        try {
          return Promise.resolve(handler(event));
        } catch (err) {
          return Promise.resolve();
        }
      });
      await Promise.allSettled(globalPromises);
    }
  }

  subscribe<K extends EventType>(
    eventType: K,
    handler: EventHandler<EventMap[K]>
  ): Subscription {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlersSet = this.handlers.get(eventType)!;
    handlersSet.add(handler);

    return {
      unsubscribe: () => {
        handlersSet.delete(handler);
        if (handlersSet.size === 0) {
          this.handlers.delete(eventType);
        }
      },
    };
  }

  subscribeAll(handler: EventHandler<SystemEvent>): Subscription {
    this.globalHandlers.add(handler);

    return {
      unsubscribe: () => {
        this.globalHandlers.delete(handler);
      },
    };
  }

  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
  }
}
