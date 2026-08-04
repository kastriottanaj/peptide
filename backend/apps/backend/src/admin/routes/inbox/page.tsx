/**
 * The Inbox.
 *
 * One admin route at `/app/inbox`: a filtered, searchable list of conversations
 * on the left, the selected conversation on the right. Mounted inside the
 * Medusa admin shell through `defineRouteConfig`, the same supported extension
 * mechanism the Analytics dashboard uses, and styled to match it.
 *
 * **What this page cannot do is as deliberate as what it can.** There is no
 * reply box, no forward button, no attachment download and no compose control,
 * because version one is a reader — see
 * `docs/specs/2026-08-04-admin-email-inbox.md`. Nothing here renders HTML from
 * an email either; message bodies are plain text in a `<pre>`.
 *
 * **State lives in the URL.** `?status=open&q=rechnung&thread=ithr_…&offset=25`
 * survives a refresh, a bookmark and a link sent to a colleague. `replace` is
 * used for these updates so flipping between conversations does not fill the
 * back stack.
 */

import { defineRouteConfig } from "@medusajs/admin-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import "../../components/inbox/inbox.css";

import { InboxNavIcon } from "../../components/inbox/nav-icon";
import { Card, EmptyState, Notice } from "../../components/inbox/primitives";
import { ThreadDetail } from "../../components/inbox/thread-detail";
import { Pager, ThreadList } from "../../components/inbox/thread-list";
import { SYNC_STATUS_MESSAGES } from "../../lib/inbox-errors";
import {
  useInboxCounts,
  useInboxThread,
  useInboxThreads,
  useSetMessageRead,
  useSyncInbox,
  useUpdateThread,
} from "../../lib/inbox-queries";
import {
  INBOX_STATUS_FILTERS,
  INBOX_STATUS_LABELS,
  parseStatusFilter,
} from "../../lib/inbox-types";

const PAGE_SIZE = 25;

const InboxPage = () => {
  const [params, setParams] = useSearchParams();

  const status = parseStatusFilter(params.get("status"));
  const unreadOnly = params.get("unread") === "true";
  const query = params.get("q") ?? "";
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const selectedId = params.get("thread");

  // The search box is local state, pushed to the URL on submit. Putting every
  // keystroke in the URL would mean a history entry — and a request — per
  // letter typed.
  const [searchDraft, setSearchDraft] = useState(query);
  useEffect(() => setSearchDraft(query), [query]);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const threads = useInboxThreads({
    q: query,
    status,
    unreadOnly,
    limit: PAGE_SIZE,
    offset,
  });
  const counts = useInboxCounts({ poll: true });
  const detail = useInboxThread(selectedId);

  const updateThread = useUpdateThread();
  const setMessageRead = useSetMessageRead();
  const sync = useSyncInbox();

  const busy = updateThread.isPending || setMessageRead.isPending;

  const handleSelect = useCallback(
    (id: string) => setParam({ thread: id }),
    [setParam],
  );

  const handleStatus = useCallback(
    (next: "open" | "resolved" | "spam") => {
      if (!selectedId) return;
      updateThread.mutate({ id: selectedId, status: next });
    },
    [selectedId, updateThread],
  );

  const handleThreadRead = useCallback(
    (read: boolean) => {
      if (!selectedId) return;
      updateThread.mutate({ id: selectedId, read });
    },
    [selectedId, updateThread],
  );

  const handleMessageRead = useCallback(
    (messageId: string, read: boolean) => {
      if (!selectedId) return;
      setMessageRead.mutate({ id: messageId, read, threadId: selectedId });
    },
    [selectedId, setMessageRead],
  );

  const unread = counts.data?.unread_messages ?? 0;

  const syncMessage = useMemo(() => {
    if (sync.isPending) return "Checking the mailbox…";
    if (sync.error) return "The sync request failed.";
    if (!sync.data) return null;

    const base = SYNC_STATUS_MESSAGES[sync.data.status] ?? "Sync finished.";
    return sync.data.status === "ok" && sync.data.imported > 0
      ? `${base} ${sync.data.imported} new message(s) imported.`
      : base;
  }, [sync.isPending, sync.error, sync.data]);

  return (
    <div className="pi">
      <header className="pi-header">
        <div>
          <h1 className="pi-header__title">Inbox</h1>
          <div className="pi-header__meta">
            <span>
              {unread > 0 ? `${unread} unread` : "No unread messages"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{counts.data?.open ?? 0} open</span>
            <span aria-hidden="true">·</span>
            <ImporterIndicator enabled={counts.data?.enabled} />
          </div>
        </div>

        <div className="pi-header__actions">
          <button
            type="button"
            className="pi-button"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            className="pi-button"
            disabled={threads.isFetching}
            onClick={() => {
              void threads.refetch();
              void counts.refetch();
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {syncMessage && <Notice>{syncMessage}</Notice>}

      {counts.data?.enabled === false && (
        <Notice tone="warning">
          The mailbox importer is switched off on this server, so no new mail is
          arriving here. Messages already imported are shown below.
        </Notice>
      )}

      <div className="pi-layout">
        <Card
          flush
          title={
            <div className="pi-segment" role="group" aria-label="Filter by status">
              {INBOX_STATUS_FILTERS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="pi-segment__button"
                  aria-pressed={option === status}
                  onClick={() => setParam({ status: option, offset: null })}
                >
                  {INBOX_STATUS_LABELS[option]}
                  {option === "open" && counts.data
                    ? ` (${counts.data.open})`
                    : ""}
                </button>
              ))}
            </div>
          }
          actions={
            <label className="pi-check">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) =>
                  setParam({
                    unread: event.target.checked ? "true" : null,
                    offset: null,
                  })
                }
              />
              Unread only
            </label>
          }
        >
          <form
            className="pi-header__actions"
            style={{ padding: "12px 18px 0" }}
            onSubmit={(event) => {
              event.preventDefault();
              setParam({ q: searchDraft.trim(), offset: null });
            }}
          >
            <label className="pi-sr" htmlFor="pi-search">
              Search by sender, address or subject
            </label>
            <input
              id="pi-search"
              className="pi-search"
              type="search"
              placeholder="Search sender, address or subject"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <button type="submit" className="pi-button">
              Search
            </button>
            {query && (
              <button
                type="button"
                className="pi-button"
                onClick={() => setParam({ q: null, offset: null })}
              >
                Clear
              </button>
            )}
          </form>

          <ThreadList
            threads={threads.data?.threads}
            count={threads.data?.count ?? 0}
            selectedId={selectedId}
            loading={threads.isFetching}
            error={threads.error}
            onSelect={handleSelect}
            onRetry={() => void threads.refetch()}
            emptyTitle={
              query || unreadOnly
                ? "Nothing matches those filters"
                : status === "open"
                  ? "No open conversations"
                  : `No ${status} conversations`
            }
            emptyDescription={
              query || unreadOnly
                ? "Try a different search or clear the filters."
                : "Incoming email appears here once the mailbox importer is configured and running."
            }
          />

          <Pager
            offset={offset}
            limit={threads.data?.limit ?? PAGE_SIZE}
            count={threads.data?.count ?? 0}
            loading={threads.isFetching}
            onOffset={(next) =>
              setParam({ offset: next > 0 ? String(next) : null })
            }
          />
        </Card>

        <Card flush>
          {!selectedId ? (
            <EmptyState
              title="No conversation selected"
              description="Pick a conversation on the left to read it."
            />
          ) : (
            <ThreadDetail
              detail={detail.data}
              loading={detail.isLoading}
              error={detail.error}
              busy={busy}
              onRetry={() => void detail.refetch()}
              onSetStatus={handleStatus}
              onSetThreadRead={handleThreadRead}
              onSetMessageRead={handleMessageRead}
            />
          )}
        </Card>
      </div>

      <p className="pi-card__hint" style={{ marginTop: 12 }}>
        Messages are shown as plain text; email HTML, images and attachments are
        never loaded. Replies are sent from the mailbox itself, not from here.
      </p>
    </div>
  );
};

/**
 * Whether the importer is running — a dot and a sentence, nothing more.
 *
 * `enabled` is the only operational fact this page is given. There is no host,
 * no mailbox name, no user and no IMAP error, because an admin session is not
 * a reason to hand out the mail server's answers, and this indicator exists
 * precisely to be looked at when something is wrong.
 */
function ImporterIndicator({ enabled }: { enabled: boolean | undefined }) {
  if (enabled === undefined) {
    return (
      <span>
        <span className="pi-dot pi-dot--idle" aria-hidden="true" /> Checking…
      </span>
    );
  }

  return enabled ? (
    <span>
      <span className="pi-dot pi-dot--ok" aria-hidden="true" /> Importer active
    </span>
  ) : (
    <span>
      <span className="pi-dot pi-dot--warn" aria-hidden="true" /> Importer off
    </span>
  );
}

export const config = defineRouteConfig({
  label: "Inbox",
  icon: InboxNavIcon,
});

export default InboxPage;
