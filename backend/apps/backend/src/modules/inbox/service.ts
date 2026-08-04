/**
 * The inbox module's service.
 *
 * Two jobs in one class, kept visibly apart below:
 *
 *  - **The store.** The nine `InboxStore` methods the importer calls. This is
 *    where "one message, one row, one thread" is actually enforced, and where
 *    the thread counters are maintained — nowhere else writes them, so there is
 *    exactly one place they can drift.
 *  - **The reader.** What the admin API asks for: a page of threads, a thread
 *    with its messages, the counts behind the sidebar badge, and the four
 *    status/read mutations.
 *
 * Counter updates are read-modify-write rather than a SQL `+ 1`. They are safe
 * because there is exactly one writer at a time: the importer holds the sync
 * lock (`lib/inbox/lock.ts`), and no admin action appends messages. If a second
 * writer is ever introduced, this is the first thing that has to change.
 */

import { MedusaService } from "@medusajs/framework/utils";

import InboxMessage from "./models/message";
import InboxSyncState from "./models/sync-state";
import InboxThread from "./models/thread";

import { searchTextFor } from "../../lib/inbox/parse";
import type {
  CreateThreadInput,
  InboxStore,
  InboxSyncStatePatch,
  InboxSyncStateRecord,
  InboxThreadStatus,
  NormalizedMessage,
  ThreadRef,
} from "../../lib/inbox/types";

/** Rows examined by one retention pass. The next run continues where it left off. */
const RETENTION_BATCH = 1_000;

/**
 * How many unread threads the badge's message total is summed over.
 *
 * The per-status thread counts are exact (they are `COUNT` queries). The unread
 * *message* total is a sum over thread rows, so it is bounded: an inbox with
 * more than this many unread conversations has a bigger problem than an
 * approximate badge.
 */
const UNREAD_SUM_LIMIT = 1_000;

export type ThreadListItem = {
  id: string;
  subject: string;
  status: InboxThreadStatus;
  last_message_at: Date;
  message_count: number;
  unread_count: number;
  last_sender_name: string | null;
  last_sender_email: string | null;
};

export type InboxCounts = {
  open: number;
  resolved: number;
  spam: number;
  unread_threads: number;
  unread_messages: number;
};

class InboxModuleService
  extends MedusaService({ InboxThread, InboxMessage, InboxSyncState })
  implements InboxStore
{
  /* ============================================================= store == */

  async getSyncState(mailbox: string): Promise<InboxSyncStateRecord | null> {
    const [state] = await this.listInboxSyncStates({ mailbox }, { take: 1 });
    if (!state) return null;

    return {
      mailbox: state.mailbox,
      uid_validity: state.uid_validity ?? null,
      last_uid: state.last_uid ?? 0,
      initialized: Boolean(state.initialized),
      last_synced_at: state.last_synced_at ?? null,
      last_success_at: state.last_success_at ?? null,
      last_status: state.last_status ?? null,
    };
  }

  async saveSyncState(
    mailbox: string,
    patch: InboxSyncStatePatch,
  ): Promise<void> {
    const [existing] = await this.listInboxSyncStates({ mailbox }, { take: 1 });

    if (!existing) {
      await this.createInboxSyncStates({ mailbox, ...patch });
      return;
    }

    await this.updateInboxSyncStates({ id: existing.id, ...patch });
  }

  async findMessageByUid(
    mailbox: string,
    uid: number,
  ): Promise<ThreadRef | null> {
    const [message] = await this.listInboxMessages(
      { mailbox, uid },
      { take: 1, select: ["id", "thread_id"] },
    );

    return message ? { id: String(message.thread_id) } : null;
  }

  async findMessageByMessageId(messageId: string): Promise<ThreadRef | null> {
    const [message] = await this.listInboxMessages(
      { message_id: messageId },
      { take: 1, select: ["id", "thread_id"] },
    );

    return message ? { id: String(message.thread_id) } : null;
  }

  /**
   * The thread of the most recent message carrying any of these ids.
   *
   * Newest first, because a forwarded conversation can reference messages from
   * more than one thread and the nearest ancestor is the right answer.
   */
  async findThreadByMessageIds(messageIds: string[]): Promise<ThreadRef | null> {
    if (!messageIds.length) return null;

    const [message] = await this.listInboxMessages(
      { message_id: messageIds },
      {
        take: 1,
        select: ["id", "thread_id"],
        order: { received_at: "DESC" },
      },
    );

    return message ? { id: String(message.thread_id) } : null;
  }

  /**
   * Last-resort subject threading.
   *
   * All three conditions are applied in the query, not in the caller: same
   * normalised subject, recent activity, **and** the sender already on the
   * thread. The participant check is the one that stops two unrelated people
   * writing "Anfrage" from landing in the same conversation, so it is a second
   * query rather than an approximation via `search_text`.
   */
  async findThreadBySubject(args: {
    normalizedSubject: string;
    participantEmail: string;
    activeSince: Date;
  }): Promise<ThreadRef | null> {
    const candidates = await this.listInboxThreads(
      {
        normalized_subject: args.normalizedSubject,
        last_message_at: { $gte: args.activeSince },
      },
      { take: 10, select: ["id"], order: { last_message_at: "DESC" } },
    );

    for (const candidate of candidates) {
      const [seen] = await this.listInboxMessages(
        { thread_id: candidate.id, from_email: args.participantEmail },
        { take: 1, select: ["id"] },
      );

      if (seen) return { id: candidate.id };
    }

    return null;
  }

  async createThread(input: CreateThreadInput): Promise<ThreadRef> {
    const created = await this.createInboxThreads({
      subject: input.subject,
      normalized_subject: input.normalized_subject,
      last_message_at: input.last_message_at,
      last_sender_name: input.last_sender_name,
      last_sender_email: input.last_sender_email,
      message_count: 0,
      unread_count: 0,
      status: "open",
      search_text: "",
    });

    return { id: created.id };
  }

  /**
   * Insert the message and move the thread's counters together.
   *
   * A new message always arrives unread, and a thread that had been resolved
   * reopens — a reply to something marked done is the clearest possible signal
   * that it is not done. A thread marked **spam stays spam**: that is a
   * judgement about the sender, and re-raising it on every follow-up would make
   * the flag useless.
   */
  async appendMessage(
    threadId: string,
    message: NormalizedMessage,
  ): Promise<void> {
    await this.createInboxMessages({
      // The relation, not the raw column: Medusa's generated create type takes
      // `thread` (the id of the parent) and writes `thread_id` itself. Both
      // work at runtime; only this one typechecks.
      thread: threadId,
      mailbox: message.mailbox,
      uid: message.uid,
      message_id: message.message_id,
      in_reply_to: message.in_reply_to,
      references: message.references.length
        ? message.references.join(" ").slice(0, 4_000)
        : null,
      from_name: message.from_name,
      from_email: message.from_email,
      // `model.json()` is typed as an object while the column is `jsonb`, which
      // stores an array perfectly well. The cast is that gap and nothing more —
      // both readers (`api/admin/inbox/threads/[id]`) guard with `Array.isArray`
      // rather than trusting the shape back out.
      recipients: message.recipients as unknown as Record<string, unknown>,
      subject: message.subject,
      received_at: message.received_at,
      body_text: message.body_text,
      body_truncated: message.body_truncated,
      size_bytes: message.size_bytes,
      attachments: message.attachments as unknown as Record<string, unknown>,
      is_read: false,
    });

    const thread = await this.retrieveInboxThread(threadId);
    const previousLast = thread.last_message_at
      ? new Date(thread.last_message_at)
      : null;
    const isNewest = !previousLast || message.received_at >= previousLast;

    await this.updateInboxThreads({
      id: threadId,
      message_count: (thread.message_count ?? 0) + 1,
      unread_count: (thread.unread_count ?? 0) + 1,
      last_message_at: isNewest ? message.received_at : previousLast,
      // Only the newest message decides what the list row says.
      ...(isNewest
        ? {
            subject: message.subject || thread.subject,
            normalized_subject:
              message.normalized_subject || thread.normalized_subject,
            last_sender_name: message.from_name,
            last_sender_email: message.from_email,
          }
        : {}),
      status: thread.status === "resolved" ? "open" : thread.status,
      search_text: searchTextFor(message, thread.search_text ?? ""),
    });
  }

  /**
   * Retention.
   *
   * Only ever called when `INBOX_RETENTION_DAYS` is set — the default is that
   * this method never runs. Messages go first, then the threads left with
   * nothing in them; a thread that still has newer messages keeps its row with
   * recomputed counters rather than a stale count of deleted mail.
   */
  async purgeBefore(cutoff: Date): Promise<{ messages: number; threads: number }> {
    const stale = await this.listInboxMessages(
      { received_at: { $lt: cutoff } },
      { take: RETENTION_BATCH, select: ["id", "thread_id"], order: { received_at: "ASC" } },
    );

    if (!stale.length) return { messages: 0, threads: 0 };

    const threadIds = [...new Set(stale.map((message) => String(message.thread_id)))];
    await this.deleteInboxMessages(stale.map((message) => message.id));

    let removedThreads = 0;

    for (const threadId of threadIds) {
      const remaining = await this.listInboxMessages(
        { thread_id: threadId },
        { select: ["id", "received_at", "is_read"], take: RETENTION_BATCH },
      );

      if (!remaining.length) {
        await this.deleteInboxThreads(threadId);
        removedThreads += 1;
        continue;
      }

      const newest = remaining.reduce((latest, message) =>
        new Date(message.received_at) > new Date(latest.received_at) ? message : latest,
      );

      await this.updateInboxThreads({
        id: threadId,
        message_count: remaining.length,
        unread_count: remaining.filter((message) => !message.is_read).length,
        last_message_at: newest.received_at,
      });
    }

    return { messages: stale.length, threads: removedThreads };
  }

  /* ============================================================ reader == */

  /**
   * A page of threads, newest activity first.
   *
   * Search is a single `$ilike` against the thread's `search_text`, which holds
   * the subject, the sender's name and every address on the conversation. The
   * term is matched as a literal substring — `%` and `_` in a user's query are
   * escaped, so a search for `50%` finds the mail about fifty percent rather
   * than everything.
   */
  async listThreadsPage(options: {
    q?: string;
    status?: InboxThreadStatus;
    unreadOnly?: boolean;
    limit: number;
    offset: number;
  }): Promise<{ threads: ThreadListItem[]; count: number }> {
    const filters: Record<string, unknown> = {};

    if (options.status) filters.status = options.status;
    if (options.unreadOnly) filters.unread_count = { $gt: 0 };

    const term = (options.q ?? "").trim().toLowerCase();
    if (term) {
      filters.search_text = { $ilike: `%${escapeLike(term)}%` };
    }

    const [threads, count] = await this.listAndCountInboxThreads(filters, {
      take: options.limit,
      skip: options.offset,
      order: { last_message_at: "DESC" },
    });

    return {
      threads: threads.map(toThreadListItem),
      count,
    };
  }

  /** A thread and its messages, oldest first — the order a person reads in. */
  async getThreadDetail(id: string) {
    const thread = await this.retrieveInboxThread(id);
    const messages = await this.listInboxMessages(
      { thread_id: id },
      { order: { received_at: "ASC" }, take: 500 },
    );

    return { thread, messages };
  }

  async getCounts(): Promise<InboxCounts> {
    const [openCount, resolvedCount, spamCount, unreadThreadCount] =
      await Promise.all([
        this.countThreads({ status: "open" }),
        this.countThreads({ status: "resolved" }),
        this.countThreads({ status: "spam" }),
        this.countThreads({ status: ["open", "resolved"], unread_count: { $gt: 0 } }),
      ]);

    // Spam is deliberately excluded from the unread total: a flagged sender
    // must not keep the badge lit.
    const unreadThreads = await this.listInboxThreads(
      { status: ["open", "resolved"], unread_count: { $gt: 0 } },
      { select: ["unread_count"], take: UNREAD_SUM_LIMIT },
    );

    return {
      open: openCount,
      resolved: resolvedCount,
      spam: spamCount,
      unread_threads: unreadThreadCount,
      unread_messages: unreadThreads.reduce(
        (total, thread) => total + (thread.unread_count ?? 0),
        0,
      ),
    };
  }

  private async countThreads(filters: Record<string, unknown>): Promise<number> {
    const [, count] = await this.listAndCountInboxThreads(filters, {
      take: 1,
      select: ["id"],
    });
    return count;
  }

  async setThreadStatus(id: string, status: InboxThreadStatus) {
    await this.retrieveInboxThread(id, { select: ["id"] });
    await this.updateInboxThreads({ id, status });
    return this.retrieveInboxThread(id);
  }

  /** Mark every message in a thread read or unread, and fix the counter. */
  async setThreadRead(id: string, read: boolean) {
    const messages = await this.listInboxMessages(
      { thread_id: id },
      { select: ["id", "is_read"], take: 500 },
    );

    const changing = messages.filter((message) => Boolean(message.is_read) !== read);
    if (changing.length) {
      await this.updateInboxMessages(
        changing.map((message) => ({ id: message.id, is_read: read })),
      );
    }

    await this.updateInboxThreads({
      id,
      unread_count: read ? 0 : messages.length,
    });

    return this.retrieveInboxThread(id);
  }

  /** Mark one message read or unread, and move its thread's counter with it. */
  async setMessageRead(id: string, read: boolean) {
    const message = await this.retrieveInboxMessage(id, {
      select: ["id", "is_read", "thread_id"],
    });

    if (Boolean(message.is_read) !== read) {
      await this.updateInboxMessages({ id, is_read: read });

      const threadId = String(message.thread_id);
      const thread = await this.retrieveInboxThread(threadId, {
        select: ["id", "unread_count"],
      });

      const next = read
        ? Math.max(0, (thread.unread_count ?? 0) - 1)
        : (thread.unread_count ?? 0) + 1;

      await this.updateInboxThreads({ id: threadId, unread_count: next });
    }

    return this.retrieveInboxMessage(id);
  }
}

/** `%` and `_` are wildcards in `LIKE`; a search term is neither. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function toThreadListItem(thread: {
  id: string;
  subject: string;
  status: string;
  last_message_at: Date;
  message_count: number;
  unread_count: number;
  last_sender_name: string | null;
  last_sender_email: string | null;
}): ThreadListItem {
  return {
    id: thread.id,
    subject: thread.subject,
    status: thread.status as InboxThreadStatus,
    last_message_at: thread.last_message_at,
    message_count: thread.message_count ?? 0,
    unread_count: thread.unread_count ?? 0,
    last_sender_name: thread.last_sender_name ?? null,
    last_sender_email: thread.last_sender_email ?? null,
  };
}

export default InboxModuleService;
