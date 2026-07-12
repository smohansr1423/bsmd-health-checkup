/**
 * Unit tests for the copy-to-clipboard action (Task 13.1 — Req 13.3).
 */

import { copyToClipboard, resolveClipboardWriter } from './clipboard';

describe('copyToClipboard', () => {
  it('writes the text and reports success with an injected writer', async () => {
    const written: string[] = [];
    const result = await copyToClipboard('print("hi")', async (t) => {
      written.push(t);
    });
    expect(written).toEqual(['print("hi")']);
    expect(result).toEqual({ copied: true, message: 'Copied to clipboard' });
  });

  it('reports failure (without throwing) when the write rejects', async () => {
    const result = await copyToClipboard('snippet', async () => {
      throw new Error('denied');
    });
    expect(result.copied).toBe(false);
    expect(result.message).toBe('Could not copy to clipboard');
  });

  it('reports unavailable when no clipboard exists', async () => {
    // No injected writer and no navigator.clipboard in the node test env.
    const result = await copyToClipboard('snippet');
    expect(result.copied).toBe(false);
    expect(result.message).toBe('Clipboard is not available');
  });
});

describe('resolveClipboardWriter', () => {
  it('prefers an injected writer', () => {
    const injected = async (): Promise<void> => undefined;
    expect(resolveClipboardWriter(injected)).toBe(injected);
  });

  it('returns null when no clipboard is available', () => {
    expect(resolveClipboardWriter()).toBeNull();
  });
});
