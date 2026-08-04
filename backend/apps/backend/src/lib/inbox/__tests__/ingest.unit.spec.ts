/**
 * Deduplication and grouping, over a working store.
 *
 * Both dedupe layers are exercised through `ingestMessage` rather than by
 * asserting which lookup ran: what matters is that the same mail cannot end up
 * in the inbox twice, whichever way it arrives a second time.
 */

import { FakeInboxStore } from "./fixtures";
import { ingestMessage } from "../ingest";
import { normalizeSubject } from "../threading";
import type { NormalizedMessage } from "../types";

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  const subject = overrides.subject ?? "Anfrage Peptid";

  return {
    mailbox: "INBOX",
    uid: 1,
    message_id: "m1@example.org",
    in_reply_to: null,
    references: [],
    from_name: "A Sender",
    from_email: "sender@example.org",
    recipients: [{ kind: "to", name: null, email: "info@example.org" }],
    subject,
    normalized_subject: normalizeSubject(subject),
    received_at: new Date("2026-08-01T10:00:00.000Z"),
    body_text: "Guten Tag",
    body_truncated: false,
    size_bytes: 500,
    attachments: [],
    ...overrides,
  };
}

describe("deduplication", () => {
  it("imports a message once", async () => {
    const store = new FakeInboxStore();
    expect(await ingestMessage(store, message())).toBe("imported");
    expect(store.messages).toHaveLength(1);
  });

  it("refuses the same mailbox and UID twice", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message());

    expect(await ingestMessage(store, message())).toBe("duplicate");
    expect(store.messages).toHaveLength(1);
  });

  /**
   * The case UID dedupe cannot catch: the same mail delivered again under a new
   * UID, after a mailbox is recreated or the sending server redelivers.
   */
  it("refuses the same Message-ID under a different UID", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1 }));

    expect(await ingestMessage(store, message({ uid: 999 }))).toBe("duplicate");
    expect(store.messages).toHaveLength(1);
  });

  it("treats the same UID in a different mailbox as a different message", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, message_id: "a@x" }));

    expect(
      await ingestMessage(
        store,
        message({ uid: 1, mailbox: "Archive", message_id: "b@x" }),
      ),
    ).toBe("imported");
  });

  /** Mail without a Message-ID is legal, and must not collapse into one row. */
  it("imports messages that carry no Message-ID at all", async () => {
    const store = new FakeInboxStore();

    await ingestMessage(store, message({ uid: 1, message_id: null }));
    await ingestMessage(store, message({ uid: 2, message_id: null }));

    expect(store.messages).toHaveLength(2);
  });
});

describe("grouping", () => {
  it("puts a reply in the thread it answers", async () => {
    const store = new FakeInboxStore();

    await ingestMessage(store, message({ uid: 1, message_id: "root@x" }));
    await ingestMessage(
      store,
      message({
        uid: 2,
        message_id: "reply@x",
        in_reply_to: "root@x",
        subject: "AW: Anfrage Peptid",
        from_email: "info@example.org",
        received_at: new Date("2026-08-01T11:00:00.000Z"),
      }),
    );

    expect(Object.keys(store.grouped())).toHaveLength(1);
    expect(store.threads.size).toBe(1);
  });

  it("starts a new thread for an unrelated sender with the same subject", async () => {
    const store = new FakeInboxStore();

    await ingestMessage(store, message({ uid: 1, message_id: "a@x" }));
    await ingestMessage(
      store,
      message({ uid: 2, message_id: "b@x", from_email: "stranger@example.com" }),
    );

    expect(store.threads.size).toBe(2);
  });

  it("counts messages and unread state on the thread", async () => {
    const store = new FakeInboxStore();

    await ingestMessage(store, message({ uid: 1, message_id: "a@x" }));
    await ingestMessage(
      store,
      message({
        uid: 2,
        message_id: "b@x",
        in_reply_to: "a@x",
        received_at: new Date("2026-08-02T10:00:00.000Z"),
      }),
    );

    const [thread] = [...store.threads.values()];
    expect(thread.message_count).toBe(2);
    expect(thread.unread_count).toBe(2);
    expect(thread.last_message_at.toISOString()).toBe(
      "2026-08-02T10:00:00.000Z",
    );
  });

  it("reopens a resolved thread when a reply arrives", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, message_id: "a@x" }));

    const [thread] = [...store.threads.values()];
    thread.status = "resolved";

    await ingestMessage(
      store,
      message({ uid: 2, message_id: "b@x", in_reply_to: "a@x" }),
    );

    expect(thread.status).toBe("open");
  });

  /**
   * A thread flagged spam stays flagged. That is a judgement about the sender,
   * and re-raising it on every follow-up would make the flag worthless.
   */
  it("leaves a spam thread flagged when the sender writes again", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, message_id: "a@x" }));

    const [thread] = [...store.threads.values()];
    thread.status = "spam";

    await ingestMessage(
      store,
      message({ uid: 2, message_id: "b@x", in_reply_to: "a@x" }),
    );

    expect(thread.status).toBe("spam");
  });
});
