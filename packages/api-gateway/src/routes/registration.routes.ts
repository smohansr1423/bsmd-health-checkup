/**
 * Registration Service Routes
 * Handles senior citizen registration and health profile management.
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';
import { DuplicateDetectedError } from '@health-checkup/services';

const router = Router();

// Rate limiters for this service
const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'registration:write' });

/** Helper to get the service registry from app.locals */
function getServices(req: AuthenticatedRequest): ServiceRegistry {
  return req.app.locals.services;
}

/**
 * POST /registration
 * Register a new senior citizen
 * Roles: Administrator
 */
router.post(
  '/',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { registrationService } = getServices(req);
      const data = req.body;

      // Parse date of birth if it's a string
      if (typeof data.dateOfBirth === 'string') {
        data.dateOfBirth = new Date(data.dateOfBirth);
      }

      const profile = await registrationService.registerSeniorCitizen(data);
      res.status(201).json({ data: profile });
    } catch (error: unknown) {
      if (error instanceof DuplicateDetectedError) {
        res.status(409).json({
          error: {
            code: 'DUPLICATE_DETECTED',
            message: 'A matching health profile already exists',
            existingProfile: error.existingProfile,
          },
        });
        return;
      }
      const message = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: { code: 'REGISTRATION_FAILED', message } });
    }
  }
);

/**
 * GET /registration/:id
 * Get a health profile by ID
 * Roles: Administrator, Physician, Senior_Citizen, Caregiver
 */
router.get(
  '/:id',
  readLimiter,
  createRoleGuard('Administrator', 'Physician', 'Senior_Citizen', 'Caregiver'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { registrationService } = getServices(req);
      const profile = await registrationService.getHealthProfile(req.params.id);
      res.json({ data: profile });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Profile not found';
      if (message.includes('not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message } });
      } else {
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
      }
    }
  }
);

/**
 * PUT /registration/:id
 * Update a health profile
 * Roles: Administrator, Senior_Citizen
 */
router.put(
  '/:id',
  writeLimiter,
  createRoleGuard('Administrator', 'Senior_Citizen'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { registrationService } = getServices(req);
      const userId = req.auth?.userId || 'unknown';
      const profile = await registrationService.updateHealthProfile(req.params.id, req.body, userId);
      res.json({ data: profile });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Update failed';
      if (message.includes('not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message } });
      } else {
        res.status(400).json({ error: { code: 'UPDATE_FAILED', message } });
      }
    }
  }
);

/**
 * POST /registration/duplicate-check
 * Check for duplicate registrations
 * Roles: Administrator
 */
router.post(
  '/duplicate-check',
  readLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { registrationService } = getServices(req);
      const { fullName, dateOfBirth } = req.body;
      const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
      const result = await registrationService.checkDuplicate(fullName, dob);
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Duplicate check failed';
      res.status(400).json({ error: { code: 'CHECK_FAILED', message } });
    }
  }
);

export default router;
