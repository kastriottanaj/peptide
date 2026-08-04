/**
 * Sending one reply.
 *
 * The shape of this file is dictated by what must be true afterwards, in every
 * failure mode:
 *
 *  - **Nothing is sent twice.** One idempotency key is one email. A repeated
 *    click returns the message that already exists; a retry of a *failed* send
 *    reuses the same row rather than creating a second.
 *  - **A failure is never displayed as a success.** The row is written as
 *    `pending` before the send and moved to `sent` or `failed` after it, so a
 *    process killed mid-send leaves a visible pending record rather than a
 *    silent gap or a false confirmation.
 *  - **The admin controls the body and nothing else.** Recipient, sender,
 *    subject and threading headers are all derived from the stored thread. The
 *    endpoint takes no address, and there is no code path that could accept
 *    one.
 *  - **Nothing sensitive is logged.** A status, a thread id, a failure label.
 *    No body, no address, no password.
 *
 * Everything the run touches arrives as an argument, which is what lets the
 * tests drive a rejected password, a dropped connection, a double click and a
 * retry without an SMTP server in sight.
 */

import {
  REPLY_RATE_LIMITS,
  smtpEnabled,
  resolveSmtpConfig,
  type SmtpConfig,
} from "./config";
import {
  InboxError,
  classifySendFailure,
  type SendFailureReason,
} from "./errors";
import type { InboxLogger } from "./http";
import { sanitizeEmail, sanitizeHeader, sanitizeReplyBody } from "./sanitize";
import { INBOX_LIMITS } from "./config";
import type { MailSender, MailSenderFactory } from "./smtp";
import { buildReferences, generateMessageId, replySubject } from "./threading";
import type { OutboundRecord, ReplyParent, ReplyStore } from "./types";

/**
 * The sentinel IMAP coordinates of an outbound message.
 *
 * Outbound replies live in the same table as imported mail so a conversation
 * reads in one query, but they are not in the mailbox: **this release adds no
 * IMAP write access and no Sent-folder copy** (see `docs/inbox.md`). The
 * sentinel mailbox keeps the `(mailbox, uid)` unique index honest without
 * inventing a UID, and the negative, descending uid keeps the pair unique.
 */
export const OUTBOUND_MAILBOX = "OUTBOUND";

export type ReplyRequest = {
  threadId: string;
  body: unknown;
  idempotencyKey: unknown;
};

export type ReplyDeps = {
  store: ReplyStore;
  createSender: MailSenderFactory;
  logger: InboxLogger;
  now?: () => Date;
  /** Test seam for the random half of a generated Message-ID. */
  randomPart?: () => string;
};

export type ReplyResult = {
  message: OutboundRecord;
  /** True when an existing send was returned instead of a new one being made. */
  duplicate: boolean;
};

/**
 * Idempotency keys are client-generated and opaque to us, so the only thing
 * worth enforcing is that one is a bounded, boring string: it becomes a lock
 * name and a unique index value.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function validateIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new InboxError(
      "INBOX_INVALID_REQUEST",
      false,
      "idempotency_key must be 8-128 characters of A-Z, a-z, 0-9, hyphen or underscore.",
    );
  }
  return value;
}

/** The address a reply goes to: `Reply-To` if the sender set one, else `From`. */
export function resolveRecipient(parent: ReplyParent): string | null {
  return sanitizeEmail(parent.reply_to) ?? sanitizeEmail(parent.from_email);
}

/**
 * Is sending available at all?
 *
 * Checked before anything else, and before any store call: with
 * `INBOX_SMTP_ENABLED` unset nothing here opens a socket, writes a row, or
 * loads a mail library.
 */
export function requireSendingEnabled(): SmtpConfig {
  if (!smtpEnabled()) throw new InboxError("INBOX_SMTP_DISABLED");

  const resolved = resolveSmtpConfig();
  if (!resolved.ok) throw new InboxError("INBOX_SMTP_NOT_CONFIGURED");

  return resolved.config;
}

export async function sendReply(
  request: ReplyRequest,
  deps: ReplyDeps,
): Promise<ReplyResult> {
  const now = deps.now ?? (() => new Date());
  const { store, logger } = deps;

  const config = requireSendingEnabled();
  const idempotencyKey = validateIdempotencyKey(request.idempotencyKey);

  const body = sanitizeReplyBody(request.body, config.maxReplyChars);
  if (!body) {
    throw new InboxError(
      "INBOX_INVALID_REQUEST",
      false,
      "body must be a non-empty plain-text message.",
    );
  }
  if (body.tooLong) {
    throw new InboxError(
      "INBOX_INVALID_REQUEST",
      false,
      `body must be at most ${config.maxReplyChars} characters.`,
    );
  }

  /* ------------------------------------------------------- idempotency -- */

  const existing = await store.findOutboundByIdempotencyKey(idempotencyKey);

  if (existing?.delivery_status === "sent") {
    // The email is already out. Saying so is the whole point of the key.
    return { message: existing, duplicate: true };
  }
  if (existing?.delivery_status === "pending") {
    // Someone else is mid-send with this key — including, most likely, this
    // admin's own double click.
    throw new InboxError("INBOX_REPLY_IN_PROGRESS");
  }

  /* ------------------------------------------------------------ thread -- */

  if (!(await store.threadExists(request.threadId))) {
    throw new InboxError("INBOX_NOT_FOUND");
  }

  const parent = await store.latestInboundMessage(request.threadId);
  if (!parent) throw new InboxError("INBOX_NO_RECIPIENT");

  const recipient = resolveRecipient(parent);
  if (!recipient) throw new InboxError("INBOX_NO_RECIPIENT");

  /* ------------------------------------------------------- rate limits -- */
  // Skipped for a retry: the first attempt already paid for this slot, and
  // rate-limiting the fix for a failure is a way to strand a customer.

  if (!existing) {
    await enforceRateLimits(store, request.threadId, now());
  }

  /* ------------------------------------------------------------ headers -- */

  // Re-sanitised at the point of use even though the subject was sanitised on
  // import: this is the value that becomes a header, and defence in depth here
  // costs one function call.
  const subject = sanitizeHeader(
    replySubject(parent.subject),
    INBOX_LIMITS.subject,
  );
  const references = buildReferences(parent.references, parent.message_id);
  const messageId =
    existing?.message_id ??
    generateMessageId(config.from, now(), deps.randomPart?.());

  /* ------------------------------------------------------- persist first -- */

  const pending = existing
    ? await store.markOutboundPending(existing.id)
    : await store.createOutbound({
        thread_id: request.threadId,
        message_id: messageId,
        in_reply_to: parent.message_id,
        references,
        from_email: config.from,
        to_email: recipient,
        subject,
        body_text: body.text,
        idempotency_key: idempotencyKey,
        created_at: now(),
      });

  /* --------------------------------------------------------------- send -- */

  let sender: MailSender | null = null;

  try {
    sender = await deps.createSender(config);
    await sender.send({
      to: recipient,
      subject,
      text: body.text,
      // The wire format wants the brackets; the database stores it without
      // them, like every other id in this feature.
      messageId: `<${messageId}>`,
      inReplyTo: parent.message_id ? `<${parent.message_id}>` : undefined,
      references: references.map((id) => `<${id}>`),
    });
  } catch (error) {
    const reason: SendFailureReason = classifySendFailure(error);
    await store.markOutboundFailed(pending.id, reason);

    // The label, never the error: an SMTP rejection names the host and the
    // account, and often quotes the message.
    logger.warn(`[inbox] reply send failed (${reason}) thread=${request.threadId}`);

    throw new InboxError("INBOX_SEND_FAILED", reason === "temporary");
  } finally {
    await sender?.close();
  }

  const sent = await store.markOutboundSent(pending.id, now());
  logger.info(`[inbox] reply sent thread=${request.threadId}`);

  return { message: sent, duplicate: false };
}

async function enforceRateLimits(
  store: ReplyStore,
  threadId: string,
  now: Date,
): Promise<void> {
  const last = await store.lastOutboundAt(threadId);
  if (
    last &&
    now.getTime() - new Date(last).getTime() < REPLY_RATE_LIMITS.perThreadIntervalMs
  ) {
    throw new InboxError("INBOX_RATE_LIMITED", true);
  }

  const since = new Date(now.getTime() - REPLY_RATE_LIMITS.globalWindowMs);
  if ((await store.countOutboundSince(since)) >= REPLY_RATE_LIMITS.globalMax) {
    throw new InboxError("INBOX_RATE_LIMITED", true);
  }
}
