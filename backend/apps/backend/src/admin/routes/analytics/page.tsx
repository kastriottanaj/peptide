/**
 * The Analytics dashboard.
 *
 * One admin route at `/app/analytics`, three tabs, mounted inside the Medusa
 * admin shell. There is no second sidebar and no alternative layout: this is a
 * page in the existing application, added through `defineRouteConfig`, which is
 * the supported extension mechanism in Medusa v2 and the only one that puts an
 * item in the real navigation.
 *
 * **Tab and period live in the URL.** `?tab=live&period=30d` survives a
 * refresh, a bookmark and a link sent to a colleague. `replace` is used for
 * these updates so that flipping between tabs does not fill the browser's back
 * stack with states nobody wants to walk back through.
 *
 * **The two data sources are fetched independently.** Each panel subscribes to
 * either the Medusa query or the GA4 query and renders its own loading, error
 * and empty state, so a Google outage empties the traffic panels and leaves the
 * revenue figures exactly where they were — and vice versa.
 */

import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChartBar } from "@medusajs/icons";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import "../../components/analytics/analytics.css";

import { ConversionTab } from "../../components/analytics/conversion-tab";
import {
  buildConversionCsv,
  buildOverviewCsv,
} from "../../components/analytics/export";
import { LiveTab } from "../../components/analytics/live-tab";
import { OverviewTab } from "../../components/analytics/overview-tab";
import { buildCsv, csvFilename, downloadCsv } from "../../lib/csv";
import { formatRelative } from "../../lib/format";
import {
  DEFAULT_PERIOD,
  OPS_PERIODS,
  PERIOD_DESCRIPTIONS,
  PERIOD_LABELS,
  TABS,
  TAB_LABELS,
  parsePeriod,
  parseTab,
  type AnalyticsTab,
  type OpsPeriod,
} from "../../lib/periods";
import {
  useDocumentVisible,
  useGa4Health,
  useGa4Realtime,
  useGa4Summary,
  useOpsConversion,
  useOpsLive,
  useOpsOverview,
} from "../../lib/queries";
import type { SectionState } from "../../components/analytics/primitives";
import { errorGuidance } from "../../components/analytics/primitives";

/** A react-query result narrowed to what `Section` needs. */
function sectionState<T>(query: {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: () => unknown;
}): SectionState<T> {
  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

const AnalyticsPage = () => {
  const [params, setParams] = useSearchParams();

  const tab = parseTab(params.get("tab"));
  const period = parsePeriod(params.get("period"));

  const setParam = useCallback(
    (key: "tab" | "period", value: string) => {
      const next = new URLSearchParams(params);
      next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Polling only while the tab is both the Live one and actually on screen.
  const documentVisible = useDocumentVisible();
  const livePolling = tab === "live" && documentVisible;

  const overview = useOpsOverview(period);
  const conversion = useOpsConversion(period);
  const summary = useGa4Summary(period);
  const health = useGa4Health();

  // Realtime and today's figures are only fetched on the tab that shows them —
  // there is no reason to spend Google's quota on a tab nobody is looking at.
  const realtime = useGa4Realtime({
    enabled: tab === "live",
    poll: livePolling,
  });
  const live = useOpsLive({ enabled: tab === "live", poll: livePolling });
  const todaySummary = useGa4Summary("today", { enabled: tab === "live" });

  const todayState = useMemo<
    SectionState<{ users: number; sessions: number; views: number }>
  >(
    () => ({
      data: todaySummary.data
        ? {
            users: todaySummary.data.totals.totalUsers,
            sessions: todaySummary.data.totals.sessions,
            views: todaySummary.data.totals.screenPageViews,
          }
        : undefined,
      isLoading: todaySummary.isLoading,
      isFetching: todaySummary.isFetching,
      error: todaySummary.error,
      refetch: () => {
        void todaySummary.refetch();
      },
    }),
    [todaySummary],
  );

  const handleExport = useCallback(() => {
    const sections =
      tab === "conversion"
        ? buildConversionCsv(period, conversion.data, summary.data)
        : buildOverviewCsv(period, overview.data, summary.data);

    downloadCsv(csvFilename(tab, period), buildCsv(sections));
  }, [tab, period, conversion.data, overview.data, summary.data]);

  const lastUpdated =
    tab === "live"
      ? (live.data?.generatedAt ?? realtime.data?.generatedAt)
      : tab === "conversion"
        ? conversion.data?.generatedAt
        : overview.data?.generatedAt;

  const refreshing =
    tab === "live"
      ? live.isFetching || realtime.isFetching
      : tab === "conversion"
        ? conversion.isFetching || summary.isFetching
        : overview.isFetching || summary.isFetching;

  const handleRefresh = useCallback(() => {
    if (tab === "live") {
      void live.refetch();
      void realtime.refetch();
      void todaySummary.refetch();
      return;
    }
    if (tab === "conversion") {
      void conversion.refetch();
      void summary.refetch();
      return;
    }
    void overview.refetch();
    void summary.refetch();
  }, [tab, live, realtime, todaySummary, conversion, summary, overview]);

  return (
    <div className="pa">
      <header className="pa-header">
        <div>
          <h1 className="pa-header__title">Analytics</h1>
          <div className="pa-header__meta">
            <span>{PERIOD_DESCRIPTIONS[period]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {lastUpdated
                ? `Updated ${formatRelative(lastUpdated)}`
                : "Loading…"}
            </span>
            <span aria-hidden="true">·</span>
            <ConnectionIndicator
              health={health.data}
              error={health.error}
              loading={health.isLoading}
            />
          </div>
        </div>

        <div className="pa-header__actions">
          <div
            className="pa-segment"
            role="group"
            aria-label="Reporting period"
          >
            {OPS_PERIODS.map((option) => (
              <button
                key={option}
                type="button"
                className="pa-segment__button"
                aria-pressed={option === period}
                onClick={() => setParam("period", option)}
              >
                {PERIOD_LABELS[option]}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="pa-button"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>

          <button
            type="button"
            className="pa-button pa-button--primary"
            onClick={handleExport}
          >
            Export CSV
          </button>
        </div>
      </header>

      <div
        className="pa-segment"
        role="tablist"
        aria-label="Analytics sections"
        style={{ marginBottom: 14 }}
      >
        {TABS.map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            id={`pa-tab-${option}`}
            aria-selected={option === tab}
            aria-controls={`pa-panel-${option}`}
            className="pa-segment__button"
            onClick={() => setParam("tab", option)}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`pa-panel-${tab}`}
        aria-labelledby={`pa-tab-${tab}`}
      >
        {tab === "overview" && (
          <OverviewTab
            period={period}
            ops={sectionState(overview)}
            ga4={sectionState(summary)}
          />
        )}

        {tab === "live" && (
          <LiveTab
            realtime={sectionState(realtime)}
            live={sectionState(live)}
            todaySummary={todayState}
            polling={livePolling}
          />
        )}

        {tab === "conversion" && (
          <ConversionTab
            period={period}
            ops={sectionState(conversion)}
            ga4={sectionState(summary)}
          />
        )}
      </div>
    </div>
  );
};

/**
 * The GA4 connection state, in the page header.
 *
 * Reads the health endpoint, which proves the service account can actually read
 * the property rather than merely that some variables are set. A failure here
 * is deliberately not alarming in tone: it means the traffic panels will be
 * empty, and says nothing about the shop's own figures.
 */
function ConnectionIndicator({
  health,
  error,
  loading,
}: {
  health: { propertyIdLastFour: string } | undefined;
  error: unknown;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span>
        <span className="pa-dot pa-dot--idle" aria-hidden="true" /> Checking
        Google Analytics…
      </span>
    );
  }

  if (error) {
    const { title } = errorGuidance(error);
    return (
      <span>
        <span className="pa-dot pa-dot--warn" aria-hidden="true" /> {title} —
        order and revenue figures are unaffected
      </span>
    );
  }

  return (
    <span>
      <span className="pa-dot pa-dot--ok" aria-hidden="true" /> Google Analytics
      connected
      {health ? ` (…${health.propertyIdLastFour})` : ""}
    </span>
  );
}

export const config = defineRouteConfig({
  label: "Analytics",
  icon: ChartBar,
});

export default AnalyticsPage;

/**
 * Exported for tests, which need the same defaults the page uses without
 * mounting the whole admin shell.
 */
export const ANALYTICS_DEFAULTS = {
  tab: "overview" as AnalyticsTab,
  period: DEFAULT_PERIOD as OpsPeriod,
};
