/**
 * Device Readings Routes
 * Handles device registration, reading ingestion, daily records, alerts,
 * trends, and normal range configuration.
 * Validates: Requirements 8.1, 8.2, 8.3, 8.5
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { createRoleGuard } from '../middleware';
import type { ServiceRegistry } from '../service-registry';
import {
  DeviceConflictError,
  UnauthorizedDeviceError,
  TimestampOutOfRangeError,
  ImplausibleValueError,
  RangeOrderInvalidError,
  DeviceValidationError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '@health-checkup/services';
import type {
  ReadingType,
  AlertFilters,
  TrendPeriod,
} from '@health-checkup/services';

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getServices(req: AuthenticatedRequest): ServiceRegistry {
  return req.app.locals.services;
}

/**
 * Parse pagination query parameters with defaults and clamping.
 */
function parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  let pageSize = parseInt(String(query.pageSize ?? String(DEFAULT_PAGE_SIZE)), 10) || DEFAULT_PAGE_SIZE;
  pageSize = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  return { page, pageSize };
}

/**
 * Map service-layer errors to HTTP status codes and error response bodies.
 */
function mapErrorToResponse(error: unknown, res: Response): void {
  if (error instanceof DeviceConflictError) {
    res.status(409).json({
      error: {
        code: 'DEVICE_CONFLICT',
        message: error.message,
      },
    });
  } else if (error instanceof UnauthorizedDeviceError) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED_DEVICE',
        message: error.message,
      },
    });
  } else if (error instanceof TimestampOutOfRangeError) {
    res.status(400).json({
      error: {
        code: 'TIMESTAMP_OUT_OF_RANGE',
        message: error.message,
      },
    });
  } else if (error instanceof ImplausibleValueError) {
    res.status(400).json({
      error: {
        code: 'IMPLAUSIBLE_VALUE',
        message: error.message,
      },
    });
  } else if (error instanceof DeviceValidationError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.errors,
      },
    });
  } else if (error instanceof RangeOrderInvalidError) {
    res.status(422).json({
      error: {
        code: 'RANGE_ORDER_INVALID',
        message: error.message,
      },
    });
  } else {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const isNotFound = message.toLowerCase().includes('not found');
    if (isNotFound) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message,
        },
      });
    } else {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message,
        },
      });
    }
  }
}

// ─── Device Registration Endpoints ──────────────────────────────────────────────

/**
 * POST /devices
 * Register a new device for a senior.
 * Roles: Physician, Administrator
 */
router.post(
  '/devices',
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceRegistrationService } = services as ServiceRegistry & {
        deviceRegistrationService: { registerDevice(request: unknown): Promise<unknown> };
      };
      const device = await deviceRegistrationService.registerDevice(req.body);
      res.status(201).json({ data: device });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

/**
 * DELETE /devices/:deviceId
 * Deregister a device.
 * Roles: Physician, Administrator
 */
router.delete(
  '/devices/:deviceId',
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceRegistrationService } = services as ServiceRegistry & {
        deviceRegistrationService: { deregisterDevice(deviceId: string): Promise<void> };
      };
      await deviceRegistrationService.deregisterDevice(req.params.deviceId);
      res.status(204).send();
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

/**
 * GET /devices/senior/:seniorId
 * List all devices for a specific senior.
 * Roles: Physician, Senior_Citizen, Caregiver, Administrator
 */
router.get(
  '/devices/senior/:seniorId',
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceRegistrationService } = services as ServiceRegistry & {
        deviceRegistrationService: { getDevicesBySenior(seniorId: string): Promise<unknown[]> };
      };
      const devices = await deviceRegistrationService.getDevicesBySenior(req.params.seniorId);
      res.json({ data: devices });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

// ─── Reading Ingestion ──────────────────────────────────────────────────────────

/**
 * POST /ingest
 * Submit a device reading.
 * Roles: Any authenticated user (System / device auth token)
 */
router.post(
  '/ingest',
  createRoleGuard(),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceIntegrationService } = services as ServiceRegistry & {
        deviceIntegrationService: { ingestReading(request: unknown): Promise<unknown> };
      };
      const reading = await deviceIntegrationService.ingestReading(req.body);
      res.status(201).json({ data: reading });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

// ─── Daily Health Records ───────────────────────────────────────────────────────

/**
 * GET /seniors/:seniorId/daily/:date
 * Get daily health record for a senior on a specific date.
 * Roles: Physician, Senior_Citizen, Caregiver, Administrator
 */
router.get(
  '/seniors/:seniorId/daily/:date',
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceIntegrationService } = services as ServiceRegistry & {
        deviceIntegrationService: {
          getDailyRecord(seniorId: string, date: string): Promise<unknown | null>;
        };
      };
      const { seniorId, date } = req.params;
      const record = await deviceIntegrationService.getDailyRecord(seniorId, date);
      if (!record) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: `No daily health record found for senior ${seniorId} on ${date}`,
          },
        });
        return;
      }
      res.json({ data: record });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

/**
 * GET /seniors/:seniorId/readings
 * List readings by date range with pagination.
 * Query params: startDate, endDate, page, pageSize
 * Roles: Physician, Senior_Citizen, Caregiver, Administrator
 */
router.get(
  '/seniors/:seniorId/readings',
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceIntegrationService } = services as ServiceRegistry & {
        deviceIntegrationService: {
          getDailyRecords(seniorId: string, startDate: string, endDate: string): Promise<unknown[]>;
        };
      };
      const { seniorId } = req.params;
      const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

      if (!startDate || !endDate) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'startDate and endDate query parameters are required',
          },
        });
        return;
      }

      const { page, pageSize } = parsePagination(req.query as Record<string, unknown>);
      const records = await deviceIntegrationService.getDailyRecords(seniorId, startDate, endDate);

      // Apply pagination
      const total = records.length;
      const startIndex = (page - 1) * pageSize;
      const paginatedRecords = records.slice(startIndex, startIndex + pageSize);

      res.json({
        data: paginatedRecords,
        meta: { page, pageSize, total },
      });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

// ─── Alerts ─────────────────────────────────────────────────────────────────────

/**
 * GET /seniors/:seniorId/alerts
 * List alerts for a senior with optional filters and pagination.
 * Query params: severity, readingType, startDate, endDate, page, pageSize
 * Roles: Physician, Senior_Citizen, Caregiver, Administrator
 */
router.get(
  '/seniors/:seniorId/alerts',
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { deviceIntegrationService } = services as ServiceRegistry & {
        deviceIntegrationService: {
          getAlerts(seniorId: string, filters?: AlertFilters): Promise<unknown[]>;
        };
      };
      const { seniorId } = req.params;
      const { severity, readingType, startDate, endDate } = req.query as {
        severity?: string;
        readingType?: string;
        startDate?: string;
        endDate?: string;
      };

      const filters: AlertFilters = {};
      if (severity) filters.severity = severity as 'warning' | 'critical';
      if (readingType) filters.readingType = readingType as ReadingType;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const { page, pageSize } = parsePagination(req.query as Record<string, unknown>);
      const alerts = await deviceIntegrationService.getAlerts(seniorId, filters);

      // Apply pagination
      const total = alerts.length;
      const startIndex = (page - 1) * pageSize;
      const paginatedAlerts = alerts.slice(startIndex, startIndex + pageSize);

      res.json({
        data: paginatedAlerts,
        meta: { page, pageSize, total },
      });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

// ─── Trends ─────────────────────────────────────────────────────────────────────

/**
 * GET /seniors/:seniorId/trends/:readingType
 * Get trend summary for a senior and reading type.
 * Query params: period (daily | 7day | 30day, default: 7day)
 * Roles: Physician, Senior_Citizen, Caregiver, Administrator
 */
router.get(
  '/seniors/:seniorId/trends/:readingType',
  createRoleGuard('Physician', 'Senior_Citizen', 'Caregiver', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { trendAnalyzer } = services as ServiceRegistry & {
        trendAnalyzer: {
          computeTrend(seniorId: string, readingType: ReadingType, period: TrendPeriod): Promise<unknown>;
          getTrendDirection(seniorId: string, readingType: ReadingType): Promise<string>;
        };
      };
      const { seniorId, readingType } = req.params;
      const period = (req.query.period as string) || '7day';

      const validPeriods = ['daily', '7day', '30day'];
      if (!validPeriods.includes(period)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid period "${period}". Must be one of: ${validPeriods.join(', ')}`,
          },
        });
        return;
      }

      const validReadingTypes = [
        'blood_pressure', 'blood_glucose', 'heart_rate', 'spo2', 'temperature', 'weight',
      ];
      if (!validReadingTypes.includes(readingType)) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid readingType "${readingType}". Must be one of: ${validReadingTypes.join(', ')}`,
          },
        });
        return;
      }

      const trend = await trendAnalyzer.computeTrend(
        seniorId,
        readingType as ReadingType,
        period as TrendPeriod
      );
      const direction = await trendAnalyzer.getTrendDirection(
        seniorId,
        readingType as ReadingType
      );

      res.json({
        data: { ...(trend as object), direction },
      });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

// ─── Normal Ranges ──────────────────────────────────────────────────────────────

/**
 * GET /normal-ranges
 * List all configured normal ranges.
 * Roles: Physician, Administrator
 */
router.get(
  '/normal-ranges',
  createRoleGuard('Physician', 'Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { normalRangeService } = services as ServiceRegistry & {
        normalRangeService: { getAllRanges(): Promise<unknown[]> };
      };
      const ranges = await normalRangeService.getAllRanges();
      res.json({ data: ranges });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

/**
 * POST /normal-ranges
 * Create or update a normal range configuration.
 * Roles: Administrator
 */
router.post(
  '/normal-ranges',
  createRoleGuard('Administrator'),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const services = getServices(req);
      const { normalRangeService } = services as ServiceRegistry & {
        normalRangeService: { configure(request: unknown): Promise<unknown> };
      };
      const range = await normalRangeService.configure(req.body);
      res.status(201).json({ data: range });
    } catch (error: unknown) {
      mapErrorToResponse(error, res);
    }
  }
);

export default router;
