/**
 * Copy-to-clipboard action (Task 13.1 — Req 13.3).
 *
 * A thin, testable wrapper over the clipboard write. The code-generation view
 * offers an action to copy a generated Code_Snippet to the operating-system
 * clipboard; this module performs that write and reports success/failure so the
 * view can surface a "copied"/"copy failed" indication.
 *
 * The clipboard writer is injectable so the logic is unit-testable without a
 * real DOM: production passes nothing and the browser `navigator.clipboard` is
 * used; tests pass a fake writer.
 */

/** A minimal clipboard writer: writes `text`, resolving when the write lands. */
export type ClipboardWriter = (text: string) => Promise<void>;

/**
 * Minimal structural view of the platform clipboard we depend on.
 *
 * Read off `globalThis` behind a guard rather than referencing the DOM
 * `navigator` global type directly, so this pure module compiles and runs in a
 * non-DOM (node) test environment as well as in the Electron renderer.
 */
interface NavigatorWithClipboard {
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/** The outcome of a copy attempt, so the view can show feedback. */
export interface CopyResult {
  /** `true` when the text was written to the clipboard. */
  copied: boolean;
  /** A short, secret-free message describing the outcome. */
  message: string;
}

/**
 * Resolve the clipboard writer to use.
 *
 * Prefers an explicitly injected writer (tests), then the standard
 * `navigator.clipboard.writeText`, and otherwise returns `null` when no
 * clipboard is available in the current environment.
 */
export function resolveClipboardWriter(
  injected?: ClipboardWriter,
): ClipboardWriter | null {
  if (injected) {
    return injected;
  }
  const nav = (globalThis as { navigator?: NavigatorWithClipboard }).navigator;
  const writeText = nav?.clipboard?.writeText;
  if (writeText) {
    return (text: string) => writeText.call(nav.clipboard, text);
  }
  return null;
}

/**
 * Copy `text` to the clipboard, returning a {@link CopyResult}.
 *
 * Never throws: a missing clipboard or a rejected write is reported as
 * `copied: false` with a user-facing message, so a failed copy cannot crash the
 * view. The `text` (a generated Code_Snippet) contains no secret.
 */
export async function copyToClipboard(
  text: string,
  injected?: ClipboardWriter,
): Promise<CopyResult> {
  const writer = resolveClipboardWriter(injected);
  if (!writer) {
    return { copied: false, message: 'Clipboard is not available' };
  }
  try {
    await writer(text);
    return { copied: true, message: 'Copied to clipboard' };
  } catch {
    return { copied: false, message: 'Could not copy to clipboard' };
  }
}
