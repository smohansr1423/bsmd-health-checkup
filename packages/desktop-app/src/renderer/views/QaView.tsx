/**
 * Q&A view (Task 13.1 — Req 8.1, 8.2, 8.3, 8.4, 8.5, 16.1).
 *
 * Submits a natural-language question, validating the 1..1000-character length
 * before sending (Req 8.2) and gating on an Active_API_Version (Req 8.3). It
 * renders a grounded Answer with its Citations (Req 8.4) or the "no answer
 * found in the uploaded API knowledge" state, never fabricating content
 * (Req 8.5). The exact citation payload rendering may be enriched by Task 13.2.
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

/** A grounded Answer with its citations (mirrors the backend by name). */
export interface QaResult {
  grounded: boolean;
  text: string;
  citations: readonly string[];
}

export interface QaViewProps {
  /** The latest Answer, or undefined before a question has been answered. */
  result?: QaResult;
}

export function QaView({ result }: QaViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const [question, setQuestion] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const loading = state.requests[ASK_OP] === 'loading';
  const display = resolveQaDisplay(result);

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    const validation = validateQuestion(question);
    if (validation) {
      setMessage(validation.message);
      return;
    }
    const gated = queryEngine.ask(state.activeApiVersion, question);
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
      retainInput: { question },
    });
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
