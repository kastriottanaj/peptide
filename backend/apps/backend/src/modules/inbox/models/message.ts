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

    /**
     * Which way the message went.
     *
     * `inbound` is imported from IMAP and has IMAP coordinates; `outbound` is a
     * reply this admin sent over SMTP and has a delivery status instead. They
     * share a table because they share a conversation — a thread read in two
     * tables is a thread that eventually renders out of order.
     */
    direction: model.enum(["inbound", "outbound"]).default("inbound"),

    /**
     * IMAP source coordinates. Together with `uid`, the primary dedupe key for
     * inbound mail. Outbound replies are not in the mailbox — nothing here is
     * written back over IMAP — so they carry the sentinel mailbox `OUTBOUND`
     * and a negative uid, which keeps the unique index meaningful without
     * pretending they have a UID.
     */
    mailbox: model.text(),
    uid: model.number(),

    /** RFC 5322 headers, angle brackets stripped. Absent on some mail. */
    message_id: model.text().nullable(),
    in_reply_to: model.text().nullable(),
    /** Space-separated `References`, oldest first, capped. */
    references: model.text().nullable(),

    from_name: model.text().nullable(),
    from_email: model.text().nullable(),
    /**
     * `Reply-To`, when the sender set one. The reply endpoint prefers it over
     * `from_email`, which is what the header is for — a mailing system that
     * sends from `noreply@` and asks for answers elsewhere is common enough
     * that ignoring it would send replies into a black hole.
     */
    reply_to: model.text().nullable(),
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

    /* ----------------------------------------------------------- outbound -- */

    /**
     * Delivery state of a reply. `null` on inbound mail, which was delivered by
     * somebody else's mail server and has no status of ours.
     *
     * The row is written as `pending` **before** the send is attempted, so a
     * process that dies mid-send leaves evidence rather than a silent gap, and
     * a failed send is never displayed as a sent one.
     */
    delivery_status: model.enum(["pending", "sent", "failed"]).nullable(),
    /** When the SMTP server accepted it. */
    sent_at: model.dateTime().nullable(),
    /**
     * Why it failed, as one of a fixed set of labels — never the SMTP server's
     * own sentence, which names the host and often the account.
     */
    failure_reason: model.text().nullable(),
    /**
     * The client's key for one logical send. Unique, so two clicks or a retried
     * request cannot become two emails; a retry with the same key reuses this
     * row rather than creating a second one.
     */
    idempotency_key: model.text().nullable(),

    thread: model.belongsTo(() => InboxThread, { mappedBy: "messages" }),
  })
  .indexes([
    { on: ["mailbox", "uid"], unique: true },
    { on: ["message_id"] },
    { on: ["in_reply_to"] },
    { on: ["received_at"] },
    { on: ["direction", "created_at"] },
    {
      on: ["idempotency_key"],
      unique: true,
      where: "idempotency_key IS NOT NULL",
    },
  ]);

export default InboxMessage;
