/**
 * Data fetching for the analytics dashboard.
 *
 * Built on the `@tanstack/react-query` client the Medusa dashboard already
 * mounts — the extension imports the same externalised package, so these hooks
 * join the app's existing cache rather than standing up a second one.
 *
 * **The GA4 and Medusa halves are separate queries on purpose.** They fail for
 * unrelated reasons: Google can be unreachable while Postgres is fine, and vice
 * versa. Fetching them together would mean one `isError` for both, and the
 * first thing a merchant loses in a Google outage would be their own revenue
 * figures. Each panel subscribes to the query it needs and renders its own
 * failure.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getAnalytics } from "./sdk";
import type { AnalyticsError } from "./errors";
import type { OpsPeriod } from "./periods";
import type {
  Ga4Health,
  Ga4Realtime,
  Ga4Summary,
  OpsConversion,
  OpsLive,
  OpsOverview,
} from "./types";

const KEY = ["peptides", "analytics"] as const;

/**
 * How long a fetched report stays fresh in the browser.
 *
 * Matched to the server's own cache so a tab switch inside that window costs
 * nothing at all, rather than a request that the server answers from its cache
 * anyway.
 */
const STALE_MS = 30_000;

/**
 * Failures are retried once, and only when the server said the failure was
 * transient. Retrying a permission denial or a missing property just delays the
 * message that tells the operator what to fix.
 */
const retry = (failureCount: number, error: unknown) => {
  const retryable = (error as { retryable?: boolean })?.retryable === true;
  return retryable && failureCount < 1;
};

export function useOpsOverview(
  period: OpsPeriod,
): UseQueryResult<OpsOverview, AnalyticsError> {
  return useQuery<OpsOverview, AnalyticsError>({
    queryKey: [...KEY, "ops", "overview", period],
    // `signal` comes from react-query and is aborted when the query is
    // superseded — a fast period change cancels the request it replaced
    // instead of letting two responses race to the cache.
    queryFn: ({ signal }) =>
      getAnalytics<OpsOverview>("/admin/analytics/ops/overview", {
        scope: "ops",
        query: { period },
        signal,
      }),
    staleTime: STALE_MS,
    // The previous period's data stays on screen, dimmed, while the next one
    // loads. Replacing a populated dashboard with skeletons on every period
    // click is a worse experience than a half-second of stale numbers.
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useOpsConversion(
  period: OpsPeriod,
): UseQueryResult<OpsConversion, AnalyticsError> {
  return useQuery<OpsConversion, AnalyticsError>({
    queryKey: [...KEY, "ops", "conversion", period],
    queryFn: ({ signal }) =>
      getAnalytics<OpsConversion>("/admin/analytics/ops/conversion", {
        scope: "ops",
        query: { period },
        signal,
      }),
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useGa4Summary(
  period: OpsPeriod | "today",
  options: { enabled?: boolean } = {},
): UseQueryResult<Ga4Summary, AnalyticsError> {
  return useQuery<Ga4Summary, AnalyticsError>({
    queryKey: [...KEY, "ga4", "summary", period],
    queryFn: ({ signal }) =>
      getAnalytics<Ga4Summary>("/admin/analytics/ga4/summary", {
        scope: "ga4",
        query: { period },
        signal,
      }),
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
    retry,
  });
}

export function useGa4Health(): UseQueryResult<Ga4Health, AnalyticsError> {
  return useQuery<Ga4Health, AnalyticsError>({
    queryKey: [...KEY, "ga4", "health"],
    queryFn: ({ signal }) =>
      getAnalytics<Ga4Health>("/admin/analytics/ga4/health", {
        scope: "ga4",
        signal,
      }),
    // Health is the connection indicator in the page header. Five minutes is
    // long enough not to hammer Google on every tab switch — the endpoint is
    // uncached server-side and issues a real report — and short enough that a
    // credential fixed on the server shows up without a reload.
    staleTime: 5 * 60_000,
    retry,
  });
}

/**
 * Whether the document is currently visible.
 *
 * The Live tab polls; a hidden tab must not. This is the switch that makes that
 * possible, and it is a hook rather than a check inside the query so that a tab
 * becoming visible again immediately re-renders and refetches.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState !== "hidden",
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    update();

    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}

/** Poll interval for the Live tab, per the spec. */
export const LIVE_POLL_MS = 60_000;

export function useGa4Realtime(
  options: { enabled?: boolean; poll?: boolean } = {},
): UseQueryResult<Ga4Realtime, AnalyticsError> {
  return useQuery<Ga4Realtime, AnalyticsError>({
    queryKey: [...KEY, "ga4", "realtime"],
    queryFn: ({ signal }) =>
      getAnalytics<Ga4Realtime>("/admin/analytics/ga4/realtime", {
        scope: "ga4",
        signal,
      }),
    // `false` stops the timer outright rather than lengthening it. A hidden tab
    // costs nothing, and Google's Data API quota is per-property and shared
    // with anyone else reporting on it.
    refetchInterval: options.poll ? LIVE_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    enabled: options.enabled ?? true,
    placeholderData: (previous) => previous,
    retry,
  });
}

export function useOpsLive(
  options: { enabled?: boolean; poll?: boolean } = {},
): UseQueryResult<OpsLive, AnalyticsError> {
  return useQuery<OpsLive, AnalyticsError>({
    queryKey: [...KEY, "ops", "live"],
    queryFn: ({ signal }) =>
      getAnalytics<OpsLive>("/admin/analytics/ops/live", {
        scope: "ops",
        signal,
      }),
    refetchInterval: options.poll ? LIVE_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    enabled: options.enabled ?? true,
    placeholderData: (previous) => previous,
    retry,
  });
}
