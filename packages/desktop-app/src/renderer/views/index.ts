/**
 * Views barrel (Task 13.1).
 *
 * Single import surface for the renderer view layer: the shell, every view, the
 * navigation model, and the action seam. Task 16 mounts {@link AppShell} inside
 * the store and action providers to wire the app end-to-end.
 */

export { AppShell } from './AppShell';
export type { AppShellProps } from './AppShell';

export { SignInView, SIGN_IN_OP } from './SignInView';
export { SignUpView, SIGN_UP_OP } from './SignUpView';
export { WorkspacesView, CREATE_WORKSPACE_OP } from './WorkspacesView';
export type { WorkspaceSummary } from './WorkspacesView';
export { ApiBrowserView, SELECT_VERSION_OP } from './ApiBrowserView';
export type { ApiSummary } from './ApiBrowserView';
export { QaView, ASK_OP } from './QaView';
export type { QaResult } from './QaView';
export { SearchView, SEARCH_OP } from './SearchView';
export type { SearchResult } from './SearchView';
export { TestingConsoleView, REPLAY_OP } from './TestingConsoleView';
export type { ConsoleHistoryEntry } from './TestingConsoleView';
export { CodeGenView, GENERATE_OP } from './CodeGenView';
export type { CodeSnippet } from './CodeGenView';
export { HistoryView } from './HistoryView';
export type { ConversationEntry } from './HistoryView';
export { DashboardView, DASHBOARD_OP } from './DashboardView';
export type { DashboardData } from './DashboardView';

export { SIGNED_IN_NAV_ITEMS, isViewReachable } from './navigation';
export type { NavItem } from './navigation';

export { ViewActionsProvider, useViewActions } from './actions';
export type { ViewActions, RequestIntent } from './actions';
