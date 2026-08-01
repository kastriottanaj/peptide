/**
 * Formatting for the analytics dashboard.
 *
 * Two rules, both of which exist because getting them wrong is invisible until
 * it is embarrassing:
 *
 *  - **Currency comes from the response, never from a constant.** Every panel
 *    receives a `currencyCode` alongside its figures, taken from the orders
 *    that were summed. Hardcoding EUR would be correct today — one region, one
 *    currency — and silently wrong the day a second region is added.
 *  - **Dates are rendered in the store's reporting timezone**, the same one the
 *    server bucketed the days in. A chart labelled in the browser's zone next
 *    to totals computed in Berlin's is a bug report waiting to happen.
 */

const NUMBER_LOCALE = "de-DE";

export function formatCurrency(
  value: number,
  currencyCode: string,
  options: { compact?: boolean } = {},
): string {
  const safe = Number.isFinite(value) ? value : 0;

  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "currency",
    currency: (currencyCode || "eur").toUpperCase(),
    notation: options.compact ? "compact" : "standard",
    maximumFractionDigits: options.compact ? 1 : 2,
    minimumFractionDigits: options.compact ? 0 : 2,
  }).format(safe);
}

export function formatNumber(value: number, compact = false): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(safe);
}

/** A fraction as a percentage. `0.1234` → `12,3 %`. */
export function formatPercent(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(NUMBER_LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(safe);
}

/**
 * A signed change, or an em dash when there is no baseline.
 *
 * `null` is rendered rather than hidden: "no comparison" and "no change" are
 * different facts, and a card that shows nothing at all for the first reads as
 * a rendering bug.
 */
export function formatChange(change: number | null): string {
  if (change === null) return "—";
  const sign = change > 0 ? "+" : "";
  return `${sign}${formatPercent(change, 1)}`;
}

export function formatDay(day: string, timeZone: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;

  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).format(parsed);
}

export function formatDayLong(day: string, timeZone: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;

  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function formatTime(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

export function formatDateTime(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat(NUMBER_LOCALE, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

/** `93600` → `1 d 2 h`. Used for time-to-payment, which runs to days here. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/**
 * `not_fulfilled` → `Not fulfilled`.
 *
 * The admin's own status labels are translated strings behind an i18n
 * namespace this extension cannot reach, so the raw enum is title-cased rather
 * than mapped through a table that would drift from Medusa's.
 */
export function humanizeStatus(status: string): string {
  if (!status) return "—";
  const words = status.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** How long ago an ISO timestamp was, for "last updated" labels. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  const seconds = Math.max(0, Math.round((now.getTime() - parsed.getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.round(hours / 24)} d ago`;
}
