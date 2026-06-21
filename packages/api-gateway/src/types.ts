/**
 * API Gateway Types
 * Defines shared types for the Express-based API Gateway (BFF pattern).
 * Validates: Requirements 18.1, 18.4, 18.5
 */

import type { AuthToken, Role } from '@health-checkup/services';
import type { Request } from 'express';

/** Extended Express Request with auth context */
export interface AuthenticatedRequest extends Request {
  auth?: AuthToken;
}

/** Standardized error response format */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Rate limit configuration per route */
export interface RateLimitConfig {
  /** Maximum number of requests within the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Optional key prefix for grouping */
  keyPrefix?: string;
}

/** Predefined rate limit presets */
export const RATE_LIMIT_PRESETS = {
  /** 100 requests per minute — typical read operations */
  read: { maxRequests: 100, windowMs: 60 * 1000 } as RateLimitConfig,
  /** 20 requests per minute — write/mutation operations */
  write: { maxRequests: 20, windowMs: 60 * 1000 } as RateLimitConfig,
  /** 5 requests per minute — sensitive operations (auth, payment) */
  sensitive: { maxRequests: 5, windowMs: 60 * 1000 } as RateLimitConfig,
} as const;

/** Route definition for the gateway */
export interface RouteDefinition {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  /** Whether this route requires authentication (default: true) */
  requiresAuth?: boolean;
  /** Allowed roles (empty = all authenticated users) */
  allowedRoles?: Role[];
  /** Rate limit config for this route */
  rateLimit?: RateLimitConfig;
  /** Validation schema key (maps to a validator function) */
  validationSchema?: string;
}

/** Service route group */
export interface ServiceRouteGroup {
  /** Base path prefix, e.g. '/api/registration' */
  basePath: string;
  /** Service name for logging/tracing */
  serviceName: string;
  /** Routes in this group */
  routes: RouteDefinition[];
}

/** Request validation rule */
export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'email' | 'uuid' | 'array' | 'object';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
}

/** Validation schema: collection of rules for a request */
export interface ValidationSchema {
  body?: ValidationRule[];
  params?: ValidationRule[];
  query?: ValidationRule[];
}
