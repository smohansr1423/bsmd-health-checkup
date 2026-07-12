/**
 * TestingConsoleHistoryList (Task 13.2) — backend-ordered run history.
 *
 * Renders saved testing-console history entries in **exactly** the order the
 * Backend_Gateway returned them (most-recent-first as the backend orders them)
 * (Req 12.3). No client-side re-sorting. Each entry surfaces its request and
 * response verbatim via {@link RequestDetails} / {@link ResponseDetails}, and
 * exposes an optional replay action (wired by the console view in Task 13.1).
 */

import type { apiCopilotShared } from '@health-checkup/services';
import { toConsoleHistoryItems } from './response-presentation';
import { RequestDetails } from './RequestDetails';
import { ResponseDetails } from './ResponseDetails';

export interface TestingConsoleHistoryListProps {
  /** History entries in backend-provided order. */
  readonly entries: readonly apiCopilotShared.HistoryEntry[];
  /** Optional replay handler; invoked with the selected entry's history id (Req 12.4). */
  readonly onReplay?: (historyId: string) => void;
}

/** Renders testing-console run history in backend order (Req 12.3). */
export function TestingConsoleHistoryList({
  entries,
  onReplay,
}: TestingConsoleHistoryListProps): JSX.Element {
  const items = toConsoleHistoryItems(entries);

  return (
    <ol className="console-history" data-testid="console-history">
      {items.map(({ index, item }) => (
        <li
          key={item.historyId}
          className="console-history__entry"
          data-history-id={item.historyId}
          data-order-index={index}
        >
          <RequestDetails request={item.request} />
          <ResponseDetails result={item.result} />
          {onReplay && (
            <button
              type="button"
              className="console-history__replay"
              onClick={() => onReplay(item.historyId)}
            >
              Replay
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
