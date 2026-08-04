/**
 * The single place an inbox failure becomes an HTTP response.
 *
 * Mirrors `lib/ga4/http.ts` and `lib/ops/http.ts` deliberately: three error
 * funnels that look different are three chances for one of them to grow a
 * `cause` field. Anything that is not already an `InboxError` is classified
 * first, so an unexpected throw from MikroORM or ImapFlow cannot escape as a
 * stack trace containing a connection string.
 */

import type { MedusaResponse } from "@medusajs/framework/http";
import { classifyInboxError } from "./errors";

export type InboxLogger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export function sendInboxError(
  res: MedusaResponse,
  error: unknown,
  logger?: InboxLogger,
): void {
  const inboxError = classifyInboxError(error);

  // Logged here rather than in the caller, because this is the last point at
  // which the original still exists. Server logs are the right place for it;
  // the response is not.
  if (inboxError.code === "INBOX_UNAVAILABLE") {
    logger?.error(`[inbox] request failed: ${String(error)}`);
  }

  res.status(inboxError.status).json(inboxError.toResponse());
}
