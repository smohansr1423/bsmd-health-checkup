/**
 * Scheduling Service Routes
 * Handles appointment scheduling, reminders, and slot management.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'scheduling:write' });

function getServices(req: AuthenticatedRequest): ServiceRegistry {
  return req.app.locals.services;
}

/**
 * GET /scheduling/slots
 * Get available appointment slots for the next 30 days
 */
router.get(
  '/slots',
  readLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { schedulingService } = getServices(req);
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + 30);
      const physicianId = req.query.physicianId as string | undefined;
      const slots = await schedulingService.getAvailableSlots({ startDate: now, endDate }, physicianId);
      res.json({ data: slots });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to get slots';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

/**
 * POST /scheduling/appointments
 * Book a new appointment
 */
router.post(
  '/appointments',
  writeLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { schedulingService } = getServices(req);
      const appointment = await schedulingService.bookAppointment(req.body);
      res.status(201).json({ data: appointment });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Booking failed';
      res.status(400).json({ error: { code: 'BOOKING_FAILED', message } });
    }
  }
);

/**
 * DELETE /scheduling/appointments/:id
 * Cancel an appointment
 */
router.delete(
  '/appointments/:id',
  writeLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { schedulingService } = getServices(req);
      const result = await schedulingService.cancelAppointment(req.params.id);
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Cancellation failed';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'CANCEL_FAILED', message } });
    }
  }
);

/**
 * PUT /scheduling/appointments/:id/reschedule
 * Reschedule an appointment
 */
router.put(
  '/appointments/:id/reschedule',
  writeLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { schedulingService } = getServices(req);
      const { newSlotId } = req.body;
      const appointment = await schedulingService.rescheduleAppointment(req.params.id, newSlotId);
      res.json({ data: appointment });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Reschedule failed';
      res.status(400).json({ error: { code: 'RESCHEDULE_FAILED', message } });
    }
  }
);

/**
 * POST /scheduling/waitlist
 * Join the waiting list
 */
router.post(
  '/waitlist',
  writeLimiter,
  createRoleGuard('Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { schedulingService } = getServices(req);
      const { seniorId, preferences } = req.body;
      const entry = await schedulingService.joinWaitingList(seniorId, preferences);
      res.status(201).json({ data: entry });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Waitlist join failed';
      res.status(400).json({ error: { code: 'WAITLIST_FAILED', message } });
    }
  }
);

export default router;
