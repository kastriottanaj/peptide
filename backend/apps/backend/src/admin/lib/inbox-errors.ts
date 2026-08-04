/**
 * Inbox failures, as the UI understands them.
 *
 * Separate from `inbox-api.ts` for the same reason the analytics taxonomy is
 * separate from `sdk.ts`: this module must not import the Medusa client, which
 * reads `import.meta.env` and therefore only exists inside a bundler. The
 * panels, the empty states and the tests all import from here.
 *
 * The codes are recovered from the HTTP status, because `@medusajs/js-sdk`
 * discards the response body's `code` on a non-2xx and keeps only the top-level
 * `message`. The server maps one status per code, so the status is a faithful
 * proxy.
 */

export type InboxErrorCode =
  | "INBOX_UNAVAILABLE"
  | "INBOX_BUSY"
  | "INBOX_NOT_FOUND"
  | "INBOX_INVALID_REQUEST"
  | "INBOX_NOT_CONFIGURED"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export class InboxRequestError extends Error {
  readonly code: InboxErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: InboxErrorCode,
    message: string,
    status?: number,
    retryable = false,
  ) {
    super(message);
    this.name = "InboxRequestError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function isInboxRequestError(value: unknown): value is InboxRequestError {
  return value instanceof InboxRequestError;
}

export function codeForStatus(status: number | undefined): {
  code: InboxErrorCode;
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { code: "UNAUTHORIZED", retryable: false };
  }
  if (status === 400) return { code: "INBOX_INVALID_REQUEST", retryable: false };
  if (status === 404) return { code: "INBOX_NOT_FOUND", retryable: false };
  if (status === 429) return { code: "INBOX_BUSY", retryable: true };
  if (status === 502) return { code: "INBOX_UNAVAILABLE", retryable: true };
  if (status === 503) return { code: "INBOX_NOT_CONFIGURED", retryable: false };
  return { code: "UNKNOWN", retryable: true };
}

export function toInboxError(error: unknown): InboxRequestError {
  if (isInboxRequestError(error)) return error;

  const fetchError = error as { status?: number; message?: string };
  const { code, retryable } = codeForStatus(fetchError?.status);

  return new InboxRequestError(
    code,
    fetchError?.message || "The request failed.",
    fetchError?.status,
    retryable,
  );
}

/**
 * What to tell the person looking at the screen, and who can act on it.
 *
 * A merchant cannot fix a mailbox password, and telling them to "try again"
 * would waste their time. Every message names where the fix lives — and none of
 * them repeats anything the server said about the mail host, because the server
 * deliberately did not say it.
 */
const GUIDANCE: Record<InboxErrorCode, { title: string; detail: string }> = {
  INBOX_UNAVAILABLE: {
    title: "The mailbox could not be reached",
    detail:
      "New mail is not being imported right now. Messages already imported are still shown. This usually clears on its own; if it does not, the mailbox settings on the server need attention.",
  },
  INBOX_BUSY: {
    title: "A sync is already running",
    detail: "Give it a moment and try again.",
  },
  INBOX_NOT_FOUND: {
    title: "This conversation no longer exists",
    detail: "It may have been removed by the retention policy.",
  },
  INBOX_INVALID_REQUEST: {
    title: "That request could not be understood",
    detail: "Check the filters and try again.",
  },
  INBOX_NOT_CONFIGURED: {
    title: "The inbox importer is not configured",
    detail:
      "The mailbox settings on the server are incomplete, so no new mail is being imported. Nothing on this screen can fix it.",
  },
  UNAUTHORIZED: {
    title: "Session expired",
    detail: "Sign in again to read the inbox.",
  },
  UNKNOWN: {
    title: "Could not load the inbox",
    detail: "The request failed unexpectedly.",
  },
};

export function inboxErrorGuidance(error: unknown): {
  title: string;
  detail: string;
  code: InboxErrorCode;
  retryable: boolean;
} {
  if (isInboxRequestError(error)) {
    return {
      ...GUIDANCE[error.code],
      code: error.code,
      retryable: error.retryable,
    };
  }

  return { ...GUIDANCE.UNKNOWN, code: "UNKNOWN", retryable: true };
}

/** The one-line explanation under the "Sync now" button. */
export const SYNC_STATUS_MESSAGES: Record<string, string> = {
  ok: "Mailbox checked.",
  // No variable names, hosts or mailbox settings in browser copy: the admin
  // bundle is told whether the importer runs, and nothing else. The runbook
  // (docs/inbox.md) is where the switch is named.
  disabled:
    "The importer is switched off on this server. Existing messages are still readable.",
  misconfigured:
    "The importer is switched on but its mailbox settings are incomplete. This has to be fixed on the server.",
  locked: "A sync is already running.",
  throttled: "Just synced — try again in a moment.",
  unreachable:
    "The mailbox did not answer. Messages already imported are unaffected.",
};
