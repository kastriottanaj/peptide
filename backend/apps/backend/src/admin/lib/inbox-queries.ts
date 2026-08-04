/**
 * Data fetching for the inbox page.
 *
 * Built on the `@tanstack/react-query` client the Medusa dashboard already
 * mounts, the same way `lib/queries.ts` is, so these hooks join the app's
 * existing cache rather than standing up a second one.
 *
 * The mutations all invalidate the same two keys — the list and the counts —
 * because every one of them changes both. Marking a message read moves a
 * thread's unread count *and* the sidebar badge, and a UI where those disagree
 * for thirty seconds is a UI nobody trusts.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchCounts,
  fetchThread,
  fetchThreads,
  patchMessageRead,
  patchThread,
  postSync,
} from "./inbox-api";
import type { InboxRequestError } from "./inbox-errors";
import type {
  InboxCounts,
  InboxSyncResponse,
  InboxThreadDetail,
  InboxThreadList,
} from "./inbox-types";

const KEY = ["peptides", "inbox"] as const;

/** Threads are as fresh as the last poll; the list itself is cheap to refetch. */
const STALE_MS = 15_000;

/** How often the badge and counts refresh while the page is open. */
export const COUNTS_POLL_MS = 60_000;

const retry = (failureCount: number, error: unknown) => {
  const retryable = (error as { retryable?: boolean })?.retryable === true;
  return retryable && failureCount < 1;
};

export type ThreadListParams = {
  q: string;
  status: string;
  unreadOnly: boolean;
  limit: number;
  offset: number;
};

export function useInboxThreads(
  params: ThreadListParams,
): UseQueryResult<InboxThreadList, InboxRequestError> {
  return useQuery<InboxThreadList, InboxRequestError>({
    queryKey: [...KEY, "threads", params],
    queryFn: ({ signal }) => fetchThreads(params, signal),
    staleTime: STALE_MS,
    // The previous page stays on screen, dimmed, while the next one loads.
    // Replacing a populated list with skeletons on every keystroke is worse
    // than half a second of stale rows.
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useInboxThread(
  id: string | null,
): UseQueryResult<InboxThreadDetail, InboxRequestError> {
  return useQuery<InboxThreadDetail, InboxRequestError>({
    queryKey: [...KEY, "thread", id],
    queryFn: ({ signal }) => fetchThread(id as string, signal),
    enabled: Boolean(id),
    staleTime: STALE_MS,
    retry,
  });
}

export function useInboxCounts(
  options: { poll?: boolean } = {},
): UseQueryResult<InboxCounts, InboxRequestError> {
  return useQuery<InboxCounts, InboxRequestError>({
    queryKey: [...KEY, "counts"],
    queryFn: ({ signal }) => fetchCounts(signal),
    staleTime: STALE_MS,
    refetchInterval: options.poll ? COUNTS_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry,
  });
}

function useInvalidateInbox() {
  const client = useQueryClient();

  return (threadId?: string) => {
    void client.invalidateQueries({ queryKey: [...KEY, "threads"] });
    void client.invalidateQueries({ queryKey: [...KEY, "counts"] });
    if (threadId) {
      void client.invalidateQueries({ queryKey: [...KEY, "thread", threadId] });
    }
  };
}

export function useUpdateThread() {
  const invalidate = useInvalidateInbox();

  return useMutation({
    mutationFn: (input: {
      id: string;
      status?: string;
      read?: boolean;
    }) => patchThread(input.id, { status: input.status, read: input.read }),
    onSuccess: (_data, input) => invalidate(input.id),
  });
}

export function useSetMessageRead() {
  const invalidate = useInvalidateInbox();

  return useMutation({
    mutationFn: (input: { id: string; read: boolean; threadId: string }) =>
      patchMessageRead(input.id, input.read),
    onSuccess: (_data, input) => invalidate(input.threadId),
  });
}

export function useSyncInbox() {
  const invalidate = useInvalidateInbox();

  return useMutation<InboxSyncResponse, InboxRequestError, void>({
    mutationFn: () => postSync(),
    onSuccess: () => invalidate(),
  });
}
