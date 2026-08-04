/**
 * The one entry point that runs a sync.
 *
 * Both callers — the scheduled job and the manual admin endpoint — come through
 * here, so the four things that must be true of *every* run are checked in one
 * place rather than twice:
 *
 *  1. `INBOX_ENABLED` is on. **If it is not, no socket is opened**, no mail
 *     library is even imported, and the caller gets `disabled`.
 *  2. The configuration is complete. Incomplete is reported, never guessed at.
 *  3. Nobody else is syncing. The lock is taken without waiting.
 *  4. The manual endpoint is not being hammered — a minimum interval on top of
 *     the lock, because a lock only stops *concurrent* runs, not a button
 *     pressed twenty times in a row.
 *
 * Nothing here throws. A mail server that is down, a password that was rotated
 * and a mailbox that was renamed all produce a result object with a status, and
 * the admin page keeps showing the mail it already has.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";

import { INBOX_MODULE } from "../../modules/inbox";
import type InboxModuleService from "../../modules/inbox/service";
import { inboxEnabled, resolveInboxConfig } from "./config";
import type { InboxLogger } from "./http";
import { createImapSession } from "./imap";
import { acquireInboxSyncLock } from "./lock";
import { runInboxSyncWith, type SourceParser } from "./sync";
import type { InboxSyncResult } from "./types";

/** Manual syncs may not run more often than this. */
export const MANUAL_SYNC_MIN_INTERVAL_MS = 30_000;

export type RunSyncOptions = {
  /** `manual` applies the minimum interval; `scheduled` does not. */
  trigger: "scheduled" | "manual";
  /** Test seam. Production always uses the real IMAP session and parser. */
  createSession?: typeof createImapSession;
  parseSource?: SourceParser;
  now?: () => Date;
};

/**
 * MIME parsing, isolated so the import stays lazy and the options stay
 * explained.
 *
 * `skipHtmlToText` is on so that **our** converter in `sanitize.ts` does the
 * HTML reduction — one code path, tested against the cases that matter, rather
 * than whatever a library's default happens to be this version.
 * `skipTextToHtml` and `skipImageLinks` switch off the two features that
 * *produce* HTML, which nothing here wants to exist at all.
 *
 * Attachment bytes pass through the parser's memory (bounded by
 * `INBOX_MAX_MESSAGE_BYTES`) and are discarded with the parse result. Nothing
 * writes them anywhere.
 */
const parseMimeSource: SourceParser = async (source) => {
  const { simpleParser } = await import("mailparser");

  return simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
};

function resolveLogger(container: MedusaContainer): InboxLogger {
  try {
    return container.resolve(ContainerRegistrationKeys.LOGGER) as InboxLogger;
  } catch {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
}

export async function runInboxSync(
  container: MedusaContainer,
  options: RunSyncOptions,
): Promise<InboxSyncResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();

  const idle = (status: InboxSyncResult["status"]): InboxSyncResult => ({
    status,
    imported: 0,
    duplicates: 0,
    oversized: 0,
    failed: 0,
    lastUid: 0,
    durationMs: 0,
    startedAt: startedAt.toISOString(),
  });

  // The off switch, checked before anything else. Nothing below this line runs
  // when the inbox is switched off.
  if (!inboxEnabled()) return idle("disabled");

  const resolved = resolveInboxConfig();
  const logger = resolveLogger(container);

  if (!resolved.ok) {
    // The problem code names which variable is missing, not its value.
    logger.warn(
      `[inbox] enabled but not configured (${resolved.problem}); no sync attempted`,
    );
    return idle("misconfigured");
  }

  const store = container.resolve(INBOX_MODULE) as InboxModuleService;
  const config = resolved.config;

  if (options.trigger === "manual") {
    const state = await store.getSyncState(config.mailbox);
    const last = state?.last_synced_at ? new Date(state.last_synced_at) : null;

    if (
      last &&
      startedAt.getTime() - last.getTime() < MANUAL_SYNC_MIN_INTERVAL_MS
    ) {
      return idle("throttled");
    }
  }

  const lock = await acquireInboxSyncLock(
    container,
    `inbox-sync:${process.pid}:${startedAt.getTime()}`,
  );

  if (!lock.acquired) return idle("locked");

  try {
    return await runInboxSyncWith({
      config,
      store,
      createSession: options.createSession ?? createImapSession,
      parseSource: options.parseSource ?? parseMimeSource,
      logger,
      now,
    });
  } finally {
    await lock.release();
  }
}
