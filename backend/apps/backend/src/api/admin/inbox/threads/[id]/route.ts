import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { INBOX_MODULE } from "../../../../../modules/inbox";
import type InboxModuleService from "../../../../../modules/inbox/service";
import { InboxError } from "../../../../../lib/inbox/errors";
import { sendInboxError } from "../../../../../lib/inbox/http";
import { isInboxThreadStatus } from "../../../../../lib/inbox/types";
import { toIso } from "../route";

/**
 * `GET /admin/inbox/threads/:id` — a conversation and its messages.
 * `PATCH /admin/inbox/threads/:id` — `{ status?, read? }`.
 *
 * Messages come back **oldest first**, which is the order a person reads a
 * conversation in, and each one carries `body_text` and nothing else that could
 * be rendered. There is no `body_html` field to omit, because none was ever
 * stored: see `lib/inbox/sanitize.ts`.
 *
 * `attachments` is metadata — filename, type, size. No URL, no id, nothing to
 * fetch. The admin renders it as a list of names precisely because there is
 * nothing to download.
 *
 * Authentication is structural; see the comment in `../route.ts`.
 */

/** A message as the admin sees it. The allowlist *is* the security boundary. */
function toMessagePayload(message: {
  id: string;
  from_name: string | null;
  from_email: string | null;
  recipients: unknown;
  subject: string;
  received_at: Date;
  body_text: string;
  body_truncated: boolean;
  is_read: boolean;
  attachments: unknown;
  size_bytes: number;
}) {
  return {
    id: message.id,
    from_name: message.from_name,
    from_email: message.from_email,
    recipients: Array.isArray(message.recipients) ? message.recipients : [],
    subject: message.subject,
    received_at: toIso(message.received_at),
    body_text: message.body_text ?? "",
    body_truncated: Boolean(message.body_truncated),
    is_read: Boolean(message.is_read),
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    size_bytes: message.size_bytes ?? 0,
  };
}

function toThreadPayload(thread: {
  id: string;
  subject: string;
  status: string;
  last_message_at: Date;
  message_count: number;
  unread_count: number;
  last_sender_name: string | null;
  last_sender_email: string | null;
  created_at?: Date;
}) {
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status,
    last_message_at: toIso(thread.last_message_at),
    message_count: thread.message_count ?? 0,
    unread_count: thread.unread_count ?? 0,
    from_name: thread.last_sender_name,
    from_email: thread.last_sender_email,
    created_at: toIso(thread.created_at),
  };
}

/** A missing thread is a 404, not a 500 — deleting one is a normal thing. */
function notFound(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  return /not found|was not found|does not exist/i.test(message);
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");

  try {
    const service = req.scope.resolve(INBOX_MODULE) as InboxModuleService;
    const { thread, messages } = await service.getThreadDetail(id);

    res.json({
      thread: toThreadPayload(thread as never),
      messages: (messages as never[]).map((message) =>
        toMessagePayload(message as never),
      ),
    });
  } catch (error) {
    if (notFound(error)) {
      return sendInboxError(res, new InboxError("INBOX_NOT_FOUND"), logger);
    }
    sendInboxError(res, error, logger);
  }
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as { status?: unknown; read?: unknown };

  try {
    if (body.status === undefined && body.read === undefined) {
      throw new InboxError(
        "INBOX_INVALID_REQUEST",
        false,
        "Provide status and/or read.",
      );
    }

    if (body.status !== undefined && !isInboxThreadStatus(body.status)) {
      throw new InboxError(
        "INBOX_INVALID_REQUEST",
        false,
        "status must be one of: open, resolved, spam.",
      );
    }

    if (body.read !== undefined && typeof body.read !== "boolean") {
      throw new InboxError(
        "INBOX_INVALID_REQUEST",
        false,
        "read must be a boolean.",
      );
    }

    const service = req.scope.resolve(INBOX_MODULE) as InboxModuleService;

    // Read state first, then status: marking a thread resolved *and* read in
    // one call must not have the read update reopen it.
    if (body.read !== undefined) {
      await service.setThreadRead(id, body.read);
    }
    if (body.status !== undefined) {
      await service.setThreadStatus(id, body.status);
    }

    const thread = await service.retrieveInboxThread(id);
    res.json({ thread: toThreadPayload(thread as never) });
  } catch (error) {
    if (notFound(error)) {
      return sendInboxError(res, new InboxError("INBOX_NOT_FOUND"), logger);
    }
    sendInboxError(res, error, logger);
  }
}
