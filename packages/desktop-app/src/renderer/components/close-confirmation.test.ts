/**
 * Unit tests for close-confirmation logic (Task 13.1 — Req 18.4).
 */

import { hasInFlightRequests, shouldConfirmClose } from './close-confirmation';
import { initialAppState } from '../state/types';

describe('hasInFlightRequests', () => {
  it('is false when nothing is loading', () => {
    expect(hasInFlightRequests({})).toBe(false);
    expect(hasInFlightRequests({ a: 'success', b: 'error', c: 'idle' })).toBe(false);
  });

  it('is true when any operation is loading', () => {
    expect(hasInFlightRequests({ a: 'success', b: 'loading' })).toBe(true);
  });
});

describe('shouldConfirmClose', () => {
  it('does not confirm with no in-flight requests', () => {
    expect(shouldConfirmClose(initialAppState)).toBe(false);
  });

  it('confirms when a request is in flight (Req 18.4)', () => {
    expect(
      shouldConfirmClose({ requests: { 'query-engine:ask': 'loading' } }),
    ).toBe(true);
  });
});
