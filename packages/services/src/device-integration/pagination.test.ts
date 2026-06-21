/**
 * Unit tests for pagination utilities.
 * Validates: Requirements 8.4
 */

import { parsePaginationParams, paginateArray } from './pagination';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './device-integration.types';

describe('parsePaginationParams', () => {
  it('returns defaults when no params are provided', () => {
    const result = parsePaginationParams({});
    expect(result).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it('parses valid page and pageSize', () => {
    const result = parsePaginationParams({ page: '3', pageSize: '50' });
    expect(result).toEqual({ page: 3, pageSize: 50 });
  });

  it('defaults page to 1 when invalid', () => {
    expect(parsePaginationParams({ page: 'abc', pageSize: '10' })).toEqual({
      page: 1,
      pageSize: 10,
    });
    expect(parsePaginationParams({ page: '-5', pageSize: '10' })).toEqual({
      page: 1,
      pageSize: 10,
    });
    expect(parsePaginationParams({ page: '0', pageSize: '10' })).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it('defaults pageSize to DEFAULT_PAGE_SIZE when invalid', () => {
    expect(parsePaginationParams({ page: '1', pageSize: 'abc' })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(parsePaginationParams({ page: '1', pageSize: '-10' })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(parsePaginationParams({ page: '1', pageSize: '0' })).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('caps pageSize at MAX_PAGE_SIZE', () => {
    const result = parsePaginationParams({ page: '1', pageSize: '500' });
    expect(result).toEqual({ page: 1, pageSize: MAX_PAGE_SIZE });
  });

  it('floors fractional page and pageSize values', () => {
    const result = parsePaginationParams({ page: '2.7', pageSize: '15.9' });
    expect(result).toEqual({ page: 2, pageSize: 15 });
  });

  it('handles numeric inputs (not just strings)', () => {
    const result = parsePaginationParams({ page: 4, pageSize: 30 });
    expect(result).toEqual({ page: 4, pageSize: 30 });
  });
});

describe('paginateArray', () => {
  const items = Array.from({ length: 50 }, (_, i) => `item-${i + 1}`);

  it('returns the first page with default pageSize', () => {
    const result = paginateArray(items, { page: 1, pageSize: 20 });
    expect(result.data).toHaveLength(20);
    expect(result.data[0]).toBe('item-1');
    expect(result.data[19]).toBe('item-20');
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 50 });
  });

  it('returns the second page correctly', () => {
    const result = paginateArray(items, { page: 2, pageSize: 20 });
    expect(result.data).toHaveLength(20);
    expect(result.data[0]).toBe('item-21');
    expect(result.data[19]).toBe('item-40');
    expect(result.meta).toEqual({ page: 2, pageSize: 20, total: 50 });
  });

  it('returns a partial last page', () => {
    const result = paginateArray(items, { page: 3, pageSize: 20 });
    expect(result.data).toHaveLength(10);
    expect(result.data[0]).toBe('item-41');
    expect(result.data[9]).toBe('item-50');
    expect(result.meta).toEqual({ page: 3, pageSize: 20, total: 50 });
  });

  it('returns empty data when page exceeds total', () => {
    const result = paginateArray(items, { page: 10, pageSize: 20 });
    expect(result.data).toHaveLength(0);
    expect(result.meta).toEqual({ page: 10, pageSize: 20, total: 50 });
  });

  it('returns empty data for an empty array', () => {
    const result = paginateArray([], { page: 1, pageSize: 20 });
    expect(result.data).toHaveLength(0);
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 0 });
  });

  it('handles custom pageSize', () => {
    const result = paginateArray(items, { page: 1, pageSize: 5 });
    expect(result.data).toHaveLength(5);
    expect(result.data[0]).toBe('item-1');
    expect(result.data[4]).toBe('item-5');
    expect(result.meta).toEqual({ page: 1, pageSize: 5, total: 50 });
  });
});
