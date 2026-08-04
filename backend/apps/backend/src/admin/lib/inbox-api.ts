/**
 * Inbox requests, on the admin client the analytics dashboard already mounts.
 *
 * `sdk` is imported from `./sdk` rather than constructed again: a second Medusa
 * client would be a second place to get the credentials mode, the base URL and
 * the session handling subtly wrong, on pages that display customer
 * correspondence.
 *
 * Everything here is GET, PATCH or POST against `/admin/inbox/*`. There is no
 * send, no reply and no attachment fetch, because no such endpoint exists.
 */

import { sdk } from "./sdk";
import { toInboxError } from "./inbox-errors";
import type {
  InboxCounts,
  InboxReplyResponse,
  InboxSyncResponse,
  InboxThreadDetail,
  InboxThreadList,
} from "./inbox-types";

async function request<T>(
  path: string,
  options: {
    method: "GET" | "PATCH" | "POST";
    query?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> {
  try {
    return await sdk.client.fetch<T>(path, {
      method: options.method,
      query: options.query,
      body: options.body as never,
      signal: options.signal,
    });
  } catch (error) {
    // An aborted request is a cancellation, not a failure to report; let
    // react-query see it as what it is.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw toInboxError(error);
  }
}

export function fetchThreads(
  params: {
    q?: string;
    status?: string;
    unreadOnly?: boolean;
    limit: number;
    offset: number;
  },
  signal?: AbortSignal,
): Promise<InboxThreadList> {
  const query: Record<string, string> = {
    limit: String(params.limit),
    offset: String(params.offset),
  };

  if (params.q) query.q = params.q;
  if (params.status) query.status = params.status;
  if (params.unreadOnly) query.unread_only = "true";

  return request<InboxThreadList>("/admin/inbox/threads", {
    method: "GET",
    query,
    signal,
  });
}

export function fetchThread(
  id: string,
  signal?: AbortSignal,
): Promise<InboxThreadDetail> {
  return request<InboxThreadDetail>(
    `/admin/inbox/threads/${encodeURIComponent(id)}`,
    { method: "GET", signal },
  );
}

export function fetchCounts(signal?: AbortSignal): Promise<InboxCounts> {
  return request<InboxCounts>("/admin/inbox/counts", { method: "GET", signal });
}

export function patchThread(
  id: string,
  body: { status?: string; read?: boolean },
): Promise<{ thread: InboxThreadDetail["thread"] }> {
  return request(`/admin/inbox/threads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

export function patchMessageRead(
  id: string,
  read: boolean,
): Promise<{ message: { id: string; is_read: boolean } }> {
  return request(`/admin/inbox/messages/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
    body: { read },
  });
}

export function postSync(): Promise<InboxSyncResponse> {
  return request<InboxSyncResponse>("/admin/inbox/sync", { method: "POST" });
}

/**
 * Send a reply.
 *
 * Two fields, and neither is an address: the recipient, sender, subject and
 * threading headers all come from the stored conversation. `idempotencyKey`
 * stays the same across a retry of the *same* draft, which is what makes a
 * double click or a retried request return the existing message instead of
 * sending a second one.
 */
export function postReply(
  threadId: string,
  input: { body: string; idempotencyKey: string },
): Promise<InboxReplyResponse> {
  return request<InboxReplyResponse>(
    `/admin/inbox/threads/${encodeURIComponent(threadId)}/reply`,
    {
      method: "POST",
      body: { body: input.body, idempotency_key: input.idempotencyKey },
    },
  );
}
