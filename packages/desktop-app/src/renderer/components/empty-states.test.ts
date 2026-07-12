/**
 * Unit tests for empty-state resolution (Task 13.1 — Req 8.5, 9.3, 14.2, 15.4).
 */

import {
  resolveQaDisplay,
  resolveSearchDisplay,
  resolveHistoryDisplay,
  resolveDashboardDisplay,
} from './empty-states';

describe('resolveQaDisplay', () => {
  it('is idle before any answer', () => {
    expect(resolveQaDisplay(null)).toBe('idle');
    expect(resolveQaDisplay(undefined)).toBe('idle');
  });

  it('shows no-answer when the backend found nothing grounded (Req 8.5)', () => {
    expect(resolveQaDisplay({ grounded: false, text: '' })).toBe('no-answer');
  });

  it('shows the answer when grounded (Req 8.4)', () => {
    expect(resolveQaDisplay({ grounded: true, text: 'Use POST /x' })).toBe('answer');
  });
});

describe('resolveSearchDisplay', () => {
  it('is idle before a search', () => {
    expect(resolveSearchDisplay(undefined)).toBe('idle');
  });

  it('shows no-results for an empty list (Req 9.3)', () => {
    expect(resolveSearchDisplay([])).toBe('no-results');
  });

  it('shows results for a non-empty list', () => {
    expect(resolveSearchDisplay([{}, {}])).toBe('results');
  });
});

describe('resolveHistoryDisplay', () => {
  it('is idle before history loads', () => {
    expect(resolveHistoryDisplay(undefined)).toBe('idle');
  });

  it('shows empty for no entries (Req 14.2)', () => {
    expect(resolveHistoryDisplay([])).toBe('empty');
  });

  it('shows entries when present', () => {
    expect(resolveHistoryDisplay([{}])).toBe('entries');
  });
});

describe('resolveDashboardDisplay', () => {
  it('is idle before data loads', () => {
    expect(resolveDashboardDisplay(undefined)).toBe('idle');
  });

  it('shows no-usage when every count is zero (Req 15.4)', () => {
    expect(
      resolveDashboardDisplay({ aiQueries: 0, apiExecutions: 0, codeGenerations: 0 }),
    ).toBe('no-usage');
  });

  it('shows data when any count is non-zero', () => {
    expect(
      resolveDashboardDisplay({ aiQueries: 3, apiExecutions: 0, codeGenerations: 0 }),
    ).toBe('data');
  });
});
