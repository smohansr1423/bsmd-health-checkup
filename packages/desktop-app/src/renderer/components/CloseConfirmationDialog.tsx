/**
 * Close-confirmation dialog (Task 13.1 — Req 18.4).
 *
 * Shown when the User tries to close the window while a backend request is in
 * flight. The decision to show it comes from the pure {@link shouldConfirmClose}
 * logic (driven by the main process intercepting the OS `close` event); this
 * component only renders the prompt and reports the User's choice.
 */

import React from 'react';
import { CLOSE_CONFIRMATION_COPY } from './close-confirmation';

export interface CloseConfirmationDialogProps {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the User confirms closing despite the in-flight request. */
  onConfirm: () => void;
  /** Called when the User cancels the close and keeps working. */
  onCancel: () => void;
}

/** A modal confirmation shown before closing with an in-progress request. */
export function CloseConfirmationDialog({
  open,
  onConfirm,
  onCancel,
}: CloseConfirmationDialogProps): React.ReactElement | null {
  if (!open) {
    return null;
  }
  return (
    <div
      className="close-confirmation"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="close-confirmation-title"
      aria-describedby="close-confirmation-body"
    >
      <h2 id="close-confirmation-title">{CLOSE_CONFIRMATION_COPY.title}</h2>
      <p id="close-confirmation-body">{CLOSE_CONFIRMATION_COPY.body}</p>
      <div className="close-confirmation__actions">
        <button type="button" onClick={onCancel}>
          {CLOSE_CONFIRMATION_COPY.cancelLabel}
        </button>
        <button type="button" onClick={onConfirm}>
          {CLOSE_CONFIRMATION_COPY.confirmLabel}
        </button>
      </div>
    </div>
  );
}
