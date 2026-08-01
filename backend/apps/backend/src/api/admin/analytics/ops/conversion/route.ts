import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendOpsError } from "../../../../../lib/ops/http";
import { OpsError } from "../../../../../lib/ops/errors";
import { OPS_PERIODS, isOpsPeriod } from "../../../../../lib/ops/period";
import { getOpsAnalyticsService } from "../../../../../lib/ops/service";

/**
 * `GET /admin/analytics/ops/conversion?period=7d|30d|90d`
 *
 * Payment completion, the order funnel and tracking coverage.
 *
 * **Two of the five funnel steps report `null` on purpose.** "Added to cart"
 * and "Checkout started" have no truthful source in this codebase: the
 * storefront sends no `add_to_cart` or `begin_checkout` event, and its cart,
 * checkout and confirmation pages are excluded from measurement altogether so
 * that order identifiers never reach Google. Rather than substitute a cart-row
 * count — which is created by page load, not by intent, and would overstate the
 * step — the response says the step is unavailable and why. See
 * `buildFunnel` in `src/lib/ops/service.ts`.
 *
 * `tracking.attributionAvailable` is the same idea for source attribution: the
 * storefront persists no UTM parameters, referrer or landing page on the cart
 * or the order, so there is no key on which GA4 channels could be joined to
 * Medusa orders. It reports `false` and the UI shows a documented gap instead
 * of a fabricated conversion rate.
 *
 * Protected by living under `/admin`; see the overview route.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

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
    res.json(await getOpsAnalyticsService().getConversion(req.scope, raw));
  } catch (error) {
    sendOpsError(res, error, logger);
  }
}
