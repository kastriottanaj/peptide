/**
 * Turning email into something safe to store.
 *
 * Every value that reaches the database passes through this file, because
 * every value in an email is attacker-controlled: anyone can send mail to
 * `info@`, choosing the display name, the subject, the headers and the body.
 *
 * Four things happen here and nowhere else:
 *
 *  1. **HTML never survives.** `text/plain` is preferred; an HTML-only message
 *     is reduced to text with script and style *contents* removed first. The
 *     HTML itself is not stored — not in a second column, not "for later". A
 *     column holding raw email HTML is a column someone eventually renders.
 *  2. **Invisible characters are stripped.** C0/C1 controls, and the bidi
 *     overrides that let a display name read as `service@bank.de` while
 *     actually being something else. These are spoofing tools, not content.
 *  3. **Everything is bounded.** Headers to fixed limits, the body to
 *     `INBOX_MAX_BODY_CHARS`, attachment lists to a maximum count. Truncation
 *     is marked, never silent.
 *  4. **Attachments are metadata only.** Filename, type, size. The bytes are
 *     never touched.
 *
 * None of this is a substitute for escaping at render time — React does that —
 * but a database that cannot hold a script tag is one fewer thing to get right
 * in the future.
 */

import { INBOX_LIMITS } from "./config";
import type { InboxAttachmentMeta, InboxRecipient } from "./types";

/** Appended to anything cut short, so truncation is visible rather than silent. */
export const TRUNCATION_MARKER = "\n\n[…] message truncated by the inbox importer";

/**
 * Code points removed from every stored string.
 *
 * Written as ranges and filtered by code point rather than as a regular
 * expression: a character class of unprintable escapes is unreviewable, and the
 * one thing worse than no filter is a filter with a typo in it that everyone
 * assumes works. Tab, newline and carriage return are deliberately absent —
 * they are content in a body and are flattened separately in a header.
 */
const STRIPPED_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08], // C0 controls before tab
  [0x0b, 0x0c], // vertical tab, form feed
  [0x0e, 0x1f], // C0 controls after carriage return
  [0x7f, 0x9f], // DEL and the C1 controls
  [0x200b, 0x200f], // zero-width space … right-to-left mark
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner and the invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // zero-width no-break space (BOM)
];

function isStripped(code: number): boolean {
  return STRIPPED_RANGES.some(([from, to]) => code >= from && code <= to);
}

/** Invisible characters out. Tab, newline and carriage return survive. */
export function stripControls(value: string): string {
  let out = "";
  for (const char of value) {
    if (!isStripped(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/**
 * A single-line header value: invisibles out, every whitespace run collapsed to
 * one space, length bounded. Used for subjects, display names, addresses and
 * message ids — none of which may span lines once stored.
 */
export function sanitizeHeader(value: unknown, max: number): string {
  if (typeof value !== "string" || !value) return "";

  let flattened = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isStripped(code)) continue;
    flattened += code === 0x09 || code === 0x0a || code === 0x0d ? " " : char;
  }

  const cleaned = flattened.replace(/\s+/g, " ").trim();

  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

/**
 * An email address, lowercased.
 *
 * Not validated against a full RFC 5322 grammar — a message that arrived is a
 * message that arrived, and rejecting an odd-but-real address would lose mail.
 * What is enforced is that the stored value is a single line, has no spaces,
 * contains exactly one `@`, and fits. Anything else becomes `null` and the
 * message is still imported: a sender we cannot name is better than a message
 * we drop.
 */
export function sanitizeEmail(value: unknown): string | null {
  const cleaned = sanitizeHeader(value, INBOX_LIMITS.email).toLowerCase();
  if (!cleaned) return null;
  if (/\s/.test(cleaned)) return null;

  const at = cleaned.indexOf("@");
  if (at <= 0 || at === cleaned.length - 1) return null;
  if (cleaned.indexOf("@", at + 1) !== -1) return null;

  return cleaned;
}

export function sanitizeDisplayName(value: unknown): string | null {
  return sanitizeHeader(value, INBOX_LIMITS.displayName) || null;
}

/** `<abc@def>` → `abc@def`. Message ids are stored without their brackets. */
export function sanitizeMessageId(value: unknown): string | null {
  const cleaned = sanitizeHeader(value, INBOX_LIMITS.messageId)
    .replace(/^</, "")
    .replace(/>$/, "")
    .trim();

  return cleaned || null;
}

/* ------------------------------------------------------------------ body -- */

/**
 * HTML reduced to text.
 *
 * The order matters and is the whole point:
 *
 *  1. Comments go first — a script tag hidden inside a comment must not become
 *     live markup once the surrounding comment is removed.
 *  2. Script, style, head, svg and iframe elements are removed *with their
 *     contents*. Stripping only the tags would leave CSS and JavaScript source
 *     sitting in the text as if the sender had written it.
 *  3. Block boundaries become newlines, so a table of order details does not
 *     collapse into one run-on line.
 *  4. Remaining tags are dropped and the handful of entities that matter are
 *     decoded. Numeric entities decode only in the printable BMP range, and the
 *     result goes through the invisible-character strip anyway.
 *
 * An `<img>` becomes nothing at all: no URL is kept, so no tracking pixel can
 * be fetched later by accident. Link *text* survives; the `href` does not,
 * because a stored href is one careless render away from being a live link.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(
      /<(script|style|head|svg|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi,
      " ",
    )
    // An unclosed script or style at the end of a malformed message: drop the
    // remainder rather than letting its source through as text.
    .replace(/<(script|style)\b[\s\S]*$/i, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|tr|li|h[1-6]|blockquote|table|section|article)\s*>/gi,
      "\n",
    )
    .replace(/<\/(td|th)\s*>/gi, "\t")
    .replace(/<[^>]*>/g, " ");

  text = decodeEntities(text);

  return text
    // Every whitespace run except a newline collapses to one space; this also
    // catches the non-breaking spaces that HTML mail is full of.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  euro: "€",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (_match, entity: string) => {
      if (entity.startsWith("#")) {
        const hex = entity[1] === "x" || entity[1] === "X";
        const codePoint = hex
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);

        // Printable BMP only. Surrogates, controls and out-of-range values
        // become a space rather than a replacement character.
        if (
          !Number.isFinite(codePoint) ||
          codePoint < 0x20 ||
          codePoint > 0xfffd ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return " ";
        }
        return String.fromCodePoint(codePoint);
      }

      return NAMED_ENTITIES[entity] ?? " ";
    },
  );
}

export type SanitizedBody = { text: string; truncated: boolean };

/**
 * The stored body.
 *
 * `text` wins when present, because it is what the sender wrote. HTML is used
 * only when there is no text part at all, and is converted, never kept. When
 * neither exists — an attachment-only message, or one this parser could not
 * make sense of — the body is empty and the message is still imported: that it
 * arrived, from whom and when, is the part that matters.
 */
export function sanitizeBody(
  parts: { text?: string | null; html?: string | null },
  maxChars: number,
): SanitizedBody {
  const raw = parts.text?.trim()
    ? parts.text
    : parts.html
      ? htmlToText(parts.html)
      : "";

  const cleaned = stripControls(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= maxChars) return { text: cleaned, truncated: false };

  return {
    text: cleaned.slice(0, maxChars) + TRUNCATION_MARKER,
    truncated: true,
  };
}

/**
 * The text of an outgoing reply.
 *
 * Written by an authenticated admin rather than by a stranger, which changes
 * the threat but does not remove it: the body is still typed into a browser and
 * still ends up inside a MIME message, so the same invisible characters get
 * stripped and the same length bound applies.
 *
 * Line endings are normalised to `\n` and **bare carriage returns are removed
 * entirely**. That is the header-injection defence at the body level: a
 * transport that mishandled `\r\n` in a body could otherwise be talked into
 * seeing `\r\nBcc:` as a new header. Nodemailer does not, and this makes it
 * impossible either way.
 *
 * Returns `null` for a body that is empty once cleaned — an empty reply is a
 * misclick, not a message.
 */
export function sanitizeReplyBody(
  value: unknown,
  maxChars: number,
): { text: string; tooLong: boolean } | null {
  if (typeof value !== "string") return null;

  const cleaned = stripControls(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!cleaned) return null;
  if (cleaned.length > maxChars) return { text: cleaned, tooLong: true };

  return { text: cleaned, tooLong: false };
}

/* ----------------------------------------------------------- structured -- */

/**
 * A filename that is only ever displayed.
 *
 * Path separators and traversal sequences are removed even though nothing here
 * writes a file: today's "display only" is tomorrow's download button, and a
 * stored `../../etc/passwd` would be sitting there waiting for it.
 */
export function sanitizeFilename(value: unknown): string {
  const cleaned = sanitizeHeader(value, INBOX_LIMITS.filename)
    .replace(/[\\/]/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+/, "")
    .trim();

  return cleaned || "unnamed";
}

export function sanitizeAttachments(
  attachments: readonly {
    filename?: string | null;
    contentType?: string | null;
    size?: number | null;
  }[],
): InboxAttachmentMeta[] {
  return attachments.slice(0, INBOX_LIMITS.maxAttachments).map((attachment) => ({
    filename: sanitizeFilename(attachment.filename),
    // A MIME type is a token: letters, digits and a little punctuation.
    // Anything else in that header is not a type, it is someone trying it on.
    content_type:
      sanitizeHeader(attachment.contentType, 128).replace(/[^\w.+/-]/g, "") ||
      "application/octet-stream",
    size:
      typeof attachment.size === "number" && Number.isFinite(attachment.size)
        ? Math.max(0, Math.floor(attachment.size))
        : 0,
  }));
}

export function sanitizeRecipients(
  groups: readonly {
    kind: "to" | "cc";
    addresses: readonly { name?: string | null; address?: string | null }[];
  }[],
): InboxRecipient[] {
  const seen = new Set<string>();
  const result: InboxRecipient[] = [];

  for (const group of groups) {
    for (const entry of group.addresses) {
      if (result.length >= INBOX_LIMITS.maxRecipients) return result;

      const email = sanitizeEmail(entry.address);
      if (!email) continue;

      const key = `${group.kind}:${email}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        kind: group.kind,
        name: sanitizeDisplayName(entry.name),
        email,
      });
    }
  }

  return result;
}

/**
 * The thread's search haystack: subject, sender name and every address on the
 * message, lowercased into one string.
 *
 * One column and one `$ilike` instead of an `$or` across four — the search
 * behaves identically whether Postgres or a test double answers it, and there
 * is one place to look when it stops matching something.
 */
export function buildSearchText(parts: {
  subject: string;
  fromName: string | null;
  fromEmail: string | null;
  recipients: readonly InboxRecipient[];
  previous?: string;
}): string {
  const pieces = [
    parts.previous ?? "",
    parts.subject,
    parts.fromName ?? "",
    parts.fromEmail ?? "",
    ...parts.recipients.map((recipient) => recipient.email),
  ];

  const words = new Set(
    pieces
      .join(" ")
      .toLowerCase()
      .split(/[\s,;<>()"']+/)
      .filter(Boolean),
  );

  // Bounded: a long thread with many participants must not grow an unbounded
  // column. The oldest terms fall off first.
  return [...words].slice(-400).join(" ").slice(0, 4_000);
}
