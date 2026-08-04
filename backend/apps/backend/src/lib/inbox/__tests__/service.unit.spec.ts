/**
 * The entry point both callers share.
 *
 * The first test in this file is the one that matters most: with
 * `INBOX_ENABLED` unset, **nothing is contacted**. Not a socket, not a
 * credential check, not a mail library import. Everything else here is about
 * the three ways a run declines to start.
 */

import { FakeImapSession, FakeInboxStore, fakeParser } from "./fixtures";
import { MANUAL_SYNC_MIN_INTERVAL_MS, runInboxSync } from "../service";

const KEYS = [
  "INBOX_ENABLED",
  "INBOX_IMAP_HOST",
  "INBOX_IMAP_USER",
  "INBOX_IMAP_PASSWORD",
  "INBOX_IMAP_MAILBOX",
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function enable() {
  process.env.INBOX_ENABLED = "true";
  process.env.INBOX_IMAP_HOST = "imap.example.test";
  process.env.INBOX_IMAP_USER = "info@example.test";
  process.env.INBOX_IMAP_PASSWORD = "not-a-real-password";
}

type LockBehaviour = "grant" | "refuse";

function container(store: FakeInboxStore, lock: LockBehaviour = "grant") {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const released: string[] = [];

  const locking = {
    acquire: jest.fn(async (key: string) => {
      if (lock === "refuse") throw new Error(`Failed to acquire lock for key "${key}"`);
    }),
    release: jest.fn(async (key: string) => {
      released.push(key);
      return true;
    }),
  };

  return {
    logger,
    locking,
    released,
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger;
        if (key === "locking") return locking;
        if (key === "inbox") return store;
        throw new Error(`unexpected resolve(${key})`);
      },
    } as never,
  };
}

describe("switched off", () => {
  /** The property the whole feature's safety rests on. */
  it("does not connect, and says so", async () => {
    const store = new FakeInboxStore();
    const context = container(store);
    const createSession = jest.fn();

    const result = await runInboxSync(context.scope, {
      trigger: "scheduled",
      createSession: createSession as never,
    });

    expect(result.status).toBe("disabled");
    expect(createSession).not.toHaveBeenCalled();
    expect(context.locking.acquire).not.toHaveBeenCalled();
    expect(store.saves).toEqual([]);
  });

  it("stays off for a value that is not exactly `true`", async () => {
    process.env.INBOX_ENABLED = "yes";
    const store = new FakeInboxStore();
    const createSession = jest.fn();

    const result = await runInboxSync(container(store).scope, {
      trigger: "manual",
      createSession: createSession as never,
    });

    expect(result.status).toBe("disabled");
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("switched on but incomplete", () => {
  it("reports misconfiguration without connecting", async () => {
    process.env.INBOX_ENABLED = "true";
    process.env.INBOX_IMAP_HOST = "imap.example.test";
    // No user, no password.

    const store = new FakeInboxStore();
    const context = container(store);
    const createSession = jest.fn();

    const result = await runInboxSync(context.scope, {
      trigger: "scheduled",
      createSession: createSession as never,
    });

    expect(result.status).toBe("misconfigured");
    expect(createSession).not.toHaveBeenCalled();
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("MISSING_USER"),
    );
  });

  it("names the problem but never a value", async () => {
    process.env.INBOX_ENABLED = "true";
    process.env.INBOX_IMAP_HOST = "imap.example.test";
    process.env.INBOX_IMAP_USER = "info@example.test";

    const context = container(new FakeInboxStore());
    await runInboxSync(context.scope, { trigger: "scheduled" });

    const logged = context.logger.warn.mock.calls.flat().join(" ");
    expect(logged).toContain("MISSING_PASSWORD");
    expect(logged).not.toContain("info@example.test");
    expect(logged).not.toContain("imap.example.test");
  });
});

describe("locking", () => {
  it("takes the lock and releases it", async () => {
    enable();
    const store = new FakeInboxStore();
    const context = container(store);

    const result = await runInboxSync(context.scope, {
      trigger: "scheduled",
      createSession: async () =>
        new FakeImapSession([], { uidValidity: "1", uidNext: 1, exists: 0 }),
      parseSource: fakeParser,
    });

    expect(result.status).toBe("ok");
    expect(context.locking.acquire).toHaveBeenCalledWith(
      "peptides:inbox:sync",
      expect.objectContaining({ expire: 600 }),
    );
    expect(context.released).toEqual(["peptides:inbox:sync"]);
  });

  /**
   * A queued sync is worthless: whoever holds the lock is importing exactly the
   * messages it would import. It declines and the scheduler comes back.
   */
  it("declines rather than waiting when another run holds it", async () => {
    enable();
    const store = new FakeInboxStore();
    const context = container(store, "refuse");
    const createSession = jest.fn();

    const result = await runInboxSync(context.scope, {
      trigger: "scheduled",
      createSession: createSession as never,
    });

    expect(result.status).toBe("locked");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("releases the lock even when the run fails", async () => {
    enable();
    const context = container(new FakeInboxStore());

    const result = await runInboxSync(context.scope, {
      trigger: "scheduled",
      createSession: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    expect(result.status).toBe("unreachable");
    expect(context.released).toEqual(["peptides:inbox:sync"]);
  });
});

describe("the manual trigger", () => {
  it("is rate-limited on top of the lock", async () => {
    enable();
    const store = new FakeInboxStore();
    await store.saveSyncState("INBOX", {
      last_synced_at: new Date(),
      initialized: true,
    });

    const context = container(store);
    const createSession = jest.fn();

    const result = await runInboxSync(context.scope, {
      trigger: "manual",
      createSession: createSession as never,
    });

    expect(result.status).toBe("throttled");
    expect(createSession).not.toHaveBeenCalled();
    expect(context.locking.acquire).not.toHaveBeenCalled();
  });

  it("runs again once the interval has passed", async () => {
    enable();
    const store = new FakeInboxStore();
    await store.saveSyncState("INBOX", {
      last_synced_at: new Date(Date.now() - MANUAL_SYNC_MIN_INTERVAL_MS - 1_000),
      initialized: true,
      last_uid: 0,
      uid_validity: "1",
    });

    const context = container(store);

    const result = await runInboxSync(context.scope, {
      trigger: "manual",
      createSession: async () =>
        new FakeImapSession([], { uidValidity: "1", uidNext: 1, exists: 0 }),
      parseSource: fakeParser,
    });

    expect(result.status).toBe("ok");
  });

  /** The scheduler is not rate-limited; its own interval is the limit. */
  it("does not rate-limit the scheduled trigger", async () => {
    enable();
    const store = new FakeInboxStore();
    await store.saveSyncState("INBOX", {
      last_synced_at: new Date(),
      initialized: true,
      last_uid: 0,
      uid_validity: "1",
    });

    const result = await runInboxSync(container(store).scope, {
      trigger: "scheduled",
      createSession: async () =>
        new FakeImapSession([], { uidValidity: "1", uidNext: 1, exists: 0 }),
      parseSource: fakeParser,
    });

    expect(result.status).toBe("ok");
  });
});

describe("the result", () => {
  it("carries counts and no configuration", async () => {
    enable();
    const store = new FakeInboxStore();

    const result = await runInboxSync(container(store).scope, {
      trigger: "scheduled",
      createSession: async () =>
        new FakeImapSession([], { uidValidity: "1", uidNext: 1, exists: 0 }),
      parseSource: fakeParser,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("not-a-real-password");
    expect(serialized).not.toContain("imap.example.test");
    expect(serialized).not.toContain("info@example.test");
    expect(Object.keys(result).sort()).toEqual(
      [
        "duplicates",
        "durationMs",
        "failed",
        "imported",
        "lastUid",
        "oversized",
        "startedAt",
        "status",
      ].sort(),
    );
  });
});
