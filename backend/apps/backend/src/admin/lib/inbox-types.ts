/**
 * What the inbox endpoints return, as the browser sees it.
 *
 * Hand-written rather than derived from the server types on purpose: this is
 * the list of fields the admin is *allowed* to know about, and writing it out
 * makes the absence of the interesting ones visible. There is no `body_html`,
 * no `raw`, no `source`, no attachment URL and no IMAP host — not because they
 * are omitted here, but because the server never sends them.
 */

export type InboxThreadStatus = "open" | "resolved" | "spam";

export type InboxThreadSummary = {
  id: string;
  subject: string;
  status: InboxThreadStatus;
  last_message_at: string | null;
  message_count: number;
  unread_count: number;
  from_name: string | null;
  from_email: string | null;
};

export type InboxThreadList = {
  threads: InboxThreadSummary[];
  count: number;
  limit: number;
  offset: number;
};

export type InboxRecipient = {
  kind: "to" | "cc";
  name: string | null;
  email: string;
};

/** Metadata only — there is deliberately nothing here to click. */
export type InboxAttachment = {
  filename: string;
  content_type: string;
  size: number;
};

export type InboxDeliveryStatus = "pending" | "sent" | "failed";
export type InboxMessageDirection = "inbound" | "outbound";

export type InboxMessage = {
  id: string;
  /** `outbound` is a reply this admin sent; `inbound` is imported mail. */
  direction: InboxMessageDirection;
  from_name: string | null;
  from_email: string | null;
  /** `Reply-To`, when the sender set one; the composer prefers it over `from`. */
  reply_to: string | null;
  recipients: InboxRecipient[];
  subject: string;
  received_at: string | null;
  /** Plain text. The only body field that exists. */
  body_text: string;
  body_truncated: boolean;
  is_read: boolean;
  attachments: InboxAttachment[];
  size_bytes: number;
  /** Outbound only. `null` on imported mail, which has no status of ours. */
  delivery_status: InboxDeliveryStatus | null;
  /** A label from a fixed set — never the mail server's own sentence. */
  failure_reason: string | null;
  sent_at: string | null;
};

export type InboxThreadDetail = {
  thread: InboxThreadSummary & { created_at: string | null };
  messages: InboxMessage[];
};

export type InboxCounts = {
  open: number;
  resolved: number;
  spam: number;
  unread_threads: number;
  unread_messages: number;
  /** Whether the *importer* is switched on. A boolean, and nothing more. */
  enabled: boolean;
  /** Whether replying is switched on. Also just a boolean. */
  smtp_enabled: boolean;
};

export type InboxReplyResponse = {
  message: {
    id: string;
    thread_id: string;
    subject: string;
    to_email: string;
    delivery_status: InboxDeliveryStatus;
    failure_reason: string | null;
    sent_at: string | null;
  };
  /** True when an existing send was returned instead of a new one being made. */
  duplicate: boolean;
};

export type InboxSyncStatus =
  | "ok"
  | "disabled"
  | "misconfigured"
  | "locked"
  | "throttled"
  | "unreachable";

export type InboxSyncResponse = {
  status: InboxSyncStatus;
  imported: number;
  duplicates: number;
  oversized: number;
  failed: number;
  duration_ms: number;
  started_at: string;
};

export const INBOX_STATUS_FILTERS = ["open", "resolved", "spam"] as const;
export type InboxStatusFilter = (typeof INBOX_STATUS_FILTERS)[number];

export const INBOX_STATUS_LABELS: Record<InboxStatusFilter, string> = {
  open: "Open",
  resolved: "Resolved",
  spam: "Spam",
};

export function parseStatusFilter(raw: string | null): InboxStatusFilter {
  return (INBOX_STATUS_FILTERS as readonly string[]).includes(raw ?? "")
    ? (raw as InboxStatusFilter)
    : "open";
}
