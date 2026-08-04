/**
 * Deciding which conversation a message belongs to.
 *
 * Three signals, in strict order of how much they can be trusted:
 *
 *  1. `In-Reply-To` — the sender's mail client stating which message this
 *     answers. Definitive when present.
 *  2. `References` — the chain of the conversation so far, newest last.
 *  3. The subject — **last resort only**, and hedged three ways.
 *
 * The third one is where inboxes get this wrong. "Anfrage", "Bestellung" and
 * "Rückfrage" are what half the mail to a shop is called; grouping on subject
 * alone puts two unrelated customers in one conversation, which is a privacy
 * incident with extra steps rather than a display bug. So subject threading
 * additionally requires the **same sender address** and **recent activity**,
 * and refuses subjects too short to mean anything.
 */

import { INBOX_LIMITS } from "./config";
import { sanitizeMessageId } from "./sanitize";
import type { InboxStore, NormalizedMessage, ThreadRef } from "./types";

/**
 * Reply and forward prefixes, German and English.
 *
 * `AW` and `WG` are the German ones and are not optional here — the storefront
 * is German, so most replies arrive as `AW:`. `SV` (Swedish) and `RE` with a
 * bracketed counter (`Re[2]:`) show up often enough to be worth the two extra
 * alternatives.
 */
const PREFIX_PATTERN =
  /^\s*(?:(?:re|aw|antw|fwd?|wg|sv|tr|rif|res)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*)+/i;

/** Subjects shorter than this are never a threading key on their own. */
export const MIN_SUBJECT_THREAD_LENGTH = 4;

/**
 * How long a thread stays open to subject-based continuation.
 *
 * Fourteen days: long enough for "any news on this?" after a week, short
 * enough that next month's unrelated "Anfrage" from the same address starts
 * its own conversation.
 */
export const SUBJECT_THREAD_WINDOW_DAYS = 14;

/**
 * Reply prefixes stripped, whitespace collapsed, lowercased.
 *
 * Applied repeatedly, because `AW: Re: Fwd: Anfrage` is a real subject line
 * and stripping only the first prefix would make it a different thread from
 * `Anfrage`.
 */
export function normalizeSubject(subject: string): string {
  let current = (subject ?? "").trim();

  // Bounded loop: a subject of nothing but prefixes must not spin here.
  for (let index = 0; index < 10; index += 1) {
    const stripped = current.replace(PREFIX_PATTERN, "");
    if (stripped === current) break;
    current = stripped;
  }

  return current.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 512);
}

/**
 * `<a@b> <c@d>` → `["a@b", "c@d"]`, oldest first as the header orders them.
 *
 * Unbracketed ids are accepted too: some mailers emit them, and being strict
 * here would silently break threading for those senders.
 */
export function parseReferences(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];

  const found = value.match(/<[^<>]+>|\S+@\S+/g) ?? [];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const raw of found) {
    const id = sanitizeMessageId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  // Keep the newest few. A long-running thread accumulates hundreds, and the
  // oldest are the least likely to identify the right conversation.
  return ids.slice(-INBOX_LIMITS.maxReferences);
}

/**
 * The ids to look a parent thread up by, most specific first.
 *
 * `In-Reply-To` leads, then references newest-first — the nearest ancestor is
 * the best answer when a conversation has been forwarded around.
 */
export function threadLookupIds(message: {
  in_reply_to: string | null;
  references: readonly string[];
}): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  const push = (id: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  push(message.in_reply_to);
  for (let index = message.references.length - 1; index >= 0; index -= 1) {
    push(message.references[index]);
  }

  return ids;
}

/** Whether a subject may be used as a threading key at all. */
export function subjectIsThreadable(normalizedSubject: string): boolean {
  return normalizedSubject.length >= MIN_SUBJECT_THREAD_LENGTH;
}

/**
 * The subject of a reply.
 *
 * `Re:` is prepended **only when the subject does not already carry a reply
 * prefix** — including the German ones. `Re: AW: Anfrage` is what a client that
 * does not check produces, and after three exchanges the subject line is longer
 * than the message. An empty subject becomes a bare `Re:` rather than nothing,
 * because a blank subject on an outgoing reply reads as a broken system.
 */
export function replySubject(subject: string): string {
  const cleaned = (subject ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Re:";

  // The same prefix set the threading key strips, so "already a reply" means
  // exactly the same thing in both directions.
  return PREFIX_PATTERN.test(cleaned) ? cleaned : `Re: ${cleaned}`;
}

/**
 * A Message-ID for an outbound reply, generated before the send.
 *
 * Generated here rather than left to the SMTP server because it has to be
 * stored with the message: it is what a later reply's `In-Reply-To` will point
 * at, so a thread whose outbound ids are unknown is a thread that breaks the
 * moment the customer answers.
 *
 * The right-hand side is the sender's own domain, which is what receiving
 * servers expect; the left is time plus randomness. Returned **without**
 * angle brackets, matching how every other id in this feature is stored.
 */
export function generateMessageId(
  fromAddress: string,
  now: Date = new Date(),
  randomPart: string = Math.random().toString(36).slice(2, 12),
): string {
  const at = fromAddress.lastIndexOf("@");
  const domain = at >= 0 ? fromAddress.slice(at + 1) : "localhost";
  const safeDomain = domain.replace(/[^A-Za-z0-9.-]/g, "") || "localhost";

  return `${now.getTime()}.${randomPart}@${safeDomain}`;
}

/**
 * The `References` chain for a reply: the parent's chain, then the parent.
 *
 * Capped at the same limit as inbound parsing, keeping the newest — a header
 * that grows without bound is how long threads start getting rejected by
 * receiving servers.
 */
export function buildReferences(
  parentReferences: readonly string[],
  parentMessageId: string | null,
): string[] {
  const chain = [...parentReferences];
  if (parentMessageId && !chain.includes(parentMessageId)) {
    chain.push(parentMessageId);
  }
  return chain.slice(-INBOX_LIMITS.maxReferences);
}

export type ThreadResolution = {
  thread: ThreadRef | null;
  /** Which signal decided it — logged as a counter, useful when tuning. */
  by: "references" | "subject" | "new";
};

/**
 * Find the thread this message continues, or `null` for a new conversation.
 *
 * The store does the lookups; the rules live here. `now` is injected so the
 * fourteen-day window is testable without waiting a fortnight.
 */
export async function resolveThread(
  store: InboxStore,
  message: NormalizedMessage,
  now: Date = new Date(),
): Promise<ThreadResolution> {
  const ids = threadLookupIds(message);
  if (ids.length) {
    const byReference = await store.findThreadByMessageIds(ids);
    if (byReference) return { thread: byReference, by: "references" };
  }

  // Subject fallback. All three conditions, every time: a threadable subject,
  // a known sender address, and a thread that is still recent.
  if (subjectIsThreadable(message.normalized_subject) && message.from_email) {
    const activeSince = new Date(
      now.getTime() - SUBJECT_THREAD_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const bySubject = await store.findThreadBySubject({
      normalizedSubject: message.normalized_subject,
      participantEmail: message.from_email,
      activeSince,
    });

    if (bySubject) return { thread: bySubject, by: "subject" };
  }

  return { thread: null, by: "new" };
}
