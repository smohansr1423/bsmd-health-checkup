/**
 * Unit tests for API Gateway Request Validator Middleware
 */

import { createRequestValidator } from './request-validator';
import { AppError } from './error-handler';
import type { AuthenticatedRequest, ValidationSchema } from '../types';
import type { Response, NextFunction } from 'express';

function createMockReq(
  body?: Record<string, unknown>,
  params?: Record<string, unknown>,
  query?: Record<string, unknown>
): AuthenticatedRequest {
  return {
    body: body || {},
    params: params || {},
    query: query || {},
    headers: {},
  } as unknown as AuthenticatedRequest;
}

function createMockRes(): Response {
  return {} as Response;
}

describe('createRequestValidator', () => {
  const next = jest.fn() as jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next.mockClear();
  });

  it('should call next when validation passes', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'name', type: 'string', required: true }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({ name: 'John' });
    const res = createMockRes();

    validator(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should throw AppError when required field is missing', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'name', type: 'string', required: true }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({});
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
    expect(next).not.toHaveBeenCalled();
  });

  it('should validate string type', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'name', type: 'string', required: true }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({ name: 123 });
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
  });

  it('should validate string minLength', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'name', type: 'string', required: true, minLength: 3 }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({ name: 'ab' });
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
  });

  it('should validate string maxLength', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'name', type: 'string', required: true, maxLength: 5 }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({ name: 'too long string' });
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
  });

  it('should validate number type', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'age', type: 'number', required: true, min: 0, max: 150 }],
    };
    const validator = createRequestValidator(schema);

    const req = createMockReq({ age: 65 });
    const res = createMockRes();
    validator(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should validate number min/max', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'age', type: 'number', required: true, min: 60 }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({ age: 55 });
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
  });

  it('should validate email format', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'email', type: 'email', required: true }],
    };
    const validator = createRequestValidator(schema);

    const validReq = createMockReq({ email: 'user@example.com' });
    const res = createMockRes();
    validator(validReq, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    const invalidReq = createMockReq({ email: 'not-an-email' });
    expect(() => validator(invalidReq, res, next)).toThrow(AppError);
  });

  it('should validate UUID format', () => {
    const schema: ValidationSchema = {
      params: [{ field: 'id', type: 'uuid', required: true }],
    };
    const validator = createRequestValidator(schema);

    const validReq = createMockReq({}, { id: '550e8400-e29b-41d4-a716-446655440000' });
    const res = createMockRes();
    validator(validReq, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    const invalidReq = createMockReq({}, { id: 'not-a-uuid' });
    expect(() => validator(invalidReq, res, next)).toThrow(AppError);
  });

  it('should validate date format', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'dob', type: 'date', required: true }],
    };
    const validator = createRequestValidator(schema);

    const validReq = createMockReq({ dob: '1960-05-15' });
    const res = createMockRes();
    validator(validReq, res, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    const invalidReq = createMockReq({ dob: 'not-a-date' });
    expect(() => validator(invalidReq, res, next)).toThrow(AppError);
  });

  it('should skip optional fields when not provided', () => {
    const schema: ValidationSchema = {
      body: [{ field: 'nickname', type: 'string', required: false }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({});
    const res = createMockRes();

    validator(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should validate query parameters', () => {
    const schema: ValidationSchema = {
      query: [{ field: 'page', type: 'number', min: 1 }],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({}, {}, { page: '0' });
    const res = createMockRes();

    expect(() => validator(req, res, next)).toThrow(AppError);
  });

  it('should include all field errors in details', () => {
    const schema: ValidationSchema = {
      body: [
        { field: 'name', type: 'string', required: true },
        { field: 'age', type: 'number', required: true },
      ],
    };
    const validator = createRequestValidator(schema);
    const req = createMockReq({});
    const res = createMockRes();

    try {
      validator(req, res, next);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.statusCode).toBe(422);
      expect((appErr.details as any).errors).toHaveLength(2);
    }
  });
});
