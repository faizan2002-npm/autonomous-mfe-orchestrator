import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix primitives (Select, Switch) measure with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
