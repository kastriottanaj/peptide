/**
 * The conversation list.
 *
 * One row per thread: sender, subject, when the latest message arrived, an
 * unread dot, and the message count. Every one of those values came from an
 * email — they are rendered as React children and are therefore escaped, which
 * is the entire defence needed as long as nobody reaches for
 * `dangerouslySetInnerHTML`. Long unbroken strings (a 300-character subject
 * with no spaces is a normal thing to receive) are handled in CSS with
 * `overflow-wrap: anywhere` rather than by truncating the text, so nothing is
 * hidden from the person reading it.
 */

import type { InboxThreadSummary } from "../../lib/inbox-types";
import {
  EmptyState,
  ErrorState,
  Pill,
  SkeletonRows,
  formatListTime,
  statusTone,
} from "./primitives";

export function ThreadList({
  threads,
  count,
  selectedId,
  loading,
  error,
  onSelect,
  onRetry,
  emptyTitle,
  emptyDescription,
}: {
  threads: InboxThreadSummary[] | undefined;
  count: number;
  selectedId: string | null;
  loading: boolean;
  error: unknown;
  onSelect: (id: string) => void;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (!threads && error) {
    return (
      <div className="pi-card__body">
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!threads) return <SkeletonRows />;

  if (!threads.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  // A refetch dims the rows rather than replacing them with skeletons: the
  // previous page is still true, and blanking the list on every keystroke or
  // page change reads as a failure.
  return (
    <ul
      className={loading ? "pi-list pi-dim" : "pi-list"}
      aria-label={`${count} conversations`}
      aria-busy={loading}
    >
      {threads.map((thread) => (
        <li key={thread.id} className="pi-list__item">
          <button
            type="button"
            className="pi-list__button"
            aria-current={thread.id === selectedId}
            onClick={() => onSelect(thread.id)}
          >
            <span className="pi-row__top">
              <span
                className={
                  thread.unread_count > 0
                    ? "pi-row__sender pi-row__sender--unread"
                    : "pi-row__sender"
                }
              >
                {thread.from_name || thread.from_email || "Unknown sender"}
                {thread.unread_count > 0 && (
                  <span className="pi-sr"> — unread</span>
                )}
              </span>
              <span className="pi-row__time">
                {formatListTime(thread.last_message_at)}
              </span>
            </span>

            <span className="pi-row__subject">
              {thread.subject || "(no subject)"}
            </span>

            <span className="pi-row__meta">
              {thread.from_email && <span>{thread.from_email}</span>}
              <span>
                {thread.message_count}{" "}
                {thread.message_count === 1 ? "message" : "messages"}
              </span>
              {thread.unread_count > 0 && (
                <Pill tone="accent">{thread.unread_count} unread</Pill>
              )}
              {thread.status !== "open" && (
                <Pill tone={statusTone(thread.status)}>{thread.status}</Pill>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Pager({
  offset,
  limit,
  count,
  loading,
  onOffset,
}: {
  offset: number;
  limit: number;
  count: number;
  loading: boolean;
  onOffset: (next: number) => void;
}) {
  const from = count === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, count);
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < count;

  if (count === 0 && !loading) return null;

  return (
    <div className="pi-pager">
      <span>
        {from}–{to} of {count}
      </span>
      <span className="pi-header__actions">
        <button
          type="button"
          className="pi-button"
          disabled={!hasPrevious || loading}
          onClick={() => onOffset(Math.max(0, offset - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          className="pi-button"
          disabled={!hasNext || loading}
          onClick={() => onOffset(offset + limit)}
        >
          Next
        </button>
      </span>
    </div>
  );
}
