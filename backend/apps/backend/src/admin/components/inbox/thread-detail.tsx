/**
 * One conversation, read.
 *
 * Messages oldest first — the order a person reads a thread in — each rendered
 * as **plain text inside a `<pre>`**. That is the whole rendering strategy, and
 * it is deliberate:
 *
 *  - The server stores no HTML, so there is none to render.
 *  - `white-space: pre-wrap` preserves the sender's line breaks without
 *    interpreting anything.
 *  - `{message.body_text}` is a React child, so every `<`, `&` and quote is
 *    escaped. No `dangerouslySetInnerHTML` anywhere in this feature.
 *  - No image is emitted from message content, so no remote image and no
 *    tracking pixel can be requested by opening a message.
 *  - Links are not rendered as links. A URL in an email is text here; reading a
 *    message must not be one accidental click away from following whatever a
 *    stranger sent.
 *
 * Attachments are listed by name, type and size, and there is nothing to click:
 * the bytes were never downloaded, so there is no endpoint that could serve
 * them.
 */

import type { InboxMessage, InboxThreadDetail } from "../../lib/inbox-types";
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonBlocks,
  deliveryTone,
  formatBytes,
  formatTimestamp,
  statusTone,
} from "./primitives";
import { ReplyComposer, type ReplyComposerProps } from "./reply-composer";

export function ThreadDetail({
  detail,
  loading,
  error,
  busy,
  onRetry,
  onSetStatus,
  onSetThreadRead,
  onSetMessageRead,
  reply,
}: {
  detail: InboxThreadDetail | undefined;
  loading: boolean;
  error: unknown;
  busy: boolean;
  onRetry: () => void;
  onSetStatus: (status: "open" | "resolved" | "spam") => void;
  onSetThreadRead: (read: boolean) => void;
  onSetMessageRead: (messageId: string, read: boolean) => void;
  /** Everything the reply box needs, passed through from the page. */
  reply: Omit<ReplyComposerProps, "recipient">;
}) {
  if (!detail && error) {
    return (
      <div className="pi-card__body">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!detail || loading) {
    return (
      <div className="pi-card__body">
        <SkeletonBlocks />
      </div>
    );
  }

  const { thread, messages } = detail;

  return (
    <>
      <div className="pi-card__head">
        <div>
          <h2 className="pi-card__title">{thread.subject || "(no subject)"}</h2>
          <p className="pi-card__hint">
            {thread.from_name || thread.from_email || "Unknown sender"}
            {thread.from_email && thread.from_name ? ` · ${thread.from_email}` : ""}
            {" · "}
            {thread.message_count}{" "}
            {thread.message_count === 1 ? "message" : "messages"}
            {thread.unread_count > 0 ? ` · ${thread.unread_count} unread` : ""}
          </p>
        </div>

        <div className="pi-header__actions">
          <Pill tone={statusTone(thread.status)}>{thread.status}</Pill>
        </div>
      </div>

      <div className="pi-card__body">
        <div className="pi-header__actions" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className="pi-button"
            disabled={busy}
            onClick={() => onSetThreadRead(thread.unread_count > 0)}
          >
            {thread.unread_count > 0 ? "Mark all read" : "Mark all unread"}
          </button>

          {thread.status === "resolved" ? (
            <button
              type="button"
              className="pi-button"
              disabled={busy}
              onClick={() => onSetStatus("open")}
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              className="pi-button pi-button--primary"
              disabled={busy}
              onClick={() => onSetStatus("resolved")}
            >
              Resolve
            </button>
          )}

          {thread.status === "spam" ? (
            <button
              type="button"
              className="pi-button"
              disabled={busy}
              onClick={() => onSetStatus("open")}
            >
              Not spam
            </button>
          ) : (
            <button
              type="button"
              className="pi-button"
              disabled={busy}
              onClick={() => onSetStatus("spam")}
            >
              Mark spam
            </button>
          )}
        </div>

        {!messages.length ? (
          <EmptyState
            title="No messages"
            description="This conversation has no messages left."
          />
        ) : (
          messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              busy={busy}
              onSetRead={onSetMessageRead}
            />
          ))
        )}

        {/*
          The composer sits below the conversation, where the next message
          would go. Its recipient is derived here rather than passed in, so the
          address on screen is the same one the server will resolve: the newest
          inbound message's Reply-To, falling back to its From.
        */}
        <ReplyComposer {...reply} recipient={replyRecipient(messages)} />
      </div>
    </>
  );
}

/**
 * The address a reply will go to.
 *
 * Mirrors the server's rule (`lib/inbox/reply.ts`): the newest **inbound**
 * message decides, `Reply-To` before `From`. Outbound messages are skipped —
 * threading off our own reply would address the mail to ourselves.
 */
export function replyRecipient(messages: readonly InboxMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.direction === "outbound") continue;

    const address = message.reply_to ?? message.from_email;
    if (address) return address;
  }

  return null;
}

function MessageCard({
  message,
  busy,
  onSetRead,
}: {
  message: InboxMessage;
  busy: boolean;
  onSetRead: (messageId: string, read: boolean) => void;
}) {
  const recipients = message.recipients.filter((entry) => entry.kind === "to");
  const copied = message.recipients.filter((entry) => entry.kind === "cc");

  const outbound = message.direction === "outbound";

  const className = outbound
    ? "pi-message pi-message--outbound"
    : message.is_read
      ? "pi-message"
      : "pi-message pi-message--unread";

  return (
    <article className={className}>
      <div className="pi-message__head">
        <div>
          <div className="pi-message__from">
            {message.from_name || message.from_email || "Unknown sender"}
            {message.from_email && (
              <span className="pi-message__address">
                {message.from_name ? ` <${message.from_email}>` : ""}
              </span>
            )}
          </div>
          <div className="pi-card__hint">
            {formatTimestamp(outbound ? (message.sent_at ?? message.received_at) : message.received_at)}
            {recipients.length > 0 && (
              <> · to {recipients.map((entry) => entry.email).join(", ")}</>
            )}
            {copied.length > 0 && (
              <> · cc {copied.map((entry) => entry.email).join(", ")}</>
            )}
          </div>
        </div>

        <div className="pi-header__actions">
          {outbound ? (
            <>
              <Pill tone="neutral">Sent by us</Pill>
              {message.delivery_status && (
                <Pill tone={deliveryTone(message.delivery_status)}>
                  {deliveryLabel(message.delivery_status, message.failure_reason)}
                </Pill>
              )}
            </>
          ) : (
            <>
              {!message.is_read && <Pill tone="accent">Unread</Pill>}
              <button
                type="button"
                className="pi-button"
                disabled={busy}
                onClick={() => onSetRead(message.id, !message.is_read)}
              >
                {message.is_read ? "Mark unread" : "Mark read"}
              </button>
            </>
          )}
        </div>
      </div>

      {/*
        Plain text, escaped by React, wrapped by CSS. The `<pre>` is the
        rendering strategy in one element: no markup is interpreted, and the
        sender's own line breaks survive.
      */}
      <pre className="pi-body">{message.body_text || "(no text content)"}</pre>

      {message.body_truncated && (
        <p className="pi-attachments">
          This message was truncated on import. The full text is in the mailbox.
        </p>
      )}

      {message.attachments.length > 0 && (
        <div className="pi-attachments">
          <span>
            {message.attachments.length}{" "}
            {message.attachments.length === 1 ? "attachment" : "attachments"} (not
            downloaded):
          </span>
          {message.attachments.map((attachment, index) => (
            <Pill key={`${attachment.filename}-${index}`}>
              {attachment.filename} · {attachment.content_type} ·{" "}
              {formatBytes(attachment.size)}
            </Pill>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * What a delivery status says to the person reading it.
 *
 * `failure_reason` is one of a fixed set of labels from the server, never an
 * SMTP sentence, so it is mapped here rather than printed. The distinction that
 * matters is whether trying again is worth their time.
 */
function deliveryLabel(status: string, reason: string | null): string {
	if (status === "sent") return "Delivered to the mail server";
	if (status === "pending") return "Sending…";

	switch (reason) {
		case "auth":
			return "Failed — mail login rejected (server-side fix)";
		case "tls":
			return "Failed — secure connection refused (server-side fix)";
		case "rejected":
			return "Failed — the recipient's server refused it";
		case "unreachable":
		case "temporary":
			return "Failed — temporary problem, can be retried";
		default:
			return "Failed";
	}
}
