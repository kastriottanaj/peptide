import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendGa4Error } from "../../../../../lib/ga4/http";
import { getGa4Service } from "../../../../../lib/ga4/service";

/**
 * `GET /admin/analytics/ga4/realtime`
 *
 * Who is on the site right now: active users, page views, event counts, and
 * breakdowns by country, device, page and event name.
 *
 * **This is an activity signal, not live revenue.** GA4 Realtime reports what
 * the browser sent in the last half hour, from visitors who accepted statistics
 * consent, before Google's processing has finished. Medusa's orders are the
 * source of truth for anything to do with money — do not label a number from
 * this endpoint as sales.
 *
 * Protected by living under `/admin`; see the health route for why that is the
 * whole of the auth story.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const result = await getGa4Service(logger).getRealtime();
    res.json(result);
  } catch (error) {
    sendGa4Error(res, error, logger);
  }
}
