/**
 * Safe error taxonomy for the GA4 Data API.
 *
 * Google's errors are useful and unsafe in the same breath: a bad
 * `GOOGLE_APPLICATION_CREDENTIALS` produces `ENOENT: ... open
 * '/Users/…/secrets/…json'`, and a permission failure names the service-account
 * email and the project. None of that may reach an HTTP response or a log line.
 *
 * So every Google failure is collapsed here into one of five codes with a
 * *fixed* message written by us. The original error is classified and then
 * dropped — it is never stored on the `Ga4Error`, because an error object that
 * carries a `cause` will eventually be spread into a log by someone who did not
 * read this comment.
 */

export const GA4_ERROR_CODES = [
  "GA4_NOT_CONFIGURED",
  "GA4_INVALID_CREDENTIALS",
  "GA4_PERMISSION_DENIED",
  "GA4_PROPERTY_NOT_FOUND",
  "GA4_API_UNAVAILABLE",
] as const;

export type Ga4ErrorCode = (typeof GA4_ERROR_CODES)[number];

/**
 * HTTP status per code.
 *
 * `GA4_INVALID_CREDENTIALS` is 503 rather than 401/500: the caller is an
 * authenticated admin who did nothing wrong, and the integration is genuinely
 * unavailable until someone fixes the key on the server. Answering 401 would
 * suggest their own admin session was rejected, which would send them to
 * precisely the wrong place.
 */
const STATUS_BY_CODE: Record<Ga4ErrorCode, number> = {
  GA4_NOT_CONFIGURED: 503,
  GA4_INVALID_CREDENTIALS: 503,
  GA4_PERMISSION_DENIED: 403,
  GA4_PROPERTY_NOT_FOUND: 404,
  GA4_API_UNAVAILABLE: 502,
};

/**
 * Client-facing messages. Fixed strings — never interpolated from a Google
 * error, and phrased so an admin knows which of them can act on it.
 */
const MESSAGE_BY_CODE: Record<Ga4ErrorCode, string> = {
  GA4_NOT_CONFIGURED:
    "Google Analytics reporting is not configured on this server.",
  GA4_INVALID_CREDENTIALS:
    "The Google Analytics service-account credentials were rejected.",
  GA4_PERMISSION_DENIED:
    "The service account does not have access to this Google Analytics property.",
  GA4_PROPERTY_NOT_FOUND:
    "The configured Google Analytics property does not exist.",
  GA4_API_UNAVAILABLE:
    "Google Analytics is temporarily unavailable. Please try again.",
};

export class Ga4Error extends Error {
  readonly code: Ga4ErrorCode;
  readonly status: number;
  /** Whether re-issuing the same call could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: Ga4ErrorCode, retryable = false) {
    super(MESSAGE_BY_CODE[code]);
    this.name = "Ga4Error";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.retryable = retryable;
  }

  /**
   * Exactly the shape sent to the client. Nothing else is ever serialized.
   *
   * `code` and `message` are repeated at the top level, which looks redundant
   * and is not. `@medusajs/js-sdk` — the client the admin dashboard uses —
   * turns a non-2xx response into a `FetchError` carrying only the body's
   * *top-level* `message`, discarding everything else. Without this the admin
   * would render "Service Unavailable" instead of the actionable sentence this
   * class exists to produce. The nested `error` object stays because it is the
   * documented shape and other callers read it.
   */
  toResponse(): {
    error: { code: Ga4ErrorCode; message: string };
    code: Ga4ErrorCode;
    message: string;
  } {
    return {
      error: { code: this.code, message: this.message },
      code: this.code,
      message: this.message,
    };
  }
}

export function isGa4Error(value: unknown): value is Ga4Error {
  return value instanceof Ga4Error;
}

/**
 * gRPC status codes, from `grpc/status.h`. The client surfaces these as a
 * numeric `code` on the rejection.
 */
const GRPC = {
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  ABORTED: 10,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  UNAUTHENTICATED: 16,
} as const;

function grpcStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Node-level failure codes seen when the key file itself is the problem: the
 * path does not exist, or the process cannot read it.
 */
function nodeSyscallCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Credential failures that arrive as plain `Error`s from google-auth-library
 * rather than as gRPC statuses — a malformed PEM, a revoked key, a file that is
 * not JSON.
 *
 * This is the one place that looks at a Google message. The result is a boolean;
 * the string itself goes no further, and in particular is never what gets
 * logged — `ENOENT` messages embed the credential path.
 */
function looksLikeCredentialFailure(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return (
    /invalid_grant|invalid_client|unauthorized_client/i.test(message) ||
    /PEM routines|DECODER routines|error:[0-9a-f]{8}:/i.test(message) ||
    /Unexpected token .* in JSON|is not valid JSON/i.test(message) ||
    /Unable to detect a Project Id|could not load the default credentials/i.test(
      message,
    )
  );
}

/**
 * Collapse any thrown value into a safe `Ga4Error`.
 *
 * Retry policy is decided here, once, so the retry loop never has to reason
 * about Google's error shapes:
 *
 *  - Retried: `UNAVAILABLE`, `DEADLINE_EXCEEDED`, `INTERNAL`, `ABORTED`,
 *    `UNKNOWN` and socket-level failures — transient by definition.
 *  - Never retried: `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`,
 *    `INVALID_ARGUMENT`. A rejected key is rejected just as hard the second
 *    time; retrying only multiplies failed auth attempts against Google.
 *  - `RESOURCE_EXHAUSTED` (quota) is reported as unavailable but **not**
 *    retried. Quota exhaustion is the one failure that retrying actively makes
 *    worse for every other caller of the property.
 */
export function classifyGa4Error(error: unknown): Ga4Error {
  if (isGa4Error(error)) return error;

  const syscall = nodeSyscallCode(error);
  if (syscall === "ENOENT" || syscall === "EACCES" || syscall === "EISDIR") {
    return new Ga4Error("GA4_INVALID_CREDENTIALS");
  }
  if (
    syscall === "ECONNRESET" ||
    syscall === "ETIMEDOUT" ||
    syscall === "ENOTFOUND" ||
    syscall === "EAI_AGAIN" ||
    syscall === "ECONNREFUSED"
  ) {
    return new Ga4Error("GA4_API_UNAVAILABLE", true);
  }

  switch (grpcStatus(error)) {
    case GRPC.UNAUTHENTICATED:
      return new Ga4Error("GA4_INVALID_CREDENTIALS");
    case GRPC.PERMISSION_DENIED:
      return new Ga4Error("GA4_PERMISSION_DENIED");
    case GRPC.NOT_FOUND:
      return new Ga4Error("GA4_PROPERTY_NOT_FOUND");
    case GRPC.INVALID_ARGUMENT:
      // A malformed property id reaches Google as INVALID_ARGUMENT. Config is
      // validated before we get here, so this means the property is not one
      // this service account can name — indistinguishable from missing.
      return new Ga4Error("GA4_PROPERTY_NOT_FOUND");
    case GRPC.RESOURCE_EXHAUSTED:
      return new Ga4Error("GA4_API_UNAVAILABLE", false);
    case GRPC.UNAVAILABLE:
    case GRPC.DEADLINE_EXCEEDED:
    case GRPC.INTERNAL:
    case GRPC.ABORTED:
    case GRPC.UNKNOWN:
    case GRPC.CANCELLED:
      return new Ga4Error("GA4_API_UNAVAILABLE", true);
    default:
      break;
  }

  if (looksLikeCredentialFailure(error)) {
    return new Ga4Error("GA4_INVALID_CREDENTIALS");
  }

  // Unrecognised. Treated as transient rather than as a credential problem:
  // guessing "bad key" at an admin who has a good key sends them to rotate a
  // credential for nothing.
  return new Ga4Error("GA4_API_UNAVAILABLE", true);
}

/** Map a config problem onto the one code that describes all of them. */
export function notConfigured(): Ga4Error {
  return new Ga4Error("GA4_NOT_CONFIGURED");
}
