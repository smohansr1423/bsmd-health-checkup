/**
 * Sign-up view (Task 13.2 — Req 2.1, 2.2, 2.3, 2.4, 2.5, 16.1).
 *
 * Collects registration fields, runs the pure client-side validation (email
 * must contain "@", password length 8..128, no empty required field — Req 2.3)
 * and rejects before sending, then hands a built `account/sign-up` descriptor
 * to the action seam (Req 2.1). While the request is in flight it shows the
 * operation's Loading_Indicator (Req 16.1).
 *
 * Success handling (display a confirmation and present the sign-in view —
 * Req 2.2) is performed by the action seam / wiring layer (Task 16.2), which
 * navigates to the sign-in view on a created-Account response. The view only
 * builds and sends the request and reflects the outcome fed back to it.
 *
 * Failure handling is presentation-only and driven by the `outcome` prop
 * (mapped from the backend response by the wiring layer):
 *
 *   - the email is already registered → an "already registered" error is shown
 *     and the entered fields are retained except the password (Req 2.4);
 *   - any other error → a describe-the-failure message is shown and the entered
 *     fields are retained except the password (Req 2.5).
 *
 * The password is cleared from local state the moment the request is dispatched,
 * so it is retained neither while a response is pending nor after a failure; the
 * email stays in its field.
 */

import React, { useState } from 'react';
import { account } from '../app-client/builders';
import type { UiOutcome } from '../app-client/types';
import { validateSignUp } from '../app-client/validation';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { resolveSignUpError } from './auth-errors';
import { useViewActions } from './actions';

/** Stable operation id for the sign-up Loading_Indicator. */
export const SIGN_UP_OP = 'account:sign-up';

export interface SignUpViewProps {
  /**
   * The outcome of the most recent sign-up attempt, supplied by the wiring
   * layer. Error outcomes are rendered as a secret-free message (Req 2.4, 2.5);
   * a success outcome navigates to the sign-in view (Req 2.2).
   */
  outcome?: UiOutcome<unknown>;
}

export function SignUpView({ outcome }: SignUpViewProps): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const actions = useViewActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loading = state.requests[SIGN_UP_OP] === 'loading';
  // Backend/transport failure message for the last attempt (Req 2.4, 2.5).
  const backendError = resolveSignUpError(outcome);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const input = { email, password };
    const validation = validateSignUp(input);
    if (validation) {
      // Reject before sending; identify the offending field (Req 2.3).
      setFieldError(validation.message);
      return;
    }
    setFieldError(null);
    void actions.runRequest?.({
      operationId: SIGN_UP_OP,
      view: 'sign-up',
      descriptor: account.signUp(input),
      // Retain the email for retry, never the password (Req 2.4, 2.5).
      retainInput: { email },
    });
    // Drop the password immediately so it is never retained on failure.
    setPassword('');
  };

  return (
    <section className="view view--sign-up" aria-labelledby="sign-up-title">
      <h1 id="sign-up-title">Create an account</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {fieldError !== null ? (
          <p className="error error--field" role="alert">
            {fieldError}
          </p>
        ) : null}

        {backendError !== null ? (
          <p className="error error--backend" role="alert">
            {backendError}
          </p>
        ) : null}

        <button type="submit" disabled={loading}>
          Sign up
        </button>
      </form>

      {loading ? <LoadingIndicator label="Creating account…" /> : null}

      <button
        type="button"
        className="link"
        onClick={() => dispatch({ type: 'NAVIGATED', view: 'sign-in' })}
      >
        Back to sign in
      </button>
    </section>
  );
}
