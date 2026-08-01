/**
 * The single place an ops-analytics failure becomes an HTTP response.
 *
 * Mirrors `lib/ga4/http.ts` deliberately: two error funnels that look different
 * are two chances for one of them to grow a `cause` field. Anything not already
 * an `OpsError` is classified first, so an unexpected throw from a workflow
 * cannot escape as a stack trace.
 */

import type { MedusaResponse } from "@medusajs/framework/http";
import { classifyOpsError } from "./errors";

export type OpsLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export function sendOpsError(
  res: MedusaResponse,
  error: unknown,
  logger?: OpsLogger,
): void {
  const opsError = classifyOpsError(error);

  // The full error is logged here rather than in the caller, because this is
  // the last point at which it still exists. Server logs are the right place
  // for it; the response is not.
  if (opsError.code === "OPS_UNAVAILABLE") {
    logger?.error(`[ops-analytics] failed: ${String(error)}`);
  }

  res.status(opsError.status).json(opsError.toResponse());
}
