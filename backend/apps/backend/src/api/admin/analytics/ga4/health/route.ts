import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendGa4Error } from "../../../../../lib/ga4/http";
import { getGa4Service } from "../../../../../lib/ga4/service";

/**
 * `GET /admin/analytics/ga4/health`
 *
 * Does the configured service account actually reach the configured property?
 * Answered by issuing a real one-metric report, not by inspecting configuration
 * — a revoked key and an ungranted property both look perfectly configured from
 * this side, and both fail only when Google is asked.
 *
 * Authentication is not wired up here and must not be: Medusa's `ApiLoader`
 * applies `authenticate("user", ["bearer","session","api-key"])` to everything
 * under `/admin` with no `allowUnauthenticated`, so placement in this directory
 * *is* the protection. Adding a second check would be the kind of redundancy
 * that later gets "simplified" away along with the real one.
 *
 * The response is deliberately thin. No property id, service-account email,
 * project id, credential path, token or Google error — an admin session is not
 * a reason to hand out the shop's Google credentials, and this endpoint exists
 * precisely to be called when something is wrong.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const result = await getGa4Service(logger).checkHealth();
    res.json(result);
  } catch (error) {
    sendGa4Error(res, error, logger);
  }
}
