import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { sendInboxReply } from "../../../../../../lib/inbox/service";
import { sendInboxError } from "../../../../../../lib/inbox/http";
import { InboxError } from "../../../../../../lib/inbox/errors";

/**
 * `POST /admin/inbox/threads/:id/reply` — `{ body, idempotency_key }`.
 *
 * **The request body has exactly two fields, and neither of them is an
 * address.** Recipient, sender, subject and the threading headers are all
 * derived from the stored conversation; there is no `to`, `cc`, `bcc`, `from`,
 * `subject`, `html`, `attachments` or `template` parameter to supply, and
 * unknown fields are ignored rather than honoured. That is what makes this
 * endpoint unusable as a general mail sender if an admin session is ever
 * stolen: the worst it can do is send text to someone who already wrote to us.
 *
 * `idempotency_key` is required. One key is one email — a second request with
 * the same key returns the message that already exists instead of sending
 * another, and a retry of a *failed* send reuses its row. A client that omits
 * it is refused rather than served, because "the button did nothing, click it
 * again" is exactly how duplicates happen.
 *
 * Authentication is structural: Medusa's `ApiLoader` applies
 * `authenticate("user", …)` to everything under `/admin`, so living in this
 * directory *is* the protection — see `../../route.ts`.
 *
 * Errors are the fixed set from `lib/inbox/errors.ts`. No SMTP response, host,
 * account or exception text ever reaches the client.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const threadId = String(req.params.id ?? "");
  const body = (req.body ?? {}) as {
    body?: unknown;
    idempotency_key?: unknown;
  };

  try {
    if (typeof body.body !== "string") {
      throw new InboxError(
        "INBOX_INVALID_REQUEST",
        false,
        "body must be a plain-text string.",
      );
    }

    const result = await sendInboxReply(req.scope, {
      threadId,
      body: body.body,
      idempotencyKey: body.idempotency_key,
    });

    // 201 for a send that happened, 200 when an existing one was returned —
    // the client can tell a duplicate from a new message without parsing text.
    res.status(result.duplicate ? 200 : 201).json({
      message: {
        id: result.message.id,
        thread_id: result.message.thread_id,
        subject: result.message.subject,
        to_email: result.message.to_email,
        delivery_status: result.message.delivery_status,
        failure_reason: result.message.failure_reason,
        sent_at: result.message.sent_at
          ? new Date(result.message.sent_at).toISOString()
          : null,
      },
      duplicate: result.duplicate,
    });
  } catch (error) {
    sendInboxError(res, error, logger);
  }
}
