/**
 * Non-secret application configuration: persistence, HTTPS-only base-URL
 * validation, and relative-path URL resolution.
 *
 * This module lives in the Electron MAIN process but is deliberately
 * Electron-free so it can be unit- and property-tested in isolation. The
 * caller (main-process wiring) supplies the user-data directory; see
 * {@link configFilePath} and {@link createFileConfigPersistence}.
 *
 * IMPORTANT (Req 4): the Session_Token is NEVER stored here. This file holds
 * only non-secret values — the Backend_Gateway base URL and window bounds.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Persisted window geometry (Req 18.2). */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/**
 * Persisted, non-secret application configuration.
 *
 * `backendBaseUrl` is always an HTTPS URL or null (Req 1.2, 1.3). The
 * Session_Token is intentionally absent — it lives only in the Secure_Store.
 */
export interface AppConfig {
  /** HTTPS-only Backend_Gateway base URL, or null when not yet configured. */
  backendBaseUrl: string | null;
  /** Last known window geometry. */
  window: WindowBounds;
}

/** Default window geometry used before the user has moved/resized the window. */
export const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  x: 0,
  y: 0,
  width: 1280,
  height: 800,
  maximized: false,
};

/** The configuration a fresh install starts with (no base URL configured). */
export const DEFAULT_APP_CONFIG: AppConfig = {
  backendBaseUrl: null,
  window: { ...DEFAULT_WINDOW_BOUNDS },
};

/** File name used for the persisted, non-secret config within the user-data dir. */
export const CONFIG_FILE_NAME = 'app-config.json';

/** The namespace prefix every resolvable relative backend path lives under. */
export const API_COPILOT_PREFIX = '/api/copilot';

/** Why a candidate base URL was rejected. */
export type BaseUrlRejectionReason = 'empty' | 'not_https' | 'malformed';

/** The result of validating a candidate base URL. */
export type BaseUrlValidation =
  | { valid: true; normalized: string }
  | { valid: false; reason: BaseUrlRejectionReason };

/**
 * Validate a candidate Backend_Gateway base URL (Req 1.2, 1.3, 4.5).
 *
 * A candidate is valid if and only if it is non-empty (after trimming) and
 * uses the HTTPS scheme. The returned `normalized` value is the trimmed
 * candidate string, suitable for storage.
 */
export function validateBaseUrl(candidate: string): BaseUrlValidation {
  const trimmed = (candidate ?? '').trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'not_https' };
  }

  return { valid: true, normalized: trimmed };
}

/** Convenience predicate: true iff the candidate is a non-empty HTTPS URL. */
export function isValidBaseUrl(candidate: string): boolean {
  return validateBaseUrl(candidate).valid;
}

/**
 * Resolve a relative backend path against a stored HTTPS base URL (Req 1.2).
 *
 * The base URL's own path prefix (if any) is preserved; the relative path is
 * appended with exactly one separating slash. Absolute (`http(s)://…`) paths
 * are returned unchanged so callers can pass either form safely.
 */
export function resolveApiUrl(baseUrl: string, relativePath: string): string {
  if (/^https?:\/\//i.test(relativePath)) {
    return relativePath;
  }
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = relativePath.startsWith('/')
    ? relativePath
    : `/${relativePath}`;
  return `${trimmedBase}${normalizedPath}`;
}

/** The outcome of attempting to set the stored base URL. */
export type SetBaseUrlResult =
  | { accepted: true; baseUrl: string }
  | { accepted: false; reason: BaseUrlRejectionReason; baseUrl: string | null };

/**
 * A minimal persistence backend for the config file. Injected into
 * {@link AppConfigStore} so tests can substitute an in-memory fake instead of
 * touching the filesystem.
 */
export interface ConfigPersistence {
  /** Return the raw serialized config, or null when nothing is persisted yet. */
  read(): string | null;
  /** Persist the serialized config. */
  write(serialized: string): void;
}

/** Compute the absolute config-file path within a user-data directory. */
export function configFilePath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE_NAME);
}

/**
 * A filesystem-backed {@link ConfigPersistence}. Used by the real app with the
 * path returned by {@link configFilePath}; tests use an in-memory fake instead.
 */
export function createFileConfigPersistence(filePath: string): ConfigPersistence {
  return {
    read(): string | null {
      try {
        return fs.readFileSync(filePath, 'utf8');
      } catch {
        return null;
      }
    },
    write(serialized: string): void {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, serialized, 'utf8');
    },
  };
}

/**
 * Loads, validates, and persists the non-secret {@link AppConfig}.
 *
 * Base-URL rules (Req 1.2, 1.3, 4.5): a candidate is stored if and only if it
 * is a non-empty HTTPS URL. A rejected candidate leaves the previously stored
 * value unchanged and is never persisted.
 */
export class AppConfigStore {
  private config: AppConfig;

  constructor(private readonly persistence: ConfigPersistence) {
    this.config = AppConfigStore.parse(persistence.read());
  }

  /** Return a defensive copy of the current configuration. */
  getConfig(): AppConfig {
    return { ...this.config, window: { ...this.config.window } };
  }

  /** The stored HTTPS base URL, or null when none is configured. */
  getBaseUrl(): string | null {
    return this.config.backendBaseUrl;
  }

  /**
   * Attempt to store a candidate base URL (Req 1.2, 1.3, 4.5).
   *
   * On success the normalized (trimmed) HTTPS URL is stored and persisted. On
   * failure the previously stored value is retained and nothing is persisted.
   */
  setBaseUrl(candidate: string): SetBaseUrlResult {
    const validation = validateBaseUrl(candidate);
    if (!validation.valid) {
      return {
        accepted: false,
        reason: validation.reason,
        baseUrl: this.config.backendBaseUrl,
      };
    }
    this.config.backendBaseUrl = validation.normalized;
    this.save();
    return { accepted: true, baseUrl: validation.normalized };
  }

  /** Replace the persisted window bounds (Req 18.2). */
  setWindowBounds(bounds: WindowBounds): void {
    this.config.window = { ...bounds };
    this.save();
  }

  /**
   * Resolve a relative `/api/copilot/*` path against the stored base URL.
   * Returns null when no base URL has been configured yet.
   */
  resolve(relativePath: string): string | null {
    if (this.config.backendBaseUrl === null) {
      return null;
    }
    return resolveApiUrl(this.config.backendBaseUrl, relativePath);
  }

  /** Persist the current configuration via the injected backend. */
  save(): void {
    this.persistence.write(JSON.stringify(this.config, null, 2));
  }

  /**
   * Parse persisted JSON into an {@link AppConfig}, falling back to defaults
   * for missing or invalid fields. A persisted base URL that is not a valid
   * HTTPS URL is discarded (defense in depth against a hand-edited file).
   */
  private static parse(serialized: string | null): AppConfig {
    if (serialized === null) {
      return { backendBaseUrl: null, window: { ...DEFAULT_WINDOW_BOUNDS } };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      return { backendBaseUrl: null, window: { ...DEFAULT_WINDOW_BOUNDS } };
    }

    const record = (raw ?? {}) as Record<string, unknown>;

    const candidateUrl =
      typeof record.backendBaseUrl === 'string' ? record.backendBaseUrl : null;
    const backendBaseUrl =
      candidateUrl !== null && isValidBaseUrl(candidateUrl)
        ? candidateUrl.trim()
        : null;

    return {
      backendBaseUrl,
      window: AppConfigStore.parseWindow(record.window),
    };
  }

  /** Parse persisted window bounds, filling any missing field from defaults. */
  private static parseWindow(raw: unknown): WindowBounds {
    const record = (raw ?? {}) as Record<string, unknown>;
    const num = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return {
      x: num(record.x, DEFAULT_WINDOW_BOUNDS.x),
      y: num(record.y, DEFAULT_WINDOW_BOUNDS.y),
      width: num(record.width, DEFAULT_WINDOW_BOUNDS.width),
      height: num(record.height, DEFAULT_WINDOW_BOUNDS.height),
      maximized:
        typeof record.maximized === 'boolean'
          ? record.maximized
          : DEFAULT_WINDOW_BOUNDS.maximized,
    };
  }
}
