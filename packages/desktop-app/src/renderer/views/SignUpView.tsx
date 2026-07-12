/**
 * Sign-up view (Task 13.1 — Req 2.1, 2.3, 16.1).
 *
 * Collects registration fields, runs the pure client-side validation (email
 * must contain "@", password length 8..128, no empty required field — Req 2.3)
 * and rejects before sending, then hands a built `account/sign-up` descriptor
 * to the action seam. Offers navigation back to sign-in.
 */

import React, { useState } from 'react';
import { account } from '../app-client/builders';
import { validateSignUp } from '../app-client/validation';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for the sign-up Loading_Indicator. */
export const SIGN_UP_OP = 'account:sign-up';

export function SignUpView(): React.ReactElement {
  const { state, dispatch } = useAppStore();
  const actions = useViewActions();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const loading = state.requests[SIGN_UP_OP] === 'loading';

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const input = { email, password };
    const validation = validateSignUp(input);
    if (validation) {
      setFieldError(validation.message);
      return;
    }
    setFieldError(null);
    void actions.runRequest?.({
      operationId: SIGN_UP_OP,
      view: 'sign-up',
      descriptor: account.signUp(input),
      retainInput: { email },
    });
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
          <p className="error" role="alert">
            {fieldError}
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
