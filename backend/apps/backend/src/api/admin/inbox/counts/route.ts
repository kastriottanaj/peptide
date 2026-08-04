import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { INBOX_MODULE } from "../../../../modules/inbox";
import type InboxModuleService from "../../../../modules/inbox/service";
import { sendInboxError } from "../../../../lib/inbox/http";
import { inboxEnabled } from "../../../../lib/inbox/config";

/**
 * `GET /admin/inbox/counts`
 *
 * The numbers behind the sidebar badge and the filter chips. Deliberately the
 * cheapest endpoint in the feature: it is polled by an icon component that
 * renders on every admin page, so it does five `COUNT`s and one bounded sum,
 * and returns integers.
 *
 * `enabled` says whether the *importer* is switched on. It is a boolean and
 * nothing more — no host, no mailbox, no user, no error. The admin uses it to
 * explain an inbox that has stopped filling up; it is not a diagnostic channel
 * and must not become one.
 *
 * This endpoint answers normally when the importer is off, because the mail
 * already imported is still there to be read.
 *
 * Authentication is structural; see `../threads/route.ts`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const service = req.scope.resolve(INBOX_MODULE) as InboxModuleService;
    const counts = await service.getCounts();

    res.json({ ...counts, enabled: inboxEnabled() });
  } catch (error) {
    sendInboxError(res, error, logger);
  }
}
