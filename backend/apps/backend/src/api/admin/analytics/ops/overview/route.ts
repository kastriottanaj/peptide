import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendOpsError } from "../../../../../lib/ops/http";
import { OpsError } from "../../../../../lib/ops/errors";
import { OPS_PERIODS, isOpsPeriod } from "../../../../../lib/ops/period";
import { getOpsAnalyticsService } from "../../../../../lib/ops/service";

/**
 * `GET /admin/analytics/ops/overview?period=7d|30d|90d`
 *
 * The commerce half of the analytics dashboard: KPIs with previous-period
 * comparisons, the daily sales trend, the sales breakdown, bestsellers, top
 * customers, and the recent-orders list.
 *
 * **Every figure here comes from Medusa's own order records.** Nothing in this
 * response has been anywhere near Google Analytics, which is why a GA4 outage
 * leaves the money numbers on screen.
 *
 * Aggregation happens on the server rather than in the browser on purpose: the
 * alternative is the admin downloading every order, customer and line item for
 * ninety days to add them up, which is slow, and which puts far more customer
 * data in a browser than the page renders.
 *
 * Authentication is structural. Medusa's `ApiLoader` applies
 * `authenticate("user", ["bearer","session","api-key"])` to everything under
 * `/admin` with no `allowUnauthenticated`, so living in this directory *is* the
 * protection — see `src/api/admin/analytics/ga4/health/route.ts` for the longer
 * version of that argument.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  // Absent means the default window rather than an error, matching the GA4
  // summary route so the two can be called with the same query string.
  const raw = req.query.period ?? "7d";

  if (!isOpsPeriod(raw)) {
    return sendOpsError(
      res,
      new OpsError(
        "OPS_INVALID_PERIOD",
        `period must be one of: ${OPS_PERIODS.join(", ")}.`,
      ),
      logger,
    );
  }

  try {
    res.json(await getOpsAnalyticsService().getOverview(req.scope, raw));
  } catch (error) {
    sendOpsError(res, error, logger);
  }
}
