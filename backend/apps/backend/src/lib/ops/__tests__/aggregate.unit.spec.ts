import {
  averageOrderValue,
  bestsellers,
  billableOrders,
  byDiscountCode,
  byPaymentMethod,
  bySalesChannel,
  customerDisplayName,
  customerMetrics,
  dominantCurrency,
  fulfillmentBreakdown,
  hasOpenShipment,
  isPaid,
  kpi,
  medianSecondsToPayment,
  orderAttributionSource,
  ordersWithAttribution,
  paymentStatusBreakdown,
  recentOrders,
  salesBreakdown,
  salesTrend,
  salesVolume,
  topCustomers,
} from "../aggregate";
import { amount, percentChange, ratio, roundMoney } from "../money";
import { resolvePeriod } from "../period";
import {
  makeCapturedPayment,
  makeCustomer,
  makeItem,
  makeOrder,
  resetFixtureCounter,
} from "./fixtures";

beforeEach(() => {
  resetFixtureCounter();
});

/* ---------------------------------------------------------------- money -- */

describe("amount", () => {
  it.each([
    [42, 42],
    ["42", 42],
    ["39.90", 39.9],
    [{ numeric: 17.5 }, 17.5],
    [{ value: "12.34" }, 12.34],
    [{ toJSON: () => 5 }, 5],
  ])("reads %p as %p", (input, expected) => {
    expect(amount(input)).toBe(expected);
  });

  /**
   * A single unreadable cell must not turn a whole revenue column into NaN.
   */
  it.each([null, undefined, "", "  ", "n/a", NaN, Infinity, {}, [], true])(
    "reads %p as 0",
    (input) => {
      expect(amount(input)).toBe(0);
    },
  );
});

describe("roundMoney", () => {
  it("removes float drift from repeated addition", () => {
    expect(roundMoney(39.9 + 39.9 + 19.9)).toBe(99.7);
  });

  it("returns 0 for non-finite input", () => {
    expect(roundMoney(NaN)).toBe(0);
  });
});

describe("percentChange", () => {
  it("computes a fraction", () => {
    expect(percentChange(110, 100)).toBe(0.1);
    expect(percentChange(90, 100)).toBe(-0.1);
  });

  /**
   * Growth from nothing is not a percentage. Reporting +100% would invent a
   * baseline, which on a shop's first order is the difference between "one
   * order" and "infinite growth".
   */
  it("has no answer when the baseline is zero", () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe("ratio", () => {
  it("guards a zero denominator", () => {
    expect(ratio(3, 0)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });
});

/* ------------------------------------------------------------- cancelled -- */

describe("cancelled orders", () => {
  it("are excluded from every money figure", () => {
    const orders = [
      makeOrder({ total: 100 }),
      makeOrder({ total: 250, canceled_at: "2026-07-31T00:00:00.000Z" }),
      makeOrder({ total: 300, status: "canceled" }),
    ];

    expect(billableOrders(orders)).toHaveLength(1);
    expect(salesVolume(orders)).toBe(100);
    expect(averageOrderValue(orders)).toBe(100);
  });

  it("never count as an open shipment", () => {
    const cancelled = makeOrder({
      canceled_at: "2026-07-31T00:00:00.000Z",
      fulfillment_status: "not_fulfilled",
    });
    expect(hasOpenShipment(cancelled)).toBe(false);
  });
});

/* --------------------------------------------------------------- volumes -- */

describe("salesVolume", () => {
  it("sums order totals", () => {
    expect(salesVolume([makeOrder({ total: 39.9 }), makeOrder({ total: 59.9 })])).toBe(
      99.8,
    );
  });

  it("subtracts refunds", () => {
    const refunded = makeOrder({
      total: 100,
      summary: { paid_total: 100, refunded_total: 30 },
    });
    expect(salesVolume([refunded])).toBe(70);
  });

  it("falls back to payment collections when the summary is absent", () => {
    const order = makeOrder({
      total: 100,
      summary: null,
      payment_collections: [
        {
          id: "pc_1",
          status: "completed",
          amount: 100,
          captured_amount: 100,
          refunded_amount: 25,
          payments: [],
        },
      ],
    });
    expect(salesVolume([order])).toBe(75);
  });

  it("is zero for an empty period", () => {
    expect(salesVolume([])).toBe(0);
    expect(averageOrderValue([])).toBe(0);
  });
});

describe("kpi", () => {
  it("marks growth, decline and no change", () => {
    expect(kpi(120, 100)).toMatchObject({ trend: "up", change: 0.2 });
    expect(kpi(80, 100)).toMatchObject({ trend: "down", change: -0.2 });
    expect(kpi(100, 100)).toMatchObject({ trend: "flat", change: 0 });
  });

  it("reports no comparison against a zero baseline", () => {
    expect(kpi(5, 0)).toMatchObject({ trend: "up", change: null });
  });
});

/* ----------------------------------------------------------------- trend -- */

describe("salesTrend", () => {
  const windows = resolvePeriod("7d", {
    timeZone: "UTC",
    now: new Date("2026-08-01T12:00:00.000Z"),
  });

  it("emits one row per day including empty ones", () => {
    const trend = salesTrend(
      [makeOrder({ total: 100, createdAt: "2026-07-30T10:00:00.000Z" })],
      windows.current,
      "UTC",
    );

    expect(trend).toHaveLength(7);
    expect(trend.map((point) => point.day)).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
    expect(trend.find((point) => point.day === "2026-07-30")).toMatchObject({
      sales: 100,
      orders: 1,
      averageOrderValue: 100,
    });
    expect(trend.find((point) => point.day === "2026-07-29")).toMatchObject({
      sales: 0,
      orders: 0,
      averageOrderValue: 0,
    });
  });

  it("buckets an order by the reporting zone", () => {
    // 22:30 UTC on 30 July is 00:30 on 31 July in Berlin.
    const order = makeOrder({
      total: 50,
      createdAt: "2026-07-30T22:30:00.000Z",
    });

    const utc = salesTrend([order], windows.current, "UTC");
    expect(utc.find((point) => point.day === "2026-07-30")?.sales).toBe(50);

    const berlin = resolvePeriod("7d", {
      timeZone: "Europe/Berlin",
      now: new Date("2026-08-01T12:00:00.000Z"),
    });
    const local = salesTrend([order], berlin.current, "Europe/Berlin");
    expect(local.find((point) => point.day === "2026-07-31")?.sales).toBe(50);
  });

  it("is all zeros when nothing was ordered", () => {
    const trend = salesTrend([], windows.current, "UTC");
    expect(trend).toHaveLength(7);
    expect(trend.every((point) => point.sales === 0 && point.orders === 0)).toBe(
      true,
    );
  });
});

/* ------------------------------------------------------------- breakdown -- */

describe("salesBreakdown", () => {
  it("splits a period into its components", () => {
    const orders = [
      makeOrder({
        total: 110,
        subtotal: 100,
        shipping_total: 20,
        discount_total: 10,
        tax_total: 0,
        summary: { paid_total: 110, refunded_total: 5 },
      }),
    ];

    expect(salesBreakdown(orders)).toEqual({
      subtotal: 100,
      shipping: 20,
      discounts: 10,
      tax: 0,
      refunds: 5,
      total: 105,
    });
  });
});

/* -------------------------------------------------------------- grouping -- */

describe("byPaymentMethod", () => {
  it("groups by provider", () => {
    const orders = [
      makeOrder({
        total: 100,
        payment_collections: [makeCapturedPayment(100)],
      }),
      makeOrder({
        total: 50,
        payment_collections: [
          makeCapturedPayment(50, { providerId: "pp_stripe_stripe" }),
        ],
      }),
    ];

    const rows = byPaymentMethod(orders);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ key: "pp_system_default", sales: 100 });
  });

  /**
   * Counting a provider twice for one order would make the column sum to more
   * than the shop took.
   */
  it("counts a provider once per order", () => {
    const order = makeOrder({
      total: 100,
      payment_collections: [makeCapturedPayment(60), makeCapturedPayment(40)],
    });

    const rows = byPaymentMethod([order]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orders: 1, sales: 100 });
  });

  it("groups orders with no payment under 'unpaid'", () => {
    expect(byPaymentMethod([makeOrder({ total: 70 })])).toEqual([
      { key: "unpaid", label: "Not paid", orders: 1, sales: 70 },
    ]);
  });
});

describe("byDiscountCode", () => {
  it("reads codes off line-item and shipping adjustments", () => {
    const order = makeOrder({
      total: 90,
      items: [
        makeItem({
          adjustments: [{ code: "MENGE3", amount: 10, promotion_id: "promo_1" }],
        }),
      ],
      shipping_methods: [
        {
          id: "sm_1",
          amount: 0,
          total: 0,
          adjustments: [{ code: "VERSANDFREI100", amount: 5 }],
        },
      ],
    });

    const rows = byDiscountCode([order]);
    expect(rows.map((row) => row.key).sort()).toEqual([
      "MENGE3",
      "VERSANDFREI100",
    ]);
  });

  it("returns nothing when no promotion was applied", () => {
    expect(byDiscountCode([makeOrder()])).toEqual([]);
  });
});

describe("bySalesChannel", () => {
  it("resolves channel names, falling back to the id", () => {
    const orders = [
      makeOrder({ total: 100, sales_channel_id: "sc_1" }),
      makeOrder({ total: 40, sales_channel_id: "sc_unknown" }),
      makeOrder({ total: 10 }),
    ];

    const rows = bySalesChannel(orders, new Map([["sc_1", "Webshop"]]));
    expect(rows).toEqual([
      { key: "sc_1", label: "Webshop", orders: 1, sales: 100 },
      { key: "sc_unknown", label: "sc_unknown", orders: 1, sales: 40 },
      { key: "none", label: "No sales channel", orders: 1, sales: 10 },
    ]);
  });
});

/* ------------------------------------------------------------- products -- */

describe("bestsellers", () => {
  it("sums units and revenue per product, ranked by units", () => {
    const orders = [
      makeOrder({
        items: [
          makeItem({ product_id: "prod_a", product_title: "A", quantity: 2, total: 80 }),
          makeItem({ product_id: "prod_b", product_title: "B", quantity: 5, total: 50 }),
        ],
      }),
      makeOrder({
        items: [
          makeItem({ product_id: "prod_a", product_title: "A", quantity: 1, total: 40 }),
        ],
      }),
    ];

    expect(bestsellers(orders)).toEqual([
      { productId: "prod_b", title: "B", units: 5, sales: 50 },
      { productId: "prod_a", title: "A", units: 3, sales: 120 },
    ]);
  });

  /**
   * A line item whose product has been deleted still has a title. Collapsing
   * all of them into one "null" row would hide real revenue.
   */
  it("keeps orphaned line items apart by title", () => {
    const orders = [
      makeOrder({
        items: [
          makeItem({ product_id: null, product_title: "Gone A", quantity: 1 }),
          makeItem({ product_id: null, product_title: "Gone B", quantity: 1 }),
        ],
      }),
    ];

    expect(bestsellers(orders)).toHaveLength(2);
  });

  it("respects the limit", () => {
    const orders = [
      makeOrder({
        items: Array.from({ length: 12 }, (_, index) =>
          makeItem({ product_id: `prod_${index}`, product_title: `P${index}` }),
        ),
      }),
    ];

    expect(bestsellers(orders, 5)).toHaveLength(5);
  });
});

/* ------------------------------------------------------------ customers -- */

describe("customerDisplayName", () => {
  it("uses the customer's name", () => {
    expect(
      customerDisplayName(makeOrder({ customer: makeCustomer() })),
    ).toBe("Test Person");
  });

  it("falls back to a company name", () => {
    expect(
      customerDisplayName(
        makeOrder({
          customer: makeCustomer({
            first_name: null,
            last_name: null,
            company_name: "Test Labor GmbH",
          }),
        }),
      ),
    ).toBe("Test Labor GmbH");
  });

  /**
   * The one thing this must never do is fall back to an email address. The
   * dashboard has no reason to put one on screen.
   */
  it("never falls back to an email", () => {
    const order = makeOrder({
      email: "someone@example.invalid",
      customer: makeCustomer({ first_name: null, last_name: null }),
      customer_id: "cus_x",
    });

    expect(customerDisplayName(order)).toBe("Customer");
    expect(customerDisplayName(order)).not.toContain("@");
  });

  it("labels an order with no customer as a guest", () => {
    expect(customerDisplayName(makeOrder())).toBe("Guest");
  });
});

describe("topCustomers", () => {
  it("ranks identified customers by revenue", () => {
    const orders = [
      makeOrder({ total: 100, customer_id: "cus_1", customer: makeCustomer() }),
      makeOrder({ total: 300, customer_id: "cus_2", customer: makeCustomer({ first_name: "Other", last_name: "Person" }) }),
      makeOrder({ total: 50, customer_id: "cus_1", customer: makeCustomer() }),
    ];

    const rows = topCustomers(orders);
    expect(rows[0]).toMatchObject({ customerId: "cus_2", orders: 1, sales: 300 });
    expect(rows[1]).toMatchObject({ customerId: "cus_1", orders: 2, sales: 150 });
  });

  it("collapses guests into one row", () => {
    const rows = topCustomers([makeOrder({ total: 10 }), makeOrder({ total: 20 })]);
    expect(rows).toEqual([
      { customerId: null, name: "Guest", orders: 2, sales: 30 },
    ]);
  });
});

describe("customerMetrics", () => {
  it("counts a customer as new when they did not order in the previous window", () => {
    const current = [
      makeOrder({ total: 100, customer_id: "cus_new" }),
      makeOrder({ total: 200, customer_id: "cus_known" }),
    ];
    const previous = [makeOrder({ total: 90, customer_id: "cus_known" })];

    expect(customerMetrics(current, previous)).toMatchObject({
      newCustomers: 1,
      returningCustomers: 1,
      totalCustomers: 2,
      revenuePerCustomer: 150,
    });
  });

  it("computes repurchase rate over identified customers only", () => {
    const current = [
      makeOrder({ total: 100, customer_id: "cus_1" }),
      makeOrder({ total: 100, customer_id: "cus_1" }),
      makeOrder({ total: 100, customer_id: "cus_2" }),
      makeOrder({ total: 100 }), // guest, excluded
    ];

    expect(customerMetrics(current, []).repurchaseRate).toBe(0.5);
  });

  it("is all zeros for an empty window", () => {
    expect(customerMetrics([], [])).toEqual({
      averageOrderValue: 0,
      revenuePerCustomer: 0,
      repurchaseRate: 0,
      newCustomers: 0,
      returningCustomers: 0,
      totalCustomers: 0,
    });
  });
});

/* --------------------------------------------------------------- status -- */

describe("status breakdowns", () => {
  it("counts fulfillment statuses", () => {
    const orders = [
      makeOrder({ fulfillment_status: "not_fulfilled" }),
      makeOrder({ fulfillment_status: "not_fulfilled" }),
      makeOrder({ fulfillment_status: "shipped" }),
    ];

    expect(fulfillmentBreakdown(orders)).toEqual([
      { status: "not_fulfilled", orders: 2 },
      { status: "shipped", orders: 1 },
    ]);
  });

  it("counts payment statuses", () => {
    expect(
      paymentStatusBreakdown([
        makeOrder({ payment_status: "captured" }),
        makeOrder({ payment_status: "not_paid" }),
      ]),
    ).toEqual([
      { status: "captured", orders: 1 },
      { status: "not_paid", orders: 1 },
    ]);
  });

  it("treats an open or partly shipped order as needing work", () => {
    expect(hasOpenShipment(makeOrder({ fulfillment_status: "not_fulfilled" }))).toBe(true);
    expect(hasOpenShipment(makeOrder({ fulfillment_status: "partially_shipped" }))).toBe(true);
    expect(hasOpenShipment(makeOrder({ fulfillment_status: "delivered" }))).toBe(false);
  });
});

describe("isPaid", () => {
  it("reads the derived payment status", () => {
    expect(isPaid(makeOrder({ payment_status: "captured" }))).toBe(true);
    expect(isPaid(makeOrder({ payment_status: "not_paid" }))).toBe(false);
  });

  it("falls back to a captured amount", () => {
    const order = makeOrder({
      payment_status: null,
      summary: { paid_total: 100, refunded_total: 0 },
    });
    expect(isPaid(order)).toBe(true);
  });
});

/* -------------------------------------------------------- recent orders -- */

describe("recentOrders", () => {
  it("returns the newest first and carries no email or address", () => {
    const rows = recentOrders([
      makeOrder({ createdAt: "2026-07-28T10:00:00.000Z", total: 10 }),
      makeOrder({ createdAt: "2026-07-31T10:00:00.000Z", total: 20 }),
    ]);

    expect(rows[0].total).toBe(20);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "createdAt",
      "customer",
      "displayId",
      "fulfillmentStatus",
      "id",
      "paymentStatus",
      "total",
    ]);
  });

  it("respects the limit", () => {
    const orders = Array.from({ length: 20 }, () => makeOrder());
    expect(recentOrders(orders, 8)).toHaveLength(8);
  });
});

/* ----------------------------------------------------- time to payment -- */

describe("medianSecondsToPayment", () => {
  it("returns null when nothing has been captured", () => {
    expect(medianSecondsToPayment([makeOrder()])).toBeNull();
  });

  it("takes the median, not the mean", () => {
    const orders = [
      // 1 hour
      makeOrder({
        createdAt: "2026-07-30T10:00:00.000Z",
        payment_collections: [
          makeCapturedPayment(100, { capturedAt: "2026-07-30T11:00:00.000Z" }),
        ],
      }),
      // 2 hours
      makeOrder({
        createdAt: "2026-07-30T10:00:00.000Z",
        payment_collections: [
          makeCapturedPayment(100, { capturedAt: "2026-07-30T12:00:00.000Z" }),
        ],
      }),
      // 30 days — the outlier a mean would follow
      makeOrder({
        createdAt: "2026-07-01T10:00:00.000Z",
        payment_collections: [
          makeCapturedPayment(100, { capturedAt: "2026-07-31T10:00:00.000Z" }),
        ],
      }),
    ];

    expect(medianSecondsToPayment(orders)).toBe(7200);
  });

  it("uses the earliest capture on an order", () => {
    const order = makeOrder({
      createdAt: "2026-07-30T10:00:00.000Z",
      payment_collections: [
        makeCapturedPayment(50, { capturedAt: "2026-07-30T14:00:00.000Z" }),
        makeCapturedPayment(50, { capturedAt: "2026-07-30T11:00:00.000Z" }),
      ],
    });

    expect(medianSecondsToPayment([order])).toBe(3600);
  });
});

/* ---------------------------------------------------------- attribution -- */

describe("order attribution", () => {
  /**
   * The storefront persists no acquisition source today. These tests pin the
   * *reporting* of that gap, and the reading of a source once one exists.
   */
  it("finds no source on an order this storefront produces", () => {
    const order = makeOrder({
      metadata: { bank_reference: "TEST-0001", vat_id: "DE000000000" },
    });

    expect(orderAttributionSource(order)).toBeNull();
    expect(ordersWithAttribution([order])).toBe(0);
  });

  it.each([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "landing_page",
    "referrer",
    "attribution_source",
  ])("reads a source from metadata.%s once written", (key) => {
    const order = makeOrder({ metadata: { [key]: "newsletter" } });

    expect(orderAttributionSource(order)).toBe("newsletter");
    expect(ordersWithAttribution([order])).toBe(1);
  });

  it("ignores a blank value", () => {
    expect(orderAttributionSource(makeOrder({ metadata: { utm_source: "  " } }))).toBeNull();
  });
});

/* ------------------------------------------------------------- currency -- */

describe("dominantCurrency", () => {
  it("uses the store default when there are no orders", () => {
    expect(dominantCurrency([], "eur")).toBe("eur");
  });

  it("uses the currency the orders were actually placed in", () => {
    expect(
      dominantCurrency(
        [makeOrder({ currency_code: "usd" }), makeOrder({ currency_code: "usd" })],
        "eur",
      ),
    ).toBe("usd");
  });

  it("picks the most common when a window is mixed", () => {
    expect(
      dominantCurrency(
        [
          makeOrder({ currency_code: "eur" }),
          makeOrder({ currency_code: "eur" }),
          makeOrder({ currency_code: "usd" }),
        ],
        "usd",
      ),
    ).toBe("eur");
  });
});
