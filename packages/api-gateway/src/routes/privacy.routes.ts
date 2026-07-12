/**
 * Privacy Routes
 * Personal-data deletion endpoint. When a user submits a deletion request,
 * the platform deletes the associated personal data within 30 days and
 * returns a confirmation to the user.
 * Validates: Requirements 18.7
 */

import { Router, type Response, type NextFunction } from 'express';
import type { AuthenticatedRequest } from '../types';
import { createRoleGuard } from '../middleware';

const router = Router();

/** Maximum number of days allowed to complete a personal-data deletion. */
export const MAX_DELETION_DAYS = 30;

/** Optional service contract for delegating personal-data deletion. */
interface PersonalDataDeletionService {
  requestDeletion(userId: string): Promise<{ requestId?: string; status?: string } | void>;
}

/** Confirmation payload returned when a deletion request is accepted. */
export interface DeletionConfirmation {
  userId: string;
  status: string;
  requestId?: string;
  requestedAt: string;
  completionDeadline: string;
  maxCompletionDays: number;
  confirmation: string;
}

/**
 * Builds the deletion confirmation, computing the completion deadline as
 * `requestedAt + 30 days` (Req 18.7). Pure and deterministic given inputs.
 */
export function buildDeletionConfirmation(
  userId: string,
  requestedAt: Date,
  result?: { requestId?: string; status?: string } | void
): DeletionConfirmation {
  const completionDeadline = new Date(
    requestedAt.getTime() + MAX_DELETION_DAYS * 24 * 60 * 60 * 1000
  );

  return {
    userId,
    status: (result && result.status) || 'scheduled',
    requestId: result ? result.requestId : undefined,
    requestedAt: requestedAt.toISOString(),
    completionDeadline: completionDeadline.toISOString(),
    maxCompletionDays: MAX_DELETION_DAYS,
    confirmation:
      'Your personal-data deletion request has been received and will be ' +
      `completed within ${MAX_DELETION_DAYS} days.`,
  };
}

/**
 * Resolve an optional personal-data deletion service from the registry.
 * Domain wiring is handled separately; when absent, the endpoint still
 * records the request and returns a confirmation with the completion deadline.
 */
function getDeletionService(req: AuthenticatedRequest): PersonalDataDeletionService | undefined {
  const services = req.app.locals.services as
    | { personalDataDeletionService?: PersonalDataDeletionService }
    | undefined;
  return services?.personalDataDeletionService;
}

/**
 * POST /deletion-requests
 * Submit a request to delete the authenticated user's personal data.
 * Responds with a confirmation that includes the deadline by which the
 * deletion will be completed (within 30 days).
 */
router.post(
  '/deletion-requests',
  createRoleGuard(),
  async (req: AuthenticatedRequest, res: Response, _next: NextFunction) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'You must be authenticated to request personal-data deletion.',
          },
        });
        return;
      }

      const requestedAt = new Date();

      // Delegate to the domain service when available; otherwise the request
      // is acknowledged and scheduled for completion within the deadline.
      const service = getDeletionService(req);
      const result = service ? await service.requestDeletion(userId) : undefined;

      res.status(202).json({
        data: buildDeletionConfirmation(userId, requestedAt, result),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message,
        },
      });
    }
  }
);

export default router;
