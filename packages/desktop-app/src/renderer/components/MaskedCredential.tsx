/**
 * Masked credential display (Task 13.1 — Req 10.3, 10.4).
 *
 * Renders a configured target-API credential using only its non-secret scheme /
 * label and a masked secret. The plaintext secret is never accepted as a
 * rendered value — callers pass the already-masked view produced by
 * {@link toMaskedCredential}.
 */

import React from 'react';
import type { MaskedCredentialView } from './masking';

export interface MaskedCredentialProps {
  /** The view-safe, already-masked credential. */
  credential: MaskedCredentialView;
}

/** Render a single configured credential in masked form only (Req 10.3). */
export function MaskedCredential({
  credential,
}: MaskedCredentialProps): React.ReactElement {
  return (
    <div className="masked-credential">
      <span className="masked-credential__scheme">{credential.scheme}</span>
      <span className="masked-credential__label">{credential.label}</span>
      <span className="masked-credential__value" aria-label="masked credential value">
        {credential.masked}
      </span>
    </div>
  );
}
