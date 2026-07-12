/**
 * Sign-in view (Task 13.1 — Req 3.1, 3.3, 3.4, 4.4, 16.1).
 *
 * Collects an email and password, runs the pure client-side validation
 * (rejecting empty fields before any request is sent — Req 3.3), and hands a
 * built `account/sign-in` descriptor to the action seam. It surfaces the
 * session-expiry notice (Req 4.4) and the operation's Loading_Indicator
 * (Req 16.1). Navigation to sign-up is offered for new Users.
 */

import React, { useState } from 'react';
import { account } from '../app-client/builders';
import { validateSignIn } from '../app-client/validation';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for the sign-in Loading_Indicator. */
export const SIGN_IN_OP = 'account:sign-in';

export function SignInView(): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const actions = useViewActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loading = state.requests[SIGN_IN_OP] === 'loading';

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
      retainInput: { email },
    });
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
          <p className="error" role="alert">
            {fieldError}
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
