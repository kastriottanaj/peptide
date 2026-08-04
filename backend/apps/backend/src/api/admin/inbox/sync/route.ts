import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { sendInboxError } from "../../../../lib/inbox/http";
import { runInboxSync } from "../../../../lib/inbox/service";

/**
 * `POST /admin/inbox/sync` — run the importer now.
 *
 * For the one question the scheduled job cannot answer: "is it working?".
 * Pressing it is safe by construction — it takes the same lock as the scheduled
 * run, so it can never produce a second concurrent importer, and it refuses to
 * run more than once every thirty seconds because a lock stops concurrency, not
 * a button being clicked twenty times.
 *
 * **The response is counts, not diagnostics.** No host, no mailbox, no user, no
 * IMAP error text — an admin session is not a reason to hand out the mail
 * server's answers, and this endpoint exists precisely to be called when
 * something is wrong. `status` is the whole of the story the browser gets:
 *
 *  - `ok` — it ran; the counts say what it did.
 *  - `disabled` — `INBOX_ENABLED` is not on. Nothing was contacted.
 *  - `misconfigured` — switched on, settings incomplete. Server-side fix.
 *  - `locked` — another sync holds the lock.
 *  - `throttled` — too soon after the last one.
 *  - `unreachable` — the mailbox did not answer. The runbook has the rest.
 *
 * All six are 200 responses: none of them is an error in *this* request, and
 * the admin renders the status rather than an exception. Authentication is
 * structural; see `../threads/route.ts`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const result = await runInboxSync(req.scope, { trigger: "manual" });

    res.json({
      status: result.status,
      imported: result.imported,
      duplicates: result.duplicates,
      oversized: result.oversized,
      failed: result.failed,
      duration_ms: result.durationMs,
      started_at: result.startedAt,
    });
  } catch (error) {
    sendInboxError(res, error, logger);
  }
}
