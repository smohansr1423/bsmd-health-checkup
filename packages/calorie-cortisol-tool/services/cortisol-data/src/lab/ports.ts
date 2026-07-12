/**
 * Ports and domain types for the Lab_Integration lab-kit ordering and QR
 * sample-linkage flows (Req 8.1, 8.2, 8.6, 8.7).
 *
 * The core service logic ({@link ./kit-service}) is pure and depends only on
 * these injectable ports — a payment provider, a CLIA/CAP lab partner, the
 * order/sample persistence stores, plus an id generator and clock. This keeps
 * the order/linkage rules deterministically testable with in-memory doubles
 * and no network, database, or wall-clock coupling.
 */

import type { ErrorContract } from '@calorie-cortisol/shared/result';

// ---------------------------------------------------------------------------
// Kit / order domain
// ---------------------------------------------------------------------------

/**
 * The kind of at-home cortisol kit being ordered. A `single` kit yields one
 * spot sample; a `diurnal` kit collects the four-sample diurnal protocol
 * (Req 8.3).
 */
export type KitType = 'single' | 'diurnal';

/** Known, orderable kit types. */
export const KIT_TYPES: readonly KitType[] = ['single', 'diurnal'];

/** An inbound request to order an at-home cortisol test kit (Req 8.1). */
export interface KitOrderRequest {
  /** The account placing the order. */
  readonly userId: string;
  /** Which kit to ship. */
  readonly kitType: KitType;
  /** Order amount to authorize, in integer cents. Must be > 0. */
  readonly amountCents: number;
}

/** Lifecycle status of a persisted kit order. */
export type KitOrderStatus = 'pending' | 'confirmed';

/**
 * A persisted kit order record. On lab/payment failure the order is retained in
 * the `pending` state with `charged: false` (Req 8.6); on success it is
 * `confirmed` and `charged: true`.
 */
export interface KitOrder {
  readonly id: string;
  readonly userId: string;
  readonly kitType: KitType;
  readonly amountCents: number;
  readonly status: KitOrderStatus;
  /** Payment authorization handle, once a hold has been placed. */
  readonly paymentAuthorizationId: string | null;
  /** Whether the user has actually been charged (capture succeeded). */
  readonly charged: boolean;
  /** Lab-partner shipment handle, once a shipment has been initiated. */
  readonly shipmentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Confirmation returned when an order succeeds: it carries the unique order
 * identifier the client tracks the shipment/results against (Req 8.1).
 */
export interface KitOrderConfirmation {
  readonly orderId: string;
  readonly status: 'confirmed';
  readonly kitType: KitType;
  readonly amountCents: number;
  readonly shipmentId: string;
  readonly charged: true;
}

/**
 * Outcome of an order attempt.
 *
 * On failure the user is never charged (`charged: false`). `pendingOrderId` is
 * the id of the retained pending order when one was created (lab unavailable /
 * payment failure, Req 8.6), or `null` when the request was rejected at
 * validation before any order record existed.
 */
export type KitOrderResult =
  | { readonly ok: true; readonly confirmation: KitOrderConfirmation }
  | {
      readonly ok: false;
      readonly error: ErrorContract;
      readonly pendingOrderId: string | null;
      readonly charged: false;
    };

// ---------------------------------------------------------------------------
// QR sample linkage domain
// ---------------------------------------------------------------------------

/** An inbound request to link a scanned kit QR code to a user (Req 8.2). */
export interface KitLinkRequest {
  readonly userId: string;
  /** The raw string decoded from the scanned QR code. */
  readonly code: string;
}

/**
 * A physical-sample registry record. `linkedUserId` is `null` while the code is
 * unused; once linked it holds the owning account and is never overwritten
 * (Req 8.7 / Property 19).
 */
export interface SampleRecord {
  readonly code: string;
  readonly linkedUserId: string | null;
  readonly linkedAt: string | null;
}

/** Confirmation identifying the linked kit after a successful link (Req 8.2). */
export interface KitLinkConfirmation {
  readonly code: string;
  readonly userId: string;
  readonly linkedAt: string;
  /**
   * True when the code was already linked to this same user and the call was a
   * no-op idempotent re-link (association unchanged).
   */
  readonly alreadyLinked: boolean;
}

// ---------------------------------------------------------------------------
// Injectable ports
// ---------------------------------------------------------------------------

/** Result of a payment authorization (hold) attempt. */
export type PaymentAuthorization =
  | { readonly ok: true; readonly authorizationId: string }
  | { readonly ok: false; readonly reason: string };

/** A payment provider (e.g. Stripe) modelled as authorize → capture / void. */
export interface PaymentPort {
  /** Place a hold for the order amount. Does not charge the user. */
  authorize(req: {
    userId: string;
    amountCents: number;
    orderId: string;
  }): Promise<PaymentAuthorization>;
  /** Capture a prior authorization, charging the user (order success). */
  capture(authorizationId: string): Promise<void>;
  /** Release a prior authorization without charging the user (Req 8.6). */
  voidAuthorization(authorizationId: string): Promise<void>;
}

/** Result of a CLIA/CAP lab-partner shipment request. */
export type LabShipmentResult =
  | { readonly ok: true; readonly shipmentId: string }
  | {
      readonly ok: false;
      /** Whether the partner was unreachable or actively rejected the order. */
      readonly reason: 'unavailable' | 'rejected';
      readonly detail?: string;
    };

/** A CLIA/CAP-certified lab partner that fulfils and ships kits (Req 8.1). */
export interface LabPartnerPort {
  initiateShipment(req: {
    orderId: string;
    userId: string;
    kitType: KitType;
  }): Promise<LabShipmentResult>;
}

/** Persistence for kit orders (upsert by id). */
export interface KitOrderStore {
  save(order: KitOrder): Promise<void>;
}

/** Persistence/registry for physical-sample QR codes. */
export interface SampleLinkStore {
  /** Look up a sample by code, or `null` if the code is not in the registry. */
  findByCode(code: string): Promise<SampleRecord | null>;
  /** Link an unused code to a user, returning the updated record. */
  link(code: string, userId: string, linkedAt: string): Promise<SampleRecord>;
}

/** Source of unique identifiers (injected for deterministic tests). */
export interface IdGenerator {
  next(): string;
}

/** Source of the current time as an ISO-8601 string (injected for tests). */
export interface Clock {
  now(): string;
}

/** Everything the {@link LabKitService} depends on. */
export interface LabKitDeps {
  readonly payment: PaymentPort;
  readonly labPartner: LabPartnerPort;
  readonly orders: KitOrderStore;
  readonly samples: SampleLinkStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}
