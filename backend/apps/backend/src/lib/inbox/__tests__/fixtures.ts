/**
 * Test doubles for the inbox.
 *
 * `FakeInboxStore` is a working implementation of `InboxStore` over two Maps,
 * with the same rules the Postgres one has: a unique `(mailbox, uid)`, threads
 * that carry their own counters, and a subject lookup that also checks the
 * participant. It exists so that dedupe, threading and cursor behaviour are
 * tested as *behaviour* rather than as assertions about which query was called.
 *
 * `FakeImapSession` is the same idea for the mail server: a list of messages
 * with UIDs, a `uidNext`, and knobs for the failure modes that matter — a
 * connection that refuses, a source that will not parse, a message that is too
 * big.
 *
 * No address here belongs to a real person and no message is real mail.
 */

import type {
  CreateOutboundInput,
  CreateThreadInput,
  InboxDeliveryStatus,
  InboxStore,
  InboxSyncStatePatch,
  InboxSyncStateRecord,
  NormalizedMessage,
  OutboundRecord,
  ReplyParent,
  ReplyStore,
  ThreadRef,
} from "../types";
import type { ImapEnvelope, ImapMailboxInfo, ImapSession } from "../imap";
import type { MailSender, OutboundMail } from "../smtp";
import type { InboxConfig } from "../config";

/* ------------------------------------------------------------------ store -- */

type StoredThread = {
  id: string;
  subject: string;
  normalized_subject: string;
  last_message_at: Date;
  message_count: number;
  unread_count: number;
  status: "open" | "resolved" | "spam";
  last_sender_email: string | null;
};

export class FakeInboxStore implements InboxStore {
  threads = new Map<string, StoredThread>();
  messages: NormalizedMessage[] = [];
  states = new Map<string, InboxSyncStateRecord>();
  /** Every `saveSyncState` call, in order — the cursor's audit trail. */
  saves: InboxSyncStatePatch[] = [];

  #nextThreadId = 1;

  async getSyncState(mailbox: string): Promise<InboxSyncStateRecord | null> {
    return this.states.get(mailbox) ?? null;
  }

  async saveSyncState(
    mailbox: string,
    patch: InboxSyncStatePatch,
  ): Promise<void> {
    this.saves.push({ ...patch });

    const existing = this.states.get(mailbox) ?? {
      mailbox,
      uid_validity: null,
      last_uid: 0,
      initialized: false,
      last_synced_at: null,
      last_success_at: null,
      last_status: null,
    };

    this.states.set(mailbox, { ...existing, ...patch });
  }

  async findMessageByUid(mailbox: string, uid: number): Promise<ThreadRef | null> {
    const found = this.messages.find(
      (message) => message.mailbox === mailbox && message.uid === uid,
    );
    return found ? { id: this.#threadOf(found) } : null;
  }

  async findMessageByMessageId(messageId: string): Promise<ThreadRef | null> {
    const found = this.messages.find(
      (message) => message.message_id === messageId,
    );
    return found ? { id: this.#threadOf(found) } : null;
  }

  async findThreadByMessageIds(messageIds: string[]): Promise<ThreadRef | null> {
    const matches = this.messages
      .filter(
        (message) =>
          message.message_id && messageIds.includes(message.message_id),
      )
      .sort((a, b) => b.received_at.getTime() - a.received_at.getTime());

    return matches[0] ? { id: this.#threadOf(matches[0]) } : null;
  }

  async findThreadBySubject(args: {
    normalizedSubject: string;
    participantEmail: string;
    activeSince: Date;
  }): Promise<ThreadRef | null> {
    const candidates = [...this.threads.values()]
      .filter(
        (thread) =>
          thread.normalized_subject === args.normalizedSubject &&
          thread.last_message_at >= args.activeSince,
      )
      .sort((a, b) => b.last_message_at.getTime() - a.last_message_at.getTime());

    for (const thread of candidates) {
      const participates = this.messages.some(
        (message) =>
          this.#threadOf(message) === thread.id &&
          message.from_email === args.participantEmail,
      );
      if (participates) return { id: thread.id };
    }

    return null;
  }

  async createThread(input: CreateThreadInput): Promise<ThreadRef> {
    const id = `ithr_${this.#nextThreadId++}`;
    this.threads.set(id, {
      id,
      subject: input.subject,
      normalized_subject: input.normalized_subject,
      last_message_at: input.last_message_at,
      message_count: 0,
      unread_count: 0,
      status: "open",
      last_sender_email: input.last_sender_email,
    });
    return { id };
  }

  async appendMessage(
    threadId: string,
    message: NormalizedMessage,
  ): Promise<void> {
    this.#threadIds.set(message, threadId);
    this.messages.push(message);

    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`unknown thread ${threadId}`);

    thread.message_count += 1;
    thread.unread_count += 1;
    if (message.received_at >= thread.last_message_at) {
      thread.last_message_at = message.received_at;
      thread.subject = message.subject;
      thread.normalized_subject = message.normalized_subject;
      thread.last_sender_email = message.from_email;
    }
    if (thread.status === "resolved") thread.status = "open";
  }

  async purgeBefore(cutoff: Date): Promise<{ messages: number; threads: number }> {
    const stale = this.messages.filter((message) => message.received_at < cutoff);
    const affected = new Set(stale.map((message) => this.#threadOf(message)));

    this.messages = this.messages.filter(
      (message) => message.received_at >= cutoff,
    );

    let removed = 0;
    for (const threadId of affected) {
      const remaining = this.messages.filter(
        (message) => this.#threadOf(message) === threadId,
      );
      if (!remaining.length) {
        this.threads.delete(threadId);
        removed += 1;
      } else {
        const thread = this.threads.get(threadId);
        if (thread) thread.message_count = remaining.length;
      }
    }

    return { messages: stale.length, threads: removed };
  }

  /* -------------------------------------------------------------- helpers */

  #threadIds = new WeakMap<NormalizedMessage, string>();

  #threadOf(message: NormalizedMessage): string {
    return this.#threadIds.get(message) ?? "";
  }

  threadIdOf(message: NormalizedMessage): string {
    return this.#threadOf(message);
  }

  /** Messages grouped by thread id — the shape most assertions want. */
  grouped(): Record<string, number[]> {
    const groups: Record<string, number[]> = {};
    for (const message of this.messages) {
      const id = this.#threadOf(message);
      groups[id] = [...(groups[id] ?? []), message.uid];
    }
    return groups;
  }
}

/* ------------------------------------------------------------------- imap -- */

export type FakeMessage = {
  uid: number;
  size?: number;
  internalDate?: Date;
  /** What the parser will be handed. `"throw"` makes it fail. */
  source?: string | "throw" | null;
  headers?: ImapEnvelope["headers"];
};

export class FakeImapSession implements ImapSession {
  opened: string[] = [];
  downloaded: number[] = [];
  closed = 0;

  constructor(
    private readonly messages: FakeMessage[],
    private readonly info: ImapMailboxInfo,
  ) {}

  async open(mailbox: string): Promise<ImapMailboxInfo> {
    this.opened.push(mailbox);
    return this.info;
  }

  async listSince(sinceUid: number): Promise<ImapEnvelope[]> {
    return this.messages
      .filter((message) => message.uid > sinceUid)
      .map(toEnvelope)
      .sort((a, b) => a.uid - b.uid);
  }

  async listSinceDate(since: Date): Promise<ImapEnvelope[]> {
    return this.messages
      .filter((message) => (message.internalDate ?? new Date(0)) >= since)
      .map(toEnvelope)
      .sort((a, b) => a.uid - b.uid);
  }

  async download(uid: number): Promise<Buffer | null> {
    this.downloaded.push(uid);
    const message = this.messages.find((entry) => entry.uid === uid);
    if (!message || message.source === null || message.source === undefined) {
      return null;
    }
    return Buffer.from(message.source);
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

function toEnvelope(message: FakeMessage): ImapEnvelope {
  return {
    uid: message.uid,
    size: message.size ?? 1_000,
    internalDate: message.internalDate ?? new Date("2026-08-01T10:00:00.000Z"),
    headers: message.headers ?? null,
  };
}

/**
 * A parser that reads the fake source as JSON.
 *
 * The literal string `"throw"` fails, which is how the malformed-message test
 * gets a realistic failure without shipping broken MIME around.
 */
export const fakeParser = async (source: Buffer) => {
  const text = source.toString("utf8");
  if (text === "throw") {
    throw new SyntaxError("unparseable message");
  }
  return JSON.parse(text);
};

/** A message body the fake parser understands. */
export function mailSource(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    messageId: "<default@example.org>",
    subject: "Anfrage",
    date: "2026-08-01T10:00:00.000Z",
    from: [{ value: [{ name: "A Sender", address: "sender@example.org" }] }],
    to: [{ value: [{ name: null, address: "info@example.org" }] }],
    text: "Guten Tag",
    ...overrides,
  });
}

export const testConfig: InboxConfig = {
  host: "imap.example.test",
  port: 993,
  secure: true,
  user: "info@example.test",
  passwordConfigured: true,
  mailbox: "INBOX",
  pollIntervalSeconds: 300,
  importExisting: false,
  importSinceDays: 14,
  retentionDays: null,
  maxBodyChars: 100_000,
  maxMessageBytes: 5 * 1024 * 1024,
};

export function testLogger() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/* ---------------------------------------------------------------- replies -- */

type StoredOutbound = CreateOutboundInput & {
  id: string;
  delivery_status: InboxDeliveryStatus;
  failure_reason: string | null;
  sent_at: Date | null;
};

/**
 * A working `ReplyStore` over two arrays.
 *
 * Enforces the one rule the database enforces — an idempotency key belongs to
 * at most one row — and records every status transition, because "the record
 * was pending before it was sent" is a property worth asserting rather than
 * assuming.
 */
export class FakeReplyStore implements ReplyStore {
  threads = new Set<string>(["ithr_1"]);
  inbound: ReplyParent[] = [];
  outbound: StoredOutbound[] = [];
  /** Every delivery status ever written, in order. */
  statusHistory: string[] = [];
  /** Overridable answers for the two rate-limit queries. */
  lastOutbound: Date | null = null;
  globalCount = 0;

  #nextId = 1;

  /** A thread with one inbound message, which is the normal case. */
  static withInbound(overrides: Partial<ReplyParent> = {}): FakeReplyStore {
    const store = new FakeReplyStore();
    store.inbound.push({
      id: "imsg_1",
      message_id: "kunde-1@example.org",
      references: ["older@example.org"],
      subject: "Anfrage Semaglutid",
      from_email: "kunde@example.org",
      reply_to: null,
      received_at: new Date("2026-08-05T08:00:00.000Z"),
      ...overrides,
    });
    return store;
  }

  async threadExists(threadId: string): Promise<boolean> {
    return this.threads.has(threadId);
  }

  async latestInboundMessage(): Promise<ReplyParent | null> {
    return (
      [...this.inbound].sort(
        (a, b) => b.received_at.getTime() - a.received_at.getTime(),
      )[0] ?? null
    );
  }

  async findOutboundByIdempotencyKey(key: string): Promise<OutboundRecord | null> {
    const found = this.outbound.find((row) => row.idempotency_key === key);
    return found ? toRecord(found) : null;
  }

  async createOutbound(input: CreateOutboundInput): Promise<OutboundRecord> {
    if (this.outbound.some((row) => row.idempotency_key === input.idempotency_key)) {
      throw new Error("duplicate idempotency key");
    }

    const row: StoredOutbound = {
      ...input,
      id: `imsg_out_${this.#nextId++}`,
      delivery_status: "pending",
      failure_reason: null,
      sent_at: null,
    };

    this.outbound.push(row);
    this.statusHistory.push("pending");
    this.lastOutbound = input.created_at;

    return toRecord(row);
  }

  async markOutboundPending(id: string): Promise<OutboundRecord> {
    return this.#update(id, { delivery_status: "pending", failure_reason: null });
  }

  async markOutboundSent(id: string, sentAt: Date): Promise<OutboundRecord> {
    return this.#update(id, { delivery_status: "sent", sent_at: sentAt });
  }

  async markOutboundFailed(id: string, reason: string): Promise<OutboundRecord> {
    return this.#update(id, { delivery_status: "failed", failure_reason: reason });
  }

  async lastOutboundAt(): Promise<Date | null> {
    return this.lastOutbound;
  }

  async countOutboundSince(): Promise<number> {
    return this.globalCount;
  }

  /** Pretend a send with this key is already in flight. */
  forcePendingFor(key: string): void {
    this.outbound.push({
      id: `imsg_out_${this.#nextId++}`,
      thread_id: "ithr_1",
      message_id: "pending@example.test",
      in_reply_to: null,
      references: [],
      from_email: "info@example.test",
      to_email: "kunde@example.org",
      subject: "Re: Anfrage",
      body_text: "in flight",
      idempotency_key: key,
      created_at: new Date(),
      delivery_status: "pending",
      failure_reason: null,
      sent_at: null,
    });
  }

  #update(id: string, patch: Partial<StoredOutbound>): OutboundRecord {
    const row = this.outbound.find((entry) => entry.id === id);
    if (!row) throw new Error(`unknown outbound ${id}`);

    Object.assign(row, patch);
    if (patch.delivery_status) this.statusHistory.push(patch.delivery_status);

    return toRecord(row);
  }
}

function toRecord(row: StoredOutbound): OutboundRecord {
  return {
    id: row.id,
    thread_id: row.thread_id,
    message_id: row.message_id,
    to_email: row.to_email,
    subject: row.subject,
    delivery_status: row.delivery_status,
    failure_reason: row.failure_reason,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    sent_at: row.sent_at,
  };
}

/**
 * A mail transport that records instead of sending.
 *
 * `sent` holds the exact objects the code asked to put on the wire, which is
 * what makes "no cc", "no attachments" and "the right threading headers"
 * assertions about behaviour rather than about mocks.
 */
export function fakeSender(sendImpl?: () => Promise<{ accepted: number }>): {
  sent: OutboundMail[];
  closed: number;
  send: MailSender["send"];
  close: MailSender["close"];
} {
  const sender = {
    sent: [] as OutboundMail[],
    closed: 0,
    async send(mail: OutboundMail) {
      if (sendImpl) {
        // Recorded before the failure: a send that threw was still attempted,
        // and the retry tests depend on knowing that.
        const result = await sendImpl();
        sender.sent.push(mail);
        return result;
      }
      sender.sent.push(mail);
      return { accepted: 1 };
    },
    async close() {
      sender.closed += 1;
    },
  };

  return sender;
}
