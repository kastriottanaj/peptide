/**
 * The reply box, rendered.
 *
 * Two things are being pinned here. The obvious one is that the composer works:
 * type, send, see the state change. The one that matters more is the
 * **idempotency key** — it belongs to the draft, so a second click, an
 * impatient third, and a retry after a failure all carry the same key. That is
 * what turns "the button did nothing, click it again" from a duplicate email
 * into a no-op, and it is invisible in the UI, so it is asserted here.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InboxRequestError } from "../../../lib/inbox-errors";
import { ReplyComposer } from "../reply-composer";

const RECIPIENT = "kunde@example.org";

function setup(overrides: Partial<Parameters<typeof ReplyComposer>[0]> = {}) {
  const onSend = jest.fn();
  const onDismissResult = jest.fn();

  const props = {
    recipient: RECIPIENT,
    enabled: true,
    sending: false,
    error: null as unknown,
    sentAt: null as string | null,
    maxChars: 100,
    onSend,
    onDismissResult,
    ...overrides,
  };

  const view = render(<ReplyComposer {...props} />);
  return { ...view, onSend, onDismissResult, props };
}

describe("composing", () => {
  it("names the recipient without offering to change it", () => {
    const { container } = setup();

    expect(screen.getByText(RECIPIENT)).toBeInTheDocument();
    // One textarea, and no field that could redirect the message.
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("refuses to send an empty or whitespace-only body", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();

    const send = screen.getByRole("button", { name: "Send reply" });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText(/Reply text/i), "   ");
    expect(send).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends the trimmed body with an idempotency key", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();

    await user.type(screen.getByLabelText(/Reply text/i), "  Guten Tag  ");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0].body).toBe("Guten Tag");
    expect(onSend.mock.calls[0][0].idempotencyKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it("counts characters and blocks a body over the limit", async () => {
    const user = userEvent.setup();
    const { onSend } = setup({ maxChars: 10 });

    await user.type(screen.getByLabelText(/Reply text/i), "12345678901");

    expect(screen.getByText("11 / 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reply" })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("the idempotency key", () => {
  /** The whole point: two clicks are one email. */
  it("stays the same across repeated clicks of the same draft", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();

    await user.type(screen.getByLabelText(/Reply text/i), "Guten Tag");

    const send = screen.getByRole("button", { name: "Send reply" });
    await user.click(send);
    await user.click(send);
    await user.click(send);

    expect(onSend).toHaveBeenCalledTimes(3);
    const keys = new Set(onSend.mock.calls.map((call) => call[0].idempotencyKey));
    expect(keys.size).toBe(1);
  });

  it("stays the same when retrying after a failure", async () => {
    const user = userEvent.setup();
    const { onSend, rerender, props } = setup();

    await user.type(screen.getByLabelText(/Reply text/i), "Guten Tag");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    const firstKey = onSend.mock.calls[0][0].idempotencyKey;

    rerender(
      <ReplyComposer
        {...props}
        error={new InboxRequestError("INBOX_SEND_FAILED", "failed", 502, true)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onSend.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  });

  /** A cleared draft is a new message, and gets a new key. */
  it("changes after the draft is reset", async () => {
    const user = userEvent.setup();
    const { onSend } = setup();

    const input = screen.getByLabelText(/Reply text/i);
    await user.type(input, "Erste Antwort");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.type(screen.getByLabelText(/Reply text/i), "Zweite Antwort");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(onSend.mock.calls[0][0].idempotencyKey).not.toBe(
      onSend.mock.calls[1][0].idempotencyKey,
    );
  });
});

describe("states", () => {
  it("shows a sending state and disables the controls", () => {
    setup({ sending: true });

    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByLabelText(/Reply text/i)).toBeDisabled();
  });

  it("confirms a sent reply", () => {
    setup({ sentAt: "2026-08-05T09:00:00.000Z" });
    expect(screen.getByRole("status")).toHaveTextContent("Reply sent.");
  });

  it("shows a safe error with no server detail", () => {
    setup({
      error: new InboxRequestError(
        "INBOX_SEND_FAILED",
        // Even if a server message leaked this far, the composer renders the
        // fixed guidance rather than the message.
        "smtp.hostinger.com said 535 auth failed",
        502,
        true,
      ),
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The reply was not sent");
    expect(alert).toHaveTextContent(/saved with the conversation as failed/i);
    expect(alert.textContent).not.toContain("hostinger");
    expect(alert.textContent).not.toContain("535");
  });

  it("clears the draft on cancel", async () => {
    const user = userEvent.setup();
    const { onDismissResult } = setup();

    const input = screen.getByLabelText(/Reply text/i);
    await user.type(input, "Verworfen");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(input).toHaveValue("");
    expect(onDismissResult).toHaveBeenCalled();
  });
});

describe("when replying is not possible", () => {
  it("explains a server with sending switched off, and offers no box", () => {
    const { container } = setup({ enabled: false });

    expect(screen.getByText(/Replying is switched off/i)).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains a conversation with no reply address, and offers no box", () => {
    const { container } = setup({ recipient: null });

    expect(screen.getByText(/no usable reply address/i)).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
  });
});

describe("what it tells the person typing", () => {
  /**
   * Two facts that are true of this release and easy to get wrong in the head:
   * the message goes out as plain text, and the sent copy lives here rather
   * than in the mailbox's Sent folder, because nothing writes to IMAP.
   */
  it("says the reply is plain text and not in the mailbox's Sent folder", () => {
    setup();

    expect(screen.getByText(/plain text/i)).toBeInTheDocument();
    expect(screen.getByText(/Sent folder/i)).toBeInTheDocument();
  });

  it("offers no attachment, formatting or template control", () => {
    const { container } = setup();

    expect(container.querySelector('input[type="file"]')).toBeNull();
    for (const label of [/attach/i, /format/i, /template/i, /forward/i]) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });
});
