export default {
  projects: ['<rootDir>/jest.config.js'],
  collectCoverageFrom: [
    'packages/*/src/**/*.{ts,tsx}',
    'apps/*/src/**/*.{ts,tsx}',
  ],
  coverageReporters: ['text', 'text-summary', 'html', 'lcov'],
  coverageThreshold: {
    global: { lines: 70, functions: 70, branches: 65, statements: 70 },
  },
};
