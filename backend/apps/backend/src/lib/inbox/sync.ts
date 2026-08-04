/**
 * One import run.
 *
 * The shape of this file is dictated by what must be true after it, in every
 * failure mode:
 *
 *  - **The mailbox is unchanged.** Read-only, no flags, no deletes. Enforced by
 *    `imap.ts` offering no method that could do otherwise.
 *  - **Nothing is imported twice.** The cursor is written after *each* message,
 *    and dedupe covers the overlap when a run dies between the write and the
 *    next one.
 *  - **The whole mailbox is never swallowed by accident.** A first run with
 *    `INBOX_IMPORT_EXISTING=false` records the position and imports nothing.
 *  - **One bad message does not stop the run**, and no failure escapes as an
 *    unhandled rejection. A mailbox that is down is a log line.
 *  - **Nothing sensitive is logged.** Counts, a UID, a duration, a coarse
 *    failure label. No subject, no address, no body, no password.
 *
 * Everything the run touches arrives as an argument. That is what lets the
 * tests drive first-run behaviour, oversized messages, malformed MIME, a dead
 * server and a held lock without a mail server or a database in sight.
 */

import { imapFailureLabel, isTransientImapFailure } from "./errors";
import type { InboxConfig } from "./config";
import type { InboxLogger } from "./http";
import { ingestMessage } from "./ingest";
import type { ImapEnvelope, ImapSession, ImapSessionFactory } from "./imap";
import {
  normalizeParsedMessage,
  oversizedPlaceholderBody,
  type ParsedMailLike,
} from "./parse";
import type { InboxStore, InboxSyncResult } from "./types";

export type SourceParser = (source: Buffer) => Promise<ParsedMailLike>;

export type InboxSyncDeps = {
  config: InboxConfig;
  store: InboxStore;
  createSession: ImapSessionFactory;
  parseSource: SourceParser;
  logger: InboxLogger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/** Connection attempts per run, and the waits between them. */
const CONNECT_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1_000];

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

function emptyResult(
  status: InboxSyncResult["status"],
  startedAt: Date,
  lastUid = 0,
): InboxSyncResult {
  return {
    status,
    imported: 0,
    duplicates: 0,
    oversized: 0,
    failed: 0,
    lastUid,
    durationMs: 0,
    startedAt: startedAt.toISOString(),
  };
}

/**
 * Connect and open the mailbox, retrying only what is worth retrying.
 *
 * A refused socket or a reset connection is worth one more try; a rejected
 * password is not — retrying it walks the account towards the provider's
 * lockout and cannot succeed in the meantime.
 */
async function connectAndOpen(
  deps: InboxSyncDeps,
): Promise<{ session: ImapSession; uidValidity: string; uidNext: number }> {
  const sleep = deps.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    let session: ImapSession | null = null;

    try {
      session = await deps.createSession(deps.config);
      const info = await session.open(deps.config.mailbox);
      return {
        session,
        uidValidity: info.uidValidity,
        uidNext: info.uidNext,
      };
    } catch (error) {
      lastError = error;
      if (session) await session.close().catch(() => {});
      if (!isTransientImapFailure(error) || attempt === CONNECT_ATTEMPTS - 1) {
        break;
      }
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }

  throw lastError ?? new Error("inbox: connection failed");
}

/** The IMAP envelope, in the shape the normaliser already understands. */
function parsedFromEnvelope(
  envelope: ImapEnvelope,
  placeholder: string,
): ParsedMailLike {
  const headers = envelope.headers ?? {};

  return {
    messageId: headers.messageId ?? null,
    inReplyTo: headers.inReplyTo ?? null,
    references: null,
    subject: headers.subject ?? "",
    date: headers.date ?? null,
    from: [{ value: headers.from ?? [] }],
    to: [{ value: headers.to ?? [] }],
    cc: [{ value: headers.cc ?? [] }],
    text: placeholder,
    html: null,
    attachments: [],
  };
}

export async function runInboxSyncWith(
  deps: InboxSyncDeps,
): Promise<InboxSyncResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const { config, store, logger } = deps;
  const mailbox = config.mailbox;

  let session: ImapSession | null = null;
  let opened: { uidValidity: string; uidNext: number };

  try {
    const connection = await connectAndOpen(deps);
    session = connection.session;
    opened = { uidValidity: connection.uidValidity, uidNext: connection.uidNext };
  } catch (error) {
    const label = imapFailureLabel(error);
    // The label, never the error. `String(error)` here would put the host, the
    // mailbox and often the account name in the log.
    logger.warn(`[inbox] mailbox unreachable (${label})`);
    await store
      .saveSyncState(mailbox, { last_synced_at: startedAt, last_status: label })
      .catch(() => {});

    return { ...emptyResult("unreachable", startedAt), durationMs: elapsed(startedAt, now) };
  }

  try {
    const state = await store.getSyncState(mailbox);

    /* --------------------------------------------------- first run ------ */

    if (!state?.initialized) {
      if (!config.importExisting) {
        // The whole point of the default. `uidNext - 1` is "everything that
        // exists right now is already accounted for"; the next delivery is the
        // first message this inbox will ever show.
        const cursor = Math.max(0, opened.uidNext - 1);

        await store.saveSyncState(mailbox, {
          uid_validity: opened.uidValidity,
          last_uid: cursor,
          initialized: true,
          last_synced_at: startedAt,
          last_success_at: startedAt,
          last_status: "ok",
        });

        logger.info(
          `[inbox] first run: recorded mailbox position uid=${cursor}, importing future messages only`,
        );

        return {
          ...emptyResult("ok", startedAt, cursor),
          durationMs: elapsed(startedAt, now),
        };
      }

      // Opted in: a bounded backfill, not the whole mailbox.
      const since = new Date(
        startedAt.getTime() - config.importSinceDays * 24 * 60 * 60 * 1000,
      );

      const envelopes = await session.listSinceDate(since);
      const result = await importEnvelopes(deps, session, envelopes, 0, now);

      await store.saveSyncState(mailbox, {
        uid_validity: opened.uidValidity,
        last_uid: result.lastUid,
        initialized: true,
        last_synced_at: startedAt,
        last_success_at: now(),
        last_status: "ok",
      });

      return finish(result, startedAt, now, logger);
    }

    /* ------------------------------------------------- uid validity ----- */

    if (state.uid_validity && state.uid_validity !== opened.uidValidity) {
      // Every stored UID now refers to a different message. Re-importing the
      // mailbox would be the other option; it is not taken, because a mailbox
      // whose UIDVALIDITY changed is usually one that was recreated, and mail
      // already imported is still here. The cursor is rebuilt from the current
      // position and the gap is a documented manual step.
      const cursor = Math.max(0, opened.uidNext - 1);

      logger.warn(
        `[inbox] UIDVALIDITY changed; cursor rebuilt at uid=${cursor}, history not re-imported`,
      );

      await store.saveSyncState(mailbox, {
        uid_validity: opened.uidValidity,
        last_uid: cursor,
        last_synced_at: startedAt,
        last_success_at: now(),
        last_status: "uidvalidity-reset",
      });

      return {
        ...emptyResult("ok", startedAt, cursor),
        durationMs: elapsed(startedAt, now),
      };
    }

    /* ---------------------------------------------------- normal run ---- */

    const envelopes = await session.listSince(state.last_uid);
    const result = await importEnvelopes(
      deps,
      session,
      envelopes,
      state.last_uid,
      now,
    );

    await store.saveSyncState(mailbox, {
      uid_validity: opened.uidValidity,
      last_uid: result.lastUid,
      last_synced_at: startedAt,
      last_success_at: now(),
      last_status: "ok",
    });

    const finished = finish(result, startedAt, now, logger);

    /* ----------------------------------------------------- retention ---- */

    if (config.retentionDays !== null) {
      const cutoff = new Date(
        now().getTime() - config.retentionDays * 24 * 60 * 60 * 1000,
      );
      const purged = await store.purgeBefore(cutoff);
      if (purged.messages || purged.threads) {
        logger.info(
          `[inbox] retention: removed ${purged.messages} message(s), ${purged.threads} thread(s) older than ${config.retentionDays}d`,
        );
      }
      return { ...finished, purged };
    }

    return finished;
  } catch (error) {
    const label = imapFailureLabel(error);
    logger.warn(`[inbox] sync failed (${label})`);
    await store
      .saveSyncState(mailbox, { last_synced_at: startedAt, last_status: label })
      .catch(() => {});

    return {
      ...emptyResult("unreachable", startedAt),
      durationMs: elapsed(startedAt, now),
    };
  } finally {
    await session?.close().catch(() => {});
  }
}

type ImportTally = {
  imported: number;
  duplicates: number;
  oversized: number;
  failed: number;
  lastUid: number;
};

/**
 * Import a batch, in UID order, one message at a time.
 *
 * The cursor is persisted after every message rather than at the end of the
 * batch. That costs one small write per message and buys the property that a
 * process killed halfway through a hundred-message backlog resumes at
 * ninety-nine rather than starting over.
 *
 * A message that cannot be parsed advances the cursor anyway. Losing one
 * unreadable message is a bounded, visible failure; blocking the cursor on it
 * would wedge the entire inbox behind a single malformed mail forever.
 */
async function importEnvelopes(
  deps: InboxSyncDeps,
  session: ImapSession,
  envelopes: ImapEnvelope[],
  startUid: number,
  now: () => Date,
): Promise<ImportTally> {
  const { config, store, logger } = deps;
  const tally: ImportTally = {
    imported: 0,
    duplicates: 0,
    oversized: 0,
    failed: 0,
    lastUid: startUid,
  };

  for (const envelope of envelopes) {
    try {
      const oversized = envelope.size > config.maxMessageBytes;

      const parsed = oversized
        ? parsedFromEnvelope(envelope, oversizedPlaceholderBody(envelope.size))
        : await downloadAndParse(deps, session, envelope);

      if (!parsed) {
        // Gone between the two passes — deleted or moved in Hostinger while
        // this ran. Not an error, and not something to retry.
        tally.failed += 1;
      } else {
        const message = normalizeParsedMessage({
          mailbox: config.mailbox,
          uid: envelope.uid,
          parsed,
          internalDate: envelope.internalDate,
          sizeBytes: envelope.size,
          maxBodyChars: config.maxBodyChars,
          now: now(),
        });

        const outcome = await ingestMessage(store, message, now());
        if (outcome === "imported") tally.imported += 1;
        else tally.duplicates += 1;

        if (oversized) tally.oversized += 1;
      }
    } catch (error) {
      // The error's *name* only. A parser error message can carry a fragment of
      // the message it choked on, which is exactly what must not be logged.
      const kind = error instanceof Error ? error.name : "unknown";
      logger.warn(`[inbox] skipped uid=${envelope.uid} (${kind})`);
      tally.failed += 1;
    }

    tally.lastUid = Math.max(tally.lastUid, envelope.uid);
    await store.saveSyncState(config.mailbox, { last_uid: tally.lastUid });
  }

  return tally;
}

async function downloadAndParse(
  deps: InboxSyncDeps,
  session: ImapSession,
  envelope: ImapEnvelope,
): Promise<ParsedMailLike | null> {
  const source = await session.download(envelope.uid);
  if (!source) return null;

  // A server that lies about `size` — or a message that grew between the two
  // passes — must not get past the cap by the back door.
  if (source.length > deps.config.maxMessageBytes) {
    return parsedFromEnvelope(envelope, oversizedPlaceholderBody(source.length));
  }

  return deps.parseSource(source);
}

function elapsed(startedAt: Date, now: () => Date): number {
  return Math.max(0, now().getTime() - startedAt.getTime());
}

function finish(
  tally: ImportTally,
  startedAt: Date,
  now: () => Date,
  logger: InboxLogger,
): InboxSyncResult {
  const result: InboxSyncResult = {
    status: "ok",
    imported: tally.imported,
    duplicates: tally.duplicates,
    oversized: tally.oversized,
    failed: tally.failed,
    lastUid: tally.lastUid,
    durationMs: elapsed(startedAt, now),
    startedAt: startedAt.toISOString(),
  };

  // The only routine log line. Counts and a duration — nothing that identifies
  // a sender or a message.
  if (result.imported || result.failed || result.oversized) {
    logger.info(
      `[inbox] sync ok imported=${result.imported} duplicates=${result.duplicates} ` +
        `oversized=${result.oversized} failed=${result.failed} ` +
        `lastUid=${result.lastUid} took=${result.durationMs}ms`,
    );
  }

  return result;
}
