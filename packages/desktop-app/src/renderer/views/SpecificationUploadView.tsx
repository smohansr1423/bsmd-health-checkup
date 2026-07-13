/**
 * Specification-upload view (Task 13.4 — Req 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 16.1).
 *
 * Lets the User pick an API_Specification file and upload it to the
 * Active_Workspace. Everything the client is responsible for happens here:
 *
 *  - **Size / content-type gating (Req 6.3)**: the selected file is validated
 *    with the pure {@link validateUpload} — files over 25 MB or that are not
 *    YAML/JSON are rejected *before* any request is built, so nothing is sent.
 *  - **Workspace gating (Req 6.2)**: the upload builder is gated on an
 *    Active_Workspace; with none selected it yields a selection-required
 *    indication and sends nothing.
 *  - **Send (Req 6.1)**: on a valid, gated submission the file bytes and their
 *    declared content type are handed to the action seam, and the operation's
 *    Loading_Indicator shows until the wiring layer records completion.
 *
 * The outcome of a completed upload is supplied by the wiring layer (Task 14.2)
 * through props so this component stays pure and testable:
 *
 *  - **Success (Req 6.4)**: `uploadResult` names the uploaded API and its
 *    API_Version in a success confirmation.
 *  - **Parse failure (Req 6.5)**: `uploadError.kind === 'parse-failure'` shows
 *    the backend's parse detail unaltered; the User's file selection is retained
 *    for retry (it lives in this component's state and is never cleared on
 *    failure).
 *  - **Plan limit (Req 6.6)**: `uploadError.kind === 'plan-limit'` shows the
 *    plan-tier API-limit error and never implies an API was added.
 */

import React, { useState } from 'react';
import { knowledgeEngine, isSelectionRequired } from '../app-client/builders';
import { validateUpload } from '../app-client/validation';
import type { UploadFile } from '../app-client/types';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { useAppStore } from '../state/store';
import { useViewActions } from './actions';

/** Stable operation id for a specification upload (Req 16.1). */
export const UPLOAD_SPEC_OP = 'knowledge-engine:upload';

/**
 * A file the User has selected for upload. `contentType` is kept as a plain
 * string here (not the narrowed `'yaml' | 'json'`) because an unsupported
 * selection must survive long enough to be *rejected* by {@link validateUpload}
 * with the supported-formats message (Req 6.3).
 */
export interface SelectedSpecFile {
  name: string;
  contentType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}

/** The uploaded API identified in a success confirmation (Req 6.4). */
export interface UploadedApiSummary {
  /** The uploaded API's name/title as returned by the Backend_Gateway. */
  apiName: string;
  /** The stored API_Version number the upload produced. */
  version: number;
}

/**
 * A completed-upload failure surfaced to the view. `parse-failure` carries the
 * backend's detail verbatim (Req 6.5); `plan-limit` reports the plan-tier API
 * limit without implying an API was added (Req 6.6).
 */
export type UploadFailure =
  | { kind: 'parse-failure'; detail: string }
  | { kind: 'plan-limit'; message: string };

export interface SpecificationUploadViewProps {
  /** The uploaded API + version on success (Req 6.4). */
  uploadResult?: UploadedApiSummary;
  /** A parse-failure or plan-limit error from a completed upload (Req 6.5, 6.6). */
  uploadError?: UploadFailure;
}

/** Derive the declared content type (Req 6.1) from a file's name and MIME type. */
function deriveContentType(fileName: string, mimeType: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return 'yaml';
  }
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (mimeType.includes('yaml')) {
    return 'yaml';
  }
  if (mimeType.includes('json')) {
    return 'json';
  }
  // Preserve whatever was declared so validation can reject it (Req 6.3).
  return mimeType || 'unknown';
}

export function SpecificationUploadView({
  uploadResult,
  uploadError,
}: SpecificationUploadViewProps): React.ReactElement {
  const { state } = useAppStore();
  const actions = useViewActions();
  // The current file selection is retained across a failed upload for retry (Req 6.5).
  const [selected, setSelected] = useState<SelectedSpecFile | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [gateMessage, setGateMessage] = useState<string | null>(null);

  const loading = state.requests[UPLOAD_SPEC_OP] === 'loading';

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) {
      setSelected(null);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setSelected({
      name: file.name,
      contentType: deriveContentType(file.name, file.type),
      sizeBytes: file.size,
      bytes,
    });
    // A fresh selection clears the previous pre-send messages.
    setFieldError(null);
    setGateMessage(null);
  };

  const handleUpload = (event: React.FormEvent): void => {
    event.preventDefault();
    if (selected === null) {
      setFieldError('Select a specification file to upload');
      return;
    }

    // Size / content-type gating before anything is built or sent (Req 6.3).
    const validation = validateUpload(selected as unknown as UploadFile);
    if (validation) {
      setFieldError(validation.message);
      return;
    }
    setFieldError(null);

    // Workspace gating: no descriptor is produced without an Active_Workspace (Req 6.2).
    const gated = knowledgeEngine.upload(
      state.activeWorkspaceId,
      selected as unknown as UploadFile,
    );
    if (isSelectionRequired(gated)) {
      setGateMessage(gated.message);
      return;
    }
    setGateMessage(null);

    // Valid + gated: send the file contents and declared content type (Req 6.1).
    void actions.runRequest?.({
      operationId: UPLOAD_SPEC_OP,
      view: 'workspaces',
      descriptor: gated,
      // Retain the selection so a parse failure can be retried (Req 6.5).
      retainInput: { name: selected.name },
    });
  };

  return (
    <section
      className="view view--spec-upload"
      aria-labelledby="spec-upload-title"
    >
      <h2 id="spec-upload-title">Upload API specification</h2>

      <form onSubmit={handleUpload}>
        <label>
          Specification file (YAML or JSON)
          <input
            type="file"
            name="specification"
            accept=".yaml,.yml,.json,application/json,application/x-yaml,text/yaml"
            onChange={(e) => {
              void handleFileChange(e);
            }}
          />
        </label>

        {selected !== null ? (
          <p className="spec-upload__selection">
            Selected: {selected.name}
          </p>
        ) : null}

        {gateMessage !== null ? (
          <p className="notice notice--selection-required" role="status">
            {gateMessage}
          </p>
        ) : null}

        {fieldError !== null ? (
          <p className="error" role="alert">
            {fieldError}
          </p>
        ) : null}

        <button type="submit" disabled={loading}>
          Upload specification
        </button>
      </form>

      {loading ? <LoadingIndicator label="Uploading specification…" /> : null}

      {uploadResult ? (
        <p className="notice notice--upload-success" role="status">
          Uploaded {uploadResult.apiName} (version {uploadResult.version}).
        </p>
      ) : null}

      {uploadError?.kind === 'parse-failure' ? (
        <p className="error error--parse-failure" role="alert">
          The specification could not be parsed: {uploadError.detail}
        </p>
      ) : null}

      {uploadError?.kind === 'plan-limit' ? (
        <p className="error error--plan-limit" role="alert">
          {uploadError.message}
        </p>
      ) : null}
    </section>
  );
}
