/**
 * The shapes the inbox feature passes around.
 *
 * `InboxStore` is the important one. It is the *only* thing the sync
 * orchestrator knows about persistence — nine methods, no Medusa container, no
 * MikroORM. The module service implements it against Postgres; the tests
 * implement it with a Map. That is what lets "import only new messages",
 * "deduplicate by Message-ID" and "do not merge unrelated subjects" be tested
 * as behaviour rather than as mocked SQL.
 */

export const INBOX_THREAD_STATUSES = ["open", "resolved", "spam"] as const;
export type InboxThreadStatus = (typeof INBOX_THREAD_STATUSES)[number];

export function isInboxThreadStatus(value: unknown): value is InboxThreadStatus {
  return (
    typeof value === "string" &&
    (INBOX_THREAD_STATUSES as readonly string[]).includes(value)
  );
}

/** Metadata only. The bytes are never fetched — see `docs/inbox.md`. */
export type InboxAttachmentMeta = {
  filename: string;
  content_type: string;
  size: number;
};

export type InboxRecipient = {
  kind: "to" | "cc";
  name: string | null;
  email: string;
};

/**
 * A parsed, sanitised, length-bounded message, ready to store.
 *
 * Everything on it has already been through `sanitize.ts`: no control
 * characters, no HTML, no header longer than its limit. Nothing downstream
 * re-validates, because nothing downstream should have to.
 */
export type NormalizedMessage = {
  mailbox: string;
  uid: number;
  message_id: string | null;
  in_reply_to: string | null;
  /** Oldest first, as the header orders them. */
  references: string[];
  from_name: string | null;
  from_email: string | null;
  recipients: InboxRecipient[];
  subject: string;
  /** Prefix-stripped, lowercased. The last-resort threading key. */
  normalized_subject: string;
  received_at: Date;
  body_text: string;
  body_truncated: boolean;
  size_bytes: number;
  attachments: InboxAttachmentMeta[];
};

export type InboxSyncStateRecord = {
  mailbox: string;
  uid_validity: string | null;
  last_uid: number;
  initialized: boolean;
  last_synced_at: Date | null;
  last_success_at: Date | null;
  last_status: string | null;
};

export type InboxSyncStatePatch = Partial<
  Omit<InboxSyncStateRecord, "mailbox">
>;

export type ThreadRef = { id: string };

export type CreateThreadInput = {
  subject: string;
  normalized_subject: string;
  last_message_at: Date;
  last_sender_name: string | null;
  last_sender_email: string | null;
};

export interface InboxStore {
  getSyncState(mailbox: string): Promise<InboxSyncStateRecord | null>;
  saveSyncState(mailbox: string, patch: InboxSyncStatePatch): Promise<void>;

  /** Primary dedupe key. */
  findMessageByUid(mailbox: string, uid: number): Promise<ThreadRef | null>;
  /** Secondary dedupe key, for mail that reappears under a new UID. */
  findMessageByMessageId(messageId: string): Promise<ThreadRef | null>;

  /** Thread of the newest message whose Message-ID is in the list. */
  findThreadByMessageIds(messageIds: string[]): Promise<ThreadRef | null>;
  /**
   * Last-resort threading: same normalised subject, **same participant**, and
   * active since `activeSince`. All three, or unrelated mail gets merged.
   */
  findThreadBySubject(args: {
    normalizedSubject: string;
    participantEmail: string;
    activeSince: Date;
  }): Promise<ThreadRef | null>;

  createThread(input: CreateThreadInput): Promise<ThreadRef>;
  /** Insert the message and move the thread's counters in one place. */
  appendMessage(threadId: string, message: NormalizedMessage): Promise<void>;

  /** Retention. Returns what it removed; never called when unset. */
  purgeBefore(cutoff: Date): Promise<{ messages: number; threads: number }>;
}

/** Why a sync run ended. Safe to log and to return to an admin. */
export type InboxSyncStatus =
  | "ok"
  | "disabled"
  | "misconfigured"
  | "locked"
  | "throttled"
  | "unreachable";

export type InboxSyncResult = {
  status: InboxSyncStatus;
  /** Messages written. */
  imported: number;
  /** Already present, by UID or Message-ID. */
  duplicates: number;
  /** Over the size cap: recorded from the envelope, body not downloaded. */
  oversized: number;
  /** Unparseable; counted, skipped, cursor advanced past them. */
  failed: number;
  lastUid: number;
  durationMs: number;
  startedAt: string;
  /** Retention deletions, when `INBOX_RETENTION_DAYS` is set. */
  purged?: { messages: number; threads: number };
};
