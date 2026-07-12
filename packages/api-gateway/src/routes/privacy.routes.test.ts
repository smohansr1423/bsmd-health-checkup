// @ts-nocheck
/**
 * Unit tests for personal-data deletion confirmation logic.
 * Validates: Requirements 18.7
 */

import { buildDeletionConfirmation, MAX_DELETION_DAYS } from './privacy.routes';

describe('buildDeletionConfirmation', () => {
  const requestedAt = new Date('2024-01-01T00:00:00.000Z');

  it('sets the completion deadline within 30 days of the request', () => {
    const confirmation = buildDeletionConfirmation('user-1', requestedAt);
    const deadline = new Date(confirmation.completionDeadline).getTime();
    const requested = new Date(confirmation.requestedAt).getTime();
    const diffDays = (deadline - requested) / (24 * 60 * 60 * 1000);

    expect(diffDays).toBe(MAX_DELETION_DAYS);
    expect(confirmation.completionDeadline).toBe('2024-01-31T00:00:00.000Z');
  });

  it('includes a completion confirmation message and the acting user', () => {
    const confirmation = buildDeletionConfirmation('user-42', requestedAt);
    expect(confirmation.userId).toBe('user-42');
    expect(confirmation.confirmation).toContain(`${MAX_DELETION_DAYS} days`);
    expect(confirmation.maxCompletionDays).toBe(MAX_DELETION_DAYS);
  });

  it('defaults status to "scheduled" when no service result is provided', () => {
    const confirmation = buildDeletionConfirmation('user-1', requestedAt);
    expect(confirmation.status).toBe('scheduled');
    expect(confirmation.requestId).toBeUndefined();
  });

  it('propagates status and requestId from a delegating service result', () => {
    const confirmation = buildDeletionConfirmation('user-1', requestedAt, {
      status: 'processing',
      requestId: 'req-123',
    });
    expect(confirmation.status).toBe('processing');
    expect(confirmation.requestId).toBe('req-123');
  });
});
