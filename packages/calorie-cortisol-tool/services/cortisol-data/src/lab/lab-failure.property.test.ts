/**
 * Property 22: Lab failure preserves order without charge.
 *
 * Feature: calorie-cortisol-tool, Property 22
 * Validates: Requirements 8.6, 8.8
 *
 * *For any* order where the lab is unavailable, rejects the order, or results
 * are missing/invalid within 72 hours, the order is retained (pending or
 * results-pending), no charge is applied on rejection, and an appropriate
 * error is surfaced.
 *
 * This spans the two Cortisol Data Service failure surfaces:
 *   - Req 8.6 — `POST /kits/order` ({@link LabKitService.orderKit}): a lab
 *     partner that is unavailable/rejects, or a payment authorization failure,
 *     must leave the order `pending`, never capture a charge, and surface a
 *     retained-state error.
 *   - Req 8.8 — `POST /webhooks/lab-results`
 *     ({@link handleLabResultsWebhook}): missing/structurally-invalid results,
 *     or results not received within 72 hours, must flag the retained order
 *     `results-pending` and surface an error.
 */

import fc from 'fast-check';
import type { LabResultsWebhookRequest } from '@calorie-cortisol/shared';

import { KitErrorCode } from './errors';
import { LabKitService } from './kit-service';
import type {
  Clock,
  IdGenerator,
  KitOrder,
  KitOrderStore,
  KitType,
  LabKitDeps,
  LabPartnerPort,
  LabShipmentResult,
  PaymentAuthorization,
  PaymentPort,
  SampleLinkStore,
  SampleRecord,
} from './ports';

import { computeSignature } from '../lab-ingestion/hmac';
import { LabIngestErrorCode } from '../lab-ingestion/errors';
import { handleLabResultsWebhook, RESULTS_TIMEOUT_HOURS } from '../lab-ingestion/ingest';

const NUM_RUNS = 100; // ≥100 iterations per task 9.3.

// ---------------------------------------------------------------------------
// Order-flow harness (Req 8.6): configurable in-memory doubles that record
// whether a charge (capture) was ever taken.
// ---------------------------------------------------------------------------

const FIXED_NOW = '2024-01-01T08:00:00.000Z';

function buildOrderService(opts: {
  auth: PaymentAuthorization;
  ship: LabShipmentResult;
  orderId: string;
}): {
  service: LabKitService;
  captureCalls: string[];
  voidCalls: string[];
  saved: Map<string, KitOrder>;
} {
  const captureCalls: string[] = [];
  const voidCalls: string[] = [];
  const saved = new Map<string, KitOrder>();

  const payment: PaymentPort = {
    async authorize() {
      return opts.auth;
    },
    async capture(authorizationId: string) {
      captureCalls.push(authorizationId);
    },
    async voidAuthorization(authorizationId: string) {
      voidCalls.push(authorizationId);
    },
  };

  const labPartner: LabPartnerPort = {
    async initiateShipment() {
      return opts.ship;
    },
  };

  const orders: KitOrderStore = {
    async save(order: KitOrder) {
      saved.set(order.id, order);
    },
  };

  const samples: SampleLinkStore = {
    async findByCode(): Promise<SampleRecord | null> {
      return null;
    },
    async link(code: string, userId: string, linkedAt: string): Promise<SampleRecord> {
      return { code, linkedUserId: userId, linkedAt };
    },
  };

  const ids: IdGenerator = { next: () => opts.orderId };
  const clock: Clock = { now: () => FIXED_NOW };

  const deps: LabKitDeps = { payment, labPartner, orders, samples, ids, clock };
  return { service: new LabKitService(deps), captureCalls, voidCalls, saved };
}

const arbNonEmpty = (maxLength: number) =>
  fc.string({ minLength: 1, maxLength }).filter((s) => s.trim().length > 0);

const arbKitType = fc.constantFrom<KitType>('single', 'diurnal');
const arbAmountCents = fc.integer({ min: 1, max: 1_000_000 });

/** The three ways an order can fail such that no charge is possible (Req 8.6). */
const arbOrderFailure = fc.record({
  userId: arbNonEmpty(24),
  kitType: arbKitType,
  amountCents: arbAmountCents,
  orderId: arbNonEmpty(16),
  mode: fc.constantFrom('lab-unavailable', 'lab-rejected', 'payment-failed'),
  reason: fc.string({ maxLength: 24 }),
});

describe('Property 22: lab-failure order preservation (Req 8.6) [Feature: calorie-cortisol-tool, Property 22]', () => {
  it('retains a pending, un-charged order and surfaces a retained-state error on any lab/payment failure', async () => {
    await fc.assert(
      fc.asyncProperty(arbOrderFailure, async ({ userId, kitType, amountCents, orderId, mode, reason }) => {
        let auth: PaymentAuthorization;
        let ship: LabShipmentResult;
        if (mode === 'payment-failed') {
          auth = { ok: false, reason: reason || 'card_declined' };
          ship = { ok: true, shipmentId: 'ship-should-not-be-reached' };
        } else {
          auth = { ok: true, authorizationId: 'auth-1' };
          ship = { ok: false, reason: mode === 'lab-unavailable' ? 'unavailable' : 'rejected' };
        }

        const { service, captureCalls, saved } = buildOrderService({ auth, ship, orderId });
        const result = await service.orderKit({ userId, kitType, amountCents });

        // Failure is reported and no charge is ever applied.
        expect(result.ok).toBe(false);
        if (result.ok) return false;

        expect(result.charged).toBe(false);
        // The order is retained: the pending order id is surfaced.
        expect(result.pendingOrderId).toBe(orderId);

        // An appropriate, retained-state error is surfaced.
        const expectedCode =
          mode === 'payment-failed'
            ? KitErrorCode.ORDER_PAYMENT_FAILED
            : KitErrorCode.ORDER_LAB_UNAVAILABLE;
        expect(result.error.code).toBe(expectedCode);
        expect(result.error.retainedState).toBe(true);
        expect(result.error.message.length).toBeGreaterThan(0);

        // No charge means capture was never invoked.
        expect(captureCalls).toEqual([]);

        // The persisted order is retained in the pending state, un-charged.
        const persisted = saved.get(orderId);
        expect(persisted).toBeDefined();
        expect(persisted?.status).toBe('pending');
        expect(persisted?.charged).toBe(false);

        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Results-ingestion harness (Req 8.8): missing / structurally-invalid results,
// or results past the 72-hour window, flag the retained order results-pending.
// ---------------------------------------------------------------------------

const SECRET = 'partner-secret';

/** Sign a request body exactly as a lab partner would (so HMAC passes). */
function sign(request: LabResultsWebhookRequest): { rawBody: string; signature: string } {
  const rawBody = JSON.stringify(request);
  return { rawBody, signature: computeSignature(rawBody, SECRET) };
}

/** A JSON reading corrupted in exactly one required field — always invalid. */
const arbInvalidReading = fc.oneof(
  // Missing sampleId.
  fc.record({
    sampleId: fc.constant(''),
    collectedAt: fc.constant('2024-01-01T08:00:00Z'),
    value: fc.integer({ min: 1, max: 100 }),
    unit: fc.constant('nmol/L'),
  }),
  // Invalid collectedAt.
  fc.record({
    sampleId: arbNonEmpty(8),
    collectedAt: fc.constant('not-a-timestamp'),
    value: fc.integer({ min: 1, max: 100 }),
    unit: fc.constant('nmol/L'),
  }),
  // Non-positive value.
  fc.record({
    sampleId: arbNonEmpty(8),
    collectedAt: fc.constant('2024-01-01T08:00:00Z'),
    value: fc.integer({ min: -100, max: 0 }),
    unit: fc.constant('nmol/L'),
  }),
  // Unrecognized unit.
  fc.record({
    sampleId: arbNonEmpty(8),
    collectedAt: fc.constant('2024-01-01T08:00:00Z'),
    value: fc.integer({ min: 1, max: 100 }),
    unit: fc.constant('furlongs'),
  }),
);

const arbInvalidPayloadScenario = fc.record({
  kind: fc.constant('invalid-payload' as const),
  orderId: arbNonEmpty(16),
  labPartnerId: arbNonEmpty(12),
  // Either no readings at all, or one-or-more all-invalid readings.
  readings: fc.array(arbInvalidReading, { minLength: 0, maxLength: 5 }),
});

const arbTimeoutScenario = fc.record({
  kind: fc.constant('timeout' as const),
  orderId: arbNonEmpty(16),
  labPartnerId: arbNonEmpty(12),
  // Hours beyond the 72h deadline that "now" sits at.
  hoursPastDeadline: fc.integer({ min: 1, max: 240 }),
});

const arbPendingScenario = fc.oneof(arbInvalidPayloadScenario, arbTimeoutScenario);

describe('Property 22: results-pending retention (Req 8.8) [Feature: calorie-cortisol-tool, Property 22]', () => {
  it('retains the order as results-pending and surfaces an error for missing/invalid or timed-out results', () => {
    fc.assert(
      fc.property(arbPendingScenario, (scenario) => {
        const expectedAtDate = new Date('2024-01-01T00:00:00Z');

        if (scenario.kind === 'invalid-payload') {
          const { rawBody, signature } = sign({
            orderId: scenario.orderId,
            labPartnerId: scenario.labPartnerId,
            format: 'JSON',
            readings: scenario.readings as never,
          });
          const out = handleLabResultsWebhook(rawBody, signature, {
            webhookSecret: SECRET,
            resolveUser: () => ({ userId: 'user-1', age: 40, sex: 'F' }),
            now: () => new Date('2024-01-02T00:00:00Z'),
            // No expected publication time → invalid payload (not a timeout).
          });

          expect(out.statusCode).toBe(202);
          expect(out.body.status).toBe('results-pending');
          expect(out.body.orderId).toBe(scenario.orderId); // order retained/flagged
          expect(out.body.reason).toBe(LabIngestErrorCode.PAYLOAD_INVALID);
          expect(out.readings).toHaveLength(0);
          return true;
        }

        // timeout scenario: empty results delivered after the 72h window.
        const nowMs = expectedAtDate.getTime() + (RESULTS_TIMEOUT_HOURS + scenario.hoursPastDeadline) * 3_600_000;
        const { rawBody, signature } = sign({
          orderId: scenario.orderId,
          labPartnerId: scenario.labPartnerId,
          format: 'JSON',
          readings: [],
        });
        const out = handleLabResultsWebhook(rawBody, signature, {
          webhookSecret: SECRET,
          resolveUser: () => ({ userId: 'user-1', age: 40, sex: 'F' }),
          now: () => new Date(nowMs),
          expectedPublicationAt: () => expectedAtDate,
        });

        expect(out.statusCode).toBe(202);
        expect(out.body.status).toBe('results-pending');
        expect(out.body.orderId).toBe(scenario.orderId); // order retained/flagged
        expect(out.body.reason).toBe(LabIngestErrorCode.RESULTS_TIMEOUT);
        expect(out.readings).toHaveLength(0);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
