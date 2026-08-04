/**
 * The reply box.
 *
 * Deliberately the smallest composer that can send a support answer: one
 * textarea, Send, Cancel. There is no recipient field, no subject field, no cc,
 * no attachment picker, no formatting toolbar and no template menu — not
 * because they were left for later, but because the endpoint accepts a body and
 * nothing else. A control here that the API would ignore is a lie to whoever is
 * typing.
 *
 * **The idempotency key belongs to the draft, not to the click.** It is minted
 * when the composer first has text and kept until a send succeeds, so a double
 * click, an impatient second press, or a retry after a failure all carry the
 * same key and produce at most one email. It is reset only when the draft is
 * cleared — a new draft is a new message.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { inboxErrorGuidance } from "../../lib/inbox-errors";

/** RFC 4122 where available, random otherwise. Both fit the API's key format. */
function newIdempotencyKey(): string {
  const globalCrypto = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;

  if (typeof globalCrypto?.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }

  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export type ReplyComposerProps = {
  /** The address the reply will go to, for the "to" line. Never editable. */
  recipient: string | null;
  /** False when the server has sending switched off. */
  enabled: boolean;
  sending: boolean;
  /** The last send's error, if it failed. */
  error: unknown;
  /** Set after a successful send, cleared when the draft is reset. */
  sentAt: string | null;
  maxChars: number;
  onSend: (input: { body: string; idempotencyKey: string }) => void;
  onDismissResult: () => void;
};

export function ReplyComposer({
  recipient,
  enabled,
  sending,
  error,
  sentAt,
  maxChars,
  onSend,
  onDismissResult,
}: ReplyComposerProps) {
  const [body, setBody] = useState("");
  const keyRef = useRef<string | null>(null);

  const trimmed = body.trim();
  const tooLong = body.length > maxChars;
  const canSend = Boolean(recipient) && enabled && !sending && trimmed.length > 0 && !tooLong;

  const guidance = useMemo(() => (error ? inboxErrorGuidance(error) : null), [error]);

  const handleSend = useCallback(() => {
    if (!canSend) return;

    // One key per draft: minted on the first attempt and reused by every
    // retry of the same text, which is what makes a second click harmless.
    keyRef.current = keyRef.current ?? newIdempotencyKey();
    onSend({ body: trimmed, idempotencyKey: keyRef.current });
  }, [canSend, onSend, trimmed]);

  const handleReset = useCallback(() => {
    setBody("");
    keyRef.current = null;
    onDismissResult();
  }, [onDismissResult]);

  if (!enabled) {
    return (
      <div className="pi-composer">
        <p className="pi-notice pi-notice--warning" style={{ margin: 0 }}>
          Replying is switched off on this server. Answer this conversation in
          webmail; the mailbox is unchanged either way.
        </p>
      </div>
    );
  }

  if (!recipient) {
    return (
      <div className="pi-composer">
        <p className="pi-notice pi-notice--warning" style={{ margin: 0 }}>
          This conversation has no usable reply address, so no reply can be sent
          from here.
        </p>
      </div>
    );
  }

  return (
    <div className="pi-composer">
      <div className="pi-composer__head">
        <span className="pi-composer__to">
          Reply to <strong>{recipient}</strong>
        </span>
        <span className={tooLong ? "pi-composer__count pi-composer__count--over" : "pi-composer__count"}>
          {body.length} / {maxChars}
        </span>
      </div>

      <label className="pi-sr" htmlFor="pi-reply-body">
        Reply text
      </label>
      <textarea
        id="pi-reply-body"
        className="pi-composer__input"
        rows={6}
        value={body}
        disabled={sending}
        placeholder="Write a plain-text reply…"
        onChange={(event) => setBody(event.target.value)}
      />

      {/*
        Stated rather than implied: someone typing here should know the message
        leaves as plain text and that it will not show up in the mailbox's Sent
        folder, because nothing in this release writes to IMAP.
      */}
      <p className="pi-composer__hint">
        Sent as plain text from the support address. Attachments and formatting
        are not supported, and the sent copy is stored here rather than in the
        mailbox's Sent folder.
      </p>

      {guidance && (
        <div className="pi-error" role="alert">
          <span className="pi-error__title">
            <span className="pi-dot pi-dot--error" aria-hidden="true" />
            {guidance.title}
          </span>
          <p className="pi-error__body">{guidance.detail}</p>
          <span className="pi-error__code">{guidance.code}</span>
        </div>
      )}

      {sentAt && !error && (
        <p className="pi-notice" role="status" style={{ marginBottom: 0 }}>
          Reply sent.
        </p>
      )}

      <div className="pi-header__actions">
        <button
          type="button"
          className="pi-button pi-button--primary"
          disabled={!canSend}
          onClick={handleSend}
        >
          {sending ? "Sending…" : error ? "Try again" : "Send reply"}
        </button>
        <button
          type="button"
          className="pi-button"
          disabled={sending || (!body && !error && !sentAt)}
          onClick={handleReset}
        >
          {sentAt && !error ? "New reply" : "Cancel"}
        </button>
      </div>
    </div>
  );
}
