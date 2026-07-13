/**
 * View action seam (Task 13.1).
 *
 * The views build validated, token-less {@link RequestDescriptor}s (via the
 * pure `app-client` builders) and hand them to this seam to be sent. The actual
 * transport — calling the preload bridge `window.copilot.secureRequest`,
 * mapping the response, and dispatching the resulting store actions — is wired
 * end-to-end in Task 16.2. Keeping that behind a context means the view
 * scaffolding here is complete and testable now, and the real implementation
 * drops in later without touching the views.
 *
 * When no provider supplies actions (pure scaffolding / tests), views degrade
 * gracefully: submit handlers still run client-side validation and gating, and
 * simply skip the send.
 */

import React, { createContext, useContext } from 'react';
import type { RequestDescriptor, UiOutcome } from '../app-client/types';
import type { ViewId } from '../state/types';

/** A single request the view wants sent through the broker. */
export interface RequestIntent {
  /** Stable per-operation id used for the Loading_Indicator (Req 16.1). */
  operationId: string;
  /** The view that initiated the request (for input retention — Req 17.5). */
  view: ViewId;
  /** The token-less descriptor to send. */
  descriptor: RequestDescriptor;
  /** Optional input to retain for retry if the request fails (Req 8.7, 11.5, 17.5). */
  retainInput?: unknown;
}

/** The actions a view may invoke. All optional so scaffolding works standalone. */
export interface ViewActions {
  /** Send a built request through the broker (wired in Task 16). */
  runRequest?: (intent: RequestIntent) => void | Promise<void>;
}

const ActionsContext = createContext<ViewActions>({});

/** Provide view actions to a subtree. */
export function ViewActionsProvider({
  actions,
  children,
}: {
  actions: ViewActions;
  children: React.ReactNode;
}): React.ReactElement {
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

/** Read the current view actions (defaults to an empty, no-op set). */
export function useViewActions(): ViewActions {
  return useContext(ActionsContext);
}
