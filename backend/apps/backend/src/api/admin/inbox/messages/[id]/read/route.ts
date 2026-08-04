import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { INBOX_MODULE } from "../../../../../../modules/inbox";
import type InboxModuleService from "../../../../../../modules/inbox/service";
import { InboxError } from "../../../../../../lib/inbox/errors";
import { sendInboxError } from "../../../../../../lib/inbox/http";

/**
 * `PATCH /admin/inbox/messages/:id/read` — `{ read: boolean }`.
 *
 * Read state is **local to Medusa**. Nothing here is written back over IMAP:
 * the mailbox is opened read-only and this application has no method that could
 * set a flag on it.
 *
 * This is the same `info@` mailbox someone reads in webmail, so the direction
 * that matters is the one that does *not* happen: marking a message read here
 * leaves it unread there. Quietly clearing the unread state of a shared mailbox
 * from a dashboard is how mail stops being answered.
 *
 * `read` is required and must be a boolean. A toggle endpoint would be smaller
 * and would make a double-click a coin flip.
 *
 * Authentication is structural; see `../../../threads/route.ts`.
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as { read?: unknown };

  try {
    if (typeof body.read !== "boolean") {
      throw new InboxError(
        "INBOX_INVALID_REQUEST",
        false,
        "read must be a boolean.",
      );
    }

    const service = req.scope.resolve(INBOX_MODULE) as InboxModuleService;
    const message = await service.setMessageRead(id, body.read);

    res.json({
      message: { id: message.id, is_read: Boolean(message.is_read) },
    });
  } catch (error) {
    const text =
      typeof error === "object" && error !== null
        ? String((error as { message?: unknown }).message ?? "")
        : "";

    if (/not found|was not found|does not exist/i.test(text)) {
      return sendInboxError(res, new InboxError("INBOX_NOT_FOUND"), logger);
    }

    sendInboxError(res, error, logger);
  }
}
