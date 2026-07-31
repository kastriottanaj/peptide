/**
 * The single place a GA4 failure becomes an HTTP response.
 *
 * Routes must not build error bodies themselves: the whole safety property here
 * is that nothing reaches a client except a fixed code and a fixed message, and
 * that is only true if there is exactly one funnel. Anything that is not already
 * a `Ga4Error` is classified first, so an unexpected throw cannot escape as a
 * stack trace or a raw Google message.
 */

import type { MedusaResponse } from "@medusajs/framework/http";
import { classifyGa4Error } from "./errors";
import type { Ga4Logger } from "./service";

export function sendGa4Error(
  res: MedusaResponse,
  error: unknown,
  logger?: Ga4Logger,
): void {
  const ga4Error = classifyGa4Error(error);

  // Code and status only — the service has already logged the failure with the
  // detail it is safe to keep.
  logger?.error(`[ga4] responding ${ga4Error.status} code=${ga4Error.code}`);

  res.status(ga4Error.status).json(ga4Error.toResponse());
}
