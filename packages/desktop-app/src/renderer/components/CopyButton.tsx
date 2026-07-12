/**
 * Copy-to-clipboard button (Task 13.1 — Req 13.3).
 *
 * Renders a button that copies the given `text` (a generated Code_Snippet) to
 * the OS clipboard and surfaces a transient "copied"/"copy failed" message. The
 * clipboard write is delegated to the pure {@link copyToClipboard} helper, and
 * the writer is injectable for testing.
 */

import React, { useState } from 'react';
import { copyToClipboard, type ClipboardWriter } from './clipboard';

export interface CopyButtonProps {
  /** The text to copy to the clipboard. */
  text: string;
  /** The button label. */
  label?: string;
  /** Optional clipboard writer override (tests). */
  writer?: ClipboardWriter;
}

/** A button that copies `text` to the clipboard and reports the result. */
export function CopyButton({
  text,
  label = 'Copy',
  writer,
}: CopyButtonProps): React.ReactElement {
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleCopy = async (): Promise<void> => {
    const result = await copyToClipboard(text, writer);
    setFeedback(result.message);
  };

  return (
    <span className="copy-action">
      <button type="button" onClick={handleCopy} aria-label="Copy code snippet">
        {label}
      </button>
      {feedback !== null ? (
        <span role="status" className="copy-feedback">
          {feedback}
        </span>
      ) : null}
    </span>
  );
}
