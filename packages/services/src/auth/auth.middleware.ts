/**
 * Authentication Middleware for Express
 * Validates JWT tokens and enforces session timeout.
 * Validates: Requirements 18.1, 18.5, 18.7
 *
 * Usage:
 *   app.use(createAuthMiddleware(authService));
 *   app.get('/protected', requireRole('Physician'), handler);
 */

import type { AuthToken, Role } from './auth.types';
import type { AuthService } from './auth.service';

/** Extends Express Request with auth context */
export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthToken;
}

/** Minimal response interface (compatible with Express Response) */
export interface MiddlewareResponse {
  status(code: number): MiddlewareResponse;
  json(body: unknown): void;
}

/** Next function for middleware chaining */
export type NextFunction = () => void;

/**
 * Creates authentication middleware that validates JWT tokens.
 * Checks:
 * 1. Authorization header is present with Bearer token
 * 2. Token is valid (not expired, not revoked)
 * 3. Session is active and not timed out (15-minute inactivity)
 *
 * On success: attaches AuthToken to request.auth and refreshes session activity.
 * On failure: returns 401 Unauthorized.
 */
export function createAuthMiddleware(authService: AuthService) {
  return (req: AuthenticatedRequest, res: MiddlewareResponse, next: NextFunction): void => {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'No authorization header provided',
      });
      return;
    }

    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;

    if (!headerValue || !headerValue.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'Invalid authorization header format. Expected: Bearer <token>',
      });
      return;
    }

    const tokenString = headerValue.substring(7); // Remove 'Bearer '

    const authToken = authService.validateToken(tokenString);
    if (!authToken) {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired token. Please re-authenticate.',
      });
      return;
    }

    // Refresh session activity
    const sessionActive = authService.refreshSession(authToken.sessionId);
    if (!sessionActive) {
      res.status(401).json({
        error: 'Session expired',
        message: 'Your session has expired due to inactivity. Please log in again.',
      });
      return;
    }

    // Attach auth token to request
    req.auth = authToken;
    next();
  };
}

/**
 * Creates role-based authorization middleware.
 * Must be used AFTER createAuthMiddleware.
 *
 * Denies access and records unauthorized attempt in audit log if
 * the user's role is not in the allowed list.
 * Validates: Requirements 18.1, 18.7
 */
export function requireRole(authService: AuthService, ...allowedRoles: Role[]) {
  return async (
    req: AuthenticatedRequest,
    res: MiddlewareResponse,
    next: NextFunction
  ): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'You must be authenticated to access this resource.',
      });
      return;
    }

    if (!allowedRoles.includes(req.auth.role)) {
      // Record unauthorized access attempt
      await authService.recordAuditEntry({
        userId: req.auth.userId,
        action: 'unauthorized_access_attempt',
        resourceType: 'route',
        resourceId: '',
        details: {
          role: req.auth.role,
          allowedRoles,
          message: 'Insufficient permissions',
        },
      });

      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to access this resource.',
      });
      return;
    }

    next();
  };
}

/**
 * Creates resource-level authorization middleware.
 * Checks whether the user's role allows the specified action on the resource.
 * Must be used AFTER createAuthMiddleware.
 * Validates: Requirements 18.1, 18.7
 */
export function requirePermission(authService: AuthService, resource: string, action: string) {
  return async (
    req: AuthenticatedRequest,
    res: MiddlewareResponse,
    next: NextFunction
  ): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'You must be authenticated to access this resource.',
      });
      return;
    }

    const permitted = await authService.authorize(req.auth, resource, action);
    if (!permitted) {
      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'You do not have permission to perform this action on this resource.',
      });
      return;
    }

    next();
  };
}
