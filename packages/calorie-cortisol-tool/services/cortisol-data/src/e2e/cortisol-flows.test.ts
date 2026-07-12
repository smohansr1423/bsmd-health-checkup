/**
 * End-to-end composition tests for the cortisol flows (Task 18.2).
 *
 * These exercise the wiring in {@link CortisolFlowCoordinator} across module
 * boundaries with in-memory fakes for persistence (TimescaleDB), the
 * Notification Service, and the dashboard/insights refresh:
 *
 *   - Flow 2: kit order → QR link → signed lab-results webhook → readings
 *     persisted → results-ready notification → dashboard/insights refresh.
 *   - Flow 3: wearable sync → valid proxy readings persisted → refresh, and a
 *     revoked connection emits a wearable sync-failure notice.
 *   - CAR diurnal-deviation alerting fans a flattened-CAR alert to the
 *     Notification Service.
 *
 * The upstream ingestion/scoring logic is not re-implemented here; the tests
 * assert that the coordinator composes the existing modules and drives their
 * validated output through the injected ports.
 *
 * Requirements: 8.1, 8.4, 9.1, 10.1, 11.1
 */

import type { LabResultsWebhookRequest } from '@calorie-cortisol/shared';
import { isOk } from '@calorie-cortisol/shared/result';

import { LabKitService } from '../lab/kit-service';
import type {
  Clock,
  IdGenerator,
  KitOrder,
  KitOrderStore,
  LabPartnerPort,
  LabShipmentResult,
  PaymentAuthorization,
  PaymentPort,
  SampleLinkStore,
  SampleRecord,
} from '../lab/ports';
import { computeSignature } from '../lab-ingestion/hmac';
import type { LabIngestionDeps } from '../lab-ingestion/ingest';
import type { WearableSyncRequest } from '../wearable-sync';
import type { CarSubmission } from '../car/car';

import { CortisolFlowCoordinator } from './cortisol-flows';
import {
  FakeCortisolPersistence,
  FakeDashboardInsights,
  FakeNotificationPublisher,
} from './ports';

// ---------------------------------------------------------------------------
// Lab-kit in-memory doubles
// ---------------------------------------------------------------------------

class FakeOrderStore implements KitOrderStore {
  readonly saved = new Map<string, KitOrder>();
  async save(order: KitOrder): Promise<void> {
    this.saved.set(order.id, order);
  }
}

class StubPayment implements PaymentPort {
  constructor(private readonly auth: PaymentAuthorization) {}
  async authorize(): Promise<PaymentAuthorization> {
    return this.auth;
  }
  async capture(): Promise<void> {}
  async voidAuthorization(): Promise<void> {}
}

class StubLabPartner implements LabPartnerPort {
  constructor(private readonly result: LabShipmentResult) {}
  async initiateShipment(): Promise<LabShipmentResult> {
    return this.result;
  }
}

class FakeSampleStore implements SampleLinkStore {
  constructor(private readonly records: Map<string, SampleRecord>) {}
  async findByCode(code: string): Promise<SampleRecord | null> {
    return this.records.get(code) ?? null;
  }
  async link(code: string, userId: string, linkedAt: string): Promise<SampleRecord> {
    const updated: SampleRecord = { code, linkedUserId: userId, linkedAt };
    this.records.set(code, updated);
    return updated;
  }
}

const WEBHOOK_SECRET = 'partner-secret';
const USER_ID = 'user-42';
const ORDER_ID = 'order-1';
const KIT_CODE = 'KIT-7F3K9QZ2';

const fixedClock: Clock = { now: () => '2024-01-01T08:00:00.000Z' };
const idGen = (id = ORDER_ID): IdGenerator => ({ next: () => id });

function signed(request: LabResultsWebhookRequest): {
  rawBody: string;
  signature: string;
} {
  const rawBody = JSON.stringify(request);
  return { rawBody, signature: computeSignature(rawBody, WEBHOOK_SECRET) };
}

interface Harness {
  coordinator: CortisolFlowCoordinator;
  persistence: FakeCortisolPersistence;
  notifications: FakeNotificationPublisher;
  insights: FakeDashboardInsights;
  samples: Map<string, SampleRecord>;
}

function makeHarness(
  opts: {
    shipment?: LabShipmentResult;
    auth?: PaymentAuthorization;
    labIngestion?: Partial<LabIngestionDeps>;
  } = {},
): Harness {
  const samples = new Map<string, SampleRecord>([
    [KIT_CODE, { code: KIT_CODE, linkedUserId: null, linkedAt: null }],
  ]);

  const labKit = new LabKitService({
    payment: new StubPayment(opts.auth ?? { ok: true, authorizationId: 'auth-1' }),
    labPartner: new StubLabPartner(
      opts.shipment ?? { ok: true, shipmentId: 'ship-1' },
    ),
    orders: new FakeOrderStore(),
    samples: new FakeSampleStore(samples),
    ids: idGen(),
    clock: fixedClock,
  });

  const persistence = new FakeCortisolPersistence();
  const notifications = new FakeNotificationPublisher();
  const insights = new FakeDashboardInsights();

  const labIngestion: LabIngestionDeps = {
    webhookSecret: WEBHOOK_SECRET,
    resolveUser: () => ({ userId: USER_ID, age: 40, sex: 'F' }),
    now: () => new Date('2024-01-02T00:00:00Z'),
    utcOffsetMinutes: 0,
    ...opts.labIngestion,
  };

  const coordinator = new CortisolFlowCoordinator({
    labKit,
    labIngestion,
    persistence,
    notifications,
    insights,
  });

  return { coordinator, persistence, notifications, insights, samples };
}

// ---------------------------------------------------------------------------
// Flow 2 — Lab Kit → Cortisol Result
// ---------------------------------------------------------------------------

describe('Flow 2: kit order → link → lab-result webhook → notification (Req 8.1, 8.4)', () => {
  const labResults: LabResultsWebhookRequest = {
    orderId: ORDER_ID,
    labPartnerId: 'lab-1',
    format: 'JSON',
    readings: [
      {
        sampleId: 's1',
        collectedAt: '2024-01-01T08:00:00Z',
        value: 12,
        unit: 'nmol/L',
        timeOfDayBucket: 'morning',
      },
    ],
  };

  it('drives the whole flow end to end', async () => {
    const h = makeHarness();

    // 1. Order a kit (Req 8.1).
    const order = await h.coordinator.orderKit({
      userId: USER_ID,
      kitType: 'diurnal',
      amountCents: 9900,
    });
    expect(order.ok).toBe(true);
    if (order.ok) {
      expect(order.confirmation.orderId).toBe(ORDER_ID);
      expect(order.confirmation.charged).toBe(true);
    }

    // 2. Link the scanned QR sample (Req 8.2).
    const link = await h.coordinator.linkSample({ userId: USER_ID, code: KIT_CODE });
    expect(isOk(link)).toBe(true);
    expect(h.samples.get(KIT_CODE)?.linkedUserId).toBe(USER_ID);

    // 3. Ingest the signed lab-results webhook (Req 8.4).
    const { rawBody, signature } = signed(labResults);
    const outcome = await h.coordinator.ingestLabResults(rawBody, signature);
    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.status).toBe('accepted');
    expect(outcome.body.acceptedCount).toBe(1);

    // 4. Readings persisted to TimescaleDB (contextualized by the module).
    expect(h.persistence.cortisolReadings).toHaveLength(1);
    const [saved] = h.persistence.cortisolReadings;
    expect(saved.userId).toBe(USER_ID);
    expect(saved.source).toBe('lab');
    expect(saved.contextualized?.classification).toBeDefined();

    // 5. Results-ready notification emitted to the Notification Service.
    const ready = h.notifications.ofType('labResultsReady');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      userId: USER_ID,
      orderId: ORDER_ID,
      acceptedCount: 1,
    });

    // 6. Dashboard / insights refresh triggered.
    expect(h.insights.updates).toContainEqual({ userId: USER_ID, kind: 'labResult' });
  });

  it('retains the order without charge when the lab partner is unavailable (Req 8.6)', async () => {
    const h = makeHarness({ shipment: { ok: false, reason: 'unavailable' } });
    const order = await h.coordinator.orderKit({
      userId: USER_ID,
      kitType: 'single',
      amountCents: 4900,
    });
    expect(order.ok).toBe(false);
    if (!order.ok) {
      expect(order.charged).toBe(false);
      expect(order.pendingOrderId).toBe(ORDER_ID);
    }
  });

  it('does not persist or notify when the webhook signature is invalid (Req 8.4)', async () => {
    const h = makeHarness();
    const { rawBody } = signed(labResults);
    const outcome = await h.coordinator.ingestLabResults(rawBody, 'deadbeef');
    expect(outcome.statusCode).toBe(401);
    expect(h.persistence.cortisolReadings).toHaveLength(0);
    expect(h.notifications.published).toHaveLength(0);
    expect(h.insights.updates).toHaveLength(0);
  });

  it('does not persist or notify on a results-pending outcome (Req 8.8)', async () => {
    const h = makeHarness();
    const { rawBody, signature } = signed({
      orderId: ORDER_ID,
      labPartnerId: 'lab-1',
      format: 'JSON',
      readings: [],
    });
    const outcome = await h.coordinator.ingestLabResults(rawBody, signature);
    expect(outcome.body.status).toBe('results-pending');
    expect(h.persistence.cortisolReadings).toHaveLength(0);
    expect(h.notifications.published).toHaveLength(0);
    expect(h.insights.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Flow 3 — Wearable → Cortisol Proxy
// ---------------------------------------------------------------------------

describe('Flow 3: wearable sync → proxy persistence (Req 9.1)', () => {
  const activeRequest = (
    over: Partial<WearableSyncRequest> = {},
  ): WearableSyncRequest => ({
    userId: USER_ID,
    sourceType: 'oura',
    connectionStatus: 'active',
    authorizedCategories: ['cortisol'],
    readings: [
      {
        category: 'cortisol',
        metricType: 'patchCortisol',
        value: 12.5,
        unit: 'ng/mL',
        capturedAt: '2024-01-01T08:00:00.000Z',
        sourceId: 'oura-ring-9',
      },
      // Invalid (out of range) — kept out of persistence, valid ones retained.
      {
        category: 'cortisol',
        metricType: 'patchCortisol',
        value: 999,
        unit: 'ng/mL',
        capturedAt: '2024-01-01T09:00:00.000Z',
      },
    ],
    ...over,
  });

  it('persists accepted proxy readings and refreshes insights', async () => {
    const h = makeHarness();
    const result = await h.coordinator.syncWearableReadings(activeRequest());

    expect(result.status).toBe('synced');
    expect(result.accepted).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);

    // Only the valid, tagged reading is persisted to the proxy series.
    expect(h.persistence.wearableProxyReadings).toHaveLength(1);
    expect(h.persistence.wearableProxyReadings[0]).toMatchObject({
      userId: USER_ID,
      sourceId: 'oura-ring-9',
      deviceType: 'oura',
    });

    expect(h.insights.updates).toContainEqual({
      userId: USER_ID,
      kind: 'wearableProxy',
    });
    // Active connection → no sync-failure notice.
    expect(h.notifications.ofType('syncFailureNotice')).toHaveLength(0);
  });

  it('emits a sync-failure notice and persists nothing on a revoked connection (Req 9.7, 9.8)', async () => {
    const h = makeHarness();
    const result = await h.coordinator.syncWearableReadings(
      activeRequest({ connectionStatus: 'revoked' }),
    );

    expect(result.status).toBe('inactive');
    expect(h.persistence.wearableProxyReadings).toHaveLength(0);

    const failures = h.notifications.ofType('syncFailureNotice');
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      userId: USER_ID,
      category: 'wearable:oura',
      operation: 'wearableSync',
    });
    expect(h.insights.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CAR diurnal-deviation alerting (Req 11.1, 11.5)
// ---------------------------------------------------------------------------

describe('CAR submission → persistence + deviation alert (Req 11.1)', () => {
  it('persists the measurement and fans a flattened-CAR alert to notifications', async () => {
    const h = makeHarness();

    // A flattened CAR: sample 2 only marginally above sample 1 (<50% rise).
    const submission: CarSubmission = {
      userId: USER_ID,
      wakeTime: '2024-01-01T06:00:00.000Z',
      sample1: { at: '2024-01-01T06:10:00.000Z', value: 10 },
      sample2: { at: '2024-01-01T06:40:00.000Z', value: 11 },
    };

    const outcome = await h.coordinator.submitCar(submission);
    expect(isOk(outcome)).toBe(true);
    expect(h.persistence.carMeasurements).toHaveLength(1);
    expect(h.insights.updates).toContainEqual({ userId: USER_ID, kind: 'car' });

    const alerts = h.notifications.ofType('deviationAlert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].cause).toBe('flattenedCAR');
  });

  it('does not persist or alert on an invalid CAR submission', async () => {
    const h = makeHarness();
    const outcome = await h.coordinator.submitCar({
      userId: '',
      wakeTime: 'not-a-time',
    });
    expect(isOk(outcome)).toBe(false);
    expect(h.persistence.carMeasurements).toHaveLength(0);
    expect(h.notifications.published).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Questionnaire proxy (Req 10.1)
// ---------------------------------------------------------------------------

describe('Questionnaire submission → persistence (Req 10.1)', () => {
  it('persists a complete PSS-10 submission and refreshes insights', async () => {
    const h = makeHarness();
    const answers = Array.from({ length: 10 }, () => 2);

    const outcome = await h.coordinator.submitQuestionnaire({
      type: 'PSS-10',
      answers,
      userId: USER_ID,
    });

    expect(outcome.ok).toBe(true);
    expect(h.persistence.questionnaireResults).toHaveLength(1);
    expect(h.persistence.questionnaireResults[0].userId).toBe(USER_ID);
    expect(h.insights.updates).toContainEqual({
      userId: USER_ID,
      kind: 'questionnaire',
    });
  });

  it('does not persist an incomplete submission (Req 10.2)', async () => {
    const h = makeHarness();
    const outcome = await h.coordinator.submitQuestionnaire({
      type: 'PSS-10',
      answers: [1, 2, 3],
      userId: USER_ID,
    });
    expect(outcome.ok).toBe(false);
    expect(h.persistence.questionnaireResults).toHaveLength(0);
    expect(h.insights.updates).toHaveLength(0);
  });
});
