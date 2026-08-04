/**
 * The six admin routes.
 *
 * Driven through the exported handlers with a fake request, response and
 * container — no HTTP server, because what is being tested is the handlers'
 * own decisions: which queries they refuse, what they hand back, and above all
 * **what they never include**.
 *
 * Authentication is not tested here and cannot be: it is applied by Medusa's
 * `ApiLoader` to everything under `/admin`, so what protects these routes is
 * their *location*. The test for that is the directory listing at the bottom of
 * this file — no inbox route may exist outside `src/api/admin/inbox`.
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * The reply endpoint's own orchestration is tested in `reply.unit.spec.ts`
 * against a fake SMTP transport. Here it is mocked, because what this file is
 * about is the handler: what it accepts, what it refuses, and what it hands
 * back.
 */
jest.mock("../service", () => ({
  ...jest.requireActual("../service"),
  sendInboxReply: jest.fn(),
}));

import { GET as threadsGET } from "../../../api/admin/inbox/threads/route";
import {
  GET as threadGET,
  PATCH as threadPATCH,
} from "../../../api/admin/inbox/threads/[id]/route";
import { GET as countsGET } from "../../../api/admin/inbox/counts/route";
import { PATCH as readPATCH } from "../../../api/admin/inbox/messages/[id]/read/route";
import { POST as syncPOST } from "../../../api/admin/inbox/sync/route";
import { POST as replyPOST } from "../../../api/admin/inbox/threads/[id]/reply/route";
import { sendInboxReply } from "../service";
import { InboxError } from "../errors";

const mockedSendReply = sendInboxReply as jest.MockedFunction<typeof sendInboxReply>;

const SENT_MESSAGE = {
  id: "imsg_out_1",
  thread_id: "ithr_1",
  message_id: "generated@example.test",
  to_email: "kunde@example.org",
  subject: "Re: Anfrage",
  delivery_status: "sent" as const,
  failure_reason: null,
  idempotency_key: "idem-key-0000001",
  sent_at: new Date("2026-08-05T09:00:00.000Z"),
};

type FakeRes = {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function fakeReq(options: {
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
  service?: Record<string, unknown>;
}) {
  return {
    query: options.query ?? {},
    params: options.params ?? {},
    body: options.body,
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger;
        if (key === "inbox") return options.service ?? {};
        throw new Error(`unexpected resolve(${key})`);
      },
    },
  } as never;
}

const THREAD = {
  id: "ithr_1",
  subject: "Anfrage",
  status: "open",
  last_message_at: new Date("2026-08-01T10:00:00.000Z"),
  message_count: 2,
  unread_count: 1,
  last_sender_name: "A Sender",
  last_sender_email: "sender@example.org",
  created_at: new Date("2026-07-30T09:00:00.000Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.INBOX_ENABLED;
});

describe("GET /admin/inbox/threads", () => {
  it("defaults to 25 newest-first, unfiltered", async () => {
    const listThreadsPage = jest
      .fn()
      .mockResolvedValue({ threads: [THREAD], count: 1 });

    const res = fakeRes();
    await threadsGET(fakeReq({ service: { listThreadsPage } }), res as never);

    expect(listThreadsPage).toHaveBeenCalledWith({
      q: "",
      status: undefined,
      unreadOnly: false,
      limit: 25,
      offset: 0,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ count: 1, limit: 25, offset: 0 });
  });

  it("passes search, status and unread filters through", async () => {
    const listThreadsPage = jest
      .fn()
      .mockResolvedValue({ threads: [], count: 0 });

    await threadsGET(
      fakeReq({
        query: {
          q: "  rechnung  ",
          status: "spam",
          unread_only: "true",
          limit: "50",
          offset: "100",
        },
        service: { listThreadsPage },
      }),
      fakeRes() as never,
    );

    expect(listThreadsPage).toHaveBeenCalledWith({
      q: "rechnung",
      status: "spam",
      unreadOnly: true,
      limit: 50,
      offset: 100,
    });
  });

  it("treats status=all as no filter", async () => {
    const listThreadsPage = jest.fn().mockResolvedValue({ threads: [], count: 0 });

    await threadsGET(
      fakeReq({ query: { status: "all" }, service: { listThreadsPage } }),
      fakeRes() as never,
    );

    expect(listThreadsPage).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
    );
  });

  /** Only the exact string turns a filter on; `?unread_only=0` must not hide mail. */
  it.each(["0", "false", "no", ""])(
    "does not filter unread for unread_only=%p",
    async (value) => {
      const listThreadsPage = jest
        .fn()
        .mockResolvedValue({ threads: [], count: 0 });

      await threadsGET(
        fakeReq({ query: { unread_only: value }, service: { listThreadsPage } }),
        fakeRes() as never,
      );

      expect(listThreadsPage).toHaveBeenCalledWith(
        expect.objectContaining({ unreadOnly: false }),
      );
    },
  );

  it.each(["0", "101", "-1", "abc", "10.5"])(
    "rejects limit=%p with 400",
    async (limit) => {
      const res = fakeRes();
      await threadsGET(
        fakeReq({ query: { limit }, service: { listThreadsPage: jest.fn() } }),
        res as never,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: "INBOX_INVALID_REQUEST" },
      });
    },
  );

  it("rejects an unknown status with 400 naming the accepted values", async () => {
    const res = fakeRes();
    await threadsGET(
      fakeReq({
        query: { status: "archived" },
        service: { listThreadsPage: jest.fn() },
      }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toContain("open, resolved, spam");
  });

  it("returns no message bodies in the list", async () => {
    const listThreadsPage = jest
      .fn()
      .mockResolvedValue({ threads: [THREAD], count: 1 });

    const res = fakeRes();
    await threadsGET(fakeReq({ service: { listThreadsPage } }), res as never);

    const [thread] = (res.body as { threads: Record<string, unknown>[] }).threads;
    expect(Object.keys(thread).sort()).toEqual(
      [
        "from_email",
        "from_name",
        "id",
        "last_message_at",
        "message_count",
        "status",
        "subject",
        "unread_count",
      ].sort(),
    );
  });

  it("does not let an internal failure reach the client", async () => {
    const listThreadsPage = jest
      .fn()
      .mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:5432 medusa_peptides"),
      );

    const res = fakeRes();
    await threadsGET(fakeReq({ service: { listThreadsPage } }), res as never);

    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("5432");
    expect(JSON.stringify(res.body)).not.toContain("medusa_peptides");
  });
});

describe("GET /admin/inbox/threads/:id", () => {
  const MESSAGE = {
    id: "imsg_1",
    from_name: "A Sender",
    from_email: "sender@example.org",
    recipients: [{ kind: "to", name: null, email: "info@example.org" }],
    subject: "Anfrage",
    received_at: new Date("2026-08-01T10:00:00.000Z"),
    body_text: "Guten Tag",
    body_truncated: false,
    is_read: false,
    attachments: [{ filename: "a.pdf", content_type: "application/pdf", size: 12 }],
    size_bytes: 900,
  };

  it("returns the thread and its messages", async () => {
    const getThreadDetail = jest
      .fn()
      .mockResolvedValue({ thread: THREAD, messages: [MESSAGE] });

    const res = fakeRes();
    await threadGET(
      fakeReq({ params: { id: "ithr_1" }, service: { getThreadDetail } }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    const body = res.body as { messages: Record<string, unknown>[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].body_text).toBe("Guten Tag");
  });

  /**
   * The allowlist is the security boundary: a field added to the model must not
   * appear in a response by default.
   */
  it("returns a fixed set of message fields and no HTML or raw source", async () => {
    const getThreadDetail = jest.fn().mockResolvedValue({
      thread: THREAD,
      messages: [
        {
          ...MESSAGE,
          // Fields a future model change might add. None may escape.
          body_html: "<script>alert(1)</script>",
          raw_source: "From: attacker@example.com\r\n\r\nbody",
          mailbox: "INBOX",
          uid: 42,
        },
      ],
    });

    const res = fakeRes();
    await threadGET(
      fakeReq({ params: { id: "ithr_1" }, service: { getThreadDetail } }),
      res as never,
    );

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("body_html");
    expect(serialized).not.toContain("<script>");
    expect(serialized).not.toContain("raw_source");
    expect(serialized).not.toContain("From: attacker");
    // IMAP coordinates are internal bookkeeping, not something the browser needs.
    expect(serialized).not.toContain("\"uid\"");
  });

  it("answers 404 for a thread that does not exist", async () => {
    const getThreadDetail = jest
      .fn()
      .mockRejectedValue(new Error("InboxThread with id: ithr_x was not found"));

    const res = fakeRes();
    await threadGET(
      fakeReq({ params: { id: "ithr_x" }, service: { getThreadDetail } }),
      res as never,
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "INBOX_NOT_FOUND" } });
  });
});

describe("PATCH /admin/inbox/threads/:id", () => {
  function service() {
    return {
      setThreadStatus: jest.fn().mockResolvedValue(THREAD),
      setThreadRead: jest.fn().mockResolvedValue(THREAD),
      retrieveInboxThread: jest.fn().mockResolvedValue(THREAD),
    };
  }

  it.each(["open", "resolved", "spam"])("accepts status=%s", async (status) => {
    const inbox = service();
    const res = fakeRes();

    await threadPATCH(
      fakeReq({ params: { id: "ithr_1" }, body: { status }, service: inbox }),
      res as never,
    );

    expect(inbox.setThreadStatus).toHaveBeenCalledWith("ithr_1", status);
    expect(res.statusCode).toBe(200);
  });

  it("marks every message read or unread", async () => {
    const inbox = service();

    await threadPATCH(
      fakeReq({ params: { id: "ithr_1" }, body: { read: true }, service: inbox }),
      fakeRes() as never,
    );

    expect(inbox.setThreadRead).toHaveBeenCalledWith("ithr_1", true);
  });

  /** Resolving *and* reading in one call must not have the read reopen it. */
  it("applies read before status", async () => {
    const order: string[] = [];
    const inbox = {
      setThreadRead: jest.fn(async () => {
        order.push("read");
        return THREAD;
      }),
      setThreadStatus: jest.fn(async () => {
        order.push("status");
        return THREAD;
      }),
      retrieveInboxThread: jest.fn().mockResolvedValue(THREAD),
    };

    await threadPATCH(
      fakeReq({
        params: { id: "ithr_1" },
        body: { read: true, status: "resolved" },
        service: inbox,
      }),
      fakeRes() as never,
    );

    expect(order).toEqual(["read", "status"]);
  });

  it.each([
    [{}, "Provide status"],
    [{ status: "archived" }, "open, resolved, spam"],
    [{ read: "yes" }, "read must be a boolean"],
  ])("rejects %p with 400", async (body, fragment) => {
    const res = fakeRes();
    await threadPATCH(
      fakeReq({ params: { id: "ithr_1" }, body, service: service() }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect((res.body as { message: string }).message).toContain(fragment);
  });
});

describe("PATCH /admin/inbox/messages/:id/read", () => {
  it("sets read state explicitly in both directions", async () => {
    for (const read of [true, false]) {
      const setMessageRead = jest
        .fn()
        .mockResolvedValue({ id: "imsg_1", is_read: read });

      const res = fakeRes();
      await readPATCH(
        fakeReq({
          params: { id: "imsg_1" },
          body: { read },
          service: { setMessageRead },
        }),
        res as never,
      );

      expect(setMessageRead).toHaveBeenCalledWith("imsg_1", read);
      expect(res.body).toEqual({ message: { id: "imsg_1", is_read: read } });
    }
  });

  it("requires a boolean rather than toggling", async () => {
    const res = fakeRes();
    await readPATCH(
      fakeReq({ params: { id: "imsg_1" }, body: {}, service: {} }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
  });

  it("answers 404 for a message that does not exist", async () => {
    const setMessageRead = jest
      .fn()
      .mockRejectedValue(new Error("InboxMessage with id: imsg_x was not found"));

    const res = fakeRes();
    await readPATCH(
      fakeReq({
        params: { id: "imsg_x" },
        body: { read: true },
        service: { setMessageRead },
      }),
      res as never,
    );

    expect(res.statusCode).toBe(404);
  });
});

describe("GET /admin/inbox/counts", () => {
  it("returns the counts and whether the importer is on", async () => {
    const getCounts = jest.fn().mockResolvedValue({
      open: 3,
      resolved: 1,
      spam: 0,
      unread_threads: 2,
      unread_messages: 4,
    });

    const res = fakeRes();
    await countsGET(fakeReq({ service: { getCounts } }), res as never);

    expect(res.body).toEqual({
      open: 3,
      resolved: 1,
      spam: 0,
      unread_threads: 2,
      unread_messages: 4,
      // Two independent switches: importing and replying are different risks
      // and are reported separately.
      enabled: false,
      smtp_enabled: false,
    });
  });

  /** Already-imported mail stays readable when the importer is off. */
  it("answers normally while the importer is switched off", async () => {
    const getCounts = jest.fn().mockResolvedValue({
      open: 1,
      resolved: 0,
      spam: 0,
      unread_threads: 1,
      unread_messages: 1,
    });

    const res = fakeRes();
    await countsGET(fakeReq({ service: { getCounts } }), res as never);

    expect(res.statusCode).toBe(200);
    expect((res.body as { enabled: boolean }).enabled).toBe(false);
  });
});

describe("POST /admin/inbox/sync", () => {
  it("reports `disabled` without connecting when the inbox is off", async () => {
    const res = fakeRes();

    await syncPOST(
      fakeReq({ service: { getSyncState: jest.fn() } }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "disabled", imported: 0 });
  });

  it("returns counts and never configuration", async () => {
    const res = fakeRes();
    await syncPOST(fakeReq({ service: {} }), res as never);

    expect(Object.keys(res.body as object).sort()).toEqual(
      [
        "duplicates",
        "duration_ms",
        "failed",
        "imported",
        "oversized",
        "started_at",
        "status",
      ].sort(),
    );
  });
});

/**
 * A structural test, not a behavioural one.
 *
 * Every inbox route lives under `src/api/admin/inbox`, which is what puts it
 * behind Medusa's admin authentication. A route file appearing under
 * `src/api/store` would be publicly reachable customer correspondence, so the
 * check is on the filesystem rather than on any one handler.
 */
describe("route placement", () => {
  const apiRoot = join(__dirname, "..", "..", "..", "api");

  function routeFiles(dir: string): string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];

    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return routeFiles(full);
      return entry.name === "route.ts" ? [full] : [];
    });
  }

  it("puts every inbox route under /admin/inbox", () => {
    const inboxRoutes = routeFiles(apiRoot).filter((file) =>
      file.includes(`${"inbox"}`),
    );

    // Six files, seven endpoints — `threads/[id]` serves both GET and PATCH.
    expect(inboxRoutes.length).toBe(6);
    for (const file of inboxRoutes) {
      expect(file).toContain(join("api", "admin", "inbox"));
    }
  });

  it("exposes no store route mentioning the inbox", () => {
    const storeRoutes = routeFiles(join(apiRoot, "store"));
    expect(storeRoutes.filter((file) => file.includes("inbox"))).toEqual([]);
  });
});

describe("POST /admin/inbox/threads/:id/reply", () => {
  beforeEach(() => {
    mockedSendReply.mockReset();
    mockedSendReply.mockResolvedValue({ message: SENT_MESSAGE, duplicate: false });
  });

  it("passes the body and idempotency key through, and nothing else", async () => {
    const res = fakeRes();

    await replyPOST(
      fakeReq({
        params: { id: "ithr_1" },
        body: {
          body: "Guten Tag",
          idempotency_key: "idem-key-0000001",
          // Everything a caller might try to smuggle in. None of it is read.
          to: "attacker@example.com",
          cc: "attacker@example.com",
          bcc: "attacker@example.com",
          from: "ceo@example.com",
          subject: "Rechnung",
          html: "<script>alert(1)</script>",
          attachments: [{ filename: "x.pdf" }],
        },
      }),
      res as never,
    );

    expect(res.statusCode).toBe(201);
    expect(mockedSendReply).toHaveBeenCalledTimes(1);

    const [, request] = mockedSendReply.mock.calls[0];
    expect(Object.keys(request).sort()).toEqual(["body", "idempotencyKey", "threadId"]);
    expect(request).toMatchObject({
      threadId: "ithr_1",
      body: "Guten Tag",
      idempotencyKey: "idem-key-0000001",
    });
  });

  it("answers 200 rather than 201 when an existing send is returned", async () => {
    mockedSendReply.mockResolvedValue({ message: SENT_MESSAGE, duplicate: true });
    const res = fakeRes();

    await replyPOST(
      fakeReq({
        params: { id: "ithr_1" },
        body: { body: "Guten Tag", idempotency_key: "idem-key-0000001" },
      }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true });
  });

  it.each([undefined, 42, null, { text: "hi" }])(
    "rejects a non-string body (%p) with 400",
    async (body) => {
      const res = fakeRes();

      await replyPOST(
        fakeReq({
          params: { id: "ithr_1" },
          body: { body, idempotency_key: "idem-key-0000001" },
        }),
        res as never,
      );

      expect(res.statusCode).toBe(400);
      expect(mockedSendReply).not.toHaveBeenCalled();
    },
  );

  it("returns the fixed error for a send that failed", async () => {
    mockedSendReply.mockRejectedValue(new InboxError("INBOX_SEND_FAILED"));
    const res = fakeRes();

    await replyPOST(
      fakeReq({
        params: { id: "ithr_1" },
        body: { body: "Guten Tag", idempotency_key: "idem-key-0000001" },
      }),
      res as never,
    );

    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: { code: "INBOX_SEND_FAILED" } });
  });

  it.each([
    ["INBOX_SMTP_DISABLED", 503],
    ["INBOX_SMTP_NOT_CONFIGURED", 503],
    ["INBOX_NO_RECIPIENT", 422],
    ["INBOX_RATE_LIMITED", 429],
    ["INBOX_REPLY_IN_PROGRESS", 409],
    ["INBOX_NOT_FOUND", 404],
  ] as Array<[code: string, status: number]>)(
    "maps %s to %i",
    async (code, status) => {
      mockedSendReply.mockRejectedValue(new InboxError(code as never));
      const res = fakeRes();

      await replyPOST(
        fakeReq({
          params: { id: "ithr_1" },
          body: { body: "Guten Tag", idempotency_key: "idem-key-0000001" },
        }),
        res as never,
      );

      expect(res.statusCode).toBe(status);
      expect(res.body).toMatchObject({ error: { code } });
    },
  );

  /** An unexpected throw must not escape as a stack trace or an SMTP sentence. */
  it("does not let an internal failure reach the client", async () => {
    mockedSendReply.mockRejectedValue(
      new Error("smtp.hostinger.com 535 auth failed for info@peptideeinkaufen.de"),
    );
    const res = fakeRes();

    await replyPOST(
      fakeReq({
        params: { id: "ithr_1" },
        body: { body: "Guten Tag", idempotency_key: "idem-key-0000001" },
      }),
      res as never,
    );

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("hostinger");
    expect(serialized).not.toContain("peptideeinkaufen.de");
    expect(serialized).not.toContain("535");
  });

  it("returns no credential and no transport detail on success", async () => {
    const res = fakeRes();

    await replyPOST(
      fakeReq({
        params: { id: "ithr_1" },
        body: { body: "Guten Tag", idempotency_key: "idem-key-0000001" },
      }),
      res as never,
    );

    const payload = (res.body as { message: Record<string, unknown> }).message;
    expect(Object.keys(payload).sort()).toEqual(
      ["delivery_status", "failure_reason", "id", "sent_at", "subject", "thread_id", "to_email"].sort(),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/password|smtp\.|idempotency_key/i);
  });
});
