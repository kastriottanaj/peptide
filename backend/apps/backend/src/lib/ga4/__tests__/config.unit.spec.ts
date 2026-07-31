import {
  credentialKeyFilename,
  inlineServiceAccountJson,
  resolveAuthMethod,
  resolveCacheTtlMs,
  resolveGa4Config,
} from "../config";

/**
 * These tests set every GA4 variable themselves and never read the real ones.
 * `jest.config.js` calls `loadEnv`, so the developer's actual `.env` — including
 * the real credential path — is in `process.env` when this file runs. Every test
 * overwrites it with a path that does not exist, so nothing here can reach the
 * service-account key even by accident.
 */
const FAKE_CREDENTIALS = "/nonexistent/test-credentials.json";

/** Fabricated. Not a key, not derived from one, and not valid anywhere. */
const FAKE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: "service_account",
  project_id: "fake-project-000000",
  client_email: "fake-tests@fake-project-000000.iam.gserviceaccount.com",
  private_key:
    "-----BEGIN PRIVATE KEY-----\\nFAKEKEYMATERIALFORTESTS\\n-----END PRIVATE KEY-----\\n",
});

const GA4_VARS = [
  "GA4_PROPERTY_ID",
  "GA4_MEASUREMENT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_ALLOW_DEFAULT_CREDENTIALS",
  "GA4_CACHE_TTL_SECONDS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(GA4_VARS.map((key) => [key, process.env[key]]));
  for (const key of GA4_VARS) delete process.env[key];
});

afterEach(() => {
  for (const key of GA4_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
});

describe("resolveGa4Config", () => {
  it("reports a missing property id rather than guessing one", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    const result = resolveGa4Config();

    expect(result).toEqual({ ok: false, problem: "MISSING_PROPERTY_ID" });
  });

  it("rejects a non-numeric property id", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    // The measurement id in the wrong variable is the mistake this catches.
    for (const invalid of ["G-TESTFAKE00", "properties/12345", "12 345", "-1"]) {
      process.env.GA4_PROPERTY_ID = invalid;
      expect(resolveGa4Config()).toEqual({
        ok: false,
        problem: "INVALID_PROPERTY_ID",
      });
    }
  });

  it("reports missing credentials when no method is configured", () => {
    process.env.GA4_PROPERTY_ID = "123456789";

    expect(resolveGa4Config()).toEqual({
      ok: false,
      problem: "MISSING_CREDENTIALS",
    });
  });

  it("accepts inline JSON with no key file present", () => {
    process.env.GA4_PROPERTY_ID = "123456789";
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;

    const result = resolveGa4Config();

    // Production has no filesystem path to point at; requiring one would make
    // this configuration unusable there.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.authMethod).toBe("inline_json");
  });

  it("treats whitespace-only values as unset", () => {
    process.env.GA4_PROPERTY_ID = "   ";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    expect(resolveGa4Config()).toEqual({
      ok: false,
      problem: "MISSING_PROPERTY_ID",
    });
  });

  it("builds the property path and exposes only the last four digits", () => {
    process.env.GA4_PROPERTY_ID = "123456789";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    const result = resolveGa4Config();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.property).toBe("properties/123456789");
    expect(result.config.propertyIdLastFour).toBe("6789");
    expect(result.config.measurementIdConfigured).toBe(false);
  });

  it("never carries the credential path on the config object", () => {
    process.env.GA4_PROPERTY_ID = "123456789";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    const result = resolveGa4Config();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.config)).not.toContain(FAKE_CREDENTIALS);
    // The path is reachable only through the one dedicated accessor.
    expect(credentialKeyFilename()).toBe(FAKE_CREDENTIALS);
  });

  it("flags a configured measurement id without returning it", () => {
    process.env.GA4_PROPERTY_ID = "123456789";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;
    process.env.GA4_MEASUREMENT_ID = "G-TESTONLY123";

    const result = resolveGa4Config();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.measurementIdConfigured).toBe(true);
    expect(JSON.stringify(result.config)).not.toContain("G-TESTONLY123");
  });
});

describe("authentication method", () => {
  beforeEach(() => {
    process.env.GA4_PROPERTY_ID = "123456789";
  });

  it("has no method when nothing is configured", () => {
    expect(resolveAuthMethod()).toBeNull();
  });

  it("prefers inline JSON over a key file", () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    // A production host can set the JSON without having to unset whatever
    // path the image or platform already exports.
    expect(resolveAuthMethod()).toBe("inline_json");
  });

  it("falls back to the key file", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;
    expect(resolveAuthMethod()).toBe("key_file");
  });

  it("uses ADC only when explicitly opted in", () => {
    expect(resolveAuthMethod()).toBeNull();

    // A literal "false" must not read as truthy, and neither must anything
    // that merely looks affirmative.
    for (const notOptedIn of ["false", "1", "yes", "on", "", "  "]) {
      process.env.GA4_ALLOW_DEFAULT_CREDENTIALS = notOptedIn;
      expect(resolveAuthMethod()).toBeNull();
    }

    // Trimmed and case-insensitive, matching how ORDERS_ENABLED is read.
    for (const optedIn of ["true", "TRUE", " true ", "True"]) {
      process.env.GA4_ALLOW_DEFAULT_CREDENTIALS = optedIn;
      expect(resolveAuthMethod()).toBe("adc");
    }
  });

  it("lets an explicit credential outrank the ADC opt-in", () => {
    process.env.GA4_ALLOW_DEFAULT_CREDENTIALS = "true";
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;
    expect(resolveAuthMethod()).toBe("key_file");

    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;
    expect(resolveAuthMethod()).toBe("inline_json");
  });

  it("fingerprints the credential without containing it", () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;

    const result = resolveGa4Config();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { authFingerprint } = result.config;
    expect(authFingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(FAKE_SERVICE_ACCOUNT_JSON).not.toContain(authFingerprint);
    expect(authFingerprint).not.toContain("PRIVATE KEY");
    expect(authFingerprint).not.toContain("gserviceaccount");
  });

  it("changes the fingerprint when the credential changes", () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;
    const first = resolveGa4Config();

    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "other-fake@fake-project-000000.iam.gserviceaccount.com",
      private_key: "-----BEGIN PRIVATE KEY-----\\nOTHER\\n-----END PRIVATE KEY-----\\n",
    });
    const second = resolveGa4Config();

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    // This is what stops a rotated credential from serving the old one's cache.
    expect(first.config.authFingerprint).not.toBe(second.config.authFingerprint);
  });

  it("keeps the whole credential off the config object", () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;

    const result = resolveGa4Config();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.config);
    for (const fragment of [
      "PRIVATE KEY",
      "FAKEKEYMATERIALFORTESTS",
      "gserviceaccount.com",
      "fake-project-000000",
      "private_key",
      "client_email",
    ]) {
      expect(serialized).not.toContain(fragment);
    }

    // Reachable only through the one dedicated accessor.
    expect(inlineServiceAccountJson()).toBe(FAKE_SERVICE_ACCOUNT_JSON);
  });
});

describe("resolveCacheTtlMs", () => {
  it("defaults to 60 seconds when unset or unparseable", () => {
    expect(resolveCacheTtlMs("")).toBe(60_000);
    expect(resolveCacheTtlMs("not-a-number")).toBe(60_000);
    expect(resolveCacheTtlMs("-5")).toBe(60_000);
  });

  it("honours an explicit value, including zero", () => {
    expect(resolveCacheTtlMs("60")).toBe(60_000);
    expect(resolveCacheTtlMs("5")).toBe(5_000);
    // 0 is a deliberate "do not cache", not a missing value.
    expect(resolveCacheTtlMs("0")).toBe(0);
  });

  it("clamps an absurd TTL instead of failing", () => {
    expect(resolveCacheTtlMs("999999")).toBe(3_600_000);
  });
});
