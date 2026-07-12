import { ServiceClass } from './constants';
import {
  accumulatedDowntimeMinutes,
  evaluateMonthlyBudget,
  monthLabel,
  monthOf,
  type CalendarMonth,
} from './accounting';
import type { DowntimeInterval } from './state-machine';

/**
 * Focused unit tests for availability accounting and budget-breach alerting
 * (Req 24.5). The optional property test (Property 56) is task 16.10.
 */

const JAN_2025: CalendarMonth = { year: 2025, month: 1 };

/** An interval spanning `minutes` starting `startIso`. */
function interval(startIso: string, minutes: number): DowntimeInterval {
  const start = Date.parse(startIso);
  return {
    start: startIso,
    end: new Date(start + minutes * 60_000).toISOString(),
  };
}

describe('month helpers', () => {
  it('labels a calendar month as YYYY-MM', () => {
    expect(monthLabel(JAN_2025)).toBe('2025-01');
    expect(monthLabel({ year: 2025, month: 12 })).toBe('2025-12');
  });

  it('derives the UTC calendar month of an instant', () => {
    expect(monthOf(new Date('2025-01-31T23:59:59Z'))).toEqual(JAN_2025);
    expect(monthOf(new Date('2025-02-01T00:00:00Z'))).toEqual({
      year: 2025,
      month: 2,
    });
  });
});

describe('accumulatedDowntimeMinutes (Req 24.5)', () => {
  const now = new Date('2025-01-31T23:59:59Z');

  it('is zero when there are no intervals', () => {
    expect(accumulatedDowntimeMinutes([], JAN_2025, now)).toBe(0);
  });

  it('sums closed intervals within the month', () => {
    const intervals = [
      interval('2025-01-05T00:00:00Z', 10),
      interval('2025-01-10T00:00:00Z', 15),
    ];
    expect(accumulatedDowntimeMinutes(intervals, JAN_2025, now)).toBe(25);
  });

  it('charges an ongoing interval up to now', () => {
    const intervals: DowntimeInterval[] = [
      { start: '2025-01-31T23:49:59Z' }, // ongoing, 10 minutes before now
    ];
    expect(accumulatedDowntimeMinutes(intervals, JAN_2025, now)).toBeCloseTo(
      10,
      5,
    );
  });

  it('clips intervals to the month boundary', () => {
    // Starts Dec 31 23:50Z, ends Jan 1 00:10Z -> only 10 min falls in January.
    const intervals = [interval('2024-12-31T23:50:00Z', 20)];
    expect(accumulatedDowntimeMinutes(intervals, JAN_2025, now)).toBe(10);
  });

  it('ignores intervals entirely outside the month', () => {
    const intervals = [interval('2025-02-05T00:00:00Z', 30)];
    expect(accumulatedDowntimeMinutes(intervals, JAN_2025, now)).toBe(0);
  });
});

describe('evaluateMonthlyBudget (Req 24.5)', () => {
  const now = new Date('2025-01-31T23:59:59Z');

  it('does not breach at or below the general budget (43 min)', () => {
    const intervals = [interval('2025-01-05T00:00:00Z', 43)];
    const result = evaluateMonthlyBudget({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      intervals,
      month: JAN_2025,
      now,
    });
    expect(result.breached).toBe(false);
    expect(result.alert).toBeUndefined();
    expect(result.budgetMinutes).toBe(43);
    expect(result.intervals).toBe(intervals); // retained
  });

  it('raises an alert when general downtime exceeds 43 min', () => {
    const intervals = [interval('2025-01-05T00:00:00Z', 44)];
    const result = evaluateMonthlyBudget({
      serviceId: 'gateway',
      serviceClass: ServiceClass.GENERAL,
      intervals,
      month: JAN_2025,
      now,
    });
    expect(result.breached).toBe(true);
    expect(result.alert).toBeDefined();
    expect(result.alert?.serviceClass).toBe(ServiceClass.GENERAL);
    expect(result.alert?.serviceId).toBe('gateway');
    expect(result.alert?.month).toBe('2025-01');
    expect(result.alert?.totalDowntimeMinutes).toBe(44);
    expect(result.alert?.budgetMinutes).toBe(43);
    expect(result.alert?.intervals).toBe(intervals); // retained (Req 24.5)
    expect(result.alert?.recordedAt).toBe(now.toISOString());
  });

  it('applies the tighter lab-ingestion budget (21 min)', () => {
    const intervals = [interval('2025-01-05T00:00:00Z', 22)];
    const result = evaluateMonthlyBudget({
      serviceId: 'lab-ingestion',
      serviceClass: ServiceClass.LAB_INGESTION,
      intervals,
      month: JAN_2025,
      now,
    });
    expect(result.budgetMinutes).toBe(21);
    expect(result.breached).toBe(true);
    expect(result.alert?.serviceClass).toBe(ServiceClass.LAB_INGESTION);
  });

  it('does not breach lab ingestion at exactly 21 min', () => {
    const intervals = [interval('2025-01-05T00:00:00Z', 21)];
    const result = evaluateMonthlyBudget({
      serviceId: 'lab-ingestion',
      serviceClass: ServiceClass.LAB_INGESTION,
      intervals,
      month: JAN_2025,
      now,
    });
    expect(result.breached).toBe(false);
  });
});
