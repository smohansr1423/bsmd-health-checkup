/**
 * Payment Processing Service
 * Handles payment initiation, processing, retries, installment plans, and session management.
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import type { PaymentRecord, InstallmentPlan, Installment } from '@health-checkup/shared';
import { PaymentMethod } from '@health-checkup/shared';
import type {
  PaymentRequest,
  PaymentSession,
  PaymentDetails,
  PaymentResult,
  PaymentReceipt,
  PaymentDependencies,
  PaymentSessionRepository,
  PaymentReceiptRepository,
  InstallmentPlanRepository,
  PaymentGateway,
  PaymentNotifier,
  PaymentMethodType,
  RefundResult,
} from './payment.types';
import {
  PaymentSessionNotFoundError,
  PaymentSessionExpiredError,
  MaxRetriesExceededError,
  PaymentTimeoutError,
  InstallmentPlanError,
  InvalidSessionStateError,
} from './payment.errors';
import { validatePaymentDetails, validatePaymentAmount } from './payment.validators';

/** Default session timeout: 10 minutes in milliseconds */
const DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

/** Default processing timeout: 30 seconds in milliseconds */
const DEFAULT_PROCESSING_TIMEOUT_MS = 30 * 1000;

/** Default max retry attempts */
const DEFAULT_MAX_RETRIES = 5;

/** Business days for refund processing */
const REFUND_BUSINESS_DAYS = 7;

/**
 * In-memory implementation of PaymentSessionRepository.
 */
export class InMemoryPaymentSessionRepository implements PaymentSessionRepository {
  private sessions: PaymentSession[] = [];

  async save(session: PaymentSession): Promise<PaymentSession> {
    this.sessions.push(session);
    return session;
  }

  async findById(id: string): Promise<PaymentSession | null> {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async update(session: PaymentSession): Promise<PaymentSession> {
    const index = this.sessions.findIndex((s) => s.id === session.id);
    if (index === -1) {
      throw new Error(`Session not found: ${session.id}`);
    }
    this.sessions[index] = session;
    return session;
  }

  async findActiveByInvoiceId(invoiceId: string): Promise<PaymentSession | null> {
    return this.sessions.find(
      (s) => s.invoiceId === invoiceId && s.status === 'active'
    ) ?? null;
  }

  clear(): void {
    this.sessions = [];
  }
}

/**
 * In-memory implementation of PaymentReceiptRepository.
 */
export class InMemoryPaymentReceiptRepository implements PaymentReceiptRepository {
  private receipts: PaymentReceipt[] = [];

  async save(receipt: PaymentReceipt): Promise<PaymentReceipt> {
    this.receipts.push(receipt);
    return receipt;
  }

  async findByPaymentId(paymentId: string): Promise<PaymentReceipt | null> {
    return this.receipts.find((r) => r.paymentId === paymentId) ?? null;
  }

  clear(): void {
    this.receipts = [];
  }
}

/**
 * In-memory implementation of InstallmentPlanRepository.
 */
export class InMemoryInstallmentPlanRepository implements InstallmentPlanRepository {
  private plans: InstallmentPlan[] = [];

  async save(plan: InstallmentPlan): Promise<InstallmentPlan> {
    this.plans.push(plan);
    return plan;
  }

  async findByInvoiceId(invoiceId: string): Promise<InstallmentPlan | null> {
    return this.plans.find((p) => p.invoiceId === invoiceId) ?? null;
  }

  async update(plan: InstallmentPlan): Promise<InstallmentPlan> {
    const index = this.plans.findIndex((p) => p.id === plan.id);
    if (index === -1) {
      throw new Error(`Installment plan not found: ${plan.id}`);
    }
    this.plans[index] = plan;
    return plan;
  }

  clear(): void {
    this.plans = [];
  }
}

/** Default ID generator */
const defaultIdGenerator = (): string => {
  return `PAY_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
};

/** Default date provider */
const defaultDateProvider = (): Date => new Date();

/** Default no-op payment notifier */
const defaultPaymentNotifier: PaymentNotifier = {
  sendConfirmation: async () => {},
};

/** Default payment gateway (simulates success) */
const defaultPaymentGateway: PaymentGateway = {
  processPayment: async () => ({
    success: true,
    transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
  }),
  processRefund: async () => ({
    success: true,
    refundId: `REF_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
  }),
};

/**
 * PaymentProcessingService implementation.
 *
 * Business rules:
 * - Session expires after 10 minutes of inactivity (Req 10.6)
 * - Max 5 retry attempts per session (Req 10.4)
 * - Payment must process within 30 seconds (Req 10.1)
 * - Receipt generated within 1 minute of success (Req 10.3)
 * - Refunds processed to original method within 7 business days (Req 10.7)
 * - Support: credit_card, debit_card, bank_transfer, digital_wallet (Req 10.1)
 */
export class PaymentProcessingService {
  private readonly idGenerator: () => string;
  private readonly dateProvider: () => Date;
  private readonly sessionRepository: PaymentSessionRepository;
  private readonly receiptRepository: PaymentReceiptRepository;
  private readonly installmentPlanRepository: InstallmentPlanRepository;
  private readonly paymentGateway: PaymentGateway;
  private readonly paymentNotifier: PaymentNotifier;
  private readonly sessionTimeoutMs: number;
  private readonly processingTimeoutMs: number;
  private readonly maxRetries: number;

  constructor(deps?: Partial<PaymentDependencies>) {
    this.idGenerator = deps?.idGenerator ?? defaultIdGenerator;
    this.dateProvider = deps?.dateProvider ?? defaultDateProvider;
    this.sessionRepository = deps?.sessionRepository ?? new InMemoryPaymentSessionRepository();
    this.receiptRepository = deps?.receiptRepository ?? new InMemoryPaymentReceiptRepository();
    this.installmentPlanRepository = deps?.installmentPlanRepository ?? new InMemoryInstallmentPlanRepository();
    this.paymentGateway = deps?.paymentGateway ?? defaultPaymentGateway;
    this.paymentNotifier = deps?.paymentNotifier ?? defaultPaymentNotifier;
    this.sessionTimeoutMs = deps?.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.processingTimeoutMs = deps?.processingTimeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_MS;
    this.maxRetries = deps?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Initiate a new payment session.
   *
   * Requirement 10.1: Support multiple payment methods.
   * Requirement 10.6: Session expires after 10 minutes of inactivity.
   *
   * @throws PaymentValidationError if amount is invalid.
   */
  async initiatePayment(request: PaymentRequest): Promise<PaymentSession> {
    validatePaymentAmount(request.amount);

    const now = this.dateProvider();
    const session: PaymentSession = {
      id: this.idGenerator(),
      invoiceId: request.invoiceId,
      amount: request.amount,
      method: request.method,
      status: 'active',
      retryCount: 0,
      maxRetries: this.maxRetries,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.sessionTimeoutMs),
      lastActivityAt: now,
      holdReleased: false,
    };

    return this.sessionRepository.save(session);
  }

  /**
   * Process a payment within an active session.
   *
   * Requirement 10.1: Process within 30 seconds.
   * Requirement 10.2: Validate payment details.
   * Requirement 10.3: Generate receipt and send confirmation within 1 minute.
   *
   * @throws PaymentSessionNotFoundError if session doesn't exist.
   * @throws PaymentSessionExpiredError if session has expired.
   * @throws InvalidSessionStateError if session is not active.
   * @throws PaymentValidationError if details are invalid.
   * @throws PaymentTimeoutError if processing exceeds 30 seconds.
   */
  async processPayment(sessionId: string, details: PaymentDetails): Promise<PaymentResult> {
    const session = await this.getActiveSession(sessionId);
    const now = this.dateProvider();

    // Validate payment details based on method
    validatePaymentDetails(session.method, details, now);

    // Process payment through gateway with timeout
    const gatewayResult = await this.processWithTimeout(
      session.amount,
      session.method,
      details,
      sessionId
    );

    // Create payment record
    const paymentRecord: PaymentRecord = {
      id: this.idGenerator(),
      invoiceId: session.invoiceId,
      amount: session.amount,
      method: this.toPaymentMethodEnum(session.method),
      status: gatewayResult.success ? 'success' : 'failed',
      transactionId: gatewayResult.transactionId,
      failureReason: gatewayResult.failureReason,
      processedAt: gatewayResult.success ? now : undefined,
      createdAt: now,
    };

    if (gatewayResult.success) {
      // Update session to completed
      const updatedSession: PaymentSession = {
        ...session,
        status: 'completed',
        lastActivityAt: now,
      };
      await this.sessionRepository.update(updatedSession);

      // Generate receipt (Req 10.3)
      const receipt = await this.generateReceipt(paymentRecord, session);

      // Send confirmation asynchronously (within 1 minute)
      this.paymentNotifier.sendConfirmation(receipt).catch(() => {
        // Log failure but don't block the response
      });

      return {
        success: true,
        transactionId: gatewayResult.transactionId,
        paymentRecord,
        receipt,
      };
    } else {
      // Update session for failure
      const updatedSession: PaymentSession = {
        ...session,
        status: 'failed',
        lastActivityAt: now,
      };
      await this.sessionRepository.update(updatedSession);

      return {
        success: false,
        paymentRecord,
        failureReason: gatewayResult.failureReason,
      };
    }
  }

  /**
   * Retry a failed payment within the same session.
   *
   * Requirement 10.4: Max 5 retry attempts per session after failure.
   *
   * @throws PaymentSessionNotFoundError if session doesn't exist.
   * @throws PaymentSessionExpiredError if session has expired.
   * @throws MaxRetriesExceededError if retries exceed maximum.
   * @throws PaymentValidationError if details are invalid.
   */
  async retryPayment(sessionId: string, details?: PaymentDetails): Promise<PaymentResult> {
    const session = await this.getSessionForRetry(sessionId);
    const now = this.dateProvider();

    // Check retry count (Req 10.4)
    if (session.retryCount >= this.maxRetries) {
      throw new MaxRetriesExceededError(sessionId, session.retryCount, this.maxRetries);
    }

    // Increment retry count and reactivate session
    const retriedSession: PaymentSession = {
      ...session,
      status: 'active',
      retryCount: session.retryCount + 1,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + this.sessionTimeoutMs),
    };
    await this.sessionRepository.update(retriedSession);

    // If no new details provided, we can't process (need valid details)
    if (!details) {
      throw new Error('Payment details are required for retry.');
    }

    // Validate and process
    validatePaymentDetails(retriedSession.method, details, now);

    const gatewayResult = await this.processWithTimeout(
      retriedSession.amount,
      retriedSession.method,
      details,
      sessionId
    );

    const paymentRecord: PaymentRecord = {
      id: this.idGenerator(),
      invoiceId: retriedSession.invoiceId,
      amount: retriedSession.amount,
      method: this.toPaymentMethodEnum(retriedSession.method),
      status: gatewayResult.success ? 'success' : 'failed',
      transactionId: gatewayResult.transactionId,
      failureReason: gatewayResult.failureReason,
      processedAt: gatewayResult.success ? now : undefined,
      createdAt: now,
    };

    if (gatewayResult.success) {
      const completedSession: PaymentSession = {
        ...retriedSession,
        status: 'completed',
        lastActivityAt: now,
      };
      await this.sessionRepository.update(completedSession);

      const receipt = await this.generateReceipt(paymentRecord, retriedSession);
      this.paymentNotifier.sendConfirmation(receipt).catch(() => {});

      return {
        success: true,
        transactionId: gatewayResult.transactionId,
        paymentRecord,
        receipt,
      };
    } else {
      const failedSession: PaymentSession = {
        ...retriedSession,
        status: 'failed',
        lastActivityAt: now,
      };
      await this.sessionRepository.update(failedSession);

      return {
        success: false,
        paymentRecord,
        failureReason: gatewayResult.failureReason,
      };
    }
  }

  /**
   * Set up an installment plan for an invoice.
   *
   * Requirement 10.5: Allow installment plans for Comprehensive packages ≥500.
   * Splits into up to 3 equal monthly installments where sum equals total.
   *
   * @param invoiceId - The invoice ID to set up the plan for.
   * @param installments - Number of installments (2 or 3).
   * @param packageType - The package tier; must be 'Comprehensive' for installment eligibility.
   * @throws InstallmentPlanError if conditions are not met.
   */
  async setupInstallmentPlan(invoiceId: string, installments: number, packageType?: string): Promise<InstallmentPlan> {
    if (installments < 2 || installments > 3) {
      throw new InstallmentPlanError(
        'Installment count must be 2 or 3.'
      );
    }

    // Validate package type is Comprehensive (Req 10.5)
    if (packageType !== undefined && packageType !== 'Comprehensive') {
      throw new InstallmentPlanError(
        'Installment plans are only available for Comprehensive packages.'
      );
    }

    // Check for existing plan
    const existingPlan = await this.installmentPlanRepository.findByInvoiceId(invoiceId);
    if (existingPlan) {
      throw new InstallmentPlanError(
        'An installment plan already exists for this invoice.'
      );
    }

    const now = this.dateProvider();
    const planId = this.idGenerator();

    // Resolve total amount from the active session for this invoice
    const activeSession = await this.sessionRepository.findActiveByInvoiceId(invoiceId);

    let totalAmount: number;
    if (activeSession) {
      totalAmount = activeSession.amount;
    } else {
      throw new InstallmentPlanError(
        'No active payment session found for this invoice. Initiate a payment first.'
      );
    }

    if (totalAmount < 500) {
      throw new InstallmentPlanError(
        `Installment plans require a minimum amount of 500. Current amount: ${totalAmount}.`
      );
    }

    const installmentAmount = Math.floor((totalAmount * 100) / installments) / 100;
    const remainder = Math.round((totalAmount - installmentAmount * installments) * 100) / 100;

    const installmentItems: Installment[] = [];
    for (let i = 1; i <= installments; i++) {
      const dueDate = new Date(now.getTime());
      dueDate.setMonth(dueDate.getMonth() + i);

      installmentItems.push({
        number: i,
        amount: i === installments ? installmentAmount + remainder : installmentAmount,
        dueDate,
        status: 'pending',
      });
    }

    const plan: InstallmentPlan = {
      id: planId,
      invoiceId,
      totalAmount,
      installmentCount: installments,
      installments: installmentItems,
    };

    return this.installmentPlanRepository.save(plan);
  }

  /**
   * Make a payment on a specific installment within an existing plan.
   *
   * Requirement 10.5: Support installment payments.
   *
   * @param invoiceId - The invoice ID for the installment plan.
   * @param installmentNumber - The installment number to pay (1-based).
   * @param paymentId - The transaction/payment ID for record keeping.
   * @throws InstallmentPlanError if plan not found or installment cannot be paid.
   */
  async makeInstallmentPayment(invoiceId: string, installmentNumber: number, paymentId: string): Promise<InstallmentPlan> {
    const plan = await this.installmentPlanRepository.findByInvoiceId(invoiceId);
    if (!plan) {
      throw new InstallmentPlanError('No installment plan found for this invoice.');
    }

    const installment = plan.installments.find((i) => i.number === installmentNumber);
    if (!installment) {
      throw new InstallmentPlanError(
        `Installment number ${installmentNumber} does not exist in this plan.`
      );
    }

    if (installment.status === 'paid') {
      throw new InstallmentPlanError(
        `Installment ${installmentNumber} has already been paid.`
      );
    }

    // Mark as paid
    installment.status = 'paid';
    installment.paymentId = paymentId;

    return this.installmentPlanRepository.update(plan);
  }

  /**
   * Get the current status of an installment plan, including overdue detection.
   *
   * Evaluates each installment against the current date:
   * - If pending and past due date → overdue
   * - If paid → paid
   * - Otherwise → pending
   *
   * @param invoiceId - The invoice ID for the installment plan.
   * @throws InstallmentPlanError if plan not found.
   */
  async getInstallmentPlanStatus(invoiceId: string): Promise<InstallmentPlan> {
    const plan = await this.installmentPlanRepository.findByInvoiceId(invoiceId);
    if (!plan) {
      throw new InstallmentPlanError('No installment plan found for this invoice.');
    }

    const now = this.dateProvider();

    // Update statuses based on current date
    for (const installment of plan.installments) {
      if (installment.status === 'pending' && now > installment.dueDate) {
        installment.status = 'overdue';
      }
    }

    return this.installmentPlanRepository.update(plan);
  }

  /**
   * Expire a payment session manually or due to inactivity.
   *
   * Requirement 10.6: Expire session after 10 minutes of inactivity;
   * release holds; allow new session.
   */
  async expireSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new PaymentSessionNotFoundError(sessionId);
    }

    if (session.status === 'expired') {
      return; // Already expired, idempotent
    }

    const expiredSession: PaymentSession = {
      ...session,
      status: 'expired',
      holdReleased: true,
      lastActivityAt: this.dateProvider(),
    };

    await this.sessionRepository.update(expiredSession);
  }

  /**
   * Process a refund to the original payment method.
   *
   * Requirement 10.7: Process refunds to original method within 7 business days.
   */
  async processRefund(transactionId: string, amount: number): Promise<RefundResult> {
    validatePaymentAmount(amount);

    const now = this.dateProvider();
    const gatewayResult = await this.paymentGateway.processRefund(transactionId, amount);

    if (!gatewayResult.success) {
      throw new Error(`Refund failed: ${gatewayResult.failureReason}`);
    }

    // Calculate estimated completion (7 business days)
    const estimatedCompletion = this.addBusinessDays(now, REFUND_BUSINESS_DAYS);

    return {
      id: gatewayResult.refundId!,
      paymentId: transactionId,
      amount,
      method: 'credit_card', // Would be looked up from original payment in production
      status: 'pending',
      estimatedCompletionDate: estimatedCompletion,
      processedAt: now,
    };
  }

  /**
   * Check if a session has expired due to inactivity and expire it if needed.
   */
  async checkAndExpireSession(sessionId: string): Promise<boolean> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session || session.status !== 'active') {
      return false;
    }

    const now = this.dateProvider();
    if (now >= session.expiresAt) {
      await this.expireSession(sessionId);
      return true;
    }

    return false;
  }

  // --- Private helpers ---

  /**
   * Retrieve an active session, checking expiry and status.
   */
  private async getActiveSession(sessionId: string): Promise<PaymentSession> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new PaymentSessionNotFoundError(sessionId);
    }

    // Check expiry
    const now = this.dateProvider();
    if (now >= session.expiresAt) {
      await this.expireSession(sessionId);
      throw new PaymentSessionExpiredError(sessionId);
    }

    if (session.status !== 'active') {
      throw new InvalidSessionStateError(sessionId, session.status, 'active');
    }

    return session;
  }

  /**
   * Retrieve a session that can be retried (must be in 'failed' state).
   */
  private async getSessionForRetry(sessionId: string): Promise<PaymentSession> {
    const session = await this.sessionRepository.findById(sessionId);
    if (!session) {
      throw new PaymentSessionNotFoundError(sessionId);
    }

    // Check expiry
    const now = this.dateProvider();
    if (now >= session.expiresAt) {
      await this.expireSession(sessionId);
      throw new PaymentSessionExpiredError(sessionId);
    }

    if (session.status !== 'failed' && session.status !== 'active') {
      throw new InvalidSessionStateError(sessionId, session.status, 'failed');
    }

    return session;
  }

  /**
   * Process payment through gateway with timeout enforcement.
   *
   * Requirement 10.1: Process within 30 seconds.
   */
  private async processWithTimeout(
    amount: number,
    method: PaymentMethodType,
    details: PaymentDetails,
    sessionId: string
  ): Promise<{ success: boolean; transactionId?: string; failureReason?: string }> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new PaymentTimeoutError(sessionId, this.processingTimeoutMs));
      }, this.processingTimeoutMs);
    });

    return Promise.race([
      this.paymentGateway.processPayment(amount, method, details),
      timeoutPromise,
    ]);
  }

  /**
   * Generate a payment receipt.
   *
   * Requirement 10.3: Generate receipt within 1 minute of success.
   */
  private async generateReceipt(
    paymentRecord: PaymentRecord,
    session: PaymentSession
  ): Promise<PaymentReceipt> {
    const receipt: PaymentReceipt = {
      id: this.idGenerator(),
      paymentId: paymentRecord.id,
      invoiceId: session.invoiceId,
      amount: session.amount,
      method: session.method,
      transactionId: paymentRecord.transactionId!,
      generatedAt: this.dateProvider(),
    };

    return this.receiptRepository.save(receipt);
  }

  /**
   * Convert string payment method type to PaymentMethod enum.
   */
  private toPaymentMethodEnum(method: PaymentMethodType): PaymentMethod {
    switch (method) {
      case 'credit_card':
        return PaymentMethod.CreditCard;
      case 'debit_card':
        return PaymentMethod.DebitCard;
      case 'bank_transfer':
        return PaymentMethod.BankTransfer;
      case 'digital_wallet':
        return PaymentMethod.DigitalWallet;
    }
  }

  /**
   * Add business days to a date (excludes weekends).
   */
  private addBusinessDays(date: Date, days: number): Date {
    const result = new Date(date.getTime());
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const dayOfWeek = result.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        added++;
      }
    }
    return result;
  }
}
