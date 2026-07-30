/**
 * Jest setup, referenced by `setupFiles` in jest.config.js.
 *
 * The Medusa starter's jest config points here, but the file was never created,
 * so every `jest` invocation failed before collecting a single test — and
 * because the root `npm run test` had no matching package script, turbo reported
 * success while running nothing at all. Both halves have to exist for the gate
 * to mean anything.
 *
 * Integration tests need Medusa's own module loader; unit tests must not pay for
 * it. `TEST_TYPE` already selects the suite, so require the loader only when an
 * integration suite asked for it.
 */
const testType = process.env.TEST_TYPE

if (testType === "integration:http" || testType === "integration:modules") {
  require("@medusajs/test-utils/dist/jest-setup")
}
