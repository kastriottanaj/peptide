/**
 * One sync at a time, across processes.
 *
 * An in-process boolean would be enough today — the deploy runs a single Medusa
 * instance — and would be wrong the moment a second one starts, because both
 * would import the same UIDs at the same moment and race on the cursor. The
 * duplicates would be caught, the cursor would not be.
 *
 * So this uses Medusa's **Locking module**, which is already registered in
 * every Medusa v2 application. Its default provider is in-memory; swapping it
 * for `@medusajs/locking-redis` or `@medusajs/locking-postgres` in
 * `medusa-config.ts` makes the same lock distributed **without touching this
 * file** — see `docs/inbox.md`.
 *
 * `acquire` is used rather than `execute` deliberately. `execute` *queues*:
 * it waits up to its timeout for the lock to free up. A queued sync is
 * worthless — whoever holds the lock is importing exactly the messages the
 * queued run would import, so it would wait, wake up and find nothing to do.
 * The right answer to a busy mailbox is to come back in five minutes, which is
 * what the scheduler does for free.
 */

import { Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";

export const INBOX_SYNC_LOCK_KEY = "peptides:inbox:sync";

/**
 * Lock lifetime.
 *
 * Long enough for a slow run over a 200-message batch, short enough that a
 * process killed mid-run does not lock the inbox out for an hour. The lock is
 * released in a `finally` on every normal path; this expiry is only for the
 * abnormal ones.
 */
export const INBOX_SYNC_LOCK_TTL_SECONDS = 600;

export type InboxLock = {
  /** Whether this caller now owns the lock. */
  acquired: boolean;
  release(): Promise<void>;
};

type LockingService = {
  acquire(
    keys: string | string[],
    args?: { ownerId?: string | null; expire?: number },
  ): Promise<void>;
  release(
    keys: string | string[],
    args?: { ownerId?: string | null },
  ): Promise<boolean>;
};

function resolveLocking(container: MedusaContainer): LockingService | null {
  try {
    return container.resolve(Modules.LOCKING) as unknown as LockingService;
  } catch {
    // A Medusa application without the Locking module registered is not a
    // configuration this project ships, but a missing lock must degrade to
    // "run anyway" rather than take the importer down. The single-instance
    // deploy is still protected by the scheduler not overlapping itself.
    return null;
  }
}

/**
 * Try to take the sync lock without waiting.
 *
 * Any failure to acquire — held by another run, or a provider that is itself
 * unhappy — is reported as "not acquired". Guessing that an error means the
 * lock is free is how two importers end up running.
 */
export async function acquireInboxSyncLock(
  container: MedusaContainer,
  ownerId: string,
): Promise<InboxLock> {
  const locking = resolveLocking(container);

  if (!locking) {
    return { acquired: true, release: async () => {} };
  }

  try {
    await locking.acquire(INBOX_SYNC_LOCK_KEY, {
      ownerId,
      expire: INBOX_SYNC_LOCK_TTL_SECONDS,
    });
  } catch {
    return { acquired: false, release: async () => {} };
  }

  return {
    acquired: true,
    release: async () => {
      try {
        await locking.release(INBOX_SYNC_LOCK_KEY, { ownerId });
      } catch {
        // The lock expires on its own; failing to release is not worth
        // failing a completed import over.
      }
    },
  };
}
