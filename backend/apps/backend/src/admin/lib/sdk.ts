/**
 * The authenticated admin API client.
 *
 * `@medusajs/js-sdk` in session mode is what the Medusa dashboard itself uses:
 * it sends the admin's session cookie with every request, so nothing here has
 * to know about tokens, and an expired session fails the same way it does
 * everywhere else in the admin rather than in some analytics-specific way.
 *
 * No raw `fetch` anywhere in this feature. A hand-rolled request would have to
 * reproduce the credentials mode, the base URL resolution and the JSON handling
 * — three chances to get authentication subtly wrong on pages that read the
 * shop's revenue.
 *
 * The error taxonomy deliberately lives in `errors.ts`, not here. This module
 * reads `import.meta.env`, which only a bundler provides, and everything that
 * merely needs to *describe* a failure should not have to be bundled to do it.
 */

import Medusa from "@medusajs/js-sdk";
import { toAnalyticsError, type AnalyticsScope } from "./errors";

export const sdk = new Medusa({
  // Relative by default: the admin is served by the same Medusa process that
  // serves these routes, so a hardcoded origin would only ever be wrong.
  baseUrl: import.meta.env.VITE_BACKEND_URL || "/",
  debug: import.meta.env.DEV,
  auth: { type: "session" },
});

/**
 * One authenticated GET, with failures normalised into `AnalyticsError`.
 *
 * `signal` is threaded through so a period change can abort the request it
 * superseded instead of racing it to the cache.
 */
export async function getAnalytics<T>(
  path: string,
  options: {
    scope: AnalyticsScope;
    query?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<T> {
  try {
    return await sdk.client.fetch<T>(path, {
      method: "GET",
      query: options.query,
      signal: options.signal,
    });
  } catch (error) {
    // An aborted request is not a failure to report; let react-query see it
    // as the cancellation it is.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw toAnalyticsError(error, options.scope);
  }
}
