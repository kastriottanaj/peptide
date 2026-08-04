/**
 * A sync run, against a fake mail server.
 *
 * **No test in this file opens a socket.** The IMAP session is a fake with a
 * list of messages; that is the point — a test suite that could reach Hostinger
 * is a test suite that eventually does.
 *
 * The cases here are the ones that decide whether this feature is safe to leave
 * running unattended: the first run must not swallow the mailbox, a restart
 * must not re-import, one bad message must not stop the rest, and a dead
 * mailbox must not throw.
 */

import {
  FakeImapSession,
  FakeInboxStore,
  fakeParser,
  mailSource,
  testConfig,
  testLogger,
  type FakeMessage,
} from "./fixtures";
import { runInboxSyncWith, type InboxSyncDeps } from "../sync";
import type { ImapMailboxInfo, ImapSession } from "../imap";
import type { InboxConfig } from "../config";

const MAILBOX_INFO: ImapMailboxInfo = {
  uidValidity: "1000",
  uidNext: 51,
  exists: 50,
};

function deps(
  overrides: {
    messages?: FakeMessage[];
    info?: Partial<ImapMailboxInfo>;
    config?: Partial<InboxConfig>;
    store?: FakeInboxStore;
    createSession?: InboxSyncDeps["createSession"];
  } = {},
) {
  const store = overrides.store ?? new FakeInboxStore();
  const logger = testLogger();
  const session = new FakeImapSession(overrides.messages ?? [], {
    ...MAILBOX_INFO,
    ...overrides.info,
  });

  const created: ImapSession[] = [];

  return {
    store,
    logger,
    session,
    created,
    deps: {
      config: { ...testConfig, ...overrides.config },
      store,
      logger,
      parseSource: fakeParser,
      createSession:
        overrides.createSession ??
        (async () => {
          created.push(session);
          return session;
        }),
    } satisfies InboxSyncDeps,
  };
}

/** A store that has already been through a first run. */
async function initialized(store: FakeInboxStore, lastUid: number) {
  await store.saveSyncState("INBOX", {
    uid_validity: "1000",
    last_uid: lastUid,
    initialized: true,
  });
  store.saves.length = 0;
  return store;
}

describe("the first run", () => {
  /**
   * The default that keeps a switch-on from swallowing a real mailbox's
   * history. It records where the mailbox is and imports nothing — including,
   * deliberately, a test mail sent before activation.
   */
  it("records the cursor and imports nothing", async () => {
    const context = deps({
      messages: [{ uid: 48, source: mailSource() }, { uid: 50, source: mailSource() }],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.status).toBe("ok");
    expect(result.imported).toBe(0);
    expect(context.store.messages).toHaveLength(0);
    expect(context.store.states.get("INBOX")).toMatchObject({
      last_uid: 50, // uidNext - 1
      initialized: true,
      uid_validity: "1000",
    });
    expect(context.session.downloaded).toEqual([]);
  });

  it("imports only messages that arrive after it", async () => {
    const context = deps({
      messages: [{ uid: 50, source: mailSource() }],
    });

    await runInboxSyncWith(context.deps);

    // A new message lands, and the next run picks up only that one.
    const second = deps({
      store: context.store,
      messages: [
        { uid: 50, source: mailSource() },
        { uid: 51, source: mailSource({ messageId: "<new@example.org>" }) },
      ],
      info: { uidNext: 52 },
    });

    const result = await runInboxSyncWith(second.deps);

    expect(result.imported).toBe(1);
    expect(second.session.downloaded).toEqual([51]);
    expect(context.store.messages.map((message) => message.uid)).toEqual([51]);
  });

  it("backfills a bounded window when explicitly opted in", async () => {
    const context = deps({
      config: { importExisting: true, importSinceDays: 14 },
      messages: [
        {
          uid: 10,
          internalDate: new Date("2020-01-01T00:00:00.000Z"),
          source: mailSource({ messageId: "<ancient@example.org>" }),
        },
        {
          uid: 49,
          internalDate: new Date(),
          source: mailSource({ messageId: "<recent@example.org>" }),
        },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(1);
    expect(context.store.messages.map((message) => message.uid)).toEqual([49]);
  });
});

describe("incremental runs", () => {
  it("asks only for UIDs above the cursor", async () => {
    const store = await initialized(new FakeInboxStore(), 40);
    const context = deps({
      store,
      messages: [
        { uid: 39, source: mailSource({ messageId: "<old@example.org>" }) },
        { uid: 41, source: mailSource({ messageId: "<a@example.org>" }) },
        { uid: 42, source: mailSource({ messageId: "<b@example.org>" }) },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(2);
    expect(context.session.downloaded).toEqual([41, 42]);
    expect(result.lastUid).toBe(42);
  });

  /**
   * The cursor is written per message, not per batch, so a process killed
   * halfway through a backlog resumes rather than starting over.
   */
  it("persists the cursor after every message", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      messages: [
        { uid: 1, source: mailSource({ messageId: "<a@x>" }) },
        { uid: 2, source: mailSource({ messageId: "<b@x>" }) },
        { uid: 3, source: mailSource({ messageId: "<c@x>" }) },
      ],
    });

    await runInboxSyncWith(context.deps);

    const cursors = context.store.saves
      .map((save) => save.last_uid)
      .filter((value): value is number => typeof value === "number");

    expect(cursors).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it("does not re-import after a restart", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const messages = [
      { uid: 1, source: mailSource({ messageId: "<a@x>" }) },
      { uid: 2, source: mailSource({ messageId: "<b@x>" }) },
    ];

    await runInboxSyncWith(deps({ store, messages }).deps);
    const second = deps({ store, messages });
    const result = await runInboxSyncWith(second.deps);

    expect(result.imported).toBe(0);
    expect(second.session.downloaded).toEqual([]);
    expect(store.messages).toHaveLength(2);
  });

  /**
   * Belt and braces: even if the same UIDs are offered again — a cursor lost,
   * a mailbox replayed — dedupe refuses them.
   */
  it("deduplicates when the same messages are offered again", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const messages = [{ uid: 1, source: mailSource({ messageId: "<a@x>" }) }];

    await runInboxSyncWith(deps({ store, messages }).deps);
    await store.saveSyncState("INBOX", { last_uid: 0 });

    const result = await runInboxSyncWith(deps({ store, messages }).deps);

    expect(result.duplicates).toBe(1);
    expect(result.imported).toBe(0);
    expect(store.messages).toHaveLength(1);
  });
});

describe("bad input", () => {
  it("skips a malformed message and keeps going", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      messages: [
        { uid: 1, source: mailSource({ messageId: "<a@x>" }) },
        { uid: 2, source: "throw" },
        { uid: 3, source: mailSource({ messageId: "<c@x>" }) },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(2);
    expect(result.failed).toBe(1);
    // The cursor moved past the bad one: a single unreadable message must not
    // wedge the inbox behind it forever.
    expect(result.lastUid).toBe(3);
  });

  it("logs nothing but a UID and an error kind for a bad message", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({ store, messages: [{ uid: 7, source: "throw" }] });

    await runInboxSyncWith(context.deps);

    const logged = context.logger.warn.mock.calls.flat().join(" ");
    expect(logged).toContain("uid=7");
    expect(logged).toContain("SyntaxError");
    expect(logged).not.toContain("unparseable message");
  });

  /**
   * Oversized mail is recorded from its envelope rather than downloaded: the
   * fact that it arrived is kept, the bytes are not pulled through this
   * process, and the mail stays readable in Hostinger.
   */
  it("records an oversized message without downloading it", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      config: { maxMessageBytes: 1_000 },
      messages: [
        {
          uid: 5,
          size: 40 * 1024 * 1024,
          headers: {
            subject: "Große Datei",
            messageId: "<big@example.org>",
            from: [{ name: "Sender", address: "sender@example.org" }],
            date: new Date("2026-08-01T10:00:00.000Z"),
          },
        },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(1);
    expect(result.oversized).toBe(1);
    expect(context.session.downloaded).toEqual([]);

    const [stored] = context.store.messages;
    expect(stored.subject).toBe("Große Datei");
    expect(stored.body_text).toContain("above the import size limit");
    expect(stored.from_email).toBe("sender@example.org");
  });

  it("truncates an oversized body rather than storing it whole", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      config: { maxBodyChars: 50 },
      messages: [
        {
          uid: 1,
          source: mailSource({ messageId: "<long@x>", text: "x".repeat(5_000) }),
        },
      ],
    });

    await runInboxSyncWith(context.deps);

    const [stored] = context.store.messages;
    expect(stored.body_truncated).toBe(true);
    expect(stored.body_text.length).toBeLessThan(200);
  });

  it("counts a message that vanished between the two passes", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({ store, messages: [{ uid: 1, source: null }] });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
  });
});

describe("failure modes", () => {
  it("reports an unreachable mailbox instead of throwing", async () => {
    const context = deps({
      createSession: async () => {
        const error: NodeJS.ErrnoException = new Error("connect ECONNREFUSED");
        error.code = "ECONNREFUSED";
        throw error;
      },
    });

    const result = await runInboxSyncWith({
      ...context.deps,
      sleep: async () => {},
    });

    expect(result.status).toBe("unreachable");
    expect(context.logger.warn).toHaveBeenCalledWith(
      "[inbox] mailbox unreachable (unreachable)",
    );
  });

  it("retries a transient failure with bounded backoff", async () => {
    let attempts = 0;
    const session = new FakeImapSession([], MAILBOX_INFO);

    const context = deps({
      createSession: async () => {
        attempts += 1;
        if (attempts < 3) {
          const error: NodeJS.ErrnoException = new Error("reset");
          error.code = "ECONNRESET";
          throw error;
        }
        return session;
      },
    });

    const waits: number[] = [];
    const result = await runInboxSyncWith({
      ...context.deps,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(attempts).toBe(3);
    expect(waits).toEqual([250, 1_000]);
    expect(result.status).toBe("ok");
  });

  /** A rejected password is rejected just as hard the second time. */
  it("does not retry an authentication failure", async () => {
    let attempts = 0;

    const context = deps({
      createSession: async () => {
        attempts += 1;
        throw new Error(
          "Authentication failed. [AUTHENTICATIONFAILED] for info@example.test",
        );
      },
    });

    const result = await runInboxSyncWith({
      ...context.deps,
      sleep: async () => {},
    });

    expect(attempts).toBe(1);
    expect(result.status).toBe("unreachable");
    expect(context.logger.warn).toHaveBeenCalledWith(
      "[inbox] mailbox unreachable (auth)",
    );
  });

  it("never puts the mail server's answer in a log line", async () => {
    const context = deps({
      createSession: async () => {
        throw new Error(
          "imap.hostinger.com says: [AUTHENTICATIONFAILED] Invalid credentials for info@peptideeinkaufen.de",
        );
      },
    });

    await runInboxSyncWith({ ...context.deps, sleep: async () => {} });

    const logged = [
      ...context.logger.warn.mock.calls,
      ...context.logger.error.mock.calls,
      ...context.logger.info.mock.calls,
    ]
      .flat()
      .join(" ");

    expect(logged).not.toContain("hostinger");
    expect(logged).not.toContain("peptideeinkaufen.de");
    expect(logged).not.toContain("Invalid credentials");
  });

  it("closes the session even when the run fails", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({ store });

    jest
      .spyOn(context.session, "listSince")
      .mockRejectedValueOnce(new Error("boom"));

    const result = await runInboxSyncWith(context.deps);

    expect(result.status).toBe("unreachable");
    expect(context.session.closed).toBe(1);
  });

  it("rebuilds the cursor when UIDVALIDITY changes, without re-importing", async () => {
    const store = await initialized(new FakeInboxStore(), 40);
    const context = deps({
      store,
      info: { uidValidity: "2000", uidNext: 11 },
      messages: [{ uid: 5, source: mailSource() }],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.imported).toBe(0);
    expect(store.states.get("INBOX")).toMatchObject({
      uid_validity: "2000",
      last_uid: 10,
      last_status: "uidvalidity-reset",
    });
    expect(context.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("UIDVALIDITY changed"),
    );
  });
});

describe("the mailbox is never modified", () => {
  /**
   * Not an assertion about a call — an assertion about the *interface*. The
   * session type has no method that could set a flag, move or delete, so the
   * importer cannot do it by accident in some future refactor.
   */
  it("offers no method that could write to the mailbox", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({ store, messages: [{ uid: 1, source: mailSource() }] });

    await runInboxSyncWith(context.deps);

    const surface = Object.keys(context.session).concat(
      Object.getOwnPropertyNames(Object.getPrototypeOf(context.session)),
    );

    for (const forbidden of [
      "setFlags",
      "addFlags",
      "removeFlags",
      "messageFlagsAdd",
      "messageDelete",
      "messageMove",
      "messageCopy",
      "expunge",
      "append",
    ]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("opens the configured mailbox exactly once per run", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({ store, config: { mailbox: "INBOX/Archive" } });

    await runInboxSyncWith(context.deps);

    expect(context.session.opened).toEqual(["INBOX/Archive"]);
  });
});

describe("retention", () => {
  it("does nothing when it is not configured", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      messages: [
        {
          uid: 1,
          source: mailSource({
            messageId: "<old@x>",
            date: "2019-01-01T00:00:00.000Z",
          }),
          internalDate: new Date("2019-01-01T00:00:00.000Z"),
        },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.purged).toBeUndefined();
    expect(context.store.messages).toHaveLength(1);
  });

  it("removes messages past the window when it is", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      config: { retentionDays: 30 },
      messages: [
        {
          uid: 1,
          source: mailSource({
            messageId: "<old@x>",
            date: "2019-01-01T00:00:00.000Z",
          }),
          internalDate: new Date("2019-01-01T00:00:00.000Z"),
        },
      ],
    });

    const result = await runInboxSyncWith(context.deps);

    expect(result.purged).toEqual({ messages: 1, threads: 1 });
    expect(context.store.messages).toHaveLength(0);
  });
});

describe("what gets logged", () => {
  it("reports counts and a duration, and no message content", async () => {
    const store = await initialized(new FakeInboxStore(), 0);
    const context = deps({
      store,
      messages: [
        {
          uid: 1,
          source: mailSource({
            messageId: "<a@x>",
            subject: "Sehr vertrauliche Anfrage",
            text: "Meine Adresse lautet Musterstraße 1",
            from: [{ value: [{ name: "Max Muster", address: "max@example.org" }] }],
          }),
        },
      ],
    });

    const result = await runInboxSyncWith(context.deps);
    const logged = context.logger.info.mock.calls.flat().join(" ");

    expect(result.imported).toBe(1);
    expect(logged).toContain("imported=1");
    expect(logged).toMatch(/took=\d+ms/);

    for (const secret of [
      "Sehr vertrauliche Anfrage",
      "Musterstraße",
      "max@example.org",
      "Max Muster",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
