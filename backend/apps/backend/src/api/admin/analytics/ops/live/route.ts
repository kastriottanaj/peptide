import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendOpsError } from "../../../../../lib/ops/http";
import { getOpsAnalyticsService } from "../../../../../lib/ops/service";

/**
 * `GET /admin/analytics/ops/live`
 *
 * Today's orders and takings, in the store's reporting timezone.
 *
 * This is the panel that sits next to GA4 realtime on the Live tab, and the
 * division of labour between them is the whole reason both exist: GA4 answers
 * "who is on the site right now", Medusa answers "what has actually been
 * ordered and paid today". A GA4 realtime figure must never be labelled as
 * sales — see `src/lib/ga4/service.ts`.
 *
 * Takes no period. "Today" is the only window a live panel has, and accepting
 * one would just be a second, differently-cached copy of the overview route.
 *
 * Protected by living under `/admin`; see the overview route.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    res.json(await getOpsAnalyticsService().getLive(req.scope));
  } catch (error) {
    sendOpsError(res, error, logger);
  }
}
