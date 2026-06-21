import { InMemoryEventBus } from './in-memory-event-bus';
import {
  TestResultRecordedEvent,
  CheckupSessionCompletedEvent,
  CriticalAlertRaisedEvent,
  InvoiceGeneratedEvent,
  PaymentProcessedEvent,
  ReportGeneratedEvent,
  SystemEvent,
} from './event-types';
import * as fc from 'fast-check';

// --- Helper factories ---

function makeTestResultRecordedEvent(
  overrides: Partial<TestResultRecordedEvent['payload']> = {}
): TestResultRecordedEvent {
  return {
    id: 'evt-1',
    type: 'TestResultRecorded',
    occurredAt: new Date().toISOString(),
    sourceId: 'session-1',
    payload: {
      testResultId: 'tr-1',
      checkupSessionId: 'session-1',
      seniorId: 'senior-1',
      testType: 'blood_sugar',
      measuredValue: 120,
      unit: 'mg/dL',
      technicianId: 'tech-1',
      collectionTimestamp: new Date().toISOString(),
      ...overrides,
    },
  };
}

function makeCheckupSessionCompletedEvent(): CheckupSessionCompletedEvent {
  return {
    id: 'evt-2',
    type: 'CheckupSessionCompleted',
    occurredAt: new Date().toISOString(),
    sourceId: 'session-1',
    payload: {
      checkupSessionId: 'session-1',
      seniorId: 'senior-1',
      packageId: 'pkg-1',
      assignedPhysicianId: 'doc-1',
      completedAt: new Date().toISOString(),
    },
  };
}

function makeCriticalAlertRaisedEvent(): CriticalAlertRaisedEvent {
  return {
    id: 'evt-3',
    type: 'CriticalAlertRaised',
    occurredAt: new Date().toISOString(),
    sourceId: 'tr-1',
    payload: {
      alertId: 'alert-1',
      testResultId: 'tr-1',
      seniorId: 'senior-1',
      physicianId: 'doc-1',
      testName: 'Blood Sugar',
      measuredValue: 450,
      unit: 'mg/dL',
      criticalThreshold: 300,
      thresholdDirection: 'above',
    },
  };
}

function makeInvoiceGeneratedEvent(): InvoiceGeneratedEvent {
  return {
    id: 'evt-4',
    type: 'InvoiceGenerated',
    occurredAt: new Date().toISOString(),
    sourceId: 'session-1',
    payload: {
      invoiceId: 'inv-1',
      invoiceNumber: 'INV-2024-001',
      checkupSessionId: 'session-1',
      seniorId: 'senior-1',
      totalAmountDue: 5000.0,
      currency: 'INR',
    },
  };
}

function makePaymentProcessedEvent(): PaymentProcessedEvent {
  return {
    id: 'evt-5',
    type: 'PaymentProcessed',
    occurredAt: new Date().toISOString(),
    sourceId: 'inv-1',
    payload: {
      paymentId: 'pay-1',
      invoiceId: 'inv-1',
      seniorId: 'senior-1',
      amount: 5000.0,
      method: 'credit_card',
      transactionId: 'txn-abc123',
    },
  };
}

function makeReportGeneratedEvent(): ReportGeneratedEvent {
  return {
    id: 'evt-6',
    type: 'ReportGenerated',
    occurredAt: new Date().toISOString(),
    sourceId: 'session-1',
    payload: {
      reportId: 'report-1',
      checkupSessionId: 'session-1',
      seniorId: 'senior-1',
      isRegeneration: false,
      generatedAt: new Date().toISOString(),
    },
  };
}

// --- Unit Tests ---

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus;

  beforeEach(() => {
    bus = new InMemoryEventBus();
  });

  afterEach(() => {
    bus.clear();
  });

  describe('publish', () => {
    it('should deliver event to a subscribed handler', async () => {
      const received: TestResultRecordedEvent[] = [];
      bus.subscribe('TestResultRecorded', (event) => {
        received.push(event);
      });

      const event = makeTestResultRecordedEvent();
      await bus.publish(event);

      expect(received).toHaveLength(1);
      expect(received[0]).toBe(event);
    });

    it('should deliver event to multiple subscribers of same type', async () => {
      const received1: TestResultRecordedEvent[] = [];
      const received2: TestResultRecordedEvent[] = [];

      bus.subscribe('TestResultRecorded', (e) => { received1.push(e); });
      bus.subscribe('TestResultRecorded', (e) => { received2.push(e); });

      await bus.publish(makeTestResultRecordedEvent());

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
    });

    it('should not deliver event to subscribers of different type', async () => {
      const received: CheckupSessionCompletedEvent[] = [];
      bus.subscribe('CheckupSessionCompleted', (e) => { received.push(e); });

      await bus.publish(makeTestResultRecordedEvent());

      expect(received).toHaveLength(0);
    });

    it('should handle async handlers', async () => {
      let processed = false;
      bus.subscribe('CriticalAlertRaised', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        processed = true;
      });

      await bus.publish(makeCriticalAlertRaisedEvent());

      expect(processed).toBe(true);
    });

    it('should not throw when a handler throws', async () => {
      bus.subscribe('InvoiceGenerated', () => {
        throw new Error('Handler error');
      });

      // Should not throw
      await expect(bus.publish(makeInvoiceGeneratedEvent())).resolves.toBeUndefined();
    });

    it('should continue processing other handlers when one throws', async () => {
      const received: InvoiceGeneratedEvent[] = [];

      bus.subscribe('InvoiceGenerated', () => {
        throw new Error('first handler fails');
      });
      bus.subscribe('InvoiceGenerated', (e) => {
        received.push(e);
      });

      await bus.publish(makeInvoiceGeneratedEvent());

      expect(received).toHaveLength(1);
    });

    it('should resolve without subscribers', async () => {
      await expect(bus.publish(makePaymentProcessedEvent())).resolves.toBeUndefined();
    });
  });

  describe('subscribe', () => {
    it('should return a subscription that can be unsubscribed', async () => {
      const received: ReportGeneratedEvent[] = [];
      const sub = bus.subscribe('ReportGenerated', (e) => { received.push(e); });

      await bus.publish(makeReportGeneratedEvent());
      expect(received).toHaveLength(1);

      sub.unsubscribe();

      await bus.publish(makeReportGeneratedEvent());
      expect(received).toHaveLength(1); // no additional delivery
    });

    it('should support all six event types', async () => {
      const events: SystemEvent[] = [];

      bus.subscribe('TestResultRecorded', (e) => events.push(e));
      bus.subscribe('CheckupSessionCompleted', (e) => events.push(e));
      bus.subscribe('CriticalAlertRaised', (e) => events.push(e));
      bus.subscribe('InvoiceGenerated', (e) => events.push(e));
      bus.subscribe('PaymentProcessed', (e) => events.push(e));
      bus.subscribe('ReportGenerated', (e) => events.push(e));

      await bus.publish(makeTestResultRecordedEvent());
      await bus.publish(makeCheckupSessionCompletedEvent());
      await bus.publish(makeCriticalAlertRaisedEvent());
      await bus.publish(makeInvoiceGeneratedEvent());
      await bus.publish(makePaymentProcessedEvent());
      await bus.publish(makeReportGeneratedEvent());

      expect(events).toHaveLength(6);
      expect(events.map((e) => e.type)).toEqual([
        'TestResultRecorded',
        'CheckupSessionCompleted',
        'CriticalAlertRaised',
        'InvoiceGenerated',
        'PaymentProcessed',
        'ReportGenerated',
      ]);
    });
  });

  describe('subscribeAll', () => {
    it('should receive events of any type', async () => {
      const allEvents: SystemEvent[] = [];
      bus.subscribeAll((e) => allEvents.push(e));

      await bus.publish(makeTestResultRecordedEvent());
      await bus.publish(makeCriticalAlertRaisedEvent());
      await bus.publish(makeReportGeneratedEvent());

      expect(allEvents).toHaveLength(3);
    });

    it('should not interfere with type-specific subscriptions', async () => {
      const global: SystemEvent[] = [];
      const specific: TestResultRecordedEvent[] = [];

      bus.subscribeAll((e) => global.push(e));
      bus.subscribe('TestResultRecorded', (e) => specific.push(e));

      await bus.publish(makeTestResultRecordedEvent());

      expect(global).toHaveLength(1);
      expect(specific).toHaveLength(1);
    });

    it('should support unsubscription', async () => {
      const events: SystemEvent[] = [];
      const sub = bus.subscribeAll((e) => events.push(e));

      await bus.publish(makeTestResultRecordedEvent());
      sub.unsubscribe();
      await bus.publish(makeTestResultRecordedEvent());

      expect(events).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should remove all subscriptions', async () => {
      const received: SystemEvent[] = [];
      bus.subscribe('TestResultRecorded', (e) => { received.push(e); });
      bus.subscribeAll((e) => { received.push(e); });

      bus.clear();

      await bus.publish(makeTestResultRecordedEvent());
      expect(received).toHaveLength(0);
    });
  });

  // --- Property-Based Tests ---

  describe('Property-based tests', () => {
    /**
     * **Validates: Requirements 5.4, 6.2, 7.1, 19.1**
     * Property: Every published event is delivered exactly once to each subscriber
     * of that event type, and zero times to subscribers of other types.
     */
    it('delivers events only to matching subscribers (no cross-delivery)', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          async (subscriberCount, publishCount) => {
            const localBus = new InMemoryEventBus();
            const matchReceived: number[] = Array(subscriberCount).fill(0);
            let mismatchReceived = 0;

            // Subscribe N handlers to TestResultRecorded
            for (let i = 0; i < subscriberCount; i++) {
              localBus.subscribe('TestResultRecorded', () => {
                matchReceived[i]++;
              });
            }

            // Subscribe a handler to a different type
            localBus.subscribe('ReportGenerated', () => {
              mismatchReceived++;
            });

            // Publish M TestResultRecorded events
            for (let j = 0; j < publishCount; j++) {
              await localBus.publish(
                makeTestResultRecordedEvent({ testResultId: `tr-${j}` })
              );
            }

            // Each subscriber should have received exactly publishCount events
            for (let i = 0; i < subscriberCount; i++) {
              expect(matchReceived[i]).toBe(publishCount);
            }

            // Mismatched subscriber should have received 0
            expect(mismatchReceived).toBe(0);

            localBus.clear();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Validates: Requirements 5.4, 6.2, 7.1, 19.1**
     * Property: Unsubscribing prevents future event delivery while
     * preserving delivery to remaining subscribers.
     */
    it('unsubscribe stops delivery without affecting other subscribers', () => {
      fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 8 }),
          fc.integer({ min: 0, max: 7 }),
          async (totalSubscribers, unsubIndex) => {
            const localBus = new InMemoryEventBus();
            const idx = unsubIndex % totalSubscribers;
            const counts: number[] = Array(totalSubscribers).fill(0);
            const subs: { unsubscribe: () => void }[] = [];

            for (let i = 0; i < totalSubscribers; i++) {
              const sub = localBus.subscribe('CheckupSessionCompleted', () => {
                counts[i]++;
              });
              subs.push(sub);
            }

            // Publish once - all should receive
            await localBus.publish(makeCheckupSessionCompletedEvent());
            for (let i = 0; i < totalSubscribers; i++) {
              expect(counts[i]).toBe(1);
            }

            // Unsubscribe one
            subs[idx].unsubscribe();

            // Publish again - unsubscribed one should not receive
            await localBus.publish(makeCheckupSessionCompletedEvent());
            for (let i = 0; i < totalSubscribers; i++) {
              if (i === idx) {
                expect(counts[i]).toBe(1); // still 1
              } else {
                expect(counts[i]).toBe(2);
              }
            }

            localBus.clear();
          }
        ),
        { numRuns: 50 }
      );
    });

    /**
     * **Validates: Requirements 5.4, 6.2, 7.1, 19.1**
     * Property: The subscribeAll handler receives every published event
     * regardless of type.
     */
    it('global subscriber receives all event types', () => {
      const eventTypes = [
        'TestResultRecorded',
        'CheckupSessionCompleted',
        'CriticalAlertRaised',
        'InvoiceGenerated',
        'PaymentProcessed',
        'ReportGenerated',
      ] as const;

      const eventFactories: Record<string, () => SystemEvent> = {
        TestResultRecorded: makeTestResultRecordedEvent,
        CheckupSessionCompleted: makeCheckupSessionCompletedEvent,
        CriticalAlertRaised: makeCriticalAlertRaisedEvent,
        InvoiceGenerated: makeInvoiceGeneratedEvent,
        PaymentProcessed: makePaymentProcessedEvent,
        ReportGenerated: makeReportGeneratedEvent,
      };

      fc.assert(
        fc.asyncProperty(
          fc.shuffledSubarray([...eventTypes], { minLength: 1, maxLength: 6 }),
          async (selectedTypes) => {
            const localBus = new InMemoryEventBus();
            const received: SystemEvent[] = [];
            localBus.subscribeAll((e) => { received.push(e); });

            for (const t of selectedTypes) {
              await localBus.publish((eventFactories as Record<string, () => SystemEvent>)[t as string]());
            }

            expect(received).toHaveLength(selectedTypes.length);
            expect(received.map((e) => e.type)).toEqual(selectedTypes);

            localBus.clear();
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
