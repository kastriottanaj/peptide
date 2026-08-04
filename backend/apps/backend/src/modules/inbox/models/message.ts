import { model } from "@medusajs/framework/utils";
import InboxThread from "./thread";

/**
 * One imported email.
 *
 * **What is stored is already safe.** `body_text` is plain text produced by
 * `lib/inbox/sanitize.ts` — an HTML-only message was reduced to text before it
 * got here, and the original HTML was discarded rather than kept "in case". A
 * column holding raw email HTML is a column somebody eventually renders.
 *
 * The same goes for attachments: `attachments` holds filename, content type and
 * size, and nothing else. The bytes are never downloaded, so there is no file
 * to serve, no path to traverse and no scanner to run.
 *
 * The two dedupe keys are `(mailbox, uid)` — unique, because IMAP guarantees a
 * UID is stable within a `UIDVALIDITY` — and `message_id`, which catches the
 * same mail arriving under a new UID after a mailbox is recreated. `message_id`
 * is deliberately **not** unique: it is attacker-controlled, and a forged
 * duplicate must not be able to make a later import fail.
 */
const InboxMessage = model
  .define("inbox_message", {
    id: model.id({ prefix: "imsg" }).primaryKey(),

    /** IMAP source coordinates. Together with `uid`, the primary dedupe key. */
    mailbox: model.text(),
    uid: model.number(),

    /** RFC 5322 headers, angle brackets stripped. Absent on some mail. */
    message_id: model.text().nullable(),
    in_reply_to: model.text().nullable(),
    /** Space-separated `References`, oldest first, capped. */
    references: model.text().nullable(),

    from_name: model.text().nullable(),
    from_email: model.text().nullable(),
    /** `[{ kind: "to" | "cc", name, email }]` — no bcc exists on inbound mail. */
    recipients: model.json().nullable(),

    subject: model.text(),
    received_at: model.dateTime(),

    /** Plain text only. Never HTML, never raw MIME. */
    body_text: model.text().default(""),
    /** Whether the body hit `INBOX_MAX_BODY_CHARS` and was cut. */
    body_truncated: model.boolean().default(false),
    /** RFC822 size as reported by the server, before any truncation. */
    size_bytes: model.number().default(0),

    /** `[{ filename, content_type, size }]` — metadata only, never content. */
    attachments: model.json().nullable(),

    /** Read *in Medusa*. Nothing here is ever written back to Hostinger. */
    is_read: model.boolean().default(false),

    thread: model.belongsTo(() => InboxThread, { mappedBy: "messages" }),
  })
  .indexes([
    { on: ["mailbox", "uid"], unique: true },
    { on: ["message_id"] },
    { on: ["in_reply_to"] },
    { on: ["received_at"] },
  ]);

export default InboxMessage;
