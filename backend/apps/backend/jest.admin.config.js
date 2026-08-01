/**
 * Jest for the admin extension.
 *
 * A separate config rather than a fourth `TEST_TYPE` in `jest.config.js`,
 * because almost nothing is shared: these tests run in **jsdom**, not Node;
 * they compile **TSX with the automatic JSX runtime**, which the server config
 * has no parser for; and they must **not** run `integration-tests/setup.js`,
 * which exists to point the suite at a test database these tests never touch.
 *
 * `loadEnv` is deliberately absent too. The server config calls it, which puts
 * the developer's real `.env` — including the GA4 service-account credential —
 * into `process.env`. Nothing in a browser-side test has any business being
 * able to read that, and one of the tests here asserts exactly that no
 * credential value reaches the bundle.
 */

module.exports = {
  displayName: "admin",
  rootDir: __dirname,
  testEnvironment: "jsdom",
  testEnvironmentOptions: {
    // The admin is served from the Medusa origin; a realistic URL keeps
    // `useSearchParams` and the CSV object-URL code paths honest.
    url: "http://localhost:9000/app/analytics",
  },
  transform: {
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true },
          transform: { react: { runtime: "automatic" } },
        },
      },
    ],
  },
  moduleFileExtensions: ["js", "jsx", "ts", "tsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  moduleNameMapper: {
    // Vite resolves CSS imports; Jest cannot. The stylesheet is asserted
    // separately as text, so a stub here loses nothing.
    "\\.css$": "<rootDir>/src/admin/__tests__/style-stub.js",
  },
  setupFilesAfterEnv: ["<rootDir>/src/admin/__tests__/setup.ts"],
  testMatch: ["**/src/admin/**/__tests__/**/*.admin.spec.[jt]sx"],
};
