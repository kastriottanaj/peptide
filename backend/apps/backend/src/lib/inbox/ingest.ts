/**
 * Storing one message, exactly once, in the right conversation.
 *
 * Deliberately written against `InboxStore` rather than against the Medusa
 * module: dedupe and threading are the two rules most likely to be quietly
 * broken by a later change, and testing them through a real database would
 * make the tests slow enough that they stop being run.
 *
 * **Deduplication is two-layered and both layers are needed.**
 *
 *  - `(mailbox, uid)` is authoritative within one `UIDVALIDITY`. It is what
 *    makes a crashed run safe to repeat.
 *  - `Message-ID` catches the same mail arriving under a *different* UID:
 *    after a mailbox is recreated or renumbered, or when the sender's server
 *    redelivers. It is a sender-controlled header, so it is only ever used to
 *    suppress a duplicate — never to overwrite an existing row, and never as a
 *    unique database constraint that a forged value could weaponise.
 */

import { resolveThread } from "./threading";
import type { InboxStore, NormalizedMessage } from "./types";

export type IngestOutcome = "imported" | "duplicate";

export async function ingestMessage(
  store: InboxStore,
  message: NormalizedMessage,
  now: Date = new Date(),
): Promise<IngestOutcome> {
  if (await store.findMessageByUid(message.mailbox, message.uid)) {
    return "duplicate";
  }

  if (message.message_id) {
    if (await store.findMessageByMessageId(message.message_id)) {
      return "duplicate";
    }
  }

  const { thread } = await resolveThread(store, message, now);

  const target =
    thread ??
    (await store.createThread({
      subject: message.subject || "(no subject)",
      normalized_subject: message.normalized_subject,
      last_message_at: message.received_at,
      last_sender_name: message.from_name,
      last_sender_email: message.from_email,
    }));

  // The store owns the counters. Splitting "insert the message" from "move
  // message_count" across two calls would be one more place for them to drift.
  await store.appendMessage(target.id, message);

  return "imported";
}
