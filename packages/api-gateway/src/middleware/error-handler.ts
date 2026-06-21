/**
 * API Gateway Error Handler Middleware
 * Provides standardized error response formatting.
 * Validates: Requirements 18.4
 *
 * Error format: { error: { code, message, details? } }
 */

import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types';

/**
 * Known application error class for typed error handling.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

/**
 * Creates a 400 Bad Request error.
 */
export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'BAD_REQUEST', message, details);
}

/**
 * Creates a 404 Not Found error.
 */
export function notFound(message: string): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

/**
 * Creates a 409 Conflict error.
 */
export function conflict(message: string, details?: unknown): AppError {
  return new AppError(409, 'CONFLICT', message, details);
}

/**
 * Creates a 422 Unprocessable Entity error.
 */
export function validationError(message: string, details?: unknown): AppError {
  return new AppError(422, 'VALIDATION_ERROR', message, details);
}

/**
 * Creates a 503 Service Unavailable error.
 */
export function serviceUnavailable(message: string): AppError {
  return new AppError(503, 'SERVICE_UNAVAILABLE', message);
}

/**
 * Express error handling middleware.
 * Formats all errors into the standardized { error: { code, message, details? } } shape.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Handle known application errors
  if (err instanceof AppError) {
    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
      },
    };
    if (err.details !== undefined) {
      response.error.details = err.details;
    }
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle JSON parse errors (malformed request body)
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      error: {
        code: 'MALFORMED_REQUEST',
        message: 'Request body contains invalid JSON',
      },
    } as ErrorResponse);
    return;
  }

  // Handle unknown/unexpected errors
  // In production, do not leak internal error details
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'An unexpected error occurred. Please try again later.'
        : err.message || 'An unexpected error occurred.',
    },
  } as ErrorResponse);
}

/**
 * 404 handler for unmatched routes.
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested endpoint does not exist.',
    },
  } as ErrorResponse);
}
