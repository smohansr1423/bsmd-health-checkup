import fc from 'fast-check';
import { isErr, isOk } from '@calorie-cortisol/shared/result';

import { KitErrorCode } from './errors';
import { LabKitService } from './kit-service';
import { isWellFormedKitCode } from './qr-code';
import type {
  Clock,
  IdGenerator,
  KitOrder,
  KitOrderStore,
  LabPartnerPort,
  PaymentPort,
  SampleLinkStore,
  SampleRecord,
} from './ports';

/**
 * Property 19: QR linkage never overwrites an existing association
 * Validates: Requirements 8.2, 8.7
 * Feature: calorie-cortisol-tool, Property 19
 *
 * For any QR scan, a valid *unused* code links the sample to the scanning
 * user's account (Req 8.2); an *invalid*, *unrecognized*, or *already-linked*
 * code is rejected and leaves any existing account-to-sample association
 * unchanged (Req 8.7).
 *
 * The test drives {@link LabKitService.linkSample} over a randomly generated
 * sample registry and scan request, then checks the outcome against an
 * INDEPENDENT oracle derived from the *prior* registry state — never from the
 * implementation's own result. The registry is deep-snapshotted before the call
 * so we can assert, byte-for-byte, that every account-to-sample association is
 * unchanged on every rejection (and that only the scanned code changes on a
 * successful first link).
 */

// ---------------------------------------------------------------------------
// In-memory sample store (mirrors the unit-test double) with change tracking
// ---------------------------------------------------------------------------

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

  /** Stable, order-independent snapshot of the whole association table. */
  snapshot(): string {
    return JSON.stringify(
      [...this.records.entries()]
        .map(([code, rec]) => [code, rec.linkedUserId, rec.linkedAt] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    );
  }

  get(code: string): SampleRecord | undefined {
    return this.records.get(code);
  }
}

// Unused ports for linkSample — the constructor requires the full dep set, but
// linkage never touches payment, the lab partner, the order store, or ids.
const unusedPayment: PaymentPort = {
  authorize: async () => {
    throw new Error('payment must not be used during linkSample');
  },
  capture: async () => {
    throw new Error('payment must not be used during linkSample');
  },
  voidAuthorization: async () => {
    throw new Error('payment must not be used during linkSample');
  },
};
const unusedLabPartner: LabPartnerPort = {
  initiateShipment: async () => {
    throw new Error('lab partner must not be used during linkSample');
  },
};
const unusedOrders: KitOrderStore = {
  save: async (_order: KitOrder) => {
    throw new Error('order store must not be used during linkSample');
  },
};
const unusedIds: IdGenerator = {
  next: () => {
    throw new Error('id generator must not be used during linkSample');
  },
};
const fixedClock: Clock = { now: () => '2024-06-01T09:30:00.000Z' };

function makeService(samples: SampleLinkStore): LabKitService {
  return new LabKitService({
    payment: unusedPayment,
    labPartner: unusedLabPartner,
    orders: unusedOrders,
    samples,
    ids: unusedIds,
    clock: fixedClock,
  });
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const KIT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/** A structurally well-formed kit code: `KIT-` + >=8 uppercase alphanumerics. */
const wellFormedCodeArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...KIT_CHARS), { minLength: 8, maxLength: 12 })
  .map((cs) => `KIT-${cs.join('')}`);

/** A non-empty code that is NOT a well-formed kit code (invalid QR, Req 8.7). */
const malformedCodeArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 16 })
  .filter((s) => s.trim().length > 0 && !isWellFormedKitCode(s));

/** A small pool of account identifiers so owner/scanner collisions are likely. */
const userIdArb: fc.Arbitrary<string> = fc.constantFrom(
  'userA',
  'userB',
  'userC',
  'userD',
);

const isoTimestampArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2023-01-01T00:00:00.000Z'), max: new Date('2024-05-31T23:59:59.000Z') })
  .map((d) => d.toISOString());

/**
 * A registry entry for a well-formed code that is either unlinked or already
 * linked to some owner.
 */
const registryEntryArb: fc.Arbitrary<SampleRecord> = fc.oneof(
  wellFormedCodeArb.map((code) => ({ code, linkedUserId: null, linkedAt: null })),
  fc.tuple(wellFormedCodeArb, userIdArb, isoTimestampArb).map(([code, owner, at]) => ({
    code,
    linkedUserId: owner,
    linkedAt: at,
  })),
);

/**
 * A whole scenario: a registry (unique codes), a scanning user, and the code
 * being scanned. The scanned code is drawn from three disjoint populations so
 * all Req 8.7 rejection paths and the Req 8.2 success path are exercised:
 *   - a code already in the registry (unlinked | same-owner | other-owner),
 *   - a fresh well-formed code that is NOT in the registry (unrecognized),
 *   - a malformed code (invalid).
 */
const scenarioArb = fc
  .array(registryEntryArb, { minLength: 0, maxLength: 8 })
  .chain((entries) => {
    // De-duplicate by code so the registry is a well-formed map.
    const byCode = new Map<string, SampleRecord>();
    for (const e of entries) byCode.set(e.code, e);
    const registryCodes = [...byCode.keys()];

    const targetFromRegistry =
      registryCodes.length > 0 ? fc.constantFrom(...registryCodes) : undefined;

    const freshWellFormed = wellFormedCodeArb.filter((c) => !byCode.has(c));

    const targetArb = fc.oneof(
      ...(targetFromRegistry ? [targetFromRegistry] : []),
      freshWellFormed,
      malformedCodeArb,
    );

    return fc.record({
      entries: fc.constant([...byCode.values()]),
      userId: userIdArb,
      code: targetArb,
    });
  });

// ---------------------------------------------------------------------------
// Oracle: expected outcome purely from the PRIOR registry state
// ---------------------------------------------------------------------------

type Expectation =
  | { kind: 'invalid' }
  | { kind: 'unrecognized' }
  | { kind: 'link'; owner: string; at: string }
  | { kind: 'alreadyOtherOwner' }
  | { kind: 'idempotent'; at: string };

function expectationFor(
  prior: Map<string, SampleRecord>,
  userId: string,
  code: string,
): Expectation {
  if (!isWellFormedKitCode(code)) return { kind: 'invalid' };
  const rec = prior.get(code);
  if (rec === undefined) return { kind: 'unrecognized' };
  if (rec.linkedUserId === null) return { kind: 'link', owner: userId, at: fixedClock.now() };
  if (rec.linkedUserId === userId && rec.linkedAt !== null) {
    return { kind: 'idempotent', at: rec.linkedAt };
  }
  return { kind: 'alreadyOtherOwner' };
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 19: QR linkage never overwrites an existing association (Req 8.2, 8.7)', () => {
  it('links a valid unused code and, on every rejection, leaves all associations unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ entries, userId, code }) => {
        const priorMap = new Map<string, SampleRecord>(entries.map((e) => [e.code, e]));
        const store = new FakeSampleStore(new Map(priorMap));
        const beforeSnapshot = store.snapshot();
        const service = makeService(store);

        const expected = expectationFor(priorMap, userId, code);
        const result = await service.linkSample({ userId, code });

        switch (expected.kind) {
          case 'invalid': {
            // Req 8.7: invalid code rejected, registry untouched.
            if (!isErr(result)) return false;
            if (result.error.code !== KitErrorCode.QR_INVALID) return false;
            return store.snapshot() === beforeSnapshot;
          }
          case 'unrecognized': {
            // Req 8.7: unrecognized code rejected, registry untouched.
            if (!isErr(result)) return false;
            if (result.error.code !== KitErrorCode.QR_UNRECOGNIZED) return false;
            return store.snapshot() === beforeSnapshot;
          }
          case 'alreadyOtherOwner': {
            // Req 8.7: already-linked code rejected, association NOT overwritten.
            if (!isErr(result)) return false;
            if (result.error.code !== KitErrorCode.QR_ALREADY_LINKED) return false;
            return store.snapshot() === beforeSnapshot;
          }
          case 'idempotent': {
            // Req 8.7: same-owner re-link is a no-op; association unchanged.
            if (!isOk(result)) return false;
            if (result.value.alreadyLinked !== true) return false;
            if (result.value.userId !== userId) return false;
            if (result.value.linkedAt !== expected.at) return false;
            return store.snapshot() === beforeSnapshot;
          }
          case 'link': {
            // Req 8.2: valid unused code is linked to the scanning user, and
            // ONLY the scanned code's association changes.
            if (!isOk(result)) return false;
            if (result.value.alreadyLinked !== false) return false;
            if (result.value.code !== code) return false;
            if (result.value.userId !== userId) return false;

            const after = store.get(code);
            if (after === undefined) return false;
            if (after.linkedUserId !== userId) return false;
            if (after.linkedAt !== expected.at) return false;

            // Every OTHER record must be byte-for-byte identical.
            for (const [c, before] of priorMap) {
              if (c === code) continue;
              const now = store.get(c);
              if (now === undefined) return false;
              if (now.linkedUserId !== before.linkedUserId) return false;
              if (now.linkedAt !== before.linkedAt) return false;
            }
            return true;
          }
          default:
            return false;
        }
      }),
      { numRuns: 100 },
    );
  });
});
