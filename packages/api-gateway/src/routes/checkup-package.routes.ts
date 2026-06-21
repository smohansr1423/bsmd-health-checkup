/**
 * Checkup Package Service Routes
 * Handles checkup package configuration and assignment.
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { RATE_LIMIT_PRESETS } from '../types';
import { createRateLimiter, createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';

const router = Router();

const readLimiter = createRateLimiter(RATE_LIMIT_PRESETS.read);
const writeLimiter = createRateLimiter({ ...RATE_LIMIT_PRESETS.write, keyPrefix: 'checkup-package:write' });

function getServices(req: AuthenticatedRequest): ServiceRegistry {
  return req.app.locals.services;
}

/**
 * GET /checkup-packages
 * List all available checkup packages
 */
router.get(
  '/',
  readLimiter,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const packages = await checkupPackageService.getAllPackages();
      res.json({ data: packages });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to list packages';
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
    }
  }
);

/**
 * POST /checkup-packages/seed
 * Seed predefined packages (Basic, Standard, Comprehensive)
 * Roles: Administrator
 */
router.post(
  '/seed',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const packages = await checkupPackageService.seedPredefinedPackages();
      res.status(201).json({ data: packages });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to seed packages';
      res.status(500).json({ error: { code: 'SEED_FAILED', message } });
    }
  }
);

/**
 * GET /checkup-packages/:id
 * Get a specific checkup package
 */
router.get(
  '/:id',
  readLimiter,
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const pkg = await checkupPackageService.getPackage(req.params.id);
      res.json({ data: pkg });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Package not found';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', message } });
    }
  }
);

/**
 * POST /checkup-packages
 * Create a custom checkup package
 * Roles: Administrator
 */
router.post(
  '/',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const pkg = await checkupPackageService.createPackage(req.body);
      res.status(201).json({ data: pkg });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create package';
      res.status(400).json({ error: { code: 'CREATE_FAILED', message } });
    }
  }
);

/**
 * PUT /checkup-packages/:id
 * Update a checkup package
 * Roles: Administrator
 */
router.put(
  '/:id',
  writeLimiter,
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const pkg = await checkupPackageService.updatePackage(req.params.id, req.body);
      res.json({ data: pkg });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to update package';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'UPDATE_FAILED', message } });
    }
  }
);

/**
 * POST /checkup-packages/:id/assign
 * Assign a package to a senior citizen (with allergy conflict check)
 * Roles: Administrator, Physician
 */
router.post(
  '/:id/assign',
  writeLimiter,
  createRoleGuard('Administrator', 'Physician'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const { checkupPackageService } = getServices(req);
      const { seniorId, allergies } = req.body;
      const result = await checkupPackageService.assignPackageToSenior(req.params.id, seniorId, allergies || []);
      if (!result.success) {
        res.status(409).json({ error: { code: 'CONFLICT_DETECTED', message: result.message, conflicts: result.conflictDetection } });
        return;
      }
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Assignment failed';
      res.status(400).json({ error: { code: 'ASSIGN_FAILED', message } });
    }
  }
);

export default router;
