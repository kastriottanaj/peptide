/**
 * The Inbox route, rendered.
 *
 * `lib/inbox-queries` is mocked rather than the network: these tests are about
 * what the page does with each query *state*, and driving that through fetch
 * stubs would test react-query's scheduler instead of this code. Mocking the
 * module also keeps `lib/sdk` out of the graph entirely — it reads
 * `import.meta.env`, which only a bundler provides.
 *
 * The router is real. Filter, search, page and selected thread live in the URL,
 * so a fake router would be testing nothing.
 *
 * The fixtures deliberately contain hostile input: a subject with a script tag,
 * a display name with a right-to-left override, a body full of markup. What is
 * asserted is that all of it appears on screen as *text*.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";

import type {
  InboxCounts,
  InboxThreadDetail,
  InboxThreadList,
} from "../../../lib/inbox-types";

jest.mock("../../../lib/inbox-queries", () => ({
  useInboxThreads: jest.fn(),
  useInboxThread: jest.fn(),
  useInboxCounts: jest.fn(),
  useUpdateThread: jest.fn(),
  useSetMessageRead: jest.fn(),
  useSyncInbox: jest.fn(),
  useSendReply: jest.fn(),
  COUNTS_POLL_MS: 60_000,
}));

jest.mock("../../../components/inbox/nav-icon", () => ({
  // The real one polls `/admin/inbox/counts` on mount; the sidebar badge has
  // its own test.
  InboxNavIcon: () => null,
}));

import * as queries from "../../../lib/inbox-queries";
import InboxPage, { config } from "../page";

const mocked = queries as jest.Mocked<typeof queries>;

/* ----------------------------------------------------------- fixtures --- */

const HOSTILE_NAME = "Max <b onmouseover=\"steal()\">Muster</b>";
const HOSTILE_SUBJECT = "<script>alert('xss')</script> Anfrage";
const HOSTILE_BODY =
  "Guten Tag,\n<script>alert('xss')</script>\n<img src=\"https://tracker.test/p.gif\">\nMfG";

const list: InboxThreadList = {
  threads: [
    {
      id: "ithr_1",
      subject: HOSTILE_SUBJECT,
      status: "open",
      last_message_at: "2026-08-01T10:00:00.000Z",
      message_count: 2,
      unread_count: 1,
      from_name: HOSTILE_NAME,
      from_email: "max@example.org",
    },
    {
      id: "ithr_2",
      subject: "Rechnung 42",
      status: "open",
      last_message_at: "2026-07-30T09:00:00.000Z",
      message_count: 1,
      unread_count: 0,
      from_name: null,
      from_email: "buchhaltung@example.org",
    },
  ],
  count: 40,
  limit: 25,
  offset: 0,
};

const detail: InboxThreadDetail = {
  thread: {
    id: "ithr_1",
    subject: HOSTILE_SUBJECT,
    status: "open",
    last_message_at: "2026-08-01T10:00:00.000Z",
    message_count: 1,
    unread_count: 1,
    from_name: HOSTILE_NAME,
    from_email: "max@example.org",
    created_at: "2026-08-01T10:00:00.000Z",
  },
  messages: [
    {
      id: "imsg_1",
      direction: "inbound",
      from_name: HOSTILE_NAME,
      from_email: "max@example.org",
      reply_to: null,
      recipients: [{ kind: "to", name: null, email: "info@example.org" }],
      subject: HOSTILE_SUBJECT,
      received_at: "2026-08-01T10:00:00.000Z",
      body_text: HOSTILE_BODY,
      body_truncated: false,
      is_read: false,
      attachments: [
        { filename: "Rechnung.pdf", content_type: "application/pdf", size: 4096 },
      ],
      size_bytes: 5_000,
      delivery_status: null,
      failure_reason: null,
      sent_at: null,
    },
  ],
};

/** The same thread, after we answered it. */
const OUTBOUND_MESSAGE: InboxThreadDetail["messages"][number] = {
  id: "imsg_out_1",
  direction: "outbound",
  from_name: null,
  from_email: "info@example.test",
  reply_to: null,
  recipients: [{ kind: "to", name: null, email: "max@example.org" }],
  subject: "Re: Anfrage",
  received_at: "2026-08-01T12:00:00.000Z",
  body_text: "Guten Tag,\n\ndas Peptid ist auf Lager.",
  body_truncated: false,
  is_read: true,
  attachments: [],
  size_bytes: 120,
  delivery_status: "sent",
  failure_reason: null,
  sent_at: "2026-08-01T12:00:00.000Z",
};

const withReply = (
  overrides: Partial<InboxThreadDetail["messages"][number]> = {},
): InboxThreadDetail => ({
  ...detail,
  messages: [...detail.messages, { ...OUTBOUND_MESSAGE, ...overrides }],
});

const counts: InboxCounts = {
  open: 12,
  resolved: 3,
  spam: 1,
  unread_threads: 4,
  unread_messages: 7,
  enabled: true,
  smtp_enabled: true,
};

/* ------------------------------------------------------------- helpers -- */

type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

const asResult = <T,>(state: QueryState<T>) =>
  state as unknown as UseQueryResult<T, never>;

function loaded<T>(data: T): QueryState<T> {
  return {
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  };
}

function loading<T>(): QueryState<T> {
  return {
    data: undefined,
    isLoading: true,
    isFetching: true,
    error: null,
    refetch: jest.fn(),
  };
}

function failed<T>(error: unknown): QueryState<T> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error,
    refetch: jest.fn(),
  };
}

const mutations = {
  update: { mutate: jest.fn(), isPending: false },
  read: { mutate: jest.fn(), isPending: false },
  sync: { mutate: jest.fn(), isPending: false, data: undefined, error: null },
  reply: {
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    data: undefined as unknown,
    error: null as unknown,
  },
};

function healthy() {
  mocked.useInboxThreads.mockReturnValue(asResult(loaded(list)));
  mocked.useInboxThread.mockReturnValue(asResult(loaded(detail)));
  mocked.useInboxCounts.mockReturnValue(asResult(loaded(counts)));
  mocked.useUpdateThread.mockReturnValue(mutations.update as never);
  mocked.useSetMessageRead.mockReturnValue(mutations.read as never);
  mocked.useSyncInbox.mockReturnValue(mutations.sync as never);
  mocked.useSendReply.mockReturnValue(mutations.reply as never);
}

function renderPage(initialUrl = "/app/inbox") {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <InboxPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mutations.sync.data = undefined;
  mutations.sync.error = null;
  mutations.sync.isPending = false;
  mutations.update.isPending = false;
  mutations.read.isPending = false;
  mutations.reply.isPending = false;
  mutations.reply.data = undefined;
  mutations.reply.error = null;
  healthy();
});

/* --------------------------------------------------------------- tests -- */

describe("the sidebar entry", () => {
  it("is labelled Inbox and carries an icon", () => {
    expect(config.label).toBe("Inbox");
    expect(config.icon).toBeDefined();
  });
});

describe("empty state", () => {
  it("explains an empty inbox rather than showing nothing", () => {
    mocked.useInboxThreads.mockReturnValue(
      asResult(loaded({ threads: [], count: 0, limit: 25, offset: 0 })),
    );
    mocked.useInboxThread.mockReturnValue(asResult(loaded(undefined as never)));

    renderPage();

    expect(screen.getByText("No open conversations")).toBeInTheDocument();
    expect(
      screen.getByText(/Incoming email appears here/i),
    ).toBeInTheDocument();
  });

  it("shows the reading pane empty until a conversation is picked", () => {
    renderPage();
    expect(screen.getByText("No conversation selected")).toBeInTheDocument();
  });

  it("says so when the importer is switched off", () => {
    mocked.useInboxCounts.mockReturnValue(
      asResult(loaded({ ...counts, enabled: false })),
    );

    renderPage();

    expect(screen.getByText(/importer is switched off/i)).toBeInTheDocument();
    expect(screen.getByText(/Importer off/)).toBeInTheDocument();
  });
});

describe("the thread list", () => {
  it("shows sender, subject, message count and an unread marker", () => {
    renderPage();

    const rows = screen.getAllByRole("listitem");
    const first = within(rows[0]);

    expect(first.getByText(/Max/)).toBeInTheDocument();
    expect(first.getByText("max@example.org")).toBeInTheDocument();
    expect(first.getByText("2 messages")).toBeInTheDocument();
    expect(first.getByText("1 unread")).toBeInTheDocument();
  });

  it("falls back to the address when there is no display name", () => {
    renderPage();
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[1]).getAllByText("buchhaltung@example.org").length).toBeGreaterThan(0);
  });

  it("renders a loading state without emptying the page", () => {
    mocked.useInboxThreads.mockReturnValue(asResult(loading<InboxThreadList>()));
    renderPage();

    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  });

  it("shows an actionable error when the list fails", () => {
    const error = Object.assign(new Error("nope"), {
      code: "INBOX_UNAVAILABLE",
      retryable: true,
    });
    mocked.useInboxThreads.mockReturnValue(asResult(failed<InboxThreadList>(error)));

    renderPage();

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("filters, search and paging", () => {
  it("puts the status filter in the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: /Spam/ }));

    await waitFor(() => {
      expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "spam", offset: 0 }),
      );
    });
  });

  it("reads the initial filter out of the URL", () => {
    renderPage("/app/inbox?status=resolved&unread=true");

    expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "resolved", unreadOnly: true }),
    );
  });

  it("searches on submit rather than on every keystroke", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Search by sender/i), "rechnung");

    expect(mocked.useInboxThreads).not.toHaveBeenCalledWith(
      expect.objectContaining({ q: "rechnung" }),
    );

    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "rechnung" }),
      );
    });
  });

  it("filters to unread only", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByLabelText(/Unread only/i));

    await waitFor(() => {
      expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ unreadOnly: true }),
      );
    });
  });

  it("pages forward and back, and disables what cannot be pressed", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("1–25 of 40")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 25 }),
      );
    });
  });

  it("resets to the first page when the filter changes", async () => {
    const user = userEvent.setup();
    renderPage("/app/inbox?offset=25");

    await user.click(screen.getByRole("button", { name: /Resolved/ }));

    await waitFor(() => {
      expect(mocked.useInboxThreads).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, status: "resolved" }),
      );
    });
  });
});

describe("reading a conversation", () => {
  it("selects a thread into the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getAllByRole("button", { name: /Max/ })[0]);

    await waitFor(() => {
      expect(mocked.useInboxThread).toHaveBeenLastCalledWith("ithr_1");
    });
  });

  it("shows the message body, recipients and attachment metadata", () => {
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByText(/Guten Tag/)).toBeInTheDocument();
    expect(screen.getByText(/to info@example.org/)).toBeInTheDocument();
    expect(
      screen.getByText(/Rechnung\.pdf · application\/pdf · 4 KB/),
    ).toBeInTheDocument();
    expect(screen.getByText(/attachment.*not.*downloaded/i)).toBeInTheDocument();
  });

  it("marks one message read", async () => {
    const user = userEvent.setup();
    renderPage("/app/inbox?thread=ithr_1");

    await user.click(screen.getByRole("button", { name: "Mark read" }));

    expect(mutations.read.mutate).toHaveBeenCalledWith({
      id: "imsg_1",
      read: true,
      threadId: "ithr_1",
    });
  });

  it("marks a whole thread read", async () => {
    const user = userEvent.setup();
    renderPage("/app/inbox?thread=ithr_1");

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(mutations.update.mutate).toHaveBeenCalledWith({
      id: "ithr_1",
      read: true,
    });
  });

  it("resolves, reopens and flags spam", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage("/app/inbox?thread=ithr_1");

    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(mutations.update.mutate).toHaveBeenCalledWith({
      id: "ithr_1",
      status: "resolved",
    });

    await user.click(screen.getByRole("button", { name: "Mark spam" }));
    expect(mutations.update.mutate).toHaveBeenCalledWith({
      id: "ithr_1",
      status: "spam",
    });

    unmount();

    mocked.useInboxThread.mockReturnValue(
      asResult(
        loaded({
          ...detail,
          thread: { ...detail.thread, status: "resolved" as const },
        }),
      ),
    );
    renderPage("/app/inbox?thread=ithr_1");

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    expect(mutations.update.mutate).toHaveBeenCalledWith({
      id: "ithr_1",
      status: "open",
    });
  });

  it("disables the actions while a mutation is in flight", () => {
    mutations.update.isPending = true;
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByRole("button", { name: "Resolve" })).toBeDisabled();
  });
});

describe("hostile content is text, never markup", () => {
  /**
   * The subject carries a script tag. It must be *visible as characters* and
   * must not have created an element.
   */
  it("renders a script tag in a subject as text", () => {
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    expect(container.querySelector("script")).toBeNull();
    expect(screen.getAllByText(/<script>alert\('xss'\)<\/script>/).length).toBeGreaterThan(0);
  });

  it("renders markup in a body as text, and loads no image", () => {
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    const body = container.querySelector(".pi-body");
    expect(body?.textContent).toContain("<script>alert('xss')</script>");
    expect(body?.textContent).toContain('<img src="https://tracker.test/p.gif">');

    // The URL is present as characters and absent as an attribute — which is
    // the difference between reading about a tracking pixel and fetching one.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("[src], [srcset], [href], [data-src]")).toBeNull();
  });

  it("renders no anchor, so no address in a message is clickable", () => {
    const { container } = renderPage("/app/inbox?thread=ithr_1");
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders markup in a display name as text", () => {
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    // The markup exists as characters, not as elements or attributes. Asserting
    // on `innerHTML` would be the wrong instrument here: escaped text legibly
    // contains `onmouseover=`, and that is exactly what safe output looks like.
    expect(container.querySelector("b")).toBeNull();

    const attributes = [...container.querySelectorAll("*")].flatMap((element) =>
      [...element.attributes].map((attribute) => attribute.name),
    );
    expect(attributes.filter((name) => name.startsWith("on"))).toEqual([]);

    expect(
      screen.getAllByText(/Max <b onmouseover="steal\(\)">Muster<\/b>/).length,
    ).toBeGreaterThan(0);
  });
});

describe("what the page does not offer", () => {
  /**
   * Replying is supported; everything else that would turn this page into a
   * mail client is not. A forward or a compose button would need a recipient
   * field, which is exactly what the endpoint refuses to accept.
   */
  it.each(["Forward", "Weiterleiten", "Compose", "Neue Nachricht", "Download", "Herunterladen"])(
    "has no %s control",
    (label) => {
      renderPage("/app/inbox?thread=ithr_1");
      expect(
        screen.queryByRole("button", { name: new RegExp(label, "i") }),
      ).not.toBeInTheDocument();
    },
  );

  /** One textarea — the reply body — and no other input on the message form. */
  it("offers no recipient, subject, cc or attachment field", () => {
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelector('input[type="file"]')).toBeNull();

    for (const label of [/^to$/i, /^cc$/i, /^bcc$/i, /^subject$/i, /^from$/i]) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    }
  });
});

describe("the manual sync", () => {
  it("triggers a sync", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(mutations.sync.mutate).toHaveBeenCalled();
  });

  it.each([
    ["disabled", /switched off/i],
    ["misconfigured", /settings are incomplete/i],
    ["locked", /already running/i],
    ["throttled", /Just synced/i],
    ["unreachable", /did not answer/i],
  ])("explains a %s result", (status, pattern) => {
    mutations.sync.data = {
      status,
      imported: 0,
      duplicates: 0,
      oversized: 0,
      failed: 0,
      duration_ms: 5,
      started_at: "2026-08-04T10:00:00.000Z",
    } as never;

    renderPage();
    expect(screen.getByText(pattern)).toBeInTheDocument();
  });

  it("reports what a successful sync imported", () => {
    mutations.sync.data = {
      status: "ok",
      imported: 3,
      duplicates: 0,
      oversized: 0,
      failed: 0,
      duration_ms: 120,
      started_at: "2026-08-04T10:00:00.000Z",
    } as never;

    renderPage();
    expect(screen.getByText(/3 new message\(s\) imported/)).toBeInTheDocument();
  });
});

describe("the unread count", () => {
  it("is shown in the header", () => {
    renderPage();
    expect(screen.getByText("7 unread")).toBeInTheDocument();
    expect(screen.getByText("12 open")).toBeInTheDocument();
  });

  it("says so plainly when there is nothing unread", () => {
    mocked.useInboxCounts.mockReturnValue(
      asResult(loaded({ ...counts, unread_messages: 0 })),
    );

    renderPage();
    expect(screen.getByText("No unread messages")).toBeInTheDocument();
  });
});

describe("replies in the conversation", () => {
  it("renders an outbound reply after the inbound message it answers", () => {
    mocked.useInboxThread.mockReturnValue(asResult(loaded(withReply())));
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    const bodies = [...container.querySelectorAll(".pi-body")].map(
      (node) => node.textContent ?? "",
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain("Guten Tag,");
    expect(bodies[1]).toContain("das Peptid ist auf Lager.");
    expect(screen.getByText("Sent by us")).toBeInTheDocument();
  });

  it("marks a delivered reply as delivered", () => {
    mocked.useInboxThread.mockReturnValue(asResult(loaded(withReply())));
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByText(/Delivered to the mail server/i)).toBeInTheDocument();
  });

  /** A failed send is never dressed up as a sent one. */
  it("shows a failed reply as failed, with retryability in words", () => {
    mocked.useInboxThread.mockReturnValue(
      asResult(
        loaded(withReply({ delivery_status: "failed", failure_reason: "temporary", sent_at: null })),
      ),
    );
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByText(/Failed — temporary problem, can be retried/i)).toBeInTheDocument();
    expect(screen.queryByText(/Delivered to the mail server/i)).not.toBeInTheDocument();
  });

  it("describes a server-side failure without naming the server", () => {
    mocked.useInboxThread.mockReturnValue(
      asResult(loaded(withReply({ delivery_status: "failed", failure_reason: "auth", sent_at: null }))),
    );
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByText(/mail login rejected/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/smtp\.|535|password/i);
  });

  it("shows a reply still in flight as sending, not sent", () => {
    mocked.useInboxThread.mockReturnValue(
      asResult(loaded(withReply({ delivery_status: "pending", sent_at: null }))),
    );
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  /** Our own message has no unread state to toggle. */
  it("offers no read toggle on a reply we sent", () => {
    mocked.useInboxThread.mockReturnValue(asResult(loaded(withReply())));
    renderPage("/app/inbox?thread=ithr_1");

    expect(screen.getAllByRole("button", { name: /^Mark (read|unread)$/ })).toHaveLength(1);
  });

  it("sends the reply through the mutation with the thread id", async () => {
    const user = userEvent.setup();
    renderPage("/app/inbox?thread=ithr_1");

    await user.type(screen.getByLabelText(/Reply text/i), "Danke für Ihre Anfrage");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(mutations.reply.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "ithr_1",
        body: "Danke für Ihre Anfrage",
        idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{8,128}$/),
      }),
    );
  });

  it("hides the composer when the server has sending switched off", () => {
    mocked.useInboxCounts.mockReturnValue(
      asResult(loaded({ ...counts, smtp_enabled: false })),
    );
    const { container } = renderPage("/app/inbox?thread=ithr_1");

    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.getByText(/Replying is switched off/i)).toBeInTheDocument();
  });
});
