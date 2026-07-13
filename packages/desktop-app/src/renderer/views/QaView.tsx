/**
 * Q&A view (Task 13.7 — Req 8.1, 8.4, 8.5, 8.6, 8.7, 16.1).
 *
 * Submits a natural-language question, validating the 1..1000-character length
 * before sending (Req 8.2) and gating on an Active_API_Version (Req 8.3). It
 * displays a Loading_Indicator while the request is in flight (Req 8.1, 16.1),
 * renders a grounded Answer with its Citations (Req 8.4) or the "no answer
 * found in the uploaded API knowledge" state, never fabricating content
 * (Req 8.5).
 *
 * It also surfaces the two backend/transport outcomes the wiring layer
 * (Task 14.2) feeds in as props:
 *
 *   - `quotaReached` — the Backend_Gateway reported the query quota is exhausted
 *     (Req 8.6): a quota message is shown.
 *   - `timedOut` — no response arrived within the 30s Q&A deadline (Req 8.7): an
 *     "answer could not be generated" error is shown, the User's question text
 *     is retained (from `state.retainedInputs.qa`), and a Retry action re-sends
 *     the retained question.
 */

import React, { useState } from 'react';
import { queryEngine, isSelectionRequired } from '../app-client/builders';
import { validateQuestion } from '../app-client/validation';
import { EmptyState } from '../components/EmptyState';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { EMPTY_STATE_MESSAGES, resolveQaDisplay } from '../components/empty-states';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for the Q&A request. */
export const ASK_OP = 'query-engine:ask';

/** User-facing messages for the Q&A backend/transport outcomes (secret-free). */
export const QA_MESSAGES = {
  /** Req 8.6 — the query quota has been reached. */
  quotaReached: 'You have reached your query quota. No further questions can be asked until it resets.',
  /** Req 8.7 — no answer arrived within the 30s deadline; the question is retained. */
  timedOut: 'The answer could not be generated in time. Your question was kept — you can try again.',
} as const;

/** A grounded Answer with its citations (mirrors the backend by name). */
export interface QaResult {
  grounded: boolean;
  text: string;
  citations: readonly string[];
}

/** The shape of the input retained for the Q&A view on timeout (Req 8.7). */
interface RetainedQa {
  question: string;
}

export interface QaViewProps {
  /** The latest Answer, or undefined before a question has been answered. */
  result?: QaResult;
  /** True when the Backend_Gateway reported the query quota is reached (Req 8.6). */
  quotaReached?: boolean;
  /** True when the 30s Q&A deadline elapsed without a response (Req 8.7). */
  timedOut?: boolean;
}

/** Read the retained question text for the Q&A view, if any (Req 8.7). */
function retainedQuestion(retained: unknown): string {
  if (
    typeof retained === 'object' &&
    retained !== null &&
    typeof (retained as RetainedQa).question === 'string'
  ) {
    return (retained as RetainedQa).question;
  }
  return '';
}

export function QaView({
  result,
  quotaReached = false,
  timedOut = false,
}: QaViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  // Seed from any question retained after a timeout so it survives a remount
  // and is ready for retry (Req 8.7).
  const [question, setQuestion] = useState(() =>
    retainedQuestion(state.retainedInputs.qa),
  );
  const [message, setMessage] = useState<string | null>(null);

  const loading = state.requests[ASK_OP] === 'loading';
  const display = resolveQaDisplay(result);

  const submitQuestion = (text: string): void => {
    const validation = validateQuestion(text);
    if (validation) {
      setMessage(validation.message);
      return;
    }
    const gated = queryEngine.ask(state.activeApiVersion, text);
    if (isSelectionRequired(gated)) {
      // No Active_API_Version — send nothing, show selection-required (Req 8.3).
      setMessage(gated.message);
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: ASK_OP,
      view: 'qa',
      descriptor: gated,
      // Retain the question so a 30s timeout keeps it for retry (Req 8.7).
      retainInput: { question: text },
    });
  };

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    submitQuestion(question);
  };

  return (
    <section className="view view--qa" aria-labelledby="qa-title">
      <h1 id="qa-title">Ask about your API</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Question
          <textarea
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        {message !== null ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={loading}>
          Ask
        </button>
      </form>

      {loading ? <LoadingIndicator label="Generating answer…" /> : null}

      {quotaReached ? (
        <p className="notice notice--quota" role="alert">
          {QA_MESSAGES.quotaReached}
        </p>
      ) : null}

      {timedOut ? (
        <div className="error error--timeout" role="alert">
          <p>{QA_MESSAGES.timedOut}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => submitQuestion(question)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {display === 'no-answer' ? (
        <EmptyState message={EMPTY_STATE_MESSAGES.noAnswer} />
      ) : null}

      {display === 'answer' && result ? (
        <article className="qa-answer">
          <p className="qa-answer__text">{result.text}</p>
          {result.citations.length > 0 ? (
            <ul className="qa-answer__citations">
              {result.citations.map((citation, index) => (
                <li key={`${index}:${citation}`}>{citation}</li>
              ))}
            </ul>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
