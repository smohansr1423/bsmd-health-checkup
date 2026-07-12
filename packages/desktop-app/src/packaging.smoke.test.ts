/**
 * Packaging & First-View Boot — Smoke Test
 *
 * Feature: api-copilot-desktop
 * Task 17.2 — Validates: Requirements 19.1, 19.2
 *
 * Electron packaging and per-OS launch are not property-testable (see the
 * design's Testing Strategy). Instead, this smoke test asserts the two
 * statically verifiable facts that packaging correctness reduces to:
 *
 *   1. (Req 19.1) The `electron-builder` configuration produces an installable
 *      package target for each of Windows, macOS, and Linux.
 *   2. (Req 19.2) The installed app boots to the correct first view — i.e. the
 *      compiled main entry that runs the startup router is what packaging
 *      ships, and that router resolves to the sign-in view or the restored
 *      authenticated-home view.
 */

import * as fs from 'fs';
import * as path from 'path';

import { routeStartup } from './renderer/state/startup-router';
import type { StartupDestination } from './renderer/state/startup-router';

// js-yaml ships with electron-builder but without bundled type declarations;
// `require` returns `any`, so we narrow the one function we use locally.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require('js-yaml') as { load: (input: string) => unknown };

const PACKAGE_ROOT = path.join(__dirname, '..');
const BUILDER_CONFIG_PATH = path.join(PACKAGE_ROOT, 'electron-builder.yml');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');

interface BuilderConfig {
  appId?: string;
  productName?: string;
  files?: string[];
  win?: { target?: unknown };
  mac?: { target?: unknown };
  linux?: { target?: unknown };
}

interface PackageJson {
  main?: string;
  scripts?: Record<string, string>;
}

function loadBuilderConfig(): BuilderConfig {
  const raw = fs.readFileSync(BUILDER_CONFIG_PATH, 'utf8');
  return yaml.load(raw) as BuilderConfig;
}

function loadPackageJson(): PackageJson {
  const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
  return JSON.parse(raw) as PackageJson;
}

/** electron-builder accepts a target as a string or a list of strings/objects. */
function normalizeTargets(target: unknown): string[] {
  const items = Array.isArray(target) ? target : [target];
  return items
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'target' in item) {
        return String((item as { target: unknown }).target);
      }
      return '';
    })
    .filter((name) => name.length > 0);
}

describe('Packaging smoke test — Req 19.1: installable packages for Windows, macOS, and Linux', () => {
  const config = loadBuilderConfig();

  it('loads a valid electron-builder configuration with app identity', () => {
    expect(config).toBeTruthy();
    expect(typeof config.appId).toBe('string');
    expect(config.appId).toMatch(/\S/);
    expect(typeof config.productName).toBe('string');
    expect(config.productName).toMatch(/\S/);
  });

  it('defines a Windows package target', () => {
    const targets = normalizeTargets(config.win?.target);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('nsis');
  });

  it('defines a macOS package target', () => {
    const targets = normalizeTargets(config.mac?.target);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('dmg');
  });

  it('defines a Linux package target', () => {
    const targets = normalizeTargets(config.linux?.target);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets).toContain('AppImage');
  });

  it('produces targets for all three operating systems', () => {
    const platformsWithTargets = (['win', 'mac', 'linux'] as const).filter(
      (os) => normalizeTargets(config[os]?.target).length > 0,
    );
    expect(platformsWithTargets).toEqual(['win', 'mac', 'linux']);
  });

  it('ships the compiled output rather than TypeScript sources or tests', () => {
    const files = config.files ?? [];
    expect(files).toContain('dist/**/*');
    // Sources, sourcemaps, and tests must be excluded from the installer.
    expect(files).toContain('!**/*.ts');
    expect(files.some((glob) => glob.includes('*.test.'))).toBe(true);
  });
});

describe('Packaging smoke test — Req 19.2: installed app boots to the correct first view', () => {
  const pkg = loadPackageJson();

  it('packages a compiled main entry that runs the startup router on launch', () => {
    // The `files` glob ships `dist/**/*`, and package.json "main" is the entry
    // Electron loads on launch. It must point at compiled JS under dist.
    expect(pkg.main).toBe('dist/main/main.js');
  });

  it('wires packaging scripts so the compiled output exists before packaging', () => {
    const scripts = pkg.scripts ?? {};
    // `predist` builds (tsc) before `dist` packages, guaranteeing dist/ exists.
    expect(scripts.predist).toBe('npm run build');
    expect(scripts.dist).toContain('electron-builder');
    // Per-OS packaging entry points exist for the three supported platforms.
    expect(scripts['dist:win']).toContain('--win');
    expect(scripts['dist:mac']).toContain('--mac');
    expect(scripts['dist:linux']).toContain('--linux');
  });

  it('boots to the sign-in view when configured but no session token is stored (Req 1.5)', () => {
    const destination = routeStartup({
      configuredBaseUrl: 'https://copilot.example.com',
      hasToken: false,
    });
    expect(destination).toBe('sign-in');
  });

  it('boots to the restored authenticated-home view when a session token is stored (Req 1.4)', () => {
    const destination = routeStartup({
      configuredBaseUrl: 'https://copilot.example.com',
      hasToken: true,
    });
    expect(destination).toBe('authenticated-home');
  });

  it('always reaches sign-in or the restored authenticated home once configured (Req 19.2)', () => {
    const bootViews: StartupDestination[] = [true, false].map((hasToken) =>
      routeStartup({ configuredBaseUrl: 'https://copilot.example.com', hasToken }),
    );
    for (const view of bootViews) {
      expect(['sign-in', 'authenticated-home']).toContain(view);
    }
  });
});
