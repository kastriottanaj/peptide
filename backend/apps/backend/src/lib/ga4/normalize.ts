/**
 * Turning GA4 report responses into plain JSON.
 *
 * The Data API returns every metric — counts, revenue, ratios alike — as a
 * *string*, and omits rows entirely when there is no data rather than returning
 * zeros. Both are handled here so no caller has to remember: `"1234"` becomes
 * `1234`, `"12.34"` becomes `12.34`, and absent becomes `0`.
 */

/** The subset of the Data API response shape this module relies on. */
export type Ga4Row = {
  dimensionValues?: Array<{ value?: string | null } | null> | null;
  metricValues?: Array<{ value?: string | null } | null> | null;
};

export type Ga4ReportResponse = {
  rows?: Array<Ga4Row | null> | null;
};

/**
 * A GA4 metric string as a number.
 *
 * Anything unparseable — `null`, `""`, `"n/a"`, `Infinity` — becomes `0`. A
 * dashboard showing `0` for a metric Google could not express is honest; one
 * showing `NaN` is a bug report, and one throwing takes down the whole report
 * over a single odd cell.
 */
export function toNumber(value: string | null | undefined): number {
  if (value === null || value === undefined) return 0;

  const trimmed = value.trim();
  if (trimmed === "") return 0;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Dimension value at `index`, or `""` when the row does not carry it. */
export function dimensionAt(row: Ga4Row, index: number): string {
  return row.dimensionValues?.[index]?.value ?? "";
}

/** Metric value at `index` as a number. */
export function metricAt(row: Ga4Row, index: number): number {
  return toNumber(row.metricValues?.[index]?.value);
}

/**
 * Metrics of the first row, keyed by the metric names *as requested*.
 *
 * Positional rather than header-driven: the API returns metric values in
 * request order, and reading them back by our own request array means a
 * response with unexpected headers cannot silently shift revenue into the
 * sessions field.
 *
 * A response with no rows yields every requested metric at `0` — the correct
 * reading of "this property had no traffic in this window", and the case that
 * would otherwise crash a dashboard on a quiet day.
 */
export function totalsFromResponse<T extends readonly string[]>(
  response: Ga4ReportResponse | null | undefined,
  metricNames: T,
): Record<T[number], number> {
  const row = response?.rows?.[0] ?? null;
  const totals = {} as Record<T[number], number>;

  metricNames.forEach((name, index) => {
    totals[name as T[number]] = row ? metricAt(row, index) : 0;
  });

  return totals;
}

/**
 * Every row as `{ <dimensionKey>: string, ...metrics }`.
 *
 * `dimensionKey` is the name the response should use for the single dimension,
 * which is not always the GA4 dimension id — `sessionDefaultChannelGroup` is
 * `channelGroup` to a client that does not care what Google calls it.
 */
export function rowsToObjects<M extends readonly string[]>(
  response: Ga4ReportResponse | null | undefined,
  dimensionKey: string,
  metricNames: M,
  transformDimension: (value: string) => string = (value) => value,
): Array<Record<string, string | number>> {
  const rows = response?.rows ?? [];

  return rows.flatMap((row) => {
    if (!row) return [];

    const entry: Record<string, string | number> = {
      [dimensionKey]: transformDimension(dimensionAt(row, 0)),
    };
    metricNames.forEach((name, index) => {
      entry[name] = metricAt(row, index);
    });

    return [entry];
  });
}

/**
 * `20260731` → `2026-07-31`.
 *
 * The GA4 `date` dimension is a compact string; a time series is far more
 * useful to a client already parsing ISO dates everywhere else. Values that do
 * not look like a GA4 date (`(other)` for bucketed rows) pass through untouched
 * rather than being mangled into a wrong date.
 */
export function formatGa4Date(value: string): string {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
