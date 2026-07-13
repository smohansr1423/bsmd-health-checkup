/**
 * Sign-in view (Task 13.2 — Req 3.1, 3.2, 3.3, 3.4, 3.5, 4.4, 16.1).
 *
 * Collects an email and password, runs the pure client-side validation
 * (rejecting empty fields before any request is sent — Req 3.3), and hands a
 * built `account/sign-in` descriptor to the action seam (Req 3.1). While the
 * request is in flight it shows the operation's Loading_Indicator (Req 16.1).
 *
 * Success handling (store the Session_Token, establish the Session, and route
 * to the authenticated home view — Req 3.2) is performed by the action seam /
 * wiring layer (Task 16.2): the token is stored by the main-process broker and
 * the reducer's `SIGN_IN_SUCCEEDED` transition routes home. The view therefore
 * only builds and sends the request, and reflects the outcome fed back to it.
 *
 * Failure handling is presentation-only and driven by the `outcome` prop
 * (mapped from the backend response by the wiring layer):
 *
 *   - credentials do not match → an authentication error is shown, no Session
 *     is established, and the entered email is retained (Req 3.4);
 *   - the Account is temporarily locked → a lock error is shown and no Session
 *     is established (Req 3.5);
 *   - any other error → a describe-the-failure message is shown.
 *
 * In every failure case the email is retained but the password is not: the
 * password is cleared from local state the moment the request is dispatched, so
 * it is never held while a response is pending or after a failure (Req 3.4).
 * The session-expiry notice (Req 4.4) is surfaced above the form, and
 * navigation to sign-up is offered for new Users.
 */

import React, { useState } from 'react';
import { account } from '../app-client/builders';
import type { UiOutcome } from '../app-client/types';
import { validateSignIn } from '../app-client/validation';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { resolveSignInError } from './auth-errors';
import { useViewActions } from './actions';

/** Stable operation id for the sign-in Loading_Indicator. */
export const SIGN_IN_OP = 'account:sign-in';

export interface SignInViewProps {
  /**
   * The outcome of the most recent sign-in attempt, supplied by the wiring
   * layer. Error outcomes are rendered as a secret-free message (Req 3.4, 3.5);
   * a success outcome routes away and is handled by the reducer.
   */
  outcome?: UiOutcome<unknown>;
}

export function SignInView({ outcome }: SignInViewProps): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const actions = useViewActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loading = state.requests[SIGN_IN_OP] === 'loading';
  // Backend/transport failure message for the last attempt (Req 3.4, 3.5).
  const backendError = resolveSignInError(outcome);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const input = { email, password };
    const validation = validateSignIn(input);
    if (validation) {
      // Reject before sending; identify the offending field (Req 3.3).
      setFieldError(validation.message);
      return;
    }
    setFieldError(null);
    void actions.runRequest?.({
      operationId: SIGN_IN_OP,
      view: 'sign-in',
      descriptor: account.signIn(input),
      // Retain the email for retry, never the password (Req 3.4).
      retainInput: { email },
    });
    // Drop the password immediately: it is retained neither while the response
    // is pending nor after a failure (Req 3.4). The email stays in the field.
    setPassword('');
  };

  return (
    <section className="view view--sign-in" aria-labelledby="sign-in-title">
      <h1 id="sign-in-title">Sign in</h1>

      {state.session.expiredNotice ? (
        <p className="notice notice--expired" role="status">
          Your session has expired. Please sign in again.
        </p>
      ) : null}

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
          Sign in
        </button>
      </form>

      {loading ? <LoadingIndicator label="Signing in…" /> : null}

      <button
        type="button"
        className="link"
        onClick={() => dispatch({ type: 'NAVIGATED', view: 'sign-up' })}
      >
        Create an account
      </button>
    </section>
  );
}
