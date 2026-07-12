/**
 * Code generation view (Task 13.1 — Req 13.1, 13.2, 13.3, 13.4, 16.1).
 *
 * Offers the backend-provided languages, requests a Code_Snippet for a selected
 * endpoint in a chosen language (gating on an Active_API_Version — Req 13.4),
 * and displays the returned snippet with a copy-to-clipboard action (Req 13.3).
 * A displayed snippet is left unchanged on a subsequent error (Req 13.5); this
 * view renders whatever snippet the wiring layer holds.
 */

import React, { useState } from 'react';
import { codeGenerator, isSelectionRequired } from '../app-client/builders';
import { CopyButton } from '../components/CopyButton';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for a code-generation request. */
export const GENERATE_OP = 'code-generator:generate';

/** A generated Code_Snippet (mirrors the backend by name). */
export interface CodeSnippet {
  language: string;
  code: string;
}

export interface CodeGenViewProps {
  /** Supported languages offered by the backend, or undefined before load. */
  languages?: readonly string[];
  /** The most recently generated snippet, or undefined when none exists. */
  snippet?: CodeSnippet;
}

export function CodeGenView({
  languages,
  snippet,
}: CodeGenViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const [endpointId, setEndpointId] = useState('');
  const [language, setLanguage] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const loading = state.requests[GENERATE_OP] === 'loading';

  const handleGenerate = (event: React.FormEvent): void => {
    event.preventDefault();
    const gated = codeGenerator.generate(
      state.activeApiVersion,
      endpointId,
      language,
    );
    if (isSelectionRequired(gated)) {
      // No Active_API_Version — send nothing, show selection-required (Req 13.4).
      setMessage(gated.message);
      return;
    }
    setMessage(null);
    void actions.runRequest?.({
      operationId: GENERATE_OP,
      view: 'code-gen',
      descriptor: gated,
      retainInput: { endpointId, language },
    });
  };

  return (
    <section className="view view--code-gen" aria-labelledby="code-gen-title">
      <h1 id="code-gen-title">Generate client code</h1>

      <form onSubmit={handleGenerate}>
        <label>
          Endpoint
          <input
            type="text"
            name="endpointId"
            value={endpointId}
            onChange={(e) => setEndpointId(e.target.value)}
          />
        </label>
        <label>
          Language
          <select
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="">Select a language</option>
            {(languages ?? []).map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
        {message !== null ? (
          <p className="error" role="alert">
            {message}
          </p>
        ) : null}
        <button type="submit" disabled={loading}>
          Generate
        </button>
      </form>

      {loading ? <LoadingIndicator label="Generating code…" /> : null}

      {snippet ? (
        <div className="code-snippet">
          <div className="code-snippet__toolbar">
            <span className="code-snippet__language">{snippet.language}</span>
            <CopyButton text={snippet.code} />
          </div>
          <pre className="code-snippet__code">
            <code>{snippet.code}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}
