/**
 * RequestDetails (Task 13.2) — exact request rendering for the testing console.
 *
 * Renders the request that was sent for a testing-console run/replay — method,
 * URL, headers, and body — exactly as returned by the Backend_Gateway
 * (Req 12.2). Paired with {@link ResponseDetails} to show a full run.
 *
 * Fidelity logic lives in {@link toRequestView}; this is a thin shell.
 */

import type { apiCopilotShared } from '@health-checkup/services';
import { toRequestView } from './response-presentation';

export interface RequestDetailsProps {
  /** The saved request snapshot to present verbatim. */
  readonly request: apiCopilotShared.OutboundRequestSnapshot;
  /** Optional label for the section heading. */
  readonly heading?: string;
}

/** Presents an {@link apiCopilotShared.OutboundRequestSnapshot} unaltered. */
export function RequestDetails({
  request,
  heading = 'Request',
}: RequestDetailsProps): JSX.Element {
  const view = toRequestView(request);

  return (
    <section className="request-details" aria-label={heading}>
      <h3>{heading}</h3>

      <dl className="request-details__meta">
        <dt>Method</dt>
        <dd data-testid="request-method">{view.method}</dd>

        <dt>URL</dt>
        {/* URL shown exactly as returned (Req 12.2). */}
        <dd data-testid="request-url">{view.url}</dd>
      </dl>

      <h4>Headers</h4>
      {view.headers.length === 0 ? (
        <p className="request-details__no-headers">No headers sent.</p>
      ) : (
        <table className="request-details__headers" data-testid="request-headers">
          <tbody>
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
      {view.body === undefined ? (
        <p className="request-details__no-body">No request body.</p>
      ) : (
        // Body rendered verbatim to preserve structure (Req 12.2).
        <pre className="request-details__body" data-testid="request-body">
          {view.body}
        </pre>
      )}
    </section>
  );
}
