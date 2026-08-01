/**
 * Safe error taxonomy for the Medusa-side analytics endpoints.
 *
 * Smaller than the GA4 one because the failure modes are: the caller asked for
 * a period that does not exist, or something inside Medusa threw. The second
 * case is collapsed to one code with a fixed message for the same reason GA4's
 * is — a workflow failure can carry an entity id, a SQL fragment or a
 * connection string in its message, and none of that belongs in a response.
 *
 * Unlike GA4, this is *not* a third-party integration, so there is no
 * credential to protect. What is being protected is the shop's internals.
 */

export const OPS_ERROR_CODES = [
  "OPS_INVALID_PERIOD",
  "OPS_UNAVAILABLE",
] as const;

export type OpsErrorCode = (typeof OPS_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<OpsErrorCode, number> = {
  OPS_INVALID_PERIOD: 400,
  OPS_UNAVAILABLE: 503,
};

const MESSAGE_BY_CODE: Record<OpsErrorCode, string> = {
  OPS_INVALID_PERIOD: "Unsupported reporting period.",
  OPS_UNAVAILABLE:
    "Order analytics are temporarily unavailable. Please try again.",
};

export class OpsError extends Error {
  readonly code: OpsErrorCode;
  readonly status: number;

  constructor(code: OpsErrorCode, message?: string) {
    super(message ?? MESSAGE_BY_CODE[code]);
    this.name = "OpsError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  /**
   * `code` and `message` are repeated at the top level for the same reason as
   * in `lib/ga4/errors.ts`: `@medusajs/js-sdk` keeps only the body's top-level
   * `message` when it turns a non-2xx response into a `FetchError`.
   */
  toResponse(): {
    error: { code: OpsErrorCode; message: string };
    code: OpsErrorCode;
    message: string;
  } {
    return {
      error: { code: this.code, message: this.message },
      code: this.code,
      message: this.message,
    };
  }
}

export function isOpsError(value: unknown): value is OpsError {
  return value instanceof OpsError;
}

/**
 * Collapse anything thrown into a safe `OpsError`.
 *
 * An `OPS_INVALID_PERIOD` raised by validation keeps its own message, which is
 * ours and names only the accepted values. Everything else becomes
 * `OPS_UNAVAILABLE` with a fixed string; the original is dropped rather than
 * attached, so it cannot be spread into a response by a later change.
 */
export function classifyOpsError(error: unknown): OpsError {
  if (isOpsError(error)) return error;
  return new OpsError("OPS_UNAVAILABLE");
}
