/**
 * Close-confirmation logic (Task 13.1 — Req 18.4).
 *
 * **Pure** helpers that decide whether closing the window should be confirmed
 * with the User. On a close request, if any backend request is still in
 * progress, the app must ask the User to confirm before quitting so an
 * in-flight operation is not silently abandoned (Req 18.4). The main process
 * intercepts the OS `close` event and asks the renderer, which uses this logic
 * to decide whether to show the confirmation dialog.
 */

import type { AppState, RequestStatus } from '../state/types';

/**
 * Whether any tracked operation is still loading.
 *
 * Derived purely from the per-operation request statuses (Req 16.1). An
 * operation is "in flight" while its status is `loading`; success/error/idle
 * are all settled.
 */
export function hasInFlightRequests(
  requests: Record<string, RequestStatus>,
): boolean {
  return Object.values(requests).some((status) => status === 'loading');
}

/**
 * Whether a close request should be confirmed with the User first (Req 18.4).
 *
 * Returns `true` iff at least one request is in flight; with nothing in
 * progress the window may close immediately without a prompt.
 */
export function shouldConfirmClose(state: Pick<AppState, 'requests'>): boolean {
  return hasInFlightRequests(state.requests);
}

/** The copy shown in the close-confirmation dialog (presentation constants). */
export const CLOSE_CONFIRMATION_COPY = {
  title: 'Close while a request is running?',
  body: 'A request is still in progress. If you close now it will be interrupted.',
  confirmLabel: 'Close anyway',
  cancelLabel: 'Keep working',
} as const;
