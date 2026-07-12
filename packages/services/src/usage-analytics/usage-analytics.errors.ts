/**
 * Usage Analytics — Errors
 *
 * Custom error types for the Usage Analytics service.
 *
 * Access to the dashboard by an unauthorized user is denied by reusing the
 * workspace domain's {@link AuthorizationError} (Req 16.5), so the same
 * isolation semantics apply across conversation-history and analytics reads.
 *
 * Validates: Requirements 16.5, 16.7
 */

// Re-export the workspace domain's authorization error so callers of the
// analytics service map unauthorized dashboard access to the same error class
// used elsewhere (Req 16.5, 18.5).
export { AuthorizationError } from '../workspace';

/**
 * Thrown when analytics data cannot be retrieved for the dashboard within the
 * allotted budget (Req 16.7).
 *
 * The error indicates that usage data could not be loaded and that a retry is
 * available (`retryable`). Retrieval is read-only, so any previously recorded
 * usage events are retained unchanged.
 */
export class DashboardLoadError extends Error {
  public readonly workspaceId: string;
  /** Always true: the dashboard offers a retry action (Req 16.7). */
  public readonly retryable: boolean;
  /** The underlying retrieval failure, when available. */
  public readonly cause?: unknown;

  constructor(workspaceId: string, cause?: unknown) {
    super(
      `Usage data could not be loaded for workspace "${workspaceId}". ` +
        `Previously recorded usage events are retained; retry is available.`
    );
    this.name = 'DashboardLoadError';
    this.workspaceId = workspaceId;
    this.retryable = true;
    this.cause = cause;
  }
}
