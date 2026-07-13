/**
 * Target-API credential configuration view (Task 13.9 — Req 10.1, 10.2, 10.3, 10.4).
 *
 * Lists the supported authentication schemes reported by the backend (Req 10.1),
 * lets the User submit credential values for a chosen scheme — sent to the
 * `auth-assistant` credentials Backend_Endpoint through the main-process broker,
 * which always transmits over the stored HTTPS base URL (Req 10.2) — and renders
 * every configured credential in **masked form only** (Req 10.3). Any credential
 * submission error surfaced here is secret-free (Req 10.4): the view renders the
 * caller-supplied message verbatim and never echoes an entered secret.
 *
 * Secret handling: entered secrets live only in transient, controlled inputs
 * that are cleared on submit; they are never written to `retainInput`, so no
 * secret is retained anywhere in app state.
 */

import React, { useMemo, useState } from 'react';
import { authAssistant } from '../app-client/builders';
import type { CredentialInput } from '../app-client/types';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { MaskedCredential } from '../components/MaskedCredential';
import type { MaskedCredentialView } from '../components/masking';
import { EmptyState } from '../components/EmptyState';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for loading the supported schemes (Req 10.1). */
export const SCHEMES_OP = 'auth-assistant:schemes';

/** Stable operation id for submitting a credential (Req 10.2). */
export const SET_CREDENTIAL_OP = 'auth-assistant:set-credential';

/** A single credential input field required by an authentication scheme. */
export interface AuthSchemeField {
  /** The field's stable name, used as the value key sent to the backend. */
  name: string;
  /** A human-readable label for the field. */
  label: string;
  /** Whether the field holds a secret value (rendered as a password input). */
  secret?: boolean;
}

/** A supported authentication scheme (mirrors the backend by name). */
export interface AuthScheme {
  /** The scheme's stable identifier. */
  id: string;
  /** A human-readable label for the scheme. */
  label: string;
  /** The credential fields the scheme requires. */
  fields: readonly AuthSchemeField[];
}

export interface CredentialViewProps {
  /** Supported authentication schemes, or undefined before they load (Req 10.1). */
  schemes?: readonly AuthScheme[];
  /** Configured credentials, already masked for display (Req 10.3). */
  credentials?: readonly MaskedCredentialView[];
  /** A secret-free credential-submission error to surface, if any (Req 10.4). */
  error?: string;
}

export function CredentialView({
  schemes,
  credentials,
  error,
}: CredentialViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const loading = state.requests[SET_CREDENTIAL_OP] === 'loading';

  const selectedScheme = useMemo(
    () => (schemes ?? []).find((scheme) => scheme.id === selectedSchemeId),
    [schemes, selectedSchemeId],
  );

  const handleSchemeChange = (schemeId: string): void => {
    // Changing scheme resets the entered values so no secret carries over.
    setSelectedSchemeId(schemeId);
    setValues({});
    setMessage(null);
  };

  const handleFieldChange = (name: string, value: string): void => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (!selectedScheme) {
      setMessage('Select an authentication scheme before submitting credentials.');
      return;
    }
    // Every field the scheme declares must have a non-empty value.
    const missing = selectedScheme.fields.find(
      (field) => (values[field.name] ?? '').length === 0,
    );
    if (missing) {
      setMessage(`${missing.label} is required.`);
      return;
    }
    setMessage(null);
    const input: CredentialInput = {
      scheme: selectedScheme.id,
      values,
      // Scope the credential to the Active_API_Version's API when one is set.
      targetApiRef: state.activeApiVersion?.apiId ?? '',
    };
    void actions.runRequest?.({
      operationId: SET_CREDENTIAL_OP,
      view: 'api-browser',
      descriptor: authAssistant.setCredential(input),
      // Never retain secrets for retry (Req 10.3, 10.4).
    });
    // Clear the entered secrets from the transient input state immediately.
    setValues({});
  };

  return (
    <section className="view view--credentials" aria-labelledby="credentials-title">
      <h1 id="credentials-title">Configure target-API credentials</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Authentication scheme
          <select
            name="scheme"
            value={selectedSchemeId}
            onChange={(e) => handleSchemeChange(e.target.value)}
          >
            <option value="">Select a scheme</option>
            {(schemes ?? []).map((scheme) => (
              <option key={scheme.id} value={scheme.id}>
                {scheme.label}
              </option>
            ))}
          </select>
        </label>

        {selectedScheme?.fields.map((field) => (
          <label key={field.name}>
            {field.label}
            <input
              type={field.secret === false ? 'text' : 'password'}
              name={field.name}
              value={values[field.name] ?? ''}
              onChange={(e) => handleFieldChange(field.name, e.target.value)}
              autoComplete="off"
            />
          </label>
        ))}

        {message !== null ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : null}

        {error !== undefined ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={loading}>
          Save credential
        </button>
      </form>

      {loading ? <LoadingIndicator label="Saving credential…" /> : null}

      <section className="configured-credentials" aria-labelledby="configured-title">
        <h2 id="configured-title">Configured credentials</h2>
        {credentials === undefined || credentials.length === 0 ? (
          <EmptyState message="No target-API credentials have been configured yet." />
        ) : (
          <ul className="credential-list">
            {credentials.map((credential, index) => (
              <li key={`${credential.scheme}:${credential.label}:${index}`}>
                <MaskedCredential credential={credential} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
