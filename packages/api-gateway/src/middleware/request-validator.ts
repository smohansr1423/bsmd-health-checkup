/**
 * API Gateway Request Validation Middleware
 * Validates incoming request bodies, params, and query strings
 * against defined schemas before forwarding to services.
 * Validates: Requirements 18.4
 */

import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest, ValidationSchema, ValidationRule } from '../types';
import { AppError } from './error-handler';

/** Validation error detail */
interface ValidationFieldError {
  field: string;
  message: string;
  received?: unknown;
}

/**
 * Validates a single field against a validation rule.
 */
function validateField(value: unknown, rule: ValidationRule): string | null {
  // Check required
  if (rule.required && (value === undefined || value === null || value === '')) {
    return `${rule.field} is required`;
  }

  // If not required and not provided, skip further checks
  if (value === undefined || value === null || value === '') {
    return null;
  }

  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return `${rule.field} must be a string`;
      }
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        return `${rule.field} must be at least ${rule.minLength} characters`;
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        return `${rule.field} must be at most ${rule.maxLength} characters`;
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        return `${rule.field} has an invalid format`;
      }
      break;
    }
    case 'number': {
      const num = typeof value === 'string' ? Number(value) : value;
      if (typeof num !== 'number' || isNaN(num)) {
        return `${rule.field} must be a valid number`;
      }
      if (rule.min !== undefined && num < rule.min) {
        return `${rule.field} must be at least ${rule.min}`;
      }
      if (rule.max !== undefined && num > rule.max) {
        return `${rule.field} must be at most ${rule.max}`;
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        return `${rule.field} must be a boolean`;
      }
      break;
    }
    case 'date': {
      const date = new Date(value as string);
      if (isNaN(date.getTime())) {
        return `${rule.field} must be a valid date`;
      }
      break;
    }
    case 'email': {
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return `${rule.field} must be a valid email address`;
      }
      break;
    }
    case 'uuid': {
      if (
        typeof value !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      ) {
        return `${rule.field} must be a valid UUID`;
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return `${rule.field} must be an array`;
      }
      break;
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `${rule.field} must be an object`;
      }
      break;
    }
  }

  return null;
}

/**
 * Validates a source object (body, params, or query) against validation rules.
 */
function validateSource(
  source: Record<string, unknown> | undefined,
  rules: ValidationRule[],
  sourceName: string
): ValidationFieldError[] {
  const errors: ValidationFieldError[] = [];
  const data = source || {};

  for (const rule of rules) {
    const value = data[rule.field];
    const error = validateField(value, rule);
    if (error) {
      errors.push({
        field: `${sourceName}.${rule.field}`,
        message: error,
        received: value,
      });
    }
  }

  return errors;
}

/**
 * Creates request validation middleware for a given schema.
 *
 * @param schema - Validation schema defining rules for body, params, and query
 * @returns Express middleware that validates the request
 */
export function createRequestValidator(schema: ValidationSchema) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    const errors: ValidationFieldError[] = [];

    if (schema.body) {
      errors.push(...validateSource(req.body, schema.body, 'body'));
    }

    if (schema.params) {
      errors.push(...validateSource(req.params, schema.params, 'params'));
    }

    if (schema.query) {
      errors.push(
        ...validateSource(req.query as Record<string, unknown>, schema.query, 'query')
      );
    }

    if (errors.length > 0) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', {
        errors,
      });
    }

    next();
  };
}

/**
 * Common validation schemas reusable across routes.
 */
export const commonSchemas: Record<string, ValidationSchema> = {
  /** Validate UUID path parameter :id */
  idParam: {
    params: [{ field: 'id', type: 'uuid', required: true }],
  },

  /** Validate pagination query parameters */
  pagination: {
    query: [
      { field: 'page', type: 'number', min: 1 },
      { field: 'limit', type: 'number', min: 1, max: 100 },
    ],
  },

  /** Validate date range query parameters */
  dateRange: {
    query: [
      { field: 'startDate', type: 'date' },
      { field: 'endDate', type: 'date' },
    ],
  },
};
