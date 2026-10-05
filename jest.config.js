/** @type {import('jest').Config} */
export default {
  projects: [
    {
      displayName: 'packages/core',
      testEnvironment: 'node',
      roots: ['<rootDir>/packages/core'],
      testMatch: ['<rootDir>/packages/core/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['@swc/jest'] },
      moduleNameMapper: {
        '^@orchestrator/(.*)$': '<rootDir>/packages/$1',
      },
    },
    {
      displayName: 'packages/crypto',
      testEnvironment: 'node',
      roots: ['<rootDir>/packages/crypto'],
      testMatch: ['<rootDir>/packages/crypto/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['@swc/jest'] },
    },
    {
      displayName: 'apps/api-gateway',
      testEnvironment: 'node',
      roots: ['<rootDir>/apps/api-gateway'],
      testMatch: ['<rootDir>/apps/api-gateway/src/**/*.test.ts'],
      transform: { '^.+\\.tsx?$': ['@swc/jest'] },
      moduleNameMapper: {
        '^@orchestrator/(.*)$': '<rootDir>/packages/$1',
      },
    },
    {
      displayName: 'apps/dashboard',
      testEnvironment: 'jsdom',
      roots: ['<rootDir>/apps/dashboard'],
      testMatch: ['<rootDir>/apps/dashboard/src/**/*.test.tsx?'],
      setupFilesAfterEnv: ['<rootDir>/apps/dashboard/src/test/setup.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/apps/dashboard/src/$1',
        '^@orchestrator/(.*)$': '<rootDir>/packages/$1',
      },
    },
  ],
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    'apps/*/src/**/*.{ts,tsx}',
    '!**/*.test.{ts,tsx}',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/*.d.ts',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 30000,
  maxWorkers: '50%',
};
