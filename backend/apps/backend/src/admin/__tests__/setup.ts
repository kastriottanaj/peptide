/**
 * Shared setup for the admin extension tests.
 *
 * Two jobs: load jest-dom's matchers, and fill the jsdom gaps that the
 * dashboard's components hit. Everything here is environment plumbing — no
 * fixtures, no fakes for anything under test.
 */

import "@testing-library/jest-dom";

/**
 * `ResizeObserver` and `matchMedia` do not exist in jsdom, and Radix (which
 * `@medusajs/ui` builds on) constructs both on mount.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as never);

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as never;
}

/**
 * jsdom has no object-URL implementation, which the CSV download needs. Stubbed
 * rather than mocked per test so an accidental download in an unrelated test
 * cannot throw and be mistaken for a real failure.
 */
if (!URL.createObjectURL) {
  URL.createObjectURL = () => "blob:test";
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = () => {};
}

/**
 * `import.meta.env` is a Vite construct. `@swc/jest` compiles the modules to
 * CommonJS where `import.meta` does not exist, so the two modules that read it
 * (`lib/sdk.ts` for the base URL) are given values through `process.env`
 * instead — see the `import.meta` shim in `sdk.ts`'s test double.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
