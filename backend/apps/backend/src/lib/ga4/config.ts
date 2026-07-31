/**
 * GA4 Data API configuration, read from the environment.
 *
 * Everything here is deliberately value-free in what it exposes: the resolved
 * config carries the property id (needed to build the request) and a four-digit
 * suffix (safe to show an admin so they can tell two properties apart), and
 * nothing else that identifies the Google project. Credentials — whether a file
 * path or an inline JSON blob — are never placed on the config object. What the
 * config carries instead is *which* method is in use and a non-reversible
 * fingerprint of it, which is enough to key a cache and to log.
 */

import { credentialFingerprint } from "./credentials";

/** Why the integration is not usable, when it is not. */
export type Ga4ConfigProblem =
  | "MISSING_PROPERTY_ID"
  | "INVALID_PROPERTY_ID"
  | "MISSING_CREDENTIALS";

/**
 * How this process authenticates to Google.
 *
 *  - `inline_json` — `GA4_SERVICE_ACCOUNT_JSON`, parsed in memory. The
 *    production path: no key file has to exist on the host.
 *  - `key_file` — `GOOGLE_APPLICATION_CREDENTIALS`, a path to a key file. The
 *    local development path.
 *  - `adc` — Application Default Credentials from the hosting environment
 *    (workload identity, an attached service account). Only ever chosen when
 *    explicitly opted into; see `GA4_ALLOW_DEFAULT_CREDENTIALS`.
 */
export type Ga4AuthMethod = "inline_json" | "key_file" | "adc";

export type Ga4Config = {
  /** Numeric GA4 property id, e.g. `123456789`. */
  propertyId: string;
  /** `properties/<id>` — the only form the Data API accepts. */
  property: string;
  /** Last four digits, safe to surface in an admin response. */
  propertyIdLastFour: string;
  /** Whether `GA4_MEASUREMENT_ID` is set. The Data API does not use it. */
  measurementIdConfigured: boolean;
  authMethod: Ga4AuthMethod;
  /** Non-reversible id for the credential in use. Safe to log and to key on. */
  authFingerprint: string;
  /** Successful-report cache lifetime. `0` disables caching. */
  cacheTtlMs: number;
  /** Per-Google-call deadline. */
  requestTimeoutMs: number;
};

export type Ga4ConfigResult =
  | { ok: true; config: Ga4Config }
  | { ok: false; problem: Ga4ConfigProblem };

/** GA4 property ids are numeric. Anything else is a typo, not a property. */
const PROPERTY_ID_PATTERN = /^[0-9]{1,20}$/;

const DEFAULT_CACHE_TTL_SECONDS = 60;
const MAX_CACHE_TTL_SECONDS = 3600;

/**
 * Per-call deadline. Not configurable on purpose: the admin dashboard is the
 * only caller, and a request that has not come back in 15s is not going to.
 */
export const GA4_REQUEST_TIMEOUT_MS = 15_000;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Cache TTL in milliseconds.
 *
 * Clamped rather than rejected — a nonsense TTL should degrade to the default
 * instead of taking the whole integration down, since it cannot cause a wrong
 * answer, only a differently-timed one. `0` is honoured as "do not cache".
 */
export function resolveCacheTtlMs(raw = env("GA4_CACHE_TTL_SECONDS")): number {
  if (!raw) return DEFAULT_CACHE_TTL_SECONDS * 1000;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CACHE_TTL_SECONDS * 1000;
  }

  return Math.min(Math.floor(parsed), MAX_CACHE_TTL_SECONDS) * 1000;
}

/**
 * Whether bare Application Default Credentials are an accepted answer here.
 *
 * This has to be opted into explicitly. ADC will happily authenticate as a GCE
 * metadata service account, a Cloud Run identity, or — on a developer laptop —
 * whoever last ran `gcloud auth login`. Treating "nothing configured" as
 * "use ADC" would mean a forgotten variable silently reports on whatever
 * property that other identity can reach, instead of failing. Only `true` opts
 * in — trimmed and case-insensitive, matching how `ORDERS_ENABLED` is read
 * elsewhere in this codebase, so a literal "false" cannot read as truthy.
 */
function defaultCredentialsAllowed(): boolean {
  return env("GA4_ALLOW_DEFAULT_CREDENTIALS").toLowerCase() === "true";
}

/**
 * Pick the authentication method, in precedence order.
 *
 * Inline JSON wins over a key file so a production host can set it without
 * having to unset whatever `GOOGLE_APPLICATION_CREDENTIALS` the image or the
 * platform already exports. Only presence is checked here — whether the JSON
 * parses and carries a usable key is decided when the client is built, and is
 * reported as `GA4_INVALID_CREDENTIALS` rather than as "not configured".
 */
export function resolveAuthMethod(): Ga4AuthMethod | null {
  if (env("GA4_SERVICE_ACCOUNT_JSON")) return "inline_json";
  if (env("GOOGLE_APPLICATION_CREDENTIALS")) return "key_file";
  if (defaultCredentialsAllowed()) return "adc";
  return null;
}

/**
 * A fingerprint of the credential in use, without the credential.
 *
 * Derived from the raw material so that rotating a key, swapping a path, or
 * moving from a file to inline JSON all produce a different value — which is
 * what makes it safe to use in a cache key.
 */
function fingerprintFor(method: Ga4AuthMethod): string {
  switch (method) {
    case "inline_json":
      return credentialFingerprint(env("GA4_SERVICE_ACCOUNT_JSON"));
    case "key_file":
      return credentialFingerprint(env("GOOGLE_APPLICATION_CREDENTIALS"));
    case "adc":
      // Nothing local to fingerprint; the ambient identity is what it is.
      return "adc";
  }
}

/**
 * Validate the environment without touching any credential.
 *
 * The key file is not opened and not stat-ed, and the inline JSON is not parsed
 * here. Whether either actually works is Google's library's job to discover —
 * reading a key ourselves would mean holding a private key in this process for
 * no reason, and a stat call tells us nothing the first API call will not.
 */
export function resolveGa4Config(): Ga4ConfigResult {
  const propertyId = env("GA4_PROPERTY_ID");
  if (!propertyId) return { ok: false, problem: "MISSING_PROPERTY_ID" };
  if (!PROPERTY_ID_PATTERN.test(propertyId)) {
    return { ok: false, problem: "INVALID_PROPERTY_ID" };
  }

  const authMethod = resolveAuthMethod();
  if (!authMethod) return { ok: false, problem: "MISSING_CREDENTIALS" };

  return {
    ok: true,
    config: {
      propertyId,
      property: `properties/${propertyId}`,
      propertyIdLastFour: propertyId.slice(-4),
      measurementIdConfigured: env("GA4_MEASUREMENT_ID").length > 0,
      authMethod,
      authFingerprint: fingerprintFor(authMethod),
      cacheTtlMs: resolveCacheTtlMs(),
      requestTimeoutMs: GA4_REQUEST_TIMEOUT_MS,
    },
  };
}

/**
 * The raw credential material, for handing to the client constructor only.
 *
 * Both accessors are isolated here so that every use is greppable, and so no
 * caller can pick a secret up incidentally off a config object it is already
 * logging.
 */
export function credentialKeyFilename(): string {
  return env("GOOGLE_APPLICATION_CREDENTIALS");
}

export function inlineServiceAccountJson(): string {
  return env("GA4_SERVICE_ACCOUNT_JSON");
}
