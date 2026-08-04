import { model } from "@medusajs/framework/utils";
import InboxMessage from "./message";

/**
 * A conversation in the admin inbox.
 *
 * One row per thread, with the counters and the sender kept **on the thread**
 * rather than derived from its messages. That denormalisation is deliberate:
 * the list view renders a sender and an unread dot per row, and computing those
 * with a per-row aggregate over `inbox_message` would turn one page of a list
 * into fifty queries. `InboxModuleService.appendMessage` is the only writer, so
 * there is exactly one place the counters can drift.
 *
 * `normalized_subject` is the reply-prefix-stripped, lowercased subject used as
 * the *last resort* threading key (see `lib/inbox/threading.ts`);
 * `subject` is what the latest message actually said, which is what a human
 * should read.
 *
 * `search_text` is the one field the list search matches: subject, sender name
 * and every participant address, lowercased and concatenated. A single
 * `$ilike` beats an `$or` across four columns both in clarity and in what the
 * query planner does with it — and it keeps the search behaviour identical
 * whether it is Postgres or a test double answering.
 */
const InboxThread = model
  .define("inbox_thread", {
    id: model.id({ prefix: "ithr" }).primaryKey(),

    /** Display subject — the latest message's, unmodified apart from limits. */
    subject: model.text(),
    /** Threading key: prefixes stripped, whitespace collapsed, lowercased. */
    normalized_subject: model.text(),

    last_message_at: model.dateTime(),
    message_count: model.number().default(0),
    unread_count: model.number().default(0),

    status: model.enum(["open", "resolved", "spam"]).default("open"),

    /** Denormalised from the latest message, for the list view. */
    last_sender_name: model.text().nullable(),
    last_sender_email: model.text().nullable(),

    /** Lowercased haystack for `q=`: subject + names + addresses. */
    search_text: model.text().default(""),

    messages: model.hasMany(() => InboxMessage, { mappedBy: "thread" }),
  })
  // Deleting a thread takes its messages with it. Retention deletes messages
  // first and then the threads left empty, but a thread deleted by any other
  // path must not leave orphaned mail behind in the database.
  .cascades({ delete: ["messages"] })
  .indexes([
    // The list's default ordering, and its ordering under a status filter.
    { on: ["last_message_at"] },
    { on: ["status", "last_message_at"] },
    // Subject fallback threading looks up by this pair.
    { on: ["normalized_subject", "last_message_at"] },
  ]);

export default InboxThread;
