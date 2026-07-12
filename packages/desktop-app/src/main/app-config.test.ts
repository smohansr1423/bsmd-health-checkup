/**
 * Unit tests for non-secret AppConfig persistence, HTTPS-only base-URL
 * validation, and relative-path resolution (Req 1.2, 1.3, 4.5).
 */

import {
  AppConfig,
  AppConfigStore,
  ConfigPersistence,
  DEFAULT_WINDOW_BOUNDS,
  configFilePath,
  isValidBaseUrl,
  resolveApiUrl,
  validateBaseUrl,
} from './app-config';

/** In-memory persistence backend so tests never touch the filesystem. */
function inMemoryPersistence(initial: string | null = null): ConfigPersistence & {
  peek(): string | null;
} {
  let store = initial;
  return {
    read: () => store,
    write: (serialized: string) => {
      store = serialized;
    },
    peek: () => store,
  };
}

describe('validateBaseUrl', () => {
  it('accepts a non-empty HTTPS URL', () => {
    expect(validateBaseUrl('https://api.example.com')).toEqual({
      valid: true,
      normalized: 'https://api.example.com',
    });
  });

  it('trims surrounding whitespace before storing', () => {
    expect(validateBaseUrl('  https://api.example.com/gateway  ')).toEqual({
      valid: true,
      normalized: 'https://api.example.com/gateway',
    });
  });

  it('rejects an empty or whitespace-only candidate', () => {
    expect(validateBaseUrl('')).toEqual({ valid: false, reason: 'empty' });
    expect(validateBaseUrl('   ')).toEqual({ valid: false, reason: 'empty' });
  });

  it('rejects a non-HTTPS scheme', () => {
    expect(validateBaseUrl('http://api.example.com')).toEqual({
      valid: false,
      reason: 'not_https',
    });
    expect(validateBaseUrl('ftp://api.example.com')).toEqual({
      valid: false,
      reason: 'not_https',
    });
  });

  it('rejects a malformed URL', () => {
    expect(validateBaseUrl('not a url')).toEqual({
      valid: false,
      reason: 'malformed',
    });
  });
});

describe('isValidBaseUrl', () => {
  it('mirrors validateBaseUrl validity', () => {
    expect(isValidBaseUrl('https://a.example')).toBe(true);
    expect(isValidBaseUrl('http://a.example')).toBe(false);
    expect(isValidBaseUrl('')).toBe(false);
  });
});

describe('resolveApiUrl', () => {
  it('prefixes a relative /api/copilot path', () => {
    expect(
      resolveApiUrl('https://api.example.com', '/api/copilot/workspaces'),
    ).toBe('https://api.example.com/api/copilot/workspaces');
  });

  it('collapses duplicate slashes between base and path', () => {
    expect(
      resolveApiUrl('https://api.example.com/', '/api/copilot/query-engine'),
    ).toBe('https://api.example.com/api/copilot/query-engine');
  });

  it('preserves a base-URL path prefix', () => {
    expect(
      resolveApiUrl('https://host.example/gw', '/api/copilot/workspaces'),
    ).toBe('https://host.example/gw/api/copilot/workspaces');
  });

  it('adds a leading slash to a path without one', () => {
    expect(resolveApiUrl('https://api.example.com', 'api/copilot/x')).toBe(
      'https://api.example.com/api/copilot/x',
    );
  });

  it('returns an already-absolute URL unchanged', () => {
    expect(
      resolveApiUrl('https://api.example.com', 'https://other.example/path'),
    ).toBe('https://other.example/path');
  });
});

describe('configFilePath', () => {
  it('appends the config file name to the user-data dir', () => {
    expect(configFilePath('/user/data')).toMatch(/app-config\.json$/);
  });
});

describe('AppConfigStore', () => {
  it('starts with no base URL and default window bounds on a fresh install', () => {
    const store = new AppConfigStore(inMemoryPersistence());
    expect(store.getBaseUrl()).toBeNull();
    expect(store.getConfig().window).toEqual(DEFAULT_WINDOW_BOUNDS);
  });

  it('accepts, stores, and persists a valid HTTPS base URL', () => {
    const persistence = inMemoryPersistence();
    const store = new AppConfigStore(persistence);

    const result = store.setBaseUrl('https://api.example.com/');

    expect(result).toEqual({ accepted: true, baseUrl: 'https://api.example.com/' });
    expect(store.getBaseUrl()).toBe('https://api.example.com/');
    const persisted = JSON.parse(persistence.peek() as string) as AppConfig;
    expect(persisted.backendBaseUrl).toBe('https://api.example.com/');
  });

  it('rejects an empty base URL and leaves the previous value unchanged', () => {
    const persistence = inMemoryPersistence();
    const store = new AppConfigStore(persistence);
    store.setBaseUrl('https://good.example');

    const result = store.setBaseUrl('');

    expect(result).toEqual({
      accepted: false,
      reason: 'empty',
      baseUrl: 'https://good.example',
    });
    expect(store.getBaseUrl()).toBe('https://good.example');
  });

  it('rejects a non-HTTPS base URL and does not persist it', () => {
    const persistence = inMemoryPersistence();
    const store = new AppConfigStore(persistence);

    const result = store.setBaseUrl('http://insecure.example');

    expect(result).toEqual({
      accepted: false,
      reason: 'not_https',
      baseUrl: null,
    });
    expect(store.getBaseUrl()).toBeNull();
    // Nothing valid was ever stored, so no write should have occurred.
    expect(persistence.peek()).toBeNull();
  });

  it('resolves relative paths against the stored base URL', () => {
    const store = new AppConfigStore(inMemoryPersistence());
    expect(store.resolve('/api/copilot/workspaces')).toBeNull();

    store.setBaseUrl('https://api.example.com');
    expect(store.resolve('/api/copilot/workspaces')).toBe(
      'https://api.example.com/api/copilot/workspaces',
    );
  });

  it('never writes the token: config JSON contains only non-secret fields', () => {
    const persistence = inMemoryPersistence();
    const store = new AppConfigStore(persistence);
    store.setBaseUrl('https://api.example.com');

    const serialized = persistence.peek() as string;
    expect(serialized).not.toMatch(/token/i);
    expect(Object.keys(JSON.parse(serialized))).toEqual(
      expect.arrayContaining(['backendBaseUrl', 'window']),
    );
  });

  it('loads a previously persisted config', () => {
    const persistence = inMemoryPersistence(
      JSON.stringify({
        backendBaseUrl: 'https://saved.example',
        window: { x: 10, y: 20, width: 640, height: 480, maximized: true },
      }),
    );
    const store = new AppConfigStore(persistence);

    expect(store.getBaseUrl()).toBe('https://saved.example');
    expect(store.getConfig().window).toEqual({
      x: 10,
      y: 20,
      width: 640,
      height: 480,
      maximized: true,
    });
  });

  it('discards a persisted non-HTTPS base URL and falls back to defaults', () => {
    const persistence = inMemoryPersistence(
      JSON.stringify({ backendBaseUrl: 'http://tampered.example' }),
    );
    const store = new AppConfigStore(persistence);

    expect(store.getBaseUrl()).toBeNull();
    expect(store.getConfig().window).toEqual(DEFAULT_WINDOW_BOUNDS);
  });

  it('tolerates corrupt JSON by starting from defaults', () => {
    const store = new AppConfigStore(inMemoryPersistence('{not json'));
    expect(store.getBaseUrl()).toBeNull();
    expect(store.getConfig().window).toEqual(DEFAULT_WINDOW_BOUNDS);
  });

  it('persists updated window bounds', () => {
    const persistence = inMemoryPersistence();
    const store = new AppConfigStore(persistence);

    store.setWindowBounds({ x: 1, y: 2, width: 800, height: 600, maximized: false });

    const persisted = JSON.parse(persistence.peek() as string) as AppConfig;
    expect(persisted.window).toEqual({
      x: 1,
      y: 2,
      width: 800,
      height: 600,
      maximized: false,
    });
  });
});
