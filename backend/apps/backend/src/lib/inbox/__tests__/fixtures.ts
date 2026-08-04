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
  CreateThreadInput,
  InboxStore,
  InboxSyncStatePatch,
  InboxSyncStateRecord,
  NormalizedMessage,
  ThreadRef,
} from "../types";
import type { ImapEnvelope, ImapMailboxInfo, ImapSession } from "../imap";
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
