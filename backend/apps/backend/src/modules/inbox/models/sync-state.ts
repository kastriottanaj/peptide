import { model } from "@medusajs/framework/utils";

/**
 * Where the importer got to, per mailbox.
 *
 * One row, and it is the only thing standing between a restart and a duplicate
 * import of the whole mailbox. Three fields carry that weight:
 *
 *  - `uid_validity` — IMAP's promise that UIDs mean the same thing as last
 *    time. When the server changes it, every stored UID is meaningless and the
 *    cursor has to be rebuilt rather than trusted.
 *  - `last_uid` — the highest UID that has been fully processed. Written after
 *    *each* message, not once per run, so an interrupted run resumes where it
 *    stopped.
 *  - `initialized` — whether the "record the position, import nothing" first
 *    run has happened. Distinct from `last_uid = 0`, which is also what an
 *    empty mailbox looks like.
 *
 * `last_status` is an operational breadcrumb (`ok`, `unreachable`, `auth`, …),
 * never a message and never a server error string.
 */
const InboxSyncState = model.define("inbox_sync_state", {
  id: model.id({ prefix: "isyn" }).primaryKey(),

  mailbox: model.text().unique(),

  uid_validity: model.text().nullable(),
  last_uid: model.number().default(0),
  initialized: model.boolean().default(false),

  /** Every attempt, successful or not. */
  last_synced_at: model.dateTime().nullable(),
  /** Only successful runs — how stale the inbox actually is. */
  last_success_at: model.dateTime().nullable(),
  last_status: model.text().nullable(),
});

export default InboxSyncState;
