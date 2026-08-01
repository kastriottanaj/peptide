/**
 * Reading money and counts off Medusa DTOs.
 *
 * Order totals are `BigNumberValue`, which is four different things depending on
 * how the value reached you: a plain `number` after JSON serialization, a
 * decimal `string`, a `BigNumber` instance with a `numeric` getter, or a raw
 * `{ value }` object straight out of the column. Every aggregation in this
 * directory goes through `amount()` so no call site has to know which it got,
 * and so a shape nobody anticipated degrades to `0` rather than to `NaN`
 * poisoning a whole sum.
 *
 * Nothing here rounds or converts currency. Medusa stores order totals as
 * decimal amounts in the order's own currency; they are summed as-is and the
 * currency code travels with them.
 */

type NumericLike = {
  numeric?: unknown;
  value?: unknown;
  toJSON?: () => unknown;
};

/**
 * A `BigNumberValue` (or anything else) as a finite number.
 *
 * `NaN` and `Infinity` become `0` for the same reason GA4 metric strings do in
 * `lib/ga4/normalize.ts`: a dashboard cell reading `0` is a truthful "nothing
 * here", one reading `NaN` is a bug report shown to a merchant.
 */
export function amount(value: unknown): number {
  if (value === null || value === undefined) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (typeof value === "object") {
    const candidate = value as NumericLike;

    if (typeof candidate.numeric === "number") {
      return Number.isFinite(candidate.numeric) ? candidate.numeric : 0;
    }
    if (candidate.value !== undefined) {
      return amount(candidate.value);
    }
    if (typeof candidate.toJSON === "function") {
      const json = candidate.toJSON();
      // Guard against a `toJSON` that returns another object with a `toJSON`.
      if (typeof json === "number" || typeof json === "string") {
        return amount(json);
      }
    }
  }

  return 0;
}

/** Sum a list by a numeric accessor, tolerating missing entries. */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => unknown): number {
  return rows.reduce<number>((total, row) => total + amount(pick(row)), 0);
}

/**
 * Round to cents.
 *
 * Summing decimals accumulates float error — 39.90 + 39.90 + 19.90 is not
 * exactly 99.70 in IEEE 754 — and a KPI card showing `99.700000000000003 €`
 * has cost more trust than the tenth of a cent was worth. Applied once at the
 * edge of an aggregation, never between additions.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Ratio guarded against a zero denominator, rounded to four decimals. */
export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  const value = numerator / denominator;
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

/**
 * Change from `previous` to `current`, as a fraction.
 *
 * `null` when there is no previous value to compare against, which the UI
 * renders as a neutral "no comparison" rather than as `+100%`. Growing from
 * zero is not a percentage — reporting one invents a baseline that did not
 * exist, and on a shop with its first order that is the difference between
 * "one order" and "infinite growth".
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (!previous) return null;
  const change = (current - previous) / Math.abs(previous);
  return Number.isFinite(change) ? Math.round(change * 10000) / 10000 : null;
}
