// Feature: api-copilot-desktop, Property 21: Window bounds round-trip
// Validates: Requirements 18.2
/**
 * Property test for window state persistence (main process) — Req 18.2.
 *
 * Property 21: Window bounds round-trip.
 *   For any window bounds (position, size, and maximized flag), persisting them
 *   and then loading them on the next launch yields equal bounds.
 *
 * The bounds file is backed by in-memory fakes (a plain object for the
 * `WindowBoundsPersistence` interface, and an in-memory `ConfigPersistence`
 * string store for the config-file-backed path) so the round-trip is exercised
 * deterministically across a broad, generated input space — covering both the
 * direct persistence path and the JSON-serialized config-file path used in
 * production.
 *
 * Validates: Requirements 18.2
 */
import * as fc from 'fast-check';
import {
  AppConfigStore,
  type ConfigPersistence,
  type WindowBounds,
} from './app-config';
import {
  type BrowserWindowLike,
  type WindowBoundsPersistence,
  WindowStateManager,
  createConfigBackedBoundsPersistence,
} from './window-state';

/**
 * In-memory {@link WindowBoundsPersistence}. Holds a copy of the last saved
 * bounds; mirrors the file-backed store's observable behavior without touching
 * the filesystem.
 */
function inMemoryBoundsPersistence(): WindowBoundsPersistence & {
  peek(): WindowBounds | null;
} {
  let store: WindowBounds | null = null;
  return {
    loadBounds(): WindowBounds {
      // A fresh install has no persisted bounds; the manager sanitizes null
      // into defaults, but every test below saves before loading.
      return (store ?? {}) as WindowBounds;
    },
    saveBounds(bounds: WindowBounds): void {
      store = { ...bounds };
    },
    peek(): WindowBounds | null {
      return store === null ? null : { ...store };
    },
  };
}

/**
 * In-memory {@link ConfigPersistence}. Holds the serialized config JSON so a
 * second {@link AppConfigStore} can re-parse it, exercising the real
 * serialize→deserialize round-trip that happens across app launches.
 */
function inMemoryConfigPersistence(): ConfigPersistence {
  let serialized: string | null = null;
  return {
    read(): string | null {
      return serialized;
    },
    write(next: string): void {
      serialized = next;
    },
  };
}

/** A fake window reporting fixed geometry / maximized state (Electron-free). */
function fakeWindow(
  geometry: { x: number; y: number; width: number; height: number },
  maximized: boolean,
): BrowserWindowLike {
  return {
    getBounds: () => ({ ...geometry }),
    isMaximized: () => maximized,
  };
}

/**
 * Arbitrary valid window bounds: integer coordinates (possibly negative for
 * multi-monitor layouts) and strictly-positive integer dimensions. This is the
 * space of legitimate persisted geometry — values that survive the store's
 * sanitization unchanged, so a true round-trip must reproduce them exactly.
 */
const arbBounds: fc.Arbitrary<WindowBounds> = fc.record({
  x: fc.integer({ min: -10_000, max: 10_000 }),
  y: fc.integer({ min: -10_000, max: 10_000 }),
  width: fc.integer({ min: 1, max: 10_000 }),
  height: fc.integer({ min: 1, max: 10_000 }),
  maximized: fc.boolean(),
});

describe('WindowStateManager — Property 21: window bounds round-trip', () => {
  it('save→load through bounds persistence yields equal bounds', () => {
    fc.assert(
      fc.property(arbBounds, (bounds) => {
        const persistence = inMemoryBoundsPersistence();
        persistence.saveBounds(bounds);

        // Simulate the next launch: a fresh manager loads the persisted bounds.
        const restored = new WindowStateManager(persistence);
        expect(restored.getBounds()).toEqual(bounds);
        expect(restored.shouldStartMaximized()).toBe(bounds.maximized);
      })
    );
  });

  it('round-trips through the JSON-serialized config file (production path)', () => {
    fc.assert(
      fc.property(arbBounds, (bounds) => {
        const configPersistence = inMemoryConfigPersistence();

        // First launch: capture bounds via the config-backed persistence.
        const firstStore = new AppConfigStore(configPersistence);
        const manager = new WindowStateManager(
          createConfigBackedBoundsPersistence(firstStore),
        );
        // Persist non-maximized geometry captured from a live window...
        const win = fakeWindow(
          { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          false,
        );
        manager.capture(win);
        if (bounds.maximized) {
          // ...then a maximize event flips the flag while keeping restore size.
          manager.capture(fakeWindow({ x: 0, y: 0, width: 99, height: 99 }, true));
        }

        // Next launch: a brand-new store re-parses the serialized JSON and a
        // new manager restores identical bounds.
        const secondStore = new AppConfigStore(configPersistence);
        const restored = new WindowStateManager(
          createConfigBackedBoundsPersistence(secondStore),
        );
        expect(restored.getBounds()).toEqual(bounds);
      })
    );
  });

  it('captured live geometry round-trips unchanged (non-maximized)', () => {
    fc.assert(
      fc.property(arbBounds, (bounds) => {
        const persistence = inMemoryBoundsPersistence();
        const manager = new WindowStateManager(persistence);
        manager.capture(
          fakeWindow(
            {
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
            },
            false,
          ),
        );

        const expected: WindowBounds = { ...bounds, maximized: false };
        expect(persistence.peek()).toEqual(expected);
        expect(new WindowStateManager(persistence).getBounds()).toEqual(expected);
      })
    );
  });
});
