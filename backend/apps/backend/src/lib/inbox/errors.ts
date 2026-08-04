/**
 * Safe error taxonomy for the inbox.
 *
 * Same argument as `lib/ga4/errors.ts`, and for a sharper reason: an IMAP
 * failure names the host, the mailbox and often the account. `imap.example.com
 * says: [AUTHENTICATIONFAILED] Authentication failed for info@…` is a genuinely
 * useful sentence that must never reach an HTTP response.
 *
 * So every failure collapses into one of six codes with a *fixed* message
 * written here. The original is classified and then dropped — it is never
 * stored on the `InboxError`, because an error carrying a `cause` eventually
 * gets spread into a log by someone who did not read this comment.
 */

export const INBOX_ERROR_CODES = [
  "INBOX_DISABLED",
  "INBOX_NOT_CONFIGURED",
  "INBOX_UNAVAILABLE",
  "INBOX_BUSY",
  "INBOX_NOT_FOUND",
  "INBOX_INVALID_REQUEST",
  // Sending. Separate codes from the importer's, because the two fail for
  // unrelated reasons and an admin acting on one must not be sent to fix the
  // other.
  "INBOX_SMTP_DISABLED",
  "INBOX_SMTP_NOT_CONFIGURED",
  "INBOX_NO_RECIPIENT",
  "INBOX_SEND_FAILED",
  "INBOX_RATE_LIMITED",
  "INBOX_REPLY_IN_PROGRESS",
] as const;

export type InboxErrorCode = (typeof INBOX_ERROR_CODES)[number];

/**
 * HTTP status per code.
 *
 * `INBOX_DISABLED` is 200-adjacent in spirit but 503 in fact: the caller did
 * nothing wrong and the feature is genuinely not available. `INBOX_BUSY` is 429
 * rather than 409 so that a client with a retry policy backs off instead of
 * treating it as a conflict to resolve.
 */
const STATUS_BY_CODE: Record<InboxErrorCode, number> = {
  INBOX_DISABLED: 503,
  INBOX_NOT_CONFIGURED: 503,
  INBOX_UNAVAILABLE: 502,
  INBOX_BUSY: 429,
  INBOX_NOT_FOUND: 404,
  INBOX_INVALID_REQUEST: 400,
  INBOX_SMTP_DISABLED: 503,
  INBOX_SMTP_NOT_CONFIGURED: 503,
  // 422, not 400: the request is well-formed, the conversation simply has no
  // address that can be replied to.
  INBOX_NO_RECIPIENT: 422,
  INBOX_SEND_FAILED: 502,
  INBOX_RATE_LIMITED: 429,
  // 409: the same reply is already being sent. Retrying with the same key once
  // that finishes returns the existing message rather than sending a second.
  INBOX_REPLY_IN_PROGRESS: 409,
};

/**
 * Client-facing messages. Fixed strings, never interpolated from a server
 * error, and phrased so an admin knows whether they can act.
 */
const MESSAGE_BY_CODE: Record<InboxErrorCode, string> = {
  INBOX_DISABLED:
    "The email inbox is switched off on this server. Existing messages remain readable; no new mail is imported.",
  INBOX_NOT_CONFIGURED:
    "The email inbox is switched on but its mailbox settings are incomplete. This has to be fixed on the server.",
  INBOX_UNAVAILABLE:
    "The mailbox could not be reached. The last successfully imported messages are still shown.",
  INBOX_BUSY: "A mailbox sync is already running. Try again in a moment.",
  INBOX_NOT_FOUND: "This conversation no longer exists.",
  INBOX_INVALID_REQUEST: "The request could not be understood.",
  INBOX_SMTP_DISABLED:
    "Sending replies is switched off on this server. The conversation is unchanged.",
  INBOX_SMTP_NOT_CONFIGURED:
    "Sending replies is switched on but the mail settings are incomplete. This has to be fixed on the server.",
  INBOX_NO_RECIPIENT:
    "This conversation has no usable reply address, so no reply can be sent from here.",
  INBOX_SEND_FAILED:
    "The reply could not be sent. It is saved as failed and can be retried.",
  INBOX_RATE_LIMITED:
    "Too many replies in a short time. Wait a moment and try again.",
  INBOX_REPLY_IN_PROGRESS:
    "This reply is already being sent. Wait for it to finish rather than sending again.",
};

export class InboxError extends Error {
  readonly code: InboxErrorCode;
  readonly status: number;
  /** Whether re-issuing the same call could plausibly succeed. */
  readonly retryable: boolean;

  constructor(code: InboxErrorCode, retryable = false, message?: string) {
    // A caller-supplied message is allowed for INBOX_INVALID_REQUEST only —
    // "limit must be between 1 and 100" is worth saying, and is written here,
    // not derived from anything an email or a mail server sent.
    super(
      code === "INBOX_INVALID_REQUEST" && message
        ? message
        : MESSAGE_BY_CODE[code],
    );
    this.name = "InboxError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.retryable = retryable;
  }

  /**
   * Exactly the shape sent to the client, and nothing else is ever serialized.
   *
   * `code` and `message` are repeated at the top level for the same reason as
   * in the GA4 taxonomy: `@medusajs/js-sdk` keeps only the body's top-level
   * `message` when it turns a non-2xx into a `FetchError`.
   */
  toResponse(): {
    error: { code: InboxErrorCode; message: string };
    code: InboxErrorCode;
    message: string;
  } {
    return {
      error: { code: this.code, message: this.message },
      code: this.code,
      message: this.message,
    };
  }
}

export function isInboxError(value: unknown): value is InboxError {
  return value instanceof InboxError;
}

/** Node socket-level failures seen when the mail server is unreachable. */
const TRANSIENT_SYSCALLS = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

function syscallCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Whether a failure is worth retrying inside a single run.
 *
 * Authentication failures are not: a rejected password is rejected just as hard
 * two hundred milliseconds later, and retrying only walks the account towards
 * whatever lockout the provider enforces. This is the one place an IMAP error
 * string is looked at, the result is a boolean, and the string goes no further.
 */
export function isTransientImapFailure(error: unknown): boolean {
  const syscall = syscallCode(error);
  if (syscall) {
    if (TRANSIENT_SYSCALLS.has(syscall)) return true;
    // A TLS verification failure is a configuration or interception problem.
    // Retrying it is pointless and pretending it is transient hides it.
    if (syscall.startsWith("ERR_TLS") || syscall.startsWith("CERT_")) {
      return false;
    }
  }

  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed|AUTHORIZATIONFAILED/i.test(message)) {
    return false;
  }
  if (/certificate|self.signed|unable to verify/i.test(message)) return false;

  // Unrecognised failures are treated as transient. Guessing "bad password" at
  // an operator whose password is fine sends them to rotate a credential for
  // nothing; one extra retry costs a second.
  return true;
}

/** Collapse any thrown value into a safe `InboxError`. */
export function classifyInboxError(error: unknown): InboxError {
  if (isInboxError(error)) return error;
  return new InboxError("INBOX_UNAVAILABLE", isTransientImapFailure(error));
}

/**
 * Why a send failed, as a fixed label.
 *
 * This is what gets stored on the outbound row and shown to an admin, so it
 * must never be the mail server's own sentence: `535 5.7.8 Authentication
 * failed for info@peptideeinkaufen.de` is exactly the kind of useful,
 * unshippable text a bounce produces.
 *
 * The distinction that matters to the reader is whether retrying is worth it.
 * `auth`, `rejected` and `tls` are not; `temporary` and `unreachable` are.
 */
export type SendFailureReason =
  | "auth"
  | "tls"
  | "rejected"
  | "unreachable"
  | "temporary";

export function classifySendFailure(error: unknown): SendFailureReason {
  const syscall = syscallCode(error);
  if (syscall && TRANSIENT_SYSCALLS.has(syscall)) return "unreachable";
  if (syscall && (syscall.startsWith("ERR_TLS") || syscall.startsWith("CERT_"))) {
    return "tls";
  }

  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  // SMTP reply codes: 5xx is permanent, 4xx is worth another attempt.
  const status = (error as { responseCode?: unknown })?.responseCode;
  if (typeof status === "number") {
    if (status === 535 || status === 530 || status === 534) return "auth";
    if (status >= 500) return "rejected";
    if (status >= 400) return "temporary";
  }

  if (/auth|credentials|535|password/i.test(message)) return "auth";
  if (/certificate|self.signed|unable to verify/i.test(message)) return "tls";
  if (/mailbox unavailable|does not exist|no such user|rejected|blocked|spam/i.test(message)) {
    return "rejected";
  }

  // Unrecognised failures are treated as temporary: telling an admin their
  // password is wrong when it is not sends them to rotate a live credential.
  return "temporary";
}

/** Whether a stored failure is worth a retry button doing anything. */
export function isRetryableFailure(reason: string | null | undefined): boolean {
  return reason === "temporary" || reason === "unreachable";
}

/**
 * A one-word label for logs and for the `last_status` column.
 *
 * Deliberately coarse — `auth`, `tls`, `unreachable`, `error`. Enough to tell
 * an operator which page of the runbook to open, not enough to leak an account
 * name into a log file.
 */
export function imapFailureLabel(error: unknown): string {
  const syscall = syscallCode(error);
  if (syscall && TRANSIENT_SYSCALLS.has(syscall)) return "unreachable";
  if (syscall && (syscall.startsWith("ERR_TLS") || syscall.startsWith("CERT_"))) {
    return "tls";
  }

  const message =
    typeof error === "object" && error !== null
      ? String((error as { message?: unknown }).message ?? "")
      : "";

  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(message)) {
    return "auth";
  }
  if (/certificate|self.signed|unable to verify/i.test(message)) return "tls";
  if (/NONEXISTENT|Mailbox doesn't exist|does not exist/i.test(message)) {
    return "no-mailbox";
  }

  return "error";
}
