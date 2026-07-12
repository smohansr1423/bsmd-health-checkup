/**
 * Lab_Integration lab-kit ordering and QR sample-linkage service (Req 8.1,
 * 8.2, 8.6, 8.7).
 *
 * All external effects are injected through {@link LabKitDeps}, so the ordering
 * and linkage rules here are deterministic and unit-testable with in-memory
 * doubles. The two public operations are:
 *
 *   - {@link LabKitService.orderKit} — create an order, authorize payment, and
 *     initiate shipment through a CLIA/CAP lab partner, returning a confirmation
 *     with a unique order id (Req 8.1). If the partner is unavailable/rejects,
 *     or payment authorization fails, the order is retained pending, the user is
 *     not charged, and a structured error is returned (Req 8.6).
 *
 *   - {@link LabKitService.linkSample} — link a valid, unused QR code to the
 *     scanning user (Req 8.2). Invalid, unrecognized, or already-linked codes
 *     are rejected and any existing association is left unchanged (Req 8.7 /
 *     Property 19).
 */

import {
  validationRejection,
  atomicFailure,
  ok,
  err,
  type Result,
  type ErrorContract,
} from '@calorie-cortisol/shared/result';

import { KitErrorCode } from './errors';
import { isWellFormedKitCode } from './qr-code';
import type {
  KitLinkConfirmation,
  KitLinkRequest,
  KitOrder,
  KitOrderRequest,
  KitOrderResult,
  LabKitDeps,
} from './ports';
import { KIT_TYPES } from './ports';

export class LabKitService {
  private readonly deps: LabKitDeps;

  constructor(deps: LabKitDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Order flow (Req 8.1, 8.6)
  // -------------------------------------------------------------------------

  /**
   * Order an at-home cortisol test kit.
   *
   * Sequence: validate → create pending order → authorize payment (hold) →
   * initiate CLIA/CAP shipment → on success capture the hold and confirm; on
   * any failure release the hold and leave the order pending with no charge.
   */
  async orderKit(request: KitOrderRequest): Promise<KitOrderResult> {
    const validationError = validateOrderRequest(request);
    if (validationError) {
      // Rejected at the boundary — no order record ever existed.
      return { ok: false, error: validationError, pendingOrderId: null, charged: false };
    }

    const now = this.deps.clock.now();
    const orderId = this.deps.ids.next();

    // Persist a pending order first so the order is retained regardless of what
    // happens downstream (Req 8.6 "retain the order in a pending state").
    let order: KitOrder = {
      id: orderId,
      userId: request.userId,
      kitType: request.kitType,
      amountCents: request.amountCents,
      status: 'pending',
      paymentAuthorizationId: null,
      charged: false,
      shipmentId: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.orders.save(order);

    // Authorize a hold. A failed authorization means no charge is possible, so
    // the order simply stays pending (Req 8.6).
    const auth = await this.deps.payment.authorize({
      userId: request.userId,
      amountCents: request.amountCents,
      orderId,
    });
    if (!auth.ok) {
      return {
        ok: false,
        error: labFailureError(
          KitErrorCode.ORDER_PAYMENT_FAILED,
          `Payment authorization failed: ${auth.reason}. No charge was made; the order is retained as pending.`,
        ),
        pendingOrderId: orderId,
        charged: false,
      };
    }

    order = { ...order, paymentAuthorizationId: auth.authorizationId, updatedAt: this.deps.clock.now() };
    await this.deps.orders.save(order);

    // Initiate shipment through the CLIA/CAP lab partner.
    const shipment = await this.deps.labPartner.initiateShipment({
      orderId,
      userId: request.userId,
      kitType: request.kitType,
    });
    if (!shipment.ok) {
      // Lab unavailable or rejected: release the hold so the user is not
      // charged, and keep the order pending (Req 8.6).
      await this.deps.payment.voidAuthorization(auth.authorizationId);
      order = { ...order, paymentAuthorizationId: null, updatedAt: this.deps.clock.now() };
      await this.deps.orders.save(order);

      const detail = shipment.reason === 'unavailable' ? 'the lab partner was unavailable' : 'the lab partner rejected the order';
      return {
        ok: false,
        error: labFailureError(
          KitErrorCode.ORDER_LAB_UNAVAILABLE,
          `Order creation failed because ${detail}. No charge was made; the order is retained as pending.`,
        ),
        pendingOrderId: orderId,
        charged: false,
      };
    }

    // Success: capture the hold (charge) and confirm the order.
    await this.deps.payment.capture(auth.authorizationId);
    order = {
      ...order,
      status: 'confirmed',
      charged: true,
      shipmentId: shipment.shipmentId,
      updatedAt: this.deps.clock.now(),
    };
    await this.deps.orders.save(order);

    return {
      ok: true,
      confirmation: {
        orderId,
        status: 'confirmed',
        kitType: request.kitType,
        amountCents: request.amountCents,
        shipmentId: shipment.shipmentId,
        charged: true,
      },
    };
  }

  // -------------------------------------------------------------------------
  // QR linkage flow (Req 8.2, 8.7)
  // -------------------------------------------------------------------------

  /**
   * Link a scanned kit QR code to the scanning user's account.
   *
   * A valid, unused code is linked and a confirmation identifying the kit is
   * returned. Invalid, unrecognized, or already-linked codes are rejected; in
   * every rejection path any existing account-to-sample association is left
   * unchanged (Req 8.7 / Property 19). Re-linking a code already owned by the
   * same user is an idempotent no-op that reports `alreadyLinked: true`.
   */
  async linkSample(request: KitLinkRequest): Promise<Result<KitLinkConfirmation>> {
    if (!isNonEmpty(request.userId) || !isNonEmpty(request.code)) {
      return err(
        validationRejection(
          KitErrorCode.QR_INVALID_REQUEST,
          'A userId and a scanned code are required to link a kit.',
        ),
      );
    }

    // Structural check first: a malformed code never touches the registry, so
    // it cannot disturb any existing association.
    if (!isWellFormedKitCode(request.code)) {
      return err(
        validationRejection(
          KitErrorCode.QR_INVALID,
          'The scanned code is not a valid kit QR code.',
        ),
      );
    }

    const existing = await this.deps.samples.findByCode(request.code);
    if (existing === null) {
      return err(
        validationRejection(
          KitErrorCode.QR_UNRECOGNIZED,
          'The scanned code is not recognized.',
        ),
      );
    }

    if (existing.linkedUserId !== null) {
      // Already linked. If it belongs to the same user, treat as an idempotent
      // no-op (association unchanged). Otherwise reject without overwriting.
      if (existing.linkedUserId === request.userId && existing.linkedAt !== null) {
        return ok({
          code: existing.code,
          userId: existing.linkedUserId,
          linkedAt: existing.linkedAt,
          alreadyLinked: true,
        });
      }
      return err(
        validationRejection(
          KitErrorCode.QR_ALREADY_LINKED,
          'The scanned code is already linked to another account.',
        ),
      );
    }

    const linkedAt = this.deps.clock.now();
    const linked = await this.deps.samples.link(request.code, request.userId, linkedAt);
    return ok({
      code: linked.code,
      userId: request.userId,
      linkedAt: linked.linkedAt ?? linkedAt,
      alreadyLinked: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNonEmpty(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate an order request at the boundary. Returns a validation-rejection
 * error contract, or `null` when the request is well-formed.
 */
function validateOrderRequest(request: KitOrderRequest): ErrorContract | null {
  if (!isNonEmpty(request.userId)) {
    return validationRejection(
      KitErrorCode.ORDER_INVALID_REQUEST,
      'A userId is required to order a kit.',
    );
  }
  if (!KIT_TYPES.includes(request.kitType)) {
    return validationRejection(
      KitErrorCode.ORDER_INVALID_REQUEST,
      `Unknown kit type: "${String(request.kitType)}".`,
    );
  }
  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0) {
    return validationRejection(
      KitErrorCode.ORDER_INVALID_REQUEST,
      'Order amount must be a positive integer number of cents.',
    );
  }
  return null;
}

/**
 * Build the error contract for a retained-pending order failure (lab
 * unavailable or payment failed). The order is retained (`retainedState: true`)
 * and the user may re-attempt (`retryable: true`), per Req 8.6.
 */
function labFailureError(code: string, message: string): ErrorContract {
  return atomicFailure(code, message, { retryable: true });
}
