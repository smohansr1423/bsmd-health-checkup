import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/packages'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
  // The desktop-app renderer is a React (JSX + DOM lib) package, so its files
  // must be compiled with its own tsconfig; every other package keeps the root
  // tsconfig. Path-scoped transforms let both coexist in one Jest run.
  transform: {
    '.*[\\\\/]packages[\\\\/]desktop-app[\\\\/].*\\.tsx?$': [
      'ts-jest',
      { tsconfig: 'packages/desktop-app/tsconfig.json' },
    ],
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.fast-check.ts'],
  moduleNameMapper: {
    '@health-checkup/shared': '<rootDir>/packages/shared/src',
    '@health-checkup/services': '<rootDir>/packages/services/src',
    '@health-checkup/api-gateway': '<rootDir>/packages/api-gateway/src',
    '^@react-native-community/netinfo$': '<rootDir>/packages/mobile-app/src/__mocks__/netinfo.ts',
  },
  // Never pick up compiled test output, and defer the self-contained
  // Calorie & Cortisol Tool sub-monorepo to its own Jest config
  // (packages/calorie-cortisol-tool/jest.config.ts, run by its dedicated CI
  // workflow). Its tests type-check against their own tsconfig.jest.json paths,
  // so running them from this root config would fail module resolution.
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '<rootDir>/packages/calorie-cortisol-tool/',
  ],
  collectCoverageFrom: [
    'packages/**/src/**/*.ts',
    '!packages/**/src/**/*.d.ts',
    '!packages/**/src/**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
};

export default config;
