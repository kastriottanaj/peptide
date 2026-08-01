/**
 * Reporting windows for the Medusa side of the analytics dashboard.
 *
 * GA4 expresses its ranges relatively (`6daysAgo`..`today`) and resolves them
 * against the *property's* configured timezone. Medusa has no such thing to
 * lean on: `order.created_at` is a UTC instant, and "the last 7 days" is only
 * meaningful once someone says which midnight. So the boundaries are computed
 * here, in one place, against a named IANA zone — and the same zone is used for
 * the day buckets of the sales trend, so a chart and its total cannot disagree
 * about which day an order fell in.
 *
 * The zone is `ANALYTICS_TIMEZONE`, defaulting to `Europe/Berlin`. This is a
 * German storefront invoicing in EUR; a server that happens to run in UTC must
 * not shift the shop's takings across a day boundary just because a 01:00 CEST
 * order is a 23:00 UTC one.
 *
 * Periods mirror GA4's, minus `today` — a period the ops endpoints do not
 * accept, because the KPI cards compare against a previous matching window and
 * "yesterday" is not a comparison anyone asked for on this dashboard.
 */

export const OPS_PERIODS = ["7d", "30d", "90d"] as const;
export type OpsPeriod = (typeof OPS_PERIODS)[number];

export function isOpsPeriod(value: unknown): value is OpsPeriod {
  return (
    typeof value === "string" &&
    (OPS_PERIODS as readonly string[]).includes(value)
  );
}

/** Days per period, counting today. `7d` is today plus the six before it. */
export const DAYS_IN_PERIOD: Record<OpsPeriod, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export const DEFAULT_TIMEZONE = "Europe/Berlin";

/**
 * The configured reporting timezone, validated.
 *
 * An unknown zone name makes `Intl.DateTimeFormat` throw, which would turn a
 * typo in an env file into a 500 on every analytics call. Falling back is the
 * right failure here: a dashboard an hour off is recoverable, a dashboard that
 * will not load is not.
 */
export function resolveTimezone(
  raw = process.env.ANALYTICS_TIMEZONE,
): string {
  const zone = (raw ?? "").trim();
  if (!zone) return DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * The `YYYY-MM-DD` a given instant falls on, in `timeZone`.
 *
 * `en-CA` is used purely because its short date format *is* ISO order; building
 * the string from `formatToParts` avoids depending on a locale's separators.
 */
export function dayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The UTC instant of midnight starting `dayKey` in `timeZone`.
 *
 * Done by probing rather than by table lookup: the offset of a zone depends on
 * the date (DST), so the only reliable way to find "what UTC instant does this
 * local wall-clock time correspond to" without a tz database is to guess UTC
 * midnight, ask what local time that actually is, and correct by the difference.
 * One correction is enough for every real zone — offsets are whole minutes and
 * the guess is never more than a day out.
 */
export function zonedDayStart(day: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, date, 0, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  const corrected = new Date(guess - offset);

  // A second pass matters only across a DST transition, where the first
  // correction lands on the other side of the jump.
  const secondOffset = zoneOffsetMs(corrected, timeZone);
  return secondOffset === offset ? corrected : new Date(guess - secondOffset);
}

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = get("hour") % 24;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );

  // Sub-second precision is discarded by the formatter, so compare on seconds.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Add `days` to a `YYYY-MM-DD` key without going through a timezone. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}

export type DateWindow = {
  /** First day in the window, inclusive, `YYYY-MM-DD` in the report zone. */
  startDay: string;
  /** Last day in the window, inclusive. */
  endDay: string;
  /** UTC instant the window opens at. */
  start: Date;
  /** UTC instant the window closes at, exclusive. */
  end: Date;
};

export type PeriodWindows = {
  period: OpsPeriod;
  timeZone: string;
  days: number;
  current: DateWindow;
  /**
   * The equally long window immediately before `current`, for the
   * percentage-change figures on the KPI cards. Same length, so a 30-day period
   * is never compared against a 28-day one.
   */
  previous: DateWindow;
};

function windowEndingOn(
  endDay: string,
  days: number,
  timeZone: string,
): DateWindow {
  const startDay = addDays(endDay, -(days - 1));
  return {
    startDay,
    endDay,
    start: zonedDayStart(startDay, timeZone),
    // Exclusive: the instant the day *after* the last day begins. Using the end
    // of the last day instead would drop orders placed in its final second.
    end: zonedDayStart(addDays(endDay, 1), timeZone),
  };
}

/**
 * Resolve a period into its current and previous windows.
 *
 * `now` is injectable so tests do not depend on the wall clock, and so a caller
 * that has already read the time uses the same instant for every window.
 */
export function resolvePeriod(
  period: OpsPeriod,
  options: { timeZone?: string; now?: Date } = {},
): PeriodWindows {
  const timeZone = options.timeZone ?? resolveTimezone();
  const now = options.now ?? new Date();
  const days = DAYS_IN_PERIOD[period];

  const today = dayKey(now, timeZone);
  const current = windowEndingOn(today, days, timeZone);
  const previous = windowEndingOn(addDays(current.startDay, -1), days, timeZone);

  return { period, timeZone, days, current, previous };
}

/** Every `YYYY-MM-DD` in the window, in order. Empty days included. */
export function daysInWindow(window: DateWindow): string[] {
  const out: string[] = [];
  let day = window.startDay;
  while (day <= window.endDay) {
    out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

/** The window covering the current day only, for the Live tab. */
export function todayWindow(
  options: { timeZone?: string; now?: Date } = {},
): DateWindow & { timeZone: string } {
  const timeZone = options.timeZone ?? resolveTimezone();
  const today = dayKey(options.now ?? new Date(), timeZone);
  return { ...windowEndingOn(today, 1, timeZone), timeZone };
}
