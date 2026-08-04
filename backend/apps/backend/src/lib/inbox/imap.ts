/**
 * The IMAP half, behind an interface small enough to fake.
 *
 * Everything the importer is allowed to do to the mailbox is expressed by the
 * five methods on `ImapSession`: open read-only, list envelopes above a UID,
 * list envelopes since a date, download one message, close. There is no method
 * that sets a flag, moves, copies or deletes — not because someone remembered
 * not to call one, but because none exists.
 *
 * That is the whole safety argument of this feature. **This connects to the
 * company's real `info@` mailbox, the one a human reads in webmail**, so a
 * write of any kind would be visible to that person: a message silently marked
 * read is a message they never see. The mailbox is left exactly as webmail
 * shows it, unread state included.
 *
 * Three settings are not configurable and must stay that way:
 *
 *  - `rejectUnauthorized: true`. A certificate that does not verify means
 *    something is between this process and the mail server, and no environment
 *    variable should be able to wave that through.
 *  - `doSTARTTLS: true` on a non-implicit-TLS connection, so the upgrade is
 *    mandatory rather than best-effort.
 *  - `logger: false`. ImapFlow's default logger writes protocol traffic — which
 *    is to say message content and the `LOGIN` line — to stdout as JSON.
 */

import type { FetchQueryObject, ImapFlow, SearchObject } from "imapflow";
import { imapPassword, type InboxConfig } from "./config";

export type ImapAddress = { name?: string | null; address?: string | null };

/**
 * The server's own parse of the message headers.
 *
 * Only used for messages too large to download, where it is the difference
 * between "a 40 MB message arrived from this address" and a hole in the inbox.
 * For every other message the headers come from the MIME parser, which handles
 * encoded words properly.
 */
export type ImapEnvelopeHeaders = {
  subject?: string | null;
  date?: Date | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  from?: readonly ImapAddress[] | null;
  to?: readonly ImapAddress[] | null;
  cc?: readonly ImapAddress[] | null;
};

/** One message's envelope, without its body. */
export type ImapEnvelope = {
  uid: number;
  size: number;
  /** IMAP `INTERNALDATE` — when the server received it, not what the sender claimed. */
  internalDate: Date | null;
  headers: ImapEnvelopeHeaders | null;
};

export type ImapMailboxInfo = {
  uidValidity: string;
  /** UID the *next* delivered message will get; the cursor for "future only". */
  uidNext: number;
  exists: number;
};

export interface ImapSession {
  open(mailbox: string): Promise<ImapMailboxInfo>;
  /** Envelopes with `uid > sinceUid`, ascending. Never includes bodies. */
  listSince(sinceUid: number): Promise<ImapEnvelope[]>;
  /** Envelopes received on or after `since`, ascending. First-run import only. */
  listSinceDate(since: Date): Promise<ImapEnvelope[]>;
  /** Raw RFC822 source of one message. `null` if it vanished between passes. */
  download(uid: number): Promise<Buffer | null>;
  close(): Promise<void>;
}

export type ImapSessionFactory = (config: InboxConfig) => Promise<ImapSession>;

/* -------------------------------------------------------------- imapflow -- */

/**
 * `ImapFlow` is imported lazily.
 *
 * The module is only reachable from a code path that has already checked
 * `INBOX_ENABLED`, so a backend with the inbox switched off never loads a mail
 * library at all — and, more usefully, never fails to boot because of one. The
 * *types* are imported statically, which costs nothing at runtime.
 */
async function createImapFlow(config: InboxConfig): Promise<ImapFlow> {
  const { ImapFlow } = await import("imapflow");

  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: imapPassword() },

    // No protocol logging. See the file header.
    logger: false,

    // The importer polls; it must not also hold an IDLE connection open, and
    // it must not have the server push it into a second command mid-fetch.
    disableAutoIdle: true,

    // TLS verification is not negotiable.
    //
    // When `secure` is false this is a cleartext connection on 143 that has to
    // be upgraded, and `doSTARTTLS: true` makes the upgrade **mandatory**:
    // imapflow's default (`undefined`) upgrades only if the server offers it
    // and otherwise continues in the clear, which is a downgrade attack waiting
    // to happen. Setting it alongside `secure: true` is invalid, hence the
    // conditional rather than a constant.
    ...(config.secure ? {} : { doSTARTTLS: true }),
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },

    // Bounded waits: a mail server that stops answering must fail the run, not
    // hold the lock until the process restarts.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,

    clientInfo: { name: "peptides-admin-inbox" },
  });
}

/** How many envelopes one run will look at. Bounds memory and run time. */
export const MAX_ENVELOPES_PER_RUN = 200;

function toDate(value: Date | string | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const createImapSession: ImapSessionFactory = async (config) => {
  const client = await createImapFlow(config);
  await client.connect();

  let opened = false;

  // No `source` in this query. Sizes decide what may be downloaded at all, so
  // asking for bodies here would defeat the size cap before it applies.
  const envelopeQuery: FetchQueryObject = {
    uid: true,
    size: true,
    internalDate: true,
    envelope: true,
  };

  const collect = async (range: string): Promise<ImapEnvelope[]> => {
    const envelopes: ImapEnvelope[] = [];

    for await (const message of client.fetch(range, envelopeQuery, {
      uid: true,
    })) {
      envelopes.push({
        uid: message.uid,
        size: typeof message.size === "number" ? message.size : 0,
        // The server may hand back a string here; downstream wants a real date
        // or nothing, and an unparseable one is nothing.
        internalDate: toDate(message.internalDate),
        headers: message.envelope ?? null,
      });

      if (envelopes.length >= MAX_ENVELOPES_PER_RUN) break;
    }

    return envelopes.sort((a, b) => a.uid - b.uid);
  };

  return {
    async open(mailbox) {
      // Read-only. The one line that keeps Hostinger's copy untouched.
      const info = await client.mailboxOpen(mailbox, { readOnly: true });
      opened = true;

      return {
        uidValidity: String(info.uidValidity ?? ""),
        uidNext: Number(info.uidNext ?? 0),
        exists: Number(info.exists ?? 0),
      };
    },

    async listSince(sinceUid) {
      // `n:*` always returns at least one message — the last one — even when
      // nothing is above `n`. Anything at or below the cursor is dropped here;
      // dedupe would catch it anyway, but not re-reading it is cheaper.
      const from = Math.max(0, sinceUid) + 1;
      const envelopes = await collect(`${from}:*`);
      return envelopes.filter((envelope) => envelope.uid > sinceUid);
    },

    async listSinceDate(since) {
      const query: SearchObject = { since };
      const uids = await client.search(query, { uid: true });
      if (!uids || !uids.length) return [];

      const wanted = uids.sort((a, b) => a - b).slice(-MAX_ENVELOPES_PER_RUN);
      return collect(wanted.join(","));
    },

    async download(uid) {
      const message = await client.fetchOne(
        String(uid),
        { source: true },
        { uid: true },
      );

      if (!message || !message.source) return null;
      return message.source;
    },

    async close() {
      // `logout` is the polite close and can hang on a half-dead socket;
      // `close` is the guaranteed one. Both are best-effort — a failure to
      // hang up is not a failure of the run that just succeeded.
      try {
        if (opened) await client.logout();
      } catch {
        // ignored on purpose
      }
      try {
        client.close();
      } catch {
        // ignored on purpose
      }
    },
  };
};
