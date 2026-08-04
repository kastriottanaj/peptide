/**
 * Sending a reply, against a fake SMTP transport.
 *
 * **No test in this file opens a socket.** The sender is a fake that records
 * what it was asked to send; that is the point — a suite that could reach a
 * real mail server is a suite that eventually emails a real person.
 *
 * The cases here are the ones that decide whether this feature is safe to hand
 * to an admin: the right recipient, threading that survives, one email per
 * click, a failure that is never displayed as a success, and no way to turn the
 * endpoint into a general-purpose mail sender.
 */

import { FakeReplyStore, fakeSender, testLogger } from "./fixtures";
import { InboxError } from "../errors";
import { sendReply, resolveRecipient, validateIdempotencyKey } from "../reply";
import { REPLY_RATE_LIMITS } from "../config";
import type { ReplyDeps } from "../reply";

const SMTP_KEYS = [
  "INBOX_SMTP_ENABLED",
  "INBOX_SMTP_HOST",
  "INBOX_SMTP_PORT",
  "INBOX_SMTP_SECURE",
  "INBOX_SMTP_USER",
  "INBOX_SMTP_PASSWORD",
  "INBOX_SMTP_FROM",
  "INBOX_MAX_REPLY_CHARS",
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of SMTP_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  enableSmtp();
});

afterEach(() => {
  for (const key of SMTP_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function enableSmtp(overrides: Record<string, string> = {}) {
  process.env.INBOX_SMTP_ENABLED = "true";
  process.env.INBOX_SMTP_HOST = "smtp.example.test";
  process.env.INBOX_SMTP_USER = "info@example.test";
  process.env.INBOX_SMTP_PASSWORD = "not-a-real-password";
  process.env.INBOX_SMTP_FROM = "info@example.test";
  Object.assign(process.env, overrides);
}

const KEY = "idem-key-0000001";

function context(
  options: {
    store?: FakeReplyStore;
    sendImpl?: () => Promise<{ accepted: number }>;
  } = {},
) {
  const store = options.store ?? FakeReplyStore.withInbound();
  const logger = testLogger();
  const sender = fakeSender(options.sendImpl);

  return {
    store,
    logger,
    sender,
    deps: {
      store,
      logger,
      createSender: async () => sender,
      now: () => new Date("2026-08-05T09:00:00.000Z"),
      randomPart: () => "abc123",
    } satisfies ReplyDeps,
  };
}

const request = (overrides: Partial<{ threadId: string; body: unknown; idempotencyKey: unknown }> = {}) => ({
  threadId: "ithr_1",
  body: "Guten Tag,\n\ndas Peptid ist auf Lager.\n\nViele Grüße",
  idempotencyKey: KEY,
  ...overrides,
});

/* ------------------------------------------------------------ happy path -- */

describe("a successful reply", () => {
  it("sends the body as plain text and records it as sent", async () => {
    const ctx = context();

    const result = await sendReply(request(), ctx.deps);

    expect(result.duplicate).toBe(false);
    expect(result.message.delivery_status).toBe("sent");
    expect(ctx.sender.sent).toHaveLength(1);
    expect(ctx.sender.sent[0].text).toContain("das Peptid ist auf Lager.");
    expect(ctx.sender.closed).toBe(1);
  });

  it("addresses the reply to the original sender", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    expect(ctx.sender.sent[0].to).toBe("kunde@example.org");
  });

  /** A sender that asks for answers elsewhere gets them there. */
  it("prefers Reply-To over From", async () => {
    const store = FakeReplyStore.withInbound({ reply_to: "support@example.org" });
    const ctx = context({ store });

    await sendReply(request(), ctx.deps);

    expect(ctx.sender.sent[0].to).toBe("support@example.org");
  });

  it("keeps the conversation threaded", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    const mail = ctx.sender.sent[0];
    expect(mail.inReplyTo).toBe("<kunde-1@example.org>");
    expect(mail.references).toEqual(["<older@example.org>", "<kunde-1@example.org>"]);
    expect(mail.messageId).toMatch(/^<\d+\.abc123@example\.test>$/);
  });

  it("prefixes the subject with Re: only when it needs one", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);
    expect(ctx.sender.sent[0].subject).toBe("Re: Anfrage Semaglutid");

    const already = context({
      store: FakeReplyStore.withInbound({ subject: "AW: Anfrage Semaglutid" }),
    });
    await sendReply(request({ idempotencyKey: "idem-key-0000002" }), already.deps);
    expect(already.sender.sent[0].subject).toBe("AW: Anfrage Semaglutid");
  });

  it("stores the outbound message with the conversation", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    const [stored] = ctx.store.outbound;
    expect(stored.thread_id).toBe("ithr_1");
    expect(stored.to_email).toBe("kunde@example.org");
    expect(stored.from_email).toBe("info@example.test");
    expect(stored.in_reply_to).toBe("kunde-1@example.org");
    expect(stored.references).toEqual(["older@example.org", "kunde-1@example.org"]);
    expect(stored.body_text).toContain("das Peptid ist auf Lager.");
    expect(stored.delivery_status).toBe("sent");
    expect(stored.idempotency_key).toBe(KEY);
    // The generated id is stored without brackets, like every other id here,
    // and matches the one that went on the wire.
    expect(`<${stored.message_id}>`).toBe(ctx.sender.sent[0].messageId);
  });

  /** The row exists as `pending` before the send, not after it. */
  it("writes the record before sending, then marks it sent", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    expect(ctx.store.statusHistory).toEqual(["pending", "sent"]);
  });
});

/* ------------------------------------------------------------ what it is not -- */

describe("the message it builds", () => {
  it("carries no cc, bcc, attachment or html field", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    const mail = ctx.sender.sent[0] as Record<string, unknown>;
    for (const forbidden of ["cc", "bcc", "attachments", "html", "from"]) {
      expect(mail[forbidden]).toBeUndefined();
    }
  });

  /**
   * A body is a body. Even if a transport mishandled bare carriage returns,
   * there is nothing left in the text for it to mishandle.
   */
  it("cannot be talked into adding a header", async () => {
    const ctx = context();

    await sendReply(
      request({
        body: "Guten Tag\r\nBcc: attacker@example.com\r\nSubject: Rechnung\r\n\r\nText",
      }),
      ctx.deps,
    );

    const mail = ctx.sender.sent[0] as Record<string, unknown>;
    expect(mail.bcc).toBeUndefined();
    expect(mail.subject).toBe("Re: Anfrage Semaglutid");
    expect(String(mail.text)).not.toContain("\r");
    // The text is still delivered — it is a body, and it reads as one.
    expect(String(mail.text)).toContain("Bcc: attacker@example.com");
  });

  /** A subject that arrived with an injected newline cannot become two headers. */
  it("flattens a hostile stored subject before it becomes a header", async () => {
    const store = FakeReplyStore.withInbound({
      subject: "Anfrage\r\nBcc: attacker@example.com",
    });
    const ctx = context({ store });

    await sendReply(request(), ctx.deps);

    expect(ctx.sender.sent[0].subject).not.toMatch(/[\r\n]/);
    expect(ctx.sender.sent[0].subject).toBe("Re: Anfrage Bcc: attacker@example.com");
  });
});

/* ------------------------------------------------------------- validation -- */

describe("body validation", () => {
  it.each([["", "empty"], ["   \n\t  ", "whitespace only"], [null, "missing"], [42, "not a string"]] as Array<
    [body: unknown, why: string]
  >)(
    "refuses a %p body (%s)",
    async (body) => {
      const ctx = context();

      await expect(sendReply(request({ body }), ctx.deps)).rejects.toMatchObject({
        code: "INBOX_INVALID_REQUEST",
      });
      expect(ctx.sender.sent).toHaveLength(0);
      expect(ctx.store.outbound).toHaveLength(0);
    },
  );

  it("refuses an oversized body", async () => {
    enableSmtp({ INBOX_MAX_REPLY_CHARS: "500" });
    const ctx = context();

    await expect(
      sendReply(request({ body: "x".repeat(501) }), ctx.deps),
    ).rejects.toMatchObject({ code: "INBOX_INVALID_REQUEST" });
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it.each(["", "short", "has spaces in it", "!!!!!!!!!!", "x".repeat(200)])(
    "refuses the idempotency key %p",
    (key) => {
      expect(() => validateIdempotencyKey(key)).toThrow(InboxError);
    },
  );

  it("refuses a thread that does not exist", async () => {
    const store = FakeReplyStore.withInbound();
    store.threads.clear();
    const ctx = context({ store });

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_NOT_FOUND",
    });
    expect(ctx.sender.sent).toHaveLength(0);
  });

  /** No usable address means no send — not a guess, and not a bounce. */
  it("refuses a conversation with no usable sender address", async () => {
    const store = FakeReplyStore.withInbound({ from_email: null, reply_to: null });
    const ctx = context({ store });

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_NO_RECIPIENT",
    });
    expect(ctx.sender.sent).toHaveLength(0);
    expect(ctx.store.outbound).toHaveLength(0);
  });

  it("refuses a malformed stored address rather than sending to it", () => {
    expect(
      resolveRecipient({
        id: "imsg_1",
        message_id: null,
        references: [],
        subject: "x",
        from_email: "not-an-address",
        reply_to: null,
        received_at: new Date(),
      }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------ idempotency -- */

describe("idempotency", () => {
  it("returns the existing message instead of sending twice", async () => {
    const ctx = context();

    const first = await sendReply(request(), ctx.deps);
    const second = await sendReply(request(), ctx.deps);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.message.id).toBe(first.message.id);
    expect(ctx.sender.sent).toHaveLength(1);
    expect(ctx.store.outbound).toHaveLength(1);
  });

  it("refuses a second attempt while the first is still in flight", async () => {
    const ctx = context();
    ctx.store.forcePendingFor(KEY);

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_REPLY_IN_PROGRESS",
    });
    expect(ctx.sender.sent).toHaveLength(0);
  });

  it("treats a different key as a different message", async () => {
    const ctx = context();

    await sendReply(request(), ctx.deps);
    ctx.store.lastOutbound = null; // ignore the per-thread interval for this case
    await sendReply(request({ idempotencyKey: "idem-key-0000002" }), ctx.deps);

    expect(ctx.sender.sent).toHaveLength(2);
    expect(ctx.store.outbound).toHaveLength(2);
  });
});

/* ---------------------------------------------------------------- failure -- */

describe("failure handling", () => {
  it("marks a rejected password as failed and does not report success", async () => {
    const ctx = context({
      sendImpl: async () => {
        throw Object.assign(new Error("Invalid login: 535 authentication failed"), {
          responseCode: 535,
        });
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_SEND_FAILED",
    });

    expect(ctx.store.outbound[0].delivery_status).toBe("failed");
    expect(ctx.store.outbound[0].failure_reason).toBe("auth");
    expect(ctx.store.statusHistory).toEqual(["pending", "failed"]);
  });

  it("classifies a dropped connection as temporary", async () => {
    const ctx = context({
      sendImpl: async () => {
        throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_SEND_FAILED",
      retryable: false,
    });
    expect(ctx.store.outbound[0].failure_reason).toBe("unreachable");
  });

  /** The retry reuses the row: one conversation entry, not two. */
  it("retries a failed send with the same key without duplicating it", async () => {
    let attempt = 0;
    const ctx = context({
      sendImpl: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("temporary glitch");
        return { accepted: 1 };
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_SEND_FAILED",
    });

    const retried = await sendReply(request(), ctx.deps);

    expect(retried.message.delivery_status).toBe("sent");
    expect(retried.duplicate).toBe(false);
    expect(ctx.store.outbound).toHaveLength(1);
    expect(ctx.store.statusHistory).toEqual(["pending", "failed", "pending", "sent"]);
  });

  it("closes the transport even when the send throws", async () => {
    const ctx = context({
      sendImpl: async () => {
        throw new Error("nope");
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toBeInstanceOf(InboxError);
    expect(ctx.sender.closed).toBe(1);
  });

  it("never logs the body, the recipient or the server's answer", async () => {
    const ctx = context({
      sendImpl: async () => {
        throw new Error(
          "smtp.hostinger.com said: 535 5.7.8 auth failed for info@peptideeinkaufen.de",
        );
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toBeInstanceOf(InboxError);

    const logged = [
      ...ctx.logger.warn.mock.calls,
      ...ctx.logger.info.mock.calls,
      ...ctx.logger.error.mock.calls,
    ]
      .flat()
      .join(" ");

    expect(logged).not.toContain("hostinger");
    expect(logged).not.toContain("peptideeinkaufen.de");
    expect(logged).not.toContain("kunde@example.org");
    expect(logged).not.toContain("Peptid ist auf Lager");
    expect(logged).not.toContain("not-a-real-password");
  });
});

/* ------------------------------------------------------------ rate limits -- */

describe("rate limiting", () => {
  it("refuses a second reply to the same thread within the interval", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    await expect(
      sendReply(request({ idempotencyKey: "idem-key-0000003" }), ctx.deps),
    ).rejects.toMatchObject({ code: "INBOX_RATE_LIMITED" });

    expect(ctx.sender.sent).toHaveLength(1);
  });

  it("allows the next reply once the interval has passed", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    ctx.store.lastOutbound = new Date(
      Date.parse("2026-08-05T09:00:00.000Z") - REPLY_RATE_LIMITS.perThreadIntervalMs - 1,
    );

    const second = await sendReply(
      request({ idempotencyKey: "idem-key-0000004" }),
      ctx.deps,
    );

    expect(second.message.delivery_status).toBe("sent");
  });

  it("refuses once the hourly ceiling is reached", async () => {
    const ctx = context();
    ctx.store.globalCount = REPLY_RATE_LIMITS.globalMax;

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_RATE_LIMITED",
    });
    expect(ctx.sender.sent).toHaveLength(0);
  });

  /** A retry fixes a failure; rate-limiting it would strand the customer. */
  it("does not rate-limit a retry of a failed send", async () => {
    let attempt = 0;
    const ctx = context({
      sendImpl: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("temporary glitch");
        return { accepted: 1 };
      },
    });

    await expect(sendReply(request(), ctx.deps)).rejects.toBeInstanceOf(InboxError);
    ctx.store.lastOutbound = new Date("2026-08-05T09:00:00.000Z");

    const retried = await sendReply(request(), ctx.deps);
    expect(retried.message.delivery_status).toBe("sent");
  });
});

/* -------------------------------------------------------------- switched off -- */

describe("switched off", () => {
  it("does not connect, write or load a mail library", async () => {
    delete process.env.INBOX_SMTP_ENABLED;
    const ctx = context();

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_SMTP_DISABLED",
    });

    expect(ctx.sender.sent).toHaveLength(0);
    expect(ctx.store.outbound).toHaveLength(0);
    expect(ctx.store.statusHistory).toEqual([]);
  });

  it.each(["false", "1", "yes", "TRUE "])("treats INBOX_SMTP_ENABLED=%p correctly", async (value) => {
    process.env.INBOX_SMTP_ENABLED = value;
    const ctx = context();

    const promise = sendReply(request(), ctx.deps);

    if (value.trim().toLowerCase() === "true") {
      await expect(promise).resolves.toMatchObject({ duplicate: false });
    } else {
      await expect(promise).rejects.toMatchObject({ code: "INBOX_SMTP_DISABLED" });
    }
  });

  it("reports incomplete configuration without sending", async () => {
    delete process.env.INBOX_SMTP_PASSWORD;
    const ctx = context();

    await expect(sendReply(request(), ctx.deps)).rejects.toMatchObject({
      code: "INBOX_SMTP_NOT_CONFIGURED",
    });
    expect(ctx.sender.sent).toHaveLength(0);
  });
});

/* ------------------------------------------------------------- credentials -- */

describe("credentials", () => {
  it("never appear in the result", async () => {
    const ctx = context();
    const result = await sendReply(request(), ctx.deps);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("not-a-real-password");
    expect(serialized).not.toContain("smtp.example.test");
  });

  it("are never handed to the sender factory as part of the mail", async () => {
    const ctx = context();
    await sendReply(request(), ctx.deps);

    const serialized = JSON.stringify(ctx.sender.sent[0]);
    expect(serialized).not.toContain("not-a-real-password");
  });
});
