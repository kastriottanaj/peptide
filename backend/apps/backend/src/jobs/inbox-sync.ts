/**
 * The five-minute mailbox poll.
 *
 * Everything interesting happens in `lib/inbox/service.ts`; this file exists to
 * be the thing Medusa's scheduler calls, and to guarantee two properties of it:
 *
 *  - **It never throws.** An unhandled rejection in a scheduled job is noise in
 *    the logs at best and a crashed worker at worst, and a mailbox that is
 *    temporarily unreachable is an entirely expected state of the world.
 *  - **It costs nothing when the inbox is off.** `runInboxSync` checks
 *    `INBOX_ENABLED` before it resolves anything, so a backend with no inbox
 *    configuration runs this every five minutes and does exactly nothing —
 *    no connection, no query, no log line.
 *
 * The schedule is derived from `INBOX_POLL_INTERVAL_SECONDS` at import time,
 * because Medusa reads `config.schedule` once when it registers the job. A
 * change to the interval therefore needs a restart, which is true of every
 * other environment variable this application reads.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";

import { inboxCronExpression } from "../lib/inbox/config";
import { runInboxSync } from "../lib/inbox/service";

export default async function inboxSyncJob(container: MedusaContainer) {
  try {
    await runInboxSync(container, { trigger: "scheduled" });
  } catch (error) {
    // `runInboxSync` already turns every expected failure into a status. This
    // is the belt to that braces: whatever reaches here is unexpected, and it
    // still must not take the scheduler down. The error's *name* only — a
    // message could carry a fragment of someone's mail.
    const kind = error instanceof Error ? error.name : "unknown";

    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as {
        warn(message: string): void;
      };
      logger.warn(`[inbox] scheduled sync aborted (${kind})`);
    } catch {
      // Not even the logger resolved. There is nothing useful left to do, and
      // throwing from here would be worse than silence.
    }
  }
}

export const config = {
  name: "inbox-imap-sync",
  schedule: inboxCronExpression(),
};
