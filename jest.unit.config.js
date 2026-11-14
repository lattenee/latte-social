/**
 * Focused unit-test harness for plain TypeScript specs (`*.spec.ts`).
 *
 * The repo-wide `jest.config.ts` defers to Nx `getJestProjects()`, but no
 * project in this workspace declares a jest target, so `pnpm test` ran zero
 * tests (and `@nx/jest` is not even installed). This config is deliberately
 * lightweight: ts-jest + the tsconfig.base path aliases, no Nx project
 * graph. `pnpm test` points here.
 */
module.exports = {
  displayName: 'unit',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps', '<rootDir>/libraries'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        // The codebase does not type-check under strict specs today; keep
        // transpilation isolated so specs compile like the libs do.
        diagnostics: false,
      },
    ],
  },
  moduleNameMapper: {
    '^@gitroom/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@gitroom/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@gitroom/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@gitroom/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@gitroom/react/(.*)$': '<rootDir>/libraries/react-shared-libraries/src/$1',
    '^@gitroom/plugins/(.*)$': '<rootDir>/libraries/plugins/src/$1',
    '^@gitroom/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
    '^@gitroom/extension/(.*)$': '<rootDir>/apps/extension/src/$1',
    // ESM-only packages jest cannot parse under its CJS runtime.
    '^file-type$': '<rootDir>/test/stubs/file-type.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/\\.next/'],
};
