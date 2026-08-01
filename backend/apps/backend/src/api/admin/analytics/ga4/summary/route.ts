import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendGa4Error } from "../../../../../lib/ga4/http";
import {
  GA4_PERIODS,
  getGa4Service,
  isGa4Period,
} from "../../../../../lib/ga4/service";

/**
 * `GET /admin/analytics/ga4/summary?period=today|7d|30d|90d`
 *
 * Aggregated visitor, acquisition and ecommerce reporting for a fixed window,
 * plus a daily time series and traffic grouped by channel and source/medium.
 *
 * The period is a closed set, not a passthrough date range. Each period is a
 * cache key and a fixed set of Google calls; letting callers pass arbitrary
 * dates would make the cache useless and hand an authenticated caller a way to
 * spend the property's Data API quota at will.
 *
 * Ecommerce metrics here are GA4's processed, consent-limited view. They will
 * not tie out to Medusa's orders, which remain the source of truth for revenue.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  // Absent means the default window rather than an error — a bare
  // `/summary` is a reasonable thing for a dashboard to request.
  const raw = req.query.period ?? "7d";

  if (!isGa4Period(raw)) {
    const message = `period must be one of: ${GA4_PERIODS.join(", ")}.`;
    // `code`/`message` are repeated at the top level to match `Ga4Error`; see
    // the comment on `Ga4Error.toResponse`.
    return res.status(400).json({
      error: { code: "GA4_INVALID_PERIOD", message },
      code: "GA4_INVALID_PERIOD",
      message,
    });
  }

  try {
    const result = await getGa4Service(logger).getSummary(raw);
    res.json(result);
  } catch (error) {
    sendGa4Error(res, error, logger);
  }
}
