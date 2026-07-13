/**
 * Integration tests for external ingestion and payment paths (Task 18.3).
 *
 * The design "Testing Strategy" carves the third-party integrations out of the
 * property-tested pure logic and covers them with 1–3 representative
 * integration cases each:
 *
 *   - Lab-results webhook **HL7** ingestion (Req 8.4) — the `POST
 *     /webhooks/lab-results` pipeline driven end to end through the
 *     {@link CortisolFlowCoordinator} (HMAC verify → HL7 OBX parse → unit
 *     normalization → reference-range contextualization → TimescaleDB persist →
 *     results-ready notification → dashboard/insights refresh). The JSON
 *     encoding of the same webhook is already exercised in
 *     `cortisol-flows.test.ts` (Task 18.2); here we cover the HL7 encoding.
 *   - **Epic MyChart FHIR R4** import (Req 14.4) — `GET /fhir/import` via
 *     {@link LabImportService}, including the connection-failure path that
 *     retains prior results (Req 14.5).
 *   - **Lab PDF OCR** import (Req 14.1) — `POST /lab-import` via
 *     {@link LabImportService}, including the unreadable-scan path that discards
 *     the partial extraction and retains prior results (Req 14.3).
 *   - **HealthKit / Health Connect** import (Req 9.1) — the wearable/patch sync
 *     pipeline through {@link CortisolFlowCoordinator}. HealthKit (iOS) and
 *     Health Connect (Android) surface device readings that flow through the
 *     same `POST /wearable/sync` import path; the connected device type is the
 *     sync `sourceType`.
 *   - **Stripe** kit order + payment (Req 8.1) — the kit-order/payment flow
 *     through {@link CortisolFlowCoordinator}: a successful authorize→capture
 *     charge, and a declined authorization that retains the order pending with
 *     no charge (Req 8.6).
 *
 * All external effects are exercised through the same in-memory doubles the
 * services expose for their unit tests (payment provider, lab partner, OCR
 * engine, FHIR client, imported-results store) plus the end-to-end fakes for
 * TimescaleDB persistence, the Notification Service, and dashboard/insights.
 * No recognition/scoring/ingestion logic is re-implemented here.
 *
 * Requirements: 8.1, 8.4, 9.1, 14.1, 14.4, 7.1, 7.3, 7.5
 */

import type { LabResultsWebhookRequest } from '@calorie-cortisol/shared';
import { isErr, isOk } from '@calorie-cortisol/shared/result';

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
import type { WearableSyncRequest, WearableSourceType } from '../wearable-sync';

import { LabImportService } from '../lab-import/lab-import-service';
import type {
  ExtractedLabValue,
  FhirClientPort,
  FhirImportOutcome,
  ImportedLabResult,
  ImportedResultsStore,
  LabImportDeps,
  OcrOutcome,
  OcrPort,
  ReportRenderOutcome,
  ReportRendererPort,
} from '../lab-import/ports';

import { CortisolFlowCoordinator } from './cortisol-flows';
import {
  FakeCortisolPersistence,
  FakeDashboardInsights,
  FakeNotificationPublisher,
} from './ports';

// ===========================================================================
// Shared constants
// ===========================================================================

const WEBHOOK_SECRET = 'partner-secret';
const USER_ID = 'user-42';
const ORDER_ID = 'order-1';
const KIT_CODE = 'KIT-7F3K9QZ2';

const fixedClock: Clock = { now: () => '2024-01-01T08:00:00.000Z' };
const idGen = (id = ORDER_ID): IdGenerator => ({ next: () => id });

// ===========================================================================
// Cortisol-flow coordinator harness (kit / webhook / wearable doubles)
// ===========================================================================

class FakeOrderStore implements KitOrderStore {
  readonly saved = new Map<string, KitOrder>();
  async save(order: KitOrder): Promise<void> {
    this.saved.set(order.id, order);
  }
}

class RecordingPayment implements PaymentPort {
  public captured: string[] = [];
  public voided: string[] = [];
  constructor(private readonly auth: PaymentAuthorization) {}
  async authorize(): Promise<PaymentAuthorization> {
    return this.auth;
  }
  async capture(authorizationId: string): Promise<void> {
    this.captured.push(authorizationId);
  }
  async voidAuthorization(authorizationId: string): Promise<void> {
    this.voided.push(authorizationId);
  }
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

interface CoordinatorHarness {
  coordinator: CortisolFlowCoordinator;
  persistence: FakeCortisolPersistence;
  notifications: FakeNotificationPublisher;
  insights: FakeDashboardInsights;
  payment: RecordingPayment;
}

function makeCoordinator(
  opts: {
    shipment?: LabShipmentResult;
    auth?: PaymentAuthorization;
    labIngestion?: Partial<LabIngestionDeps>;
  } = {},
): CoordinatorHarness {
  const samples = new Map<string, SampleRecord>([
    [KIT_CODE, { code: KIT_CODE, linkedUserId: null, linkedAt: null }],
  ]);

  const payment = new RecordingPayment(
    opts.auth ?? { ok: true, authorizationId: 'auth-1' },
  );

  const labKit = new LabKitService({
    payment,
    labPartner: new StubLabPartner(opts.shipment ?? { ok: true, shipmentId: 'ship-1' }),
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

  return { coordinator, persistence, notifications, insights, payment };
}

/** Sign a raw body with the partner secret, as the webhook receiver expects. */
function signedBody(request: LabResultsWebhookRequest): {
  rawBody: string;
  signature: string;
} {
  const rawBody = JSON.stringify(request);
  return { rawBody, signature: computeSignature(rawBody, WEBHOOK_SECRET) };
}

/**
 * Build a minimal HL7 v2 message with one OBR (accession → sampleId) and one
 * OBX result segment. Fields are assembled positionally so OBX-5 (value),
 * OBX-6 (units) and OBX-14 (observation datetime) land where the parser reads
 * them.
 */
function hl7Message(opts: {
  accession: string;
  value: string;
  unit: string;
  when: string;
}): string {
  const obr = ['OBR', '1', '', `${opts.accession}^LAB`].join('|');
  const obx = [
    'OBX', // 0
    '1', // 1 set id
    'NM', // 2 value type
    'CORTISOL^Cortisol', // 3 observation id
    '', // 4 sub-id
    opts.value, // 5 value
    opts.unit, // 6 units
    '', // 7 reference range
    '', // 8
    '', // 9
    'F', // 10 result status
    '', // 11
    '', // 12
    '', // 13
    opts.when, // 14 observation datetime
  ].join('|');
  return ['MSH|^~\\&|LAB|PARTNER|APP|CCT|20240101080500||ORU^R01|MSG1|P|2.5', obr, obx].join(
    '\n',
  );
}

// ===========================================================================
// Lab-import service harness (OCR / FHIR / report doubles)
// ===========================================================================

class StubOcr implements OcrPort {
  public calls = 0;
  constructor(private readonly outcome: OcrOutcome) {}
  async extract(): Promise<OcrOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

class StubFhir implements FhirClientPort {
  public calls = 0;
  constructor(private readonly outcome: FhirImportOutcome) {}
  async importResults(): Promise<FhirImportOutcome> {
    this.calls += 1;
    return this.outcome;
  }
}

class StubRenderer implements ReportRendererPort {
  constructor(private readonly outcome: ReportRenderOutcome) {}
  async render(): Promise<ReportRenderOutcome> {
    return this.outcome;
  }
}

/** In-memory imported-results store that records every append (TimescaleDB stand-in). */
class FakeResultsStore implements ImportedResultsStore {
  private readonly byUser = new Map<string, ImportedLabResult[]>();
  constructor(seed: Record<string, ImportedLabResult[]> = {}) {
    for (const [userId, results] of Object.entries(seed)) {
      this.byUser.set(userId, [...results]);
    }
  }
  async snapshot(userId: string): Promise<readonly ImportedLabResult[]> {
    return this.byUser.get(userId) ?? [];
  }
  async append(userId: string, results: readonly ImportedLabResult[]): Promise<void> {
    const current = this.byUser.get(userId) ?? [];
    this.byUser.set(userId, [...current, ...results]);
  }
  count(userId: string): number {
    return (this.byUser.get(userId) ?? []).length;
  }
}

function seqIds(prefix = 'imp'): IdGenerator {
  let n = 0;
  return { next: () => `${prefix}-${++n}` };
}

const importClock = { now: () => '2024-01-02T00:00:00.000Z' };

const sampleValues: readonly ExtractedLabValue[] = [
  { analyte: 'Cortisol, Serum', value: 15.2, unit: 'ug/dL', collectedAt: '2024-01-01T08:00:00Z' },
];

function priorImported(userId: string): ImportedLabResult {
  return {
    id: 'prior-1',
    userId,
    analyte: 'Cortisol, Serum',
    value: 12,
    unit: 'ug/dL',
    source: 'fhir',
    importedAt: '2023-12-01T00:00:00.000Z',
  };
}

function makeLabImport(overrides: {
  ocr?: OcrPort;
  fhir?: FhirClientPort;
  results?: ImportedResultsStore;
} = {}): { service: LabImportService; results: FakeResultsStore } {
  const results = (overrides.results as FakeResultsStore) ?? new FakeResultsStore();
  const deps: LabImportDeps = {
    ocr: overrides.ocr ?? new StubOcr({ ok: true, values: sampleValues }),
    fhir: overrides.fhir ?? new StubFhir({ ok: true, results: sampleValues }),
    reportRenderer: new StubRenderer({ ok: true, document: 'PDF' }),
    results,
    ids: seqIds(),
    clock: importClock,
  };
  return { service: new LabImportService(deps), results };
}

// ===========================================================================
// 1. Lab-results webhook — HL7 ingestion (Req 8.4)
// ===========================================================================

describe('External ingestion — lab-results webhook HL7 (Req 8.4)', () => {
  it('ingests a signed HL7 delivery end to end: persist → notify → refresh', async () => {
    const h = makeCoordinator();
    const request: LabResultsWebhookRequest = {
      orderId: ORDER_ID,
      labPartnerId: 'lab-1',
      format: 'HL7',
      rawMessage: hl7Message({
        accession: 'ACC12345',
        value: '15.2',
        unit: 'nmol/L',
        when: '20240101080000',
      }),
    };
    const { rawBody, signature } = signedBody(request);

    const outcome = await h.coordinator.ingestLabResults(rawBody, signature);

    expect(outcome.statusCode).toBe(200);
    expect(outcome.body.status).toBe('accepted');
    expect(outcome.body.acceptedCount).toBe(1);

    // Persisted to TimescaleDB, normalized + contextualized by the module.
    expect(h.persistence.cortisolReadings).toHaveLength(1);
    const [saved] = h.persistence.cortisolReadings;
    expect(saved.userId).toBe(USER_ID);
    expect(saved.source).toBe('lab');
    expect(saved.valueNmolL).toBeCloseTo(15.2, 5);

    // Results-ready notification + dashboard/insights refresh fanned out.
    const ready = h.notifications.ofType('labResultsReady');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ userId: USER_ID, orderId: ORDER_ID, acceptedCount: 1 });
    expect(h.insights.updates).toContainEqual({ userId: USER_ID, kind: 'labResult' });
  });

  it('retains the order results-pending (no persist/notify) for an HL7 message with no OBX results', async () => {
    const h = makeCoordinator();
    const request: LabResultsWebhookRequest = {
      orderId: ORDER_ID,
      labPartnerId: 'lab-1',
      format: 'HL7',
      rawMessage: 'MSH|^~\\&|LAB|PARTNER|APP|CCT|20240101080500||ORU^R01|MSG1|P|2.5',
    };
    const { rawBody, signature } = signedBody(request);

    const outcome = await h.coordinator.ingestLabResults(rawBody, signature);

    expect(outcome.body.status).toBe('results-pending');
    expect(h.persistence.cortisolReadings).toHaveLength(0);
    expect(h.notifications.published).toHaveLength(0);
    expect(h.insights.updates).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Epic MyChart FHIR R4 import (Req 14.4, 14.5)
// ===========================================================================

describe('External ingestion — Epic MyChart FHIR R4 (Req 14.4)', () => {
  it('imports results from a connected Epic MyChart account', async () => {
    const { service, results } = makeLabImport({
      fhir: new StubFhir({ ok: true, results: sampleValues, elapsedMs: 1200 }),
    });

    const outcome = await service.importFromFhir({ userId: USER_ID, connectionId: 'epic-1' });

    expect(isOk(outcome)).toBe(true);
    if (isOk(outcome)) {
      expect(outcome.value.source).toBe('fhir');
      expect(outcome.value.importedCount).toBe(1);
    }
    expect(results.count(USER_ID)).toBe(1);
  });

  it('retains prior results when the Epic MyChart connection fails (Req 14.5)', async () => {
    const store = new FakeResultsStore({ [USER_ID]: [priorImported(USER_ID)] });
    const { service } = makeLabImport({
      fhir: new StubFhir({ ok: false, reason: 'connection-failed' }),
      results: store,
    });

    const outcome = await service.importFromFhir({ userId: USER_ID });

    expect(isErr(outcome)).toBe(true);
    if (isErr(outcome)) {
      expect(outcome.error.retryable).toBe(true);
    }
    // Prior results untouched (append never invoked on the failure path).
    expect(store.count(USER_ID)).toBe(1);
  });
});

// ===========================================================================
// 3. Lab PDF OCR import (Req 14.1, 14.3)
// ===========================================================================

describe('External ingestion — lab PDF OCR (Req 14.1)', () => {
  const validUpload = { userId: USER_ID, contentType: 'application/pdf', sizeBytes: 1024 };

  it('extracts and imports values from a valid PDF upload', async () => {
    const { service, results } = makeLabImport({
      ocr: new StubOcr({ ok: true, values: sampleValues, elapsedMs: 800 }),
    });

    const outcome = await service.importPdf(validUpload);

    expect(isOk(outcome)).toBe(true);
    if (isOk(outcome)) {
      expect(outcome.value.source).toBe('pdf');
      expect(outcome.value.importedCount).toBe(1);
    }
    expect(results.count(USER_ID)).toBe(1);
  });

  it('discards the partial extraction and retains prior results when OCR is unreadable (Req 14.3)', async () => {
    const store = new FakeResultsStore({ [USER_ID]: [priorImported(USER_ID)] });
    const { service } = makeLabImport({
      ocr: new StubOcr({ ok: false, reason: 'unreadable' }),
      results: store,
    });

    const outcome = await service.importPdf(validUpload);

    expect(isErr(outcome)).toBe(true);
    expect(store.count(USER_ID)).toBe(1);
  });
});

// ===========================================================================
// 4. HealthKit / Health Connect import (Req 9.1)
// ===========================================================================

describe('External ingestion — HealthKit / Health Connect (Req 9.1)', () => {
  const syncRequest = (sourceType: WearableSourceType): WearableSyncRequest => ({
    userId: USER_ID,
    sourceType,
    connectionStatus: 'active',
    authorizedCategories: ['cortisol'],
    readings: [
      {
        category: 'cortisol',
        metricType: 'patchCortisol',
        value: 12.5,
        unit: 'ng/mL',
        capturedAt: '2024-01-01T08:00:00.000Z',
        sourceId: 'device-9',
      },
      // Out-of-range reading is recorded invalid without dropping the valid one.
      {
        category: 'cortisol',
        metricType: 'patchCortisol',
        value: 999,
        unit: 'ng/mL',
        capturedAt: '2024-01-01T09:00:00.000Z',
      },
    ],
  });

  it('imports Oura readings surfaced through HealthKit (iOS) end to end', async () => {
    const h = makeCoordinator();

    const result = await h.coordinator.syncWearableReadings(syncRequest('oura'));

    expect(result.status).toBe('synced');
    expect(result.accepted).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);

    expect(h.persistence.wearableProxyReadings).toHaveLength(1);
    expect(h.persistence.wearableProxyReadings[0]).toMatchObject({
      userId: USER_ID,
      sourceId: 'device-9',
      deviceType: 'oura',
    });
    expect(h.insights.updates).toContainEqual({ userId: USER_ID, kind: 'wearableProxy' });
    expect(h.notifications.ofType('syncFailureNotice')).toHaveLength(0);
  });

  it('imports Garmin readings surfaced through Health Connect (Android) end to end', async () => {
    const h = makeCoordinator();

    const result = await h.coordinator.syncWearableReadings(syncRequest('garmin'));

    expect(result.status).toBe('synced');
    expect(h.persistence.wearableProxyReadings).toHaveLength(1);
    expect(h.persistence.wearableProxyReadings[0].deviceType).toBe('garmin');
    expect(h.insights.updates).toContainEqual({ userId: USER_ID, kind: 'wearableProxy' });
  });
});

// ===========================================================================
// 5. Stripe kit order + payment (Req 8.1, 8.6)
// ===========================================================================

describe('Payment path — Stripe kit order (Req 8.1)', () => {
  it('authorizes then captures the charge on a successful order', async () => {
    const h = makeCoordinator();

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
    // The hold was captured (charged) exactly once, and never voided.
    expect(h.payment.captured).toEqual(['auth-1']);
    expect(h.payment.voided).toEqual([]);
  });

  it('retains the order pending with no charge when payment authorization is declined (Req 8.6)', async () => {
    const h = makeCoordinator({ auth: { ok: false, reason: 'card_declined' } });

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
    // A declined authorization is never captured.
    expect(h.payment.captured).toEqual([]);
  });
});
