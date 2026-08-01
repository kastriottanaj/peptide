/**
 * The period and tab vocabulary shared by the dashboard's three tabs.
 *
 * Both live in the URL. That is not a nicety: an admin who sends a colleague a
 * link to "the 90-day view" should not have them land on 7 days, and a browser
 * refresh in the middle of an investigation should not silently reset the
 * question being asked.
 */

export const OPS_PERIODS = ["7d", "30d", "90d"] as const;
export type OpsPeriod = (typeof OPS_PERIODS)[number];

export const TABS = ["overview", "live", "conversion"] as const;
export type AnalyticsTab = (typeof TABS)[number];

export const DEFAULT_PERIOD: OpsPeriod = "7d";
export const DEFAULT_TAB: AnalyticsTab = "overview";

export const PERIOD_LABELS: Record<OpsPeriod, string> = {
  "7d": "7D",
  "30d": "30D",
  "90d": "90D",
};

export const PERIOD_DESCRIPTIONS: Record<OpsPeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export const TAB_LABELS: Record<AnalyticsTab, string> = {
  overview: "Overview",
  live: "Live",
  conversion: "Conversion & Sources",
};

/**
 * Read a period out of a URL parameter.
 *
 * An unrecognised value falls back to the default rather than erroring: a
 * hand-edited or stale URL should show a dashboard, not a stack trace.
 */
export function parsePeriod(raw: string | null): OpsPeriod {
  return (OPS_PERIODS as readonly string[]).includes(raw ?? "")
    ? (raw as OpsPeriod)
    : DEFAULT_PERIOD;
}

export function parseTab(raw: string | null): AnalyticsTab {
  return (TABS as readonly string[]).includes(raw ?? "")
    ? (raw as AnalyticsTab)
    : DEFAULT_TAB;
}

/**
 * The GA4 period matching an ops period.
 *
 * They are the same three strings, which is why the summary API was extended
 * with `90d` rather than the dashboard quietly asking GA4 for 30 days while
 * labelling the page "90 days".
 */
export function ga4PeriodFor(period: OpsPeriod): OpsPeriod {
  return period;
}
