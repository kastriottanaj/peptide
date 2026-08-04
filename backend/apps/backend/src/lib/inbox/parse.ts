/**
 * Parsed MIME → a row this application is willing to store.
 *
 * `mailparser` does the hard part (encodings, nested multiparts, RFC 2047
 * headers); this file does the part that is our problem: deciding what of that
 * output is kept, and making sure every kept value has been through
 * `sanitize.ts` exactly once.
 *
 * The input type is declared structurally rather than imported from
 * `mailparser`, for two reasons: the tests can build one without pulling a MIME
 * parser into a unit test, and the shape this code actually depends on is
 * visible in one place instead of implied by a library's `ParsedMail`.
 */

import { INBOX_LIMITS } from "./config";
import {
  buildSearchText,
  sanitizeAttachments,
  sanitizeBody,
  sanitizeDisplayName,
  sanitizeEmail,
  sanitizeHeader,
  sanitizeMessageId,
  sanitizeRecipients,
} from "./sanitize";
import { normalizeSubject, parseReferences } from "./threading";
import type { NormalizedMessage } from "./types";

export type ParsedAddress = { name?: string | null; address?: string | null };

export type ParsedAddressList = {
  value?: readonly ParsedAddress[] | null;
} | readonly { value?: readonly ParsedAddress[] | null }[] | null;

/** The subset of `mailparser`'s `ParsedMail` this importer reads. */
export type ParsedMailLike = {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | string[] | null;
  subject?: string | null;
  date?: Date | string | null;
  from?: ParsedAddressList;
  replyTo?: ParsedAddressList;
  to?: ParsedAddressList;
  cc?: ParsedAddressList;
  text?: string | null;
  html?: string | false | null;
  attachments?: readonly {
    filename?: string | null;
    contentType?: string | null;
    size?: number | null;
  }[];
};

/** mailparser returns either one address object or an array of them. */
function addresses(list: ParsedAddressList): ParsedAddress[] {
  if (!list) return [];
  if (Array.isArray(list)) {
    return list.flatMap((entry) => [...(entry?.value ?? [])]);
  }
  return [...((list as { value?: readonly ParsedAddress[] | null }).value ?? [])];
}

/**
 * A received date that is actually usable.
 *
 * `Date` is a header, so it is whatever the sender felt like writing —
 * including 1970, including next year. The IMAP server's `INTERNALDATE` is
 * preferred when available because it is the one timestamp we observed rather
 * than were told, and an unparseable or absurd value falls back to now. This
 * matters more than it looks: `last_message_at` is the list's sort key, and one
 * message claiming the year 2049 would pin itself to the top of the inbox
 * forever.
 */
export function resolveReceivedAt(
  headerDate: Date | string | null | undefined,
  internalDate: Date | null | undefined,
  now: Date = new Date(),
): Date {
  const candidates = [internalDate, headerDate].map((value) =>
    value ? new Date(value) : null,
  );

  const maxFuture = now.getTime() + 24 * 60 * 60 * 1000;
  const minPast = Date.UTC(1990, 0, 1);

  for (const candidate of candidates) {
    if (!candidate || Number.isNaN(candidate.getTime())) continue;
    const time = candidate.getTime();
    if (time > maxFuture || time < minPast) continue;
    return candidate;
  }

  return now;
}

export type NormalizeInput = {
  mailbox: string;
  uid: number;
  parsed: ParsedMailLike;
  /** IMAP `INTERNALDATE`; preferred over the `Date` header. */
  internalDate?: Date | null;
  /** RFC822 size as reported by the server. */
  sizeBytes?: number | null;
  maxBodyChars: number;
  now?: Date;
};

export function normalizeParsedMessage(
  input: NormalizeInput,
): NormalizedMessage {
  const { parsed } = input;

  const from = addresses(parsed.from ?? null)[0] ?? {};
  const fromEmail = sanitizeEmail(from.address);
  const fromName = sanitizeDisplayName(from.name);

  // Only the first Reply-To is kept: this application replies to exactly one
  // address, so a header listing several has to resolve to one anyway, and the
  // first is the one mail clients use.
  const replyTo = sanitizeEmail(addresses(parsed.replyTo ?? null)[0]?.address);

  const recipients = sanitizeRecipients([
    { kind: "to", addresses: addresses(parsed.to ?? null) },
    { kind: "cc", addresses: addresses(parsed.cc ?? null) },
  ]);

  const subject = sanitizeHeader(parsed.subject, INBOX_LIMITS.subject);

  const references = parseReferences(
    Array.isArray(parsed.references)
      ? parsed.references.join(" ")
      : (parsed.references ?? ""),
  );

  const body = sanitizeBody(
    { text: parsed.text, html: parsed.html || null },
    input.maxBodyChars,
  );

  return {
    mailbox: input.mailbox,
    uid: input.uid,
    message_id: sanitizeMessageId(parsed.messageId),
    in_reply_to: sanitizeMessageId(parsed.inReplyTo),
    references,
    from_name: fromName,
    from_email: fromEmail,
    reply_to: replyTo,
    recipients,
    subject,
    normalized_subject: normalizeSubject(subject),
    received_at: resolveReceivedAt(
      parsed.date,
      input.internalDate ?? null,
      input.now,
    ),
    body_text: body.text,
    body_truncated: body.truncated,
    size_bytes:
      typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
        ? Math.max(0, Math.floor(input.sizeBytes))
        : 0,
    attachments: sanitizeAttachments(parsed.attachments ?? []),
  };
}

/**
 * A message recorded from its envelope alone.
 *
 * Used when the server reports a size above `INBOX_MAX_MESSAGE_BYTES`. Pulling
 * a 40 MB message through this process to extract two lines of text is not a
 * trade worth making, and silently skipping it would leave a hole in the inbox
 * that nobody could see. So the envelope is stored with a body that says what
 * happened, and the mail stays in Hostinger where it can be read in full.
 */
export function oversizedPlaceholderBody(sizeBytes: number): string {
  const megabytes = (sizeBytes / (1024 * 1024)).toFixed(1);
  return (
    `[This message is ${megabytes} MB, above the import size limit, so its ` +
    `content was not downloaded. Open it in the mailbox to read it.]`
  );
}

/** The search haystack for a thread, given its newest message. */
export function searchTextFor(
  message: NormalizedMessage,
  previous?: string,
): string {
  return buildSearchText({
    subject: message.subject,
    fromName: message.from_name,
    fromEmail: message.from_email,
    recipients: message.recipients,
    previous,
  });
}
