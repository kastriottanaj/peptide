import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

import { INBOX_MODULE } from "../../../../modules/inbox";
import type InboxModuleService from "../../../../modules/inbox/service";
import { InboxError } from "../../../../lib/inbox/errors";
import { sendInboxError } from "../../../../lib/inbox/http";
import { isInboxThreadStatus } from "../../../../lib/inbox/types";

/**
 * `GET /admin/inbox/threads?q=&status=&unread_only=&limit=&offset=`
 *
 * One page of conversations, newest activity first.
 *
 * Authentication is structural. Medusa's `ApiLoader` applies
 * `authenticate("user", ["bearer","session","api-key"])` to everything under
 * `/admin` with no `allowUnauthenticated`, so living in this directory *is* the
 * protection — the same argument as
 * `src/api/admin/analytics/ga4/health/route.ts`, and the same reason not to add
 * a second check that would later be "simplified" away along with the real one.
 *
 * There is no `/store` counterpart and there must never be one. This is
 * somebody's correspondence.
 *
 * The response carries no body text: a list of fifty threads does not need
 * fifty message bodies in the browser, and the detail endpoint is one click
 * away.
 */

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Query parsing that rejects rather than coerces. */
function parseListQuery(query: Record<string, unknown>) {
  const limit = parseBoundedInt(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT, "limit");
  const offset = parseBoundedInt(query.offset, 0, 0, 100_000, "offset");

  const statusRaw = typeof query.status === "string" ? query.status.trim() : "";
  if (statusRaw && statusRaw !== "all" && !isInboxThreadStatus(statusRaw)) {
    throw new InboxError(
      "INBOX_INVALID_REQUEST",
      false,
      "status must be one of: open, resolved, spam, all.",
    );
  }

  const q = typeof query.q === "string" ? query.q.trim().slice(0, 200) : "";

  return {
    q,
    status: statusRaw && statusRaw !== "all" ? statusRaw : undefined,
    // Only the exact string `true` filters; a stray `?unread_only=0` must not
    // silently hide three quarters of the inbox.
    unreadOnly: String(query.unread_only ?? "").toLowerCase() === "true",
    limit,
    offset,
  };
}

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === "" || raw === null) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new InboxError(
      "INBOX_INVALID_REQUEST",
      false,
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }

  return parsed;
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);

  try {
    const options = parseListQuery(req.query as Record<string, unknown>);
    const service = req.scope.resolve(INBOX_MODULE) as InboxModuleService;

    const { threads, count } = await service.listThreadsPage({
      q: options.q,
      status: options.status as never,
      unreadOnly: options.unreadOnly,
      limit: options.limit,
      offset: options.offset,
    });

    res.json({
      threads: threads.map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        last_message_at: toIso(thread.last_message_at),
        message_count: thread.message_count,
        unread_count: thread.unread_count,
        from_name: thread.last_sender_name,
        from_email: thread.last_sender_email,
      })),
      count,
      limit: options.limit,
      offset: options.offset,
    });
  } catch (error) {
    sendInboxError(res, error, logger);
  }
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
