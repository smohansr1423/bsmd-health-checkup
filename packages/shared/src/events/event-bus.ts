/**
 * EventBus abstraction for the Senior Citizen Health Checkup System.
 * Provides a publish/subscribe interface for domain events, enabling
 * loose coupling between services.
 *
 * In development: use InMemoryEventBus.
 * In production: swap for a BullMQ-backed or other message broker implementation.
 *
 * Validates: Requirements 5.4, 6.2, 7.1, 19.1
 */

import type { DomainEvent, EventMap, EventType, SystemEvent } from './event-types';

/** Handler function that processes a domain event */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => any;

/** Subscription handle returned when subscribing, used for unsubscription */
export interface Subscription {
  /** Unsubscribe this handler from the event type */
  unsubscribe(): void;
}

/**
 * EventBus interface defining the contract for event-driven communication.
 * Implementations can be swapped between in-memory (dev) and message broker (prod).
 */
export interface EventBus {
  /**
   * Publish a domain event to all registered subscribers.
   * @param event - The domain event to publish
   */
  publish<T extends SystemEvent>(event: T): Promise<void>;

  /**
   * Subscribe a handler to a specific event type.
   * @param eventType - The event type to listen for
   * @param handler - The handler function to invoke when the event is published
   * @returns A Subscription handle for unsubscribing
   */
  subscribe<K extends EventType>(
    eventType: K,
    handler: EventHandler<EventMap[K]>
  ): Subscription;

  /**
   * Subscribe a handler to all event types (useful for logging, analytics).
   * @param handler - The handler function invoked for every published event
   * @returns A Subscription handle for unsubscribing
   */
  subscribeAll(handler: EventHandler<SystemEvent>): Subscription;

  /**
   * Remove all subscriptions (useful for testing and cleanup).
   */
  clear(): void;
}
