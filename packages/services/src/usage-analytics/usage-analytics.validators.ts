/**
 * Usage Analytics — Validators & pure helpers
 *
 * Pure, side-effect-free helpers for normalizing usage events and tallying
 * per-type counts. Keeping these pure makes the counting logic unit- and
 * property-testable in isolation from persistence and the event bus.
 *
 * Validates: Requirements 16.1, 16.3, 16.4
 */

import type { DateProvider, UsageEvent, UsageEventType } from '../api-copilot-shared';
import type { UsageCounts } from './usage-analytics.types';

/** The complete set of measurable usage-event categories (Req 16.1, 16.3). */
export const USAGE_EVENT_TYPES: readonly UsageEventType[] = [
  'ai_query',
  'api_execution',
  'code_generation',
];

/** A zeroed {@link UsageCounts} with every category represented (Req 16.4). */
export function emptyUsageCounts(): UsageCounts {
  return {
    ai_query: 0,
    api_execution: 0,
    code_generation: 0,
  };
}

/** True when `type` is a recognized {@link UsageEventType}. */
export function isUsageEventType(type: unknown): type is UsageEventType {
  return (
    typeof type === 'string' &&
    (USAGE_EVENT_TYPES as readonly string[]).includes(type)
  );
}

/**
 * Normalize a usage event so it is tagged with a workspace id, type, and
 * timestamp (Req 16.1). A missing/invalid timestamp is defaulted from the
 * supplied clock, so recorded events are always well-formed for counting.
 */
export function normalizeUsageEvent(
  event: UsageEvent,
  dateProvider: DateProvider
): UsageEvent {
  const timestamp =
    event.timestamp instanceof Date && !Number.isNaN(event.timestamp.getTime())
      ? event.timestamp
      : dateProvider();
  return {
    workspaceId: event.workspaceId,
    type: event.type,
    timestamp,
  };
}

/**
 * Tally recorded events into per-type counts (Req 16.3). Unrecognized event
 * types are ignored so the counts stay aligned with {@link USAGE_EVENT_TYPES}.
 */
export function tallyCounts(events: readonly UsageEvent[]): UsageCounts {
  const counts = emptyUsageCounts();
  for (const event of events) {
    if (isUsageEventType(event.type)) {
      counts[event.type] += 1;
    }
  }
  return counts;
}
