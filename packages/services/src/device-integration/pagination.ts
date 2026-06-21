/**
 * Pagination utilities for device integration list endpoints.
 * Validates: Requirements 8.4
 */

import {
  PaginationParams,
  PaginatedResponse,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './device-integration.types';

/**
 * Parses and validates pagination query parameters.
 * - Defaults page to 1 if not provided or invalid
 * - Defaults pageSize to DEFAULT_PAGE_SIZE (20) if not provided or invalid
 * - Caps pageSize at MAX_PAGE_SIZE (100) regardless of input
 * - Ensures page is at least 1
 */
export function parsePaginationParams(
  query: Record<string, unknown>
): PaginationParams {
  let page = Number(query.page);
  let pageSize = Number(query.pageSize);

  // Default page to 1 if not a valid positive integer
  if (!Number.isFinite(page) || page < 1) {
    page = 1;
  } else {
    page = Math.floor(page);
  }

  // Default pageSize to DEFAULT_PAGE_SIZE if not a valid positive integer
  if (!Number.isFinite(pageSize) || pageSize < 1) {
    pageSize = DEFAULT_PAGE_SIZE;
  } else {
    pageSize = Math.floor(pageSize);
  }

  // Cap pageSize at MAX_PAGE_SIZE
  if (pageSize > MAX_PAGE_SIZE) {
    pageSize = MAX_PAGE_SIZE;
  }

  return { page, pageSize };
}

/**
 * Paginates an array of items based on the given pagination parameters.
 * Returns the sliced data along with pagination metadata.
 */
export function paginateArray<T>(
  items: T[],
  params: PaginationParams
): PaginatedResponse<T> {
  const { page, pageSize } = params;
  const total = items.length;
  const offset = (page - 1) * pageSize;
  const data = items.slice(offset, offset + pageSize);

  return {
    data,
    meta: {
      page,
      pageSize,
      total,
    },
  };
}
