/**
 * Unit tests for API Gateway Error Handler Middleware
 */

import { errorHandler, notFoundHandler, AppError, badRequest, notFound, conflict, validationError, serviceUnavailable } from './error-handler';
import type { Request, Response, NextFunction } from 'express';

function createMockReq(): Request {
  return {} as Request;
}

function createMockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  } as unknown as Response & { statusCode: number; body: unknown };
  return res;
}

describe('errorHandler', () => {
  const req = createMockReq();
  const next = jest.fn() as NextFunction;

  it('should format AppError into standardized response', () => {
    const err = new AppError(400, 'BAD_REQUEST', 'Invalid input', { field: 'name' });
    const res = createMockRes();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        details: { field: 'name' },
      },
    });
  });

  it('should handle AppError without details', () => {
    const err = new AppError(404, 'NOT_FOUND', 'Resource not found');
    const res = createMockRes();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    });
  });

  it('should handle SyntaxError from JSON parsing', () => {
    const err = Object.assign(new SyntaxError('Unexpected token'), { body: true });
    const res = createMockRes();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(400);
    expect((res.body as any).error.code).toBe('MALFORMED_REQUEST');
  });

  it('should handle unknown errors with 500', () => {
    const err = new Error('something broke');
    const res = createMockRes();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect((res.body as any).error.code).toBe('INTERNAL_ERROR');
  });

  it('should hide error details in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const err = new Error('secret internal details');
    const res = createMockRes();

    errorHandler(err, req, res, next);

    expect(res.statusCode).toBe(500);
    expect((res.body as any).error.message).toBe('An unexpected error occurred. Please try again later.');

    process.env.NODE_ENV = originalEnv;
  });
});

describe('notFoundHandler', () => {
  it('should return 404 with standardized format', () => {
    const req = createMockReq();
    const res = createMockRes();

    notFoundHandler(req, res as Response);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested endpoint does not exist.',
      },
    });
  });
});

describe('error factory functions', () => {
  it('badRequest creates 400 error', () => {
    const err = badRequest('Invalid data', { field: 'email' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('notFound creates 404 error', () => {
    const err = notFound('User not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('conflict creates 409 error', () => {
    const err = conflict('Duplicate entry');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('validationError creates 422 error', () => {
    const err = validationError('Validation failed', [{ field: 'name' }]);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('serviceUnavailable creates 503 error', () => {
    const err = serviceUnavailable('Service down');
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });
});
