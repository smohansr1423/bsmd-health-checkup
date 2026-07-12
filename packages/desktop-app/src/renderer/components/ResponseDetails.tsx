/**
 * ResponseDetails (Task 13.2) — exact-payload rendering.
 *
 * Renders an execution / testing-console / replay {@link ExecutionResult} with
 * its status code, headers, body, and elapsed time **exactly as returned** by
 * the Backend_Gateway, with no alteration (Req 11.4, 11.6, 12.2). The body is
 * shown verbatim inside a `<pre>` so whitespace and structure are preserved;
 * headers are listed in backend order with untouched values.
 *
 * All fidelity logic lives in {@link toResponseView}; this component is a thin
 * presentation shell so both this view and the property tests share one
 * verifiable source of truth.
 */

import type { apiCopilotShared } from '@health-checkup/services';
import { toResponseView } from './response-presentation';

export interface ResponseDetailsProps {
  /** The backend execution result to present verbatim. */
  readonly result: apiCopilotShared.ExecutionResult;
  /** Optional label for the section heading (e.g. "Response", "Replay"). */
  readonly heading?: string;
}

/** Presents an {@link apiCopilotShared.ExecutionResult} without altering it. */
export function ResponseDetails({
  result,
  heading = 'Response',
}: ResponseDetailsProps): JSX.Element {
  const view = toResponseView(result);

  return (
    <section className="response-details" aria-label={heading}>
      <h3>{heading}</h3>

      <dl className="response-details__meta">
        <dt>Status</dt>
        {/* Status code shown exactly as returned (Req 11.4). */}
        <dd data-testid="response-status">{view.status}</dd>

        <dt>Elapsed</dt>
        {/* Elapsed time in ms shown exactly as returned (Req 12.2). */}
        <dd data-testid="response-elapsed-ms">{view.elapsedMs}</dd>

        <dt>Outcome</dt>
        <dd data-testid="response-outcome">{view.outcome}</dd>
      </dl>

      <h4>Headers</h4>
      {view.headers.length === 0 ? (
        <p className="response-details__no-headers">No headers returned.</p>
      ) : (
        <table className="response-details__headers" data-testid="response-headers">
          <tbody>
            {/* Headers rendered in backend order, values unchanged (Req 11.4, 12.2). */}
            {view.headers.map((header, index) => (
              <tr key={`${index}:${header.name}`}>
                <th scope="row">{header.name}</th>
                <td>{header.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Body</h4>
      {/* Body rendered byte-for-byte inside <pre> to preserve structure
          (Req 11.6, 12.2). The backend already returns a structure-preserving
          body; the client applies no formatting. */}
      <pre className="response-details__body" data-testid="response-body">
        {view.body}
      </pre>
    </section>
  );
}
