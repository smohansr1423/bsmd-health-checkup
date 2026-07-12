import { isErr, isOk } from '@calorie-cortisol/shared/result';

import { KitErrorCode } from './errors';
import { LabKitService } from './kit-service';
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
} from './ports';

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

class FakeOrderStore implements KitOrderStore {
  readonly saved = new Map<string, KitOrder>();

  async save(order: KitOrder): Promise<void> {
    this.saved.set(order.id, order);
  }

  get(id: string): KitOrder | undefined {
    return this.saved.get(id);
  }
}

class RecordingPayment implements PaymentPort {
  authorizeCalls = 0;
  captureCalls: string[] = [];
  voidCalls: string[] = [];

  constructor(private readonly authResult: PaymentAuthorization) {}

  async authorize(): Promise<PaymentAuthorization> {
    this.authorizeCalls += 1;
    return this.authResult;
  }

  async capture(authorizationId: string): Promise<void> {
    this.captureCalls.push(authorizationId);
  }

  async voidAuthorization(authorizationId: string): Promise<void> {
    this.voidCalls.push(authorizationId);
  }
}

class StubLabPartner implements LabPartnerPort {
  calls = 0;

  constructor(private readonly result: LabShipmentResult) {}

  async initiateShipment(): Promise<LabShipmentResult> {
    this.calls += 1;
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

  snapshot(code: string): SampleRecord | undefined {
    return this.records.get(code);
  }
}

const fixedClock: Clock = { now: () => '2024-01-01T08:00:00.000Z' };
const idGen = (id = 'order-1'): IdGenerator => ({ next: () => id });

function makeService(overrides: {
  payment?: PaymentPort;
  labPartner?: LabPartnerPort;
  orders?: KitOrderStore;
  samples?: SampleLinkStore;
  ids?: IdGenerator;
  clock?: Clock;
}) {
  return new LabKitService({
    payment: overrides.payment ?? new RecordingPayment({ ok: true, authorizationId: 'auth-1' }),
    labPartner: overrides.labPartner ?? new StubLabPartner({ ok: true, shipmentId: 'ship-1' }),
    orders: overrides.orders ?? new FakeOrderStore(),
    samples: overrides.samples ?? new FakeSampleStore(new Map()),
    ids: overrides.ids ?? idGen(),
    clock: overrides.clock ?? fixedClock,
  });
}

// ---------------------------------------------------------------------------
// orderKit (Req 8.1, 8.6)
// ---------------------------------------------------------------------------

describe('LabKitService.orderKit', () => {
  it('confirms the order with a unique id, charges the user, and initiates shipment (Req 8.1)', async () => {
    const payment = new RecordingPayment({ ok: true, authorizationId: 'auth-1' });
    const labPartner = new StubLabPartner({ ok: true, shipmentId: 'ship-1' });
    const orders = new FakeOrderStore();
    const service = makeService({ payment, labPartner, orders, ids: idGen('order-42') });

    const result = await service.orderKit({ userId: 'u1', kitType: 'diurnal', amountCents: 9900 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.confirmation.orderId).toBe('order-42');
      expect(result.confirmation.status).toBe('confirmed');
      expect(result.confirmation.shipmentId).toBe('ship-1');
      expect(result.confirmation.charged).toBe(true);
    }
    expect(payment.captureCalls).toEqual(['auth-1']);
    expect(payment.voidCalls).toEqual([]);
    expect(labPartner.calls).toBe(1);

    const persisted = orders.get('order-42');
    expect(persisted?.status).toBe('confirmed');
    expect(persisted?.charged).toBe(true);
  });

  it('retains a pending order with no charge when the lab partner is unavailable (Req 8.6)', async () => {
    const payment = new RecordingPayment({ ok: true, authorizationId: 'auth-1' });
    const labPartner = new StubLabPartner({ ok: false, reason: 'unavailable' });
    const orders = new FakeOrderStore();
    const service = makeService({ payment, labPartner, orders, ids: idGen('order-7') });

    const result = await service.orderKit({ userId: 'u1', kitType: 'single', amountCents: 4900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(KitErrorCode.ORDER_LAB_UNAVAILABLE);
      expect(result.charged).toBe(false);
      expect(result.pendingOrderId).toBe('order-7');
      expect(result.error.retainedState).toBe(true);
    }
    // No charge: the hold was released, never captured.
    expect(payment.captureCalls).toEqual([]);
    expect(payment.voidCalls).toEqual(['auth-1']);

    const persisted = orders.get('order-7');
    expect(persisted?.status).toBe('pending');
    expect(persisted?.charged).toBe(false);
  });

  it('retains a pending order with no charge when the lab partner rejects the order (Req 8.6)', async () => {
    const payment = new RecordingPayment({ ok: true, authorizationId: 'auth-1' });
    const labPartner = new StubLabPartner({ ok: false, reason: 'rejected' });
    const orders = new FakeOrderStore();
    const service = makeService({ payment, labPartner, orders, ids: idGen('order-8') });

    const result = await service.orderKit({ userId: 'u1', kitType: 'single', amountCents: 4900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(KitErrorCode.ORDER_LAB_UNAVAILABLE);
      expect(result.charged).toBe(false);
      expect(result.pendingOrderId).toBe('order-8');
    }
    expect(payment.captureCalls).toEqual([]);
    expect(payment.voidCalls).toEqual(['auth-1']);
    expect(orders.get('order-8')?.status).toBe('pending');
  });

  it('retains a pending order with no charge when payment authorization fails (Req 8.6)', async () => {
    const payment = new RecordingPayment({ ok: false, reason: 'card_declined' });
    const labPartner = new StubLabPartner({ ok: true, shipmentId: 'ship-1' });
    const orders = new FakeOrderStore();
    const service = makeService({ payment, labPartner, orders, ids: idGen('order-9') });

    const result = await service.orderKit({ userId: 'u1', kitType: 'single', amountCents: 4900 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(KitErrorCode.ORDER_PAYMENT_FAILED);
      expect(result.charged).toBe(false);
      expect(result.pendingOrderId).toBe('order-9');
    }
    // Never reached the lab partner; nothing captured or voided.
    expect(labPartner.calls).toBe(0);
    expect(payment.captureCalls).toEqual([]);
    expect(orders.get('order-9')?.status).toBe('pending');
  });

  it.each([
    { name: 'empty userId', req: { userId: '', kitType: 'single' as const, amountCents: 4900 } },
    { name: 'zero amount', req: { userId: 'u1', kitType: 'single' as const, amountCents: 0 } },
    { name: 'negative amount', req: { userId: 'u1', kitType: 'single' as const, amountCents: -100 } },
    { name: 'non-integer amount', req: { userId: 'u1', kitType: 'single' as const, amountCents: 49.5 } },
  ])('rejects an invalid order request ($name) without creating an order or charging', async ({ req }) => {
    const payment = new RecordingPayment({ ok: true, authorizationId: 'auth-1' });
    const orders = new FakeOrderStore();
    const service = makeService({ payment, orders });

    const result = await service.orderKit(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(KitErrorCode.ORDER_INVALID_REQUEST);
      expect(result.pendingOrderId).toBeNull();
      expect(result.charged).toBe(false);
    }
    expect(payment.authorizeCalls).toBe(0);
    expect(orders.saved.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// linkSample (Req 8.2, 8.7)
// ---------------------------------------------------------------------------

describe('LabKitService.linkSample', () => {
  it('links a valid, unused QR code and returns a confirmation identifying the kit (Req 8.2)', async () => {
    const samples = new FakeSampleStore(
      new Map([['KIT-ABCD1234', { code: 'KIT-ABCD1234', linkedUserId: null, linkedAt: null }]]),
    );
    const service = makeService({ samples });

    const result = await service.linkSample({ userId: 'u1', code: 'KIT-ABCD1234' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.code).toBe('KIT-ABCD1234');
      expect(result.value.userId).toBe('u1');
      expect(result.value.alreadyLinked).toBe(false);
    }
    expect(samples.snapshot('KIT-ABCD1234')?.linkedUserId).toBe('u1');
  });

  it('rejects a malformed QR code without touching the registry (Req 8.7)', async () => {
    const samples = new FakeSampleStore(new Map());
    const service = makeService({ samples });

    const result = await service.linkSample({ userId: 'u1', code: 'not-a-kit-code' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(KitErrorCode.QR_INVALID);
      expect(result.error.retainedState).toBe(true);
    }
  });

  it('rejects an unrecognized (well-formed but unknown) QR code (Req 8.7)', async () => {
    const samples = new FakeSampleStore(new Map());
    const service = makeService({ samples });

    const result = await service.linkSample({ userId: 'u1', code: 'KIT-ZZZZ9999' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(KitErrorCode.QR_UNRECOGNIZED);
    }
  });

  it('rejects a code already linked to another account and leaves the association unchanged (Req 8.7 / Property 19)', async () => {
    const samples = new FakeSampleStore(
      new Map([
        ['KIT-ABCD1234', { code: 'KIT-ABCD1234', linkedUserId: 'owner', linkedAt: '2023-12-31T00:00:00.000Z' }],
      ]),
    );
    const service = makeService({ samples });

    const result = await service.linkSample({ userId: 'intruder', code: 'KIT-ABCD1234' });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(KitErrorCode.QR_ALREADY_LINKED);
    }
    // Existing association untouched.
    const snap = samples.snapshot('KIT-ABCD1234');
    expect(snap?.linkedUserId).toBe('owner');
    expect(snap?.linkedAt).toBe('2023-12-31T00:00:00.000Z');
  });

  it('is an idempotent no-op when the same user re-links their own code (Req 8.7)', async () => {
    const samples = new FakeSampleStore(
      new Map([
        ['KIT-ABCD1234', { code: 'KIT-ABCD1234', linkedUserId: 'u1', linkedAt: '2023-12-31T00:00:00.000Z' }],
      ]),
    );
    const service = makeService({ samples });

    const result = await service.linkSample({ userId: 'u1', code: 'KIT-ABCD1234' });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.alreadyLinked).toBe(true);
      expect(result.value.linkedAt).toBe('2023-12-31T00:00:00.000Z');
    }
    // Association unchanged.
    expect(samples.snapshot('KIT-ABCD1234')?.linkedUserId).toBe('u1');
  });

  it('rejects a link request missing a userId or code', async () => {
    const service = makeService({});

    const missingUser = await service.linkSample({ userId: '', code: 'KIT-ABCD1234' });
    const missingCode = await service.linkSample({ userId: 'u1', code: '' });

    expect(isErr(missingUser)).toBe(true);
    expect(isErr(missingCode)).toBe(true);
    if (isErr(missingUser)) {
      expect(missingUser.error.code).toBe(KitErrorCode.QR_INVALID_REQUEST);
    }
  });
});
