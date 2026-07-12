import type { Config } from 'jest';

/**
 * Jest config for all Node/TypeScript packages in the Calorie & Cortisol Tool
 * sub-monorepo (gateway, cortisol-data, notification, clients/pwa, clients/shared,
 * shared). Node/TS property-based tests use fast-check. Aligns with the repo-root
 * ts-jest setup.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.fast-check.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
  // Resolve the workspace's shared contracts package to its TypeScript source so
  // tests run without a prior `npm install` link step. Mirrors the tsconfig
  // `paths` used by the compiler.
  moduleNameMapper: {
    '^@calorie-cortisol/shared$': '<rootDir>/shared/src/index.ts',
    '^@calorie-cortisol/shared/(.*)$': '<rootDir>/shared/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/clients/ios/', '/clients/android/'],
};

export default config;
