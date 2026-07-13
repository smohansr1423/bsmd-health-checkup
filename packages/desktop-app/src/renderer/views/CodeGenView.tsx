/**
 * Code generation view (Task 13.13 — Req 13.1, 13.2, 13.3, 13.5; also 13.4, 16.1).
 *
 * Offers the backend-provided languages as selectable options (Req 13.1),
 * requests a Code_Snippet for a selected endpoint in a chosen language while
 * gating on an Active_API_Version (Req 13.2, 13.4), and displays a
 * Loading_Indicator until the response arrives (Req 13.2, 16.1). A returned
 * Code_Snippet is shown with a copy-to-clipboard action (Req 13.3).
 *
 * Req 13.5 — an unavailable-endpoint / unsupported-language Backend_Error is
 * surfaced via the `error` prop and rendered *independently* of the `snippet`
 * prop. The wiring layer (Task 14.2) leaves the previously displayed snippet
 * untouched on such a failure, so this view keeps showing the prior snippet
 * alongside the error: the two props are rendered in separate regions and one
 * never clears the other.
 */

import React, { useState } from 'react';
import { codeGenerator, isSelectionRequired } from '../app-client/builders';
import { CopyButton } from '../components/CopyButton';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for loading the supported languages (Req 13.1). */
export const LANGUAGES_OP = 'code-generator:languages';

/** Stable operation id for a code-generation request (Req 13.2). */
export const GENERATE_OP = 'code-generator:generate';

/** A generated Code_Snippet (mirrors the backend by name). */
export interface CodeSnippet {
  language: string;
  code: string;
}

export interface CodeGenViewProps {
  /** Supported languages offered by the backend, or undefined before load (Req 13.1). */
  languages?: readonly string[];
  /**
   * The most recently generated snippet, or undefined when none exists (Req 13.3).
   * On an unavailable-endpoint/unsupported-language error the wiring layer leaves
   * this prop unchanged so the prior snippet stays displayed (Req 13.5).
   */
  snippet?: CodeSnippet;
  /**
   * A secret-free Backend_Error to surface for an unavailable endpoint definition
   * or an unsupported language (Req 13.5). Rendered independently of `snippet`.
   */
  error?: string;
}

export function CodeGenView({
  languages,
  snippet,
  error,
}: CodeGenViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  const [endpointId, setEndpointId] = useState('');
  const [language, setLanguage] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const languagesLoading = state.requests[LANGUAGES_OP] === 'loading';
  const loading = state.requests[GENERATE_OP] === 'loading';

  const handleGenerate = (event: React.FormEvent): void => {
    event.preventDefault();
    // Local guards: don't send a request that the backend would only reject.
    if (endpointId.trim().length === 0) {
      setMessage('Select an endpoint before generating code.');
      return;
    }
    if (language.length === 0) {
      setMessage('Select a language before generating code.');
      return;
    }
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
        {languagesLoading ? (
          <LoadingIndicator label="Loading languages…" />
        ) : null}
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

      {/* Req 13.5 — the backend error is rendered on its own, and never clears
          the snippet region below, so any prior snippet stays displayed. */}
      {error !== undefined ? (
        <p className="error error--code-gen" role="alert">
          {error}
        </p>
      ) : null}

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
