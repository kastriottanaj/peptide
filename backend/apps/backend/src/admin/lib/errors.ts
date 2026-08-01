/**
 * Analytics failures, as the UI understands them.
 *
 * Split out of `sdk.ts` so that nothing has to construct a Medusa client to
 * reason about an error: the panels, the header indicator and the tests all
 * import from here, and only the transport imports the SDK. It also keeps this
 * module free of `import.meta`, so it runs unchanged under Jest.
 */

/**
 * Every code the analytics endpoints can report.
 *
 * The GA4 five come from `src/lib/ga4/errors.ts`, plus the summary route's
 * period validation; the two `OPS_` ones from `src/lib/ops/errors.ts`. The last
 * two are client-side conclusions, not server codes.
 */
export type AnalyticsErrorCode =
  | "GA4_NOT_CONFIGURED"
  | "GA4_INVALID_CREDENTIALS"
  | "GA4_PERMISSION_DENIED"
  | "GA4_PROPERTY_NOT_FOUND"
  | "GA4_API_UNAVAILABLE"
  | "GA4_INVALID_PERIOD"
  | "OPS_INVALID_PERIOD"
  | "OPS_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "UNKNOWN";

/** Which family of endpoints a request belonged to. */
export type AnalyticsScope = "ga4" | "ops";

export class AnalyticsError extends Error {
  readonly code: AnalyticsErrorCode;
  readonly status?: number;
  /** Whether re-issuing the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    code: AnalyticsErrorCode,
    message: string,
    status?: number,
    retryable = false,
  ) {
    super(message);
    this.name = "AnalyticsError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isAnalyticsError(value: unknown): value is AnalyticsError {
  return value instanceof AnalyticsError;
}

/**
 * HTTP status to error code.
 *
 * `@medusajs/js-sdk` throws away the response body's `code` on a non-2xx — it
 * keeps only the top-level `message`, which is why the server repeats both
 * there. So the code is recovered from the status, which is a faithful proxy:
 * the server maps one status per code, with a single documented exception.
 * `GA4_NOT_CONFIGURED` and `GA4_INVALID_CREDENTIALS` are both 503 and are
 * presented identically on purpose — for the person reading the screen, both
 * mean "the server's Google credentials need attention", and the server's own
 * message distinguishes them in words.
 */
export function codeForStatus(
  status: number | undefined,
  scope: AnalyticsScope,
): { code: AnalyticsErrorCode; retryable: boolean } {
  if (status === 403 && scope === "ga4") {
    return { code: "GA4_PERMISSION_DENIED", retryable: false };
  }
  if (status === 401 || status === 403) {
    return { code: "UNAUTHORIZED", retryable: false };
  }
  if (status === 400) {
    return {
      code: scope === "ga4" ? "GA4_INVALID_PERIOD" : "OPS_INVALID_PERIOD",
      retryable: false,
    };
  }
  if (status === 404 && scope === "ga4") {
    return { code: "GA4_PROPERTY_NOT_FOUND", retryable: false };
  }
  if (status === 502) {
    return { code: "GA4_API_UNAVAILABLE", retryable: true };
  }
  if (status === 503) {
    // On the ops side a 503 is a transient aggregation failure and worth one
    // retry; on the GA4 side it is a server configuration problem that retrying
    // cannot fix.
    return {
      code: scope === "ga4" ? "GA4_NOT_CONFIGURED" : "OPS_UNAVAILABLE",
      retryable: scope === "ops",
    };
  }
  return { code: "UNKNOWN", retryable: true };
}

/** Turn a thrown `FetchError` (or anything else) into an `AnalyticsError`. */
export function toAnalyticsError(
  error: unknown,
  scope: AnalyticsScope,
): AnalyticsError {
  if (isAnalyticsError(error)) return error;

  const fetchError = error as { status?: number; message?: string };
  const { code, retryable } = codeForStatus(fetchError?.status, scope);

  return new AnalyticsError(
    code,
    fetchError?.message || "The request failed.",
    fetchError?.status,
    retryable,
  );
}

/**
 * What to tell the person looking at the screen, and what they can do.
 *
 * Every message names who can act. A merchant cannot fix a rejected
 * service-account key, and telling them to "try again" would waste their time;
 * telling them the shop's own figures are unaffected is the part that actually
 * matters to them.
 */
const GUIDANCE: Record<
  AnalyticsErrorCode,
  { title: string; detail: string }
> = {
  GA4_NOT_CONFIGURED: {
    title: "Google Analytics is not configured",
    detail:
      "No property id or service-account credential is set on the server. Traffic panels stay empty until it is; order and revenue figures are unaffected.",
  },
  GA4_INVALID_CREDENTIALS: {
    title: "Google Analytics credentials were rejected",
    detail:
      "The service-account key on the server is missing, unreadable or no longer valid. It has to be replaced server-side — nothing can be fixed from this screen.",
  },
  GA4_PERMISSION_DENIED: {
    title: "No access to the Analytics property",
    detail:
      "The service account is not a Viewer on the property. Add it under Admin → Property access management in Google Analytics.",
  },
  GA4_PROPERTY_NOT_FOUND: {
    title: "Analytics property not found",
    detail:
      "The configured property does not exist. Check the numeric property id on the server — a G-XXXXXXXXXX measurement id will not work here.",
  },
  GA4_API_UNAVAILABLE: {
    title: "Google Analytics is unavailable",
    detail:
      "Google did not answer, or the property's reporting quota is exhausted. This usually clears on its own.",
  },
  GA4_INVALID_PERIOD: {
    title: "Unsupported period",
    detail: "This reporting period is not available from Google Analytics.",
  },
  OPS_INVALID_PERIOD: {
    title: "Unsupported period",
    detail: "This reporting period is not available.",
  },
  OPS_UNAVAILABLE: {
    title: "Order analytics unavailable",
    detail:
      "The order aggregation could not be computed. Google Analytics panels on this page are unaffected.",
  },
  UNAUTHORIZED: {
    title: "Session expired",
    detail: "Sign in again to load analytics.",
  },
  UNKNOWN: {
    title: "Could not load this panel",
    detail: "The request failed unexpectedly.",
  },
};

export function errorGuidance(error: unknown): {
  title: string;
  detail: string;
  code: AnalyticsErrorCode;
  retryable: boolean;
} {
  if (isAnalyticsError(error)) {
    return {
      ...GUIDANCE[error.code],
      code: error.code,
      retryable: error.retryable,
    };
  }

  return { ...GUIDANCE.UNKNOWN, code: "UNKNOWN", retryable: true };
}
