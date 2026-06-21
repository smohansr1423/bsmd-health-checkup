/**
 * Billing & Payment Service Routes
 * Validates: Requirements 9.1–9.8, 10.1–10.7, 11.1–11.8
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'billing:write' });
const sensitiveLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.sensitive, keyPrefix: 'billing:payment' });

function getServices(req: AuthenticatedRequest): ServiceRegistry { return req.app.locals.services; }

// --- Invoice routes ---

router.post(
  '/invoices',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { billingEngineService } = getServices(req);
      const { sessionId } = req.body;
      const invoice = await billingEngineService.generateInvoice(sessionId);
      res.status(201).json({ data: invoice });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invoice generation failed';
      res.status(400).json({ error: { code: 'INVOICE_FAILED', message } });
    }
  }
);

router.get(
  '/invoices/:id',
  readLimiter,
  createRoleGuard('Administrator', 'Senior_Citizen', 'Caregiver'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { billingEngineService } = getServices(req);
      const invoice = await billingEngineService.getInvoice(req.params.id);
      res.json({ data: invoice });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invoice not found';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message } });
    }
  }
);

// --- Payment routes ---

router.post(
  '/payments',
  sensitiveLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { paymentProcessingService } = getServices(req);
      const { sessionId, ...details } = req.body;
      const result = await paymentProcessingService.processPayment(sessionId, details);
      res.status(201).json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Payment failed';
      res.status(400).json({ error: { code: 'PAYMENT_FAILED', message } });
    }
  }
);

router.post(
  '/payments/:id/retry',
  sensitiveLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { paymentProcessingService } = getServices(req);
      const result = await paymentProcessingService.retryPayment(req.params.id, req.body.details);
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Retry failed';
      res.status(400).json({ error: { code: 'RETRY_FAILED', message } });
    }
  }
);

router.post(
  '/installment-plans',
  writeLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { paymentProcessingService } = getServices(req);
      const { invoiceId, installments, packageType } = req.body;
      const plan = await paymentProcessingService.setupInstallmentPlan(invoiceId, installments, packageType);
      res.status(201).json({ data: plan });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Installment plan setup failed';
      res.status(400).json({ error: { code: 'INSTALLMENT_FAILED', message } });
    }
  }
);

// --- Insurance routes ---

router.post(
  '/insurance/claims',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { insuranceIntegrationService } = getServices(req);
      const claim = await insuranceIntegrationService.submitClaim(req.body);
      res.status(201).json({ data: claim });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Claim submission failed';
      res.status(400).json({ error: { code: 'CLAIM_FAILED', message } });
    }
  }
);

router.get(
  '/insurance/claims/:id',
  readLimiter,
  createRoleGuard('Administrator', 'Senior_Citizen', 'Caregiver'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { insuranceIntegrationService } = getServices(req);
      const status = await insuranceIntegrationService.getClaimStatus(req.params.id);
      res.json({ data: status });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Claim not found';
      const httpStatus = message.includes('not found') ? 404 : 500;
      res.status(httpStatus).json({ error: { code: httpStatus === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message } });
    }
  }
);

export default router;
