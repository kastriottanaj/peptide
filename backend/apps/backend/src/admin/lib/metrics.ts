/**
 * Derived metrics that cross — or deliberately refuse to cross — the boundary
 * between Medusa and Google Analytics.
 *
 * There is one arithmetic trap on this dashboard and it lives here, so it is
 * named once and cannot be reinvented in a component.
 *
 * **Medusa orders ÷ GA4 sessions is not a conversion rate.** The numerator
 * counts every order the shop took. The denominator counts only sessions from
 * visitors who accepted statistics consent — this is a German storefront with a
 * hard consent gate, so everyone who declined is invisible to GA4 and fully
 * visible to Medusa. Dividing a complete numerator by an incomplete denominator
 * produces a number that is **larger** than the truth, and how much larger
 * depends on a consent rate nobody measures.
 *
 * An earlier version of this dashboard presented it as a "conversion rate" and
 * called it a lower bound. That was wrong in both directions: it is not a
 * conversion rate, and it overstates rather than understates. It survives only
 * as an explicitly-labelled diagnostic, never as a KPI and never in a table.
 *
 * A true shop-wide conversion rate needs a first-party session count covering
 * consenting and non-consenting visitors alike. This storefront has none, and
 * building one is a privacy decision rather than a reporting task.
 */

/**
 * The only name the blended ratio may appear under.
 *
 * Exported as a constant so the label in the UI, the heading in the CSV export
 * and the assertion in the tests are the same string.
 */
export const ORDERS_PER_SESSION_LABEL = "Orders per tracked GA4 session";

/** Machine-readable key for the CSV export. */
export const ORDERS_PER_SESSION_KEY = "orders_per_tracked_ga4_session";

/** The warning that must accompany the ratio everywhere it is shown. */
export const ORDERS_PER_SESSION_WARNING =
  "This compares all Medusa orders with consent-dependent GA4 sessions. It is not a true shop-wide conversion rate and may be overstated.";

/** What is said where a true shop-wide conversion rate would otherwise go. */
export const SHOP_CONVERSION_UNAVAILABLE =
  "A privacy-compliant first-party session denominator is not currently available.";

export const GA4_TRANSACTION_RATE_LABEL = "GA4 transaction rate";

/**
 * The GA4-only conversion metric: both sides come from Google, so the
 * population is consistent and the ratio means something.
 *
 * It answers "of the sessions GA4 saw, how many did GA4 record a transaction
 * for" — not "how many of the shop's visitors bought". On this storefront it
 * will read 0%, because the checkout is excluded from measurement and no
 * `purchase` event is ever sent; that is a fact about collection, not sales.
 */
export const GA4_TRANSACTION_RATE_NOTE =
  "GA4 transactions ÷ GA4 sessions. Both figures are Google's, so the populations match. This is not the shop's sales conversion — Medusa orders are.";

/**
 * A ratio, or `null` when it cannot be computed.
 *
 * `null` rather than `0` for a missing or zero denominator: a card showing
 * `0,0 %` asserts that nothing converted, which is a different claim from
 * "there is nothing to divide by".
 */
function safeRatio(
  numerator: number | undefined,
  denominator: number | undefined,
): number | null {
  if (typeof numerator !== "number" || !Number.isFinite(numerator)) return null;
  if (typeof denominator !== "number" || !Number.isFinite(denominator)) {
    return null;
  }
  if (denominator <= 0) return null;

  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

/**
 * Medusa orders ÷ GA4 sessions.
 *
 * A diagnostic, not a conversion rate. See the module comment, and never render
 * the result without `ORDERS_PER_SESSION_WARNING` beside it.
 */
export function ordersPerTrackedSession(
  orders: number | undefined,
  ga4Sessions: number | undefined,
): number | null {
  return safeRatio(orders, ga4Sessions);
}

/**
 * GA4 transactions ÷ GA4 sessions.
 *
 * Returns `null` unless both values are genuinely available, which includes the
 * zero-session case — the whole point of routing this through one function is
 * that no caller divides by zero on a quiet day.
 */
export function ga4TransactionRate(
  ga4Transactions: number | undefined,
  ga4Sessions: number | undefined,
): number | null {
  return safeRatio(ga4Transactions, ga4Sessions);
}

/**
 * Whether a step-to-step funnel percentage is meaningful.
 *
 * Only within one data source. A "Visitors → Order created" percentage is the
 * blended ratio wearing a funnel's clothes: GA4 supplies the numerator's
 * denominator and Medusa the numerator, so the same incomplete-denominator
 * problem applies, with none of the labelling that makes it honest.
 */
export function canCompareFunnelSteps(
  step: { count: number | null; source: string },
  previous: { count: number | null; source: string } | undefined,
): boolean {
  if (!previous) return false;
  if (step.count === null || previous.count === null) return false;
  if (previous.count <= 0) return false;
  return step.source === previous.source;
}
