/**
 * The one `BetaAnalyticsDataClient` this process uses.
 *
 * Constructing a client is not free — it loads the credential, builds the gRPC
 * channel and negotiates TLS — and doing it per request would also mean a fresh
 * token exchange per request. One instance is reused for the process lifetime
 * and rebuilt only when the credential it was built from changes.
 */

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import {
  credentialKeyFilename,
  inlineServiceAccountJson,
  type Ga4AuthMethod,
  type Ga4Config,
} from "./config";
import { parseInlineServiceAccount } from "./credentials";

/**
 * The two calls used here, structurally.
 *
 * Depending on this rather than on the concrete class is what lets tests supply
 * a stub without reaching for the real constructor — and it keeps the proto
 * types, which are enormous, out of every signature in the service.
 */
export type Ga4DataClient = {
  runReport(
    request: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<unknown[]>;
  runRealtimeReport(
    request: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<unknown[]>;
};

let cachedClient: Ga4DataClient | null = null;
/**
 * Identity of the credential the cached client was built from: the method plus
 * a non-reversible fingerprint. Never the secret — this value is compared on
 * every request and would otherwise be a private key living in a module-level
 * variable for the lifetime of the process.
 */
let cachedIdentity: string | null = null;

/**
 * The construction options this module ever sets.
 *
 * Concrete rather than `Record<string, unknown>` so that a typo in an option
 * name is a compile error instead of a silently ignored key — the failure mode
 * would be a client quietly falling back to credential discovery.
 */
type Ga4ClientOptions = {
  credentials?: { client_email: string; private_key: string };
  projectId?: string;
  keyFilename?: string;
};

/**
 * Construction options for the selected method.
 *
 * `inline_json` and `key_file` are both explicit: they name the credential
 * rather than letting the library discover one. That matters because ADC's
 * discovery would otherwise fill a gap left by a forgotten variable with
 * whatever identity the machine happens to offer — on a laptop, a personal
 * Google account. `adc` is the one case where discovery is the intent, and it
 * has to be opted into (see `GA4_ALLOW_DEFAULT_CREDENTIALS`).
 */
function clientOptions(method: Ga4AuthMethod): Ga4ClientOptions {
  switch (method) {
    case "inline_json": {
      // Parsed into a local, handed straight to the constructor, never stored.
      const serviceAccount = parseInlineServiceAccount(
        inlineServiceAccountJson(),
      );
      return {
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key,
        },
        ...(serviceAccount.project_id
          ? { projectId: serviceAccount.project_id }
          : {}),
      };
    }
    case "key_file":
      return { keyFilename: credentialKeyFilename() };
    case "adc":
      return {};
  }
}

/**
 * Lazily build the shared client for this configuration.
 *
 * Throws `GA4_INVALID_CREDENTIALS` when inline JSON is present but unusable —
 * that is a credential problem, not a missing-configuration one, and the
 * distinction is what tells an operator whether to set a variable or fix its
 * contents.
 */
export function getGa4Client(config: Ga4Config): Ga4DataClient {
  const identity = `${config.authMethod}:${config.authFingerprint}`;

  if (cachedClient && cachedIdentity === identity) {
    return cachedClient;
  }

  cachedClient = new BetaAnalyticsDataClient(
    clientOptions(config.authMethod),
  ) as unknown as Ga4DataClient;
  cachedIdentity = identity;

  return cachedClient;
}

/** Drop the shared client. Tests use this; nothing in the request path does. */
export function resetGa4Client(): void {
  cachedClient = null;
  cachedIdentity = null;
}
