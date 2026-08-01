/**
 * The one arithmetic trap on this dashboard.
 *
 * Medusa orders ÷ GA4 sessions divides a complete numerator by a
 * consent-limited denominator, so it reads **high**. These tests pin both the
 * direction of that error and the vocabulary that keeps it from being sold as a
 * conversion rate again.
 */

import {
  GA4_TRANSACTION_RATE_LABEL,
  GA4_TRANSACTION_RATE_NOTE,
  ORDERS_PER_SESSION_KEY,
  ORDERS_PER_SESSION_LABEL,
  ORDERS_PER_SESSION_WARNING,
  SHOP_CONVERSION_UNAVAILABLE,
  canCompareFunnelSteps,
  ga4TransactionRate,
  ordersPerTrackedSession,
} from "../metrics";

describe("vocabulary", () => {
  /**
   * The exact strings the specification requires. Asserted literally, because
   * "roughly this wording" is how a caveat becomes a footnote and then nothing.
   */
  it("names the blended ratio exactly", () => {
    expect(ORDERS_PER_SESSION_LABEL).toBe("Orders per tracked GA4 session");
    expect(ORDERS_PER_SESSION_KEY).toBe("orders_per_tracked_ga4_session");
  });

  it("carries the exact warning text", () => {
    expect(ORDERS_PER_SESSION_WARNING).toBe(
      "This compares all Medusa orders with consent-dependent GA4 sessions. It is not a true shop-wide conversion rate and may be overstated.",
    );
  });

  it("carries the exact unavailable-conversion text", () => {
    expect(SHOP_CONVERSION_UNAVAILABLE).toBe(
      "A privacy-compliant first-party session denominator is not currently available.",
    );
  });

  /**
   * The label must not contain any of the phrasings that would make a reader
   * treat it as a real conversion rate.
   */
  it.each([
    "conversion rate",
    "real conversion",
    "lower bound",
    "shop conversion",
  ])("never describes the blended ratio as %p", (phrase) => {
    expect(ORDERS_PER_SESSION_LABEL.toLowerCase()).not.toContain(phrase);
  });

  /**
   * The warning is allowed — and required — to say what it is *not*. What it
   * must never do is claim the number understates.
   */
  it("says the blended ratio may be overstated, not understated", () => {
    expect(ORDERS_PER_SESSION_WARNING).toContain("may be overstated");
    expect(ORDERS_PER_SESSION_WARNING).toContain(
      "not a true shop-wide conversion rate",
    );
    expect(ORDERS_PER_SESSION_WARNING.toLowerCase()).not.toContain(
      "lower bound",
    );
    expect(ORDERS_PER_SESSION_WARNING.toLowerCase()).not.toContain(
      "understate",
    );
  });

  it("labels the GA4-only rate as GA4's own", () => {
    expect(GA4_TRANSACTION_RATE_LABEL).toBe("GA4 transaction rate");
    expect(GA4_TRANSACTION_RATE_NOTE).toContain("GA4 transactions ÷ GA4 sessions");
  });
});

describe("ordersPerTrackedSession", () => {
  it("divides Medusa orders by GA4 sessions", () => {
    expect(ordersPerTrackedSession(14, 655)).toBeCloseTo(0.021374, 6);
    expect(ordersPerTrackedSession(1, 4)).toBe(0.25);
  });

  /**
   * The direction of the error, made concrete: if half the visitors declined
   * consent, the ratio reads twice the true rate.
   */
  it("reads high when consent hides half the sessions", () => {
    const trueRate = 10 / 1000; // 10 orders, 1000 real sessions
    const shown = ordersPerTrackedSession(10, 500); // GA4 saw half

    expect(shown).toBeGreaterThan(trueRate);
    expect(shown).toBe(trueRate * 2);
  });

  it.each([
    [5, 0],
    [5, undefined],
    [undefined, 100],
    [undefined, undefined],
    [5, -1],
    [Number.NaN, 100],
    [5, Number.NaN],
    [5, Number.POSITIVE_INFINITY],
  ])("returns null for orders=%p sessions=%p", (orders, sessions) => {
    expect(ordersPerTrackedSession(orders, sessions)).toBeNull();
  });

  /**
   * `null`, not `0`. A card reading "0,0 %" asserts nothing converted, which is
   * a different claim from "there is nothing to divide by".
   */
  it("distinguishes 'no denominator' from 'zero orders'", () => {
    expect(ordersPerTrackedSession(0, 100)).toBe(0);
    expect(ordersPerTrackedSession(10, 0)).toBeNull();
  });
});

describe("ga4TransactionRate", () => {
  /** GA4 transactions ÷ GA4 sessions — both sides from the same population. */
  it("uses GA4 transactions over GA4 sessions", () => {
    expect(ga4TransactionRate(13, 655)).toBeCloseTo(0.019847, 6);
    expect(ga4TransactionRate(5, 100)).toBe(0.05);
  });

  it("is zero, not null, when GA4 saw sessions but no transactions", () => {
    // The storefront's real state: sessions arrive, no purchase event is sent.
    expect(ga4TransactionRate(0, 655)).toBe(0);
  });

  it("returns null rather than dividing by zero sessions", () => {
    expect(ga4TransactionRate(3, 0)).toBeNull();
  });

  it.each([
    [undefined, 100],
    [10, undefined],
    [undefined, undefined],
    [10, 0],
  ])("returns null when either value is unavailable (%p, %p)", (tx, sessions) => {
    expect(ga4TransactionRate(tx, sessions)).toBeNull();
  });

  /**
   * The two ratios must not be confusable: same denominator, different
   * numerators, and the GA4 one never touches a Medusa figure.
   */
  it("ignores Medusa orders entirely", () => {
    const sessions = 500;
    expect(ga4TransactionRate(7, sessions)).toBe(7 / sessions);
    expect(ga4TransactionRate(7, sessions)).not.toBe(
      ordersPerTrackedSession(99, sessions),
    );
  });
});

describe("canCompareFunnelSteps", () => {
  const visitors = { count: 655, source: "ga4" };
  const orderCreated = { count: 14, source: "medusa" };
  const paymentConfirmed = { count: 9, source: "medusa" };
  const unavailable = { count: null, source: "unavailable" };

  it("allows a percentage between two Medusa steps", () => {
    expect(canCompareFunnelSteps(paymentConfirmed, orderCreated)).toBe(true);
  });

  /**
   * The funnel's version of the same trap: `Order created ÷ Visitors` is
   * Medusa over GA4 with a funnel drawn around it.
   */
  it("refuses a percentage across the GA4 → Medusa boundary", () => {
    expect(canCompareFunnelSteps(orderCreated, visitors)).toBe(false);
  });

  it("refuses when either step has no count", () => {
    expect(canCompareFunnelSteps(unavailable, orderCreated)).toBe(false);
    expect(canCompareFunnelSteps(orderCreated, unavailable)).toBe(false);
  });

  it("refuses a zero predecessor rather than dividing by zero", () => {
    expect(
      canCompareFunnelSteps(orderCreated, { count: 0, source: "medusa" }),
    ).toBe(false);
  });

  it("refuses when there is no predecessor at all", () => {
    expect(canCompareFunnelSteps(visitors, undefined)).toBe(false);
  });
});
