/**
 * The assembly layer: period → orders → payload.
 *
 * `./orders` is mocked, so nothing here touches a container, a workflow or a
 * database. What is under test is the orchestration — which window each figure
 * is computed over, that the previous window really is the previous one, and
 * that the funnel reports its two unavailable steps as unavailable.
 */

import { Ga4Cache } from "../../ga4/cache";
import { buildFunnel, OpsAnalyticsService, resolveOpsCacheTtlMs } from "../service";
import type { DateWindow } from "../period";
import type { OrderRow } from "../types";
import {
  makeCapturedPayment,
  makeCustomer,
  makeItem,
  makeOrder,
  resetFixtureCounter,
} from "./fixtures";

jest.mock("../orders", () => ({
  fetchOrdersInWindow: jest.fn(),
  fetchSalesChannelNames: jest.fn(),
  fetchStoreCurrency: jest.fn(),
  MAX_ORDERS: 5000,
}));

import {
  fetchOrdersInWindow,
  fetchSalesChannelNames,
  fetchStoreCurrency,
} from "../orders";

const mockedFetchOrders = fetchOrdersInWindow as jest.MockedFunction<
  typeof fetchOrdersInWindow
>;
const mockedChannels = fetchSalesChannelNames as jest.MockedFunction<
  typeof fetchSalesChannelNames
>;
const mockedCurrency = fetchStoreCurrency as jest.MockedFunction<
  typeof fetchStoreCurrency
>;

const container = {} as never;
const NOW = new Date("2026-08-01T09:00:00.000Z");

/** Answer each window with whatever the test registered for its start day. */
function respondByWindow(
  byStartDay: Record<string, OrderRow[]>,
  options: { truncated?: boolean } = {},
) {
  mockedFetchOrders.mockImplementation(async ({ window }) => ({
    rows: byStartDay[window.startDay] ?? [],
    window: window as DateWindow,
    truncated: options.truncated ?? false,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetFixtureCounter();
  mockedChannels.mockResolvedValue(new Map([["sc_1", "Webshop"]]));
  mockedCurrency.mockResolvedValue("eur");
  process.env.ANALYTICS_TIMEZONE = "UTC";
  delete process.env.ANALYTICS_CACHE_TTL_SECONDS;
});

afterAll(() => {
  delete process.env.ANALYTICS_TIMEZONE;
});

function service() {
  // A fresh cache per test, and no TTL, so one test cannot answer another's
  // question from a stale entry.
  return new OpsAnalyticsService({ cache: new Ga4Cache(), now: () => NOW });
}

describe("cache TTL configuration", () => {
  it("defaults to 30 seconds", () => {
    expect(resolveOpsCacheTtlMs(undefined)).toBe(30_000);
    expect(resolveOpsCacheTtlMs("")).toBe(30_000);
  });

  it("honours 0 as 'do not cache'", () => {
    expect(resolveOpsCacheTtlMs("0")).toBe(0);
  });

  it("clamps an absurd value instead of failing", () => {
    expect(resolveOpsCacheTtlMs("99999")).toBe(600_000);
    expect(resolveOpsCacheTtlMs("-5")).toBe(30_000);
    expect(resolveOpsCacheTtlMs("banana")).toBe(30_000);
  });
});

describe("getOverview", () => {
  it("computes KPIs against the previous matching window", async () => {
    respondByWindow({
      // Current 7d window: 2026-07-26 → 2026-08-01
      "2026-07-26": [
        makeOrder({ total: 100, createdAt: "2026-07-30T10:00:00.000Z" }),
        makeOrder({ total: 200, createdAt: "2026-07-31T10:00:00.000Z" }),
      ],
      // Previous 7d window: 2026-07-19 → 2026-07-25
      "2026-07-19": [
        makeOrder({ total: 150, createdAt: "2026-07-20T10:00:00.000Z" }),
      ],
    });

    const result = await service().getOverview(container, "7d");

    expect(result.kpis.salesVolume).toMatchObject({
      value: 300,
      previous: 150,
      change: 1,
      trend: "up",
    });
    expect(result.kpis.orders).toMatchObject({ value: 2, previous: 1 });
    expect(result.kpis.averageOrderValue).toMatchObject({
      value: 150,
      previous: 150,
      trend: "flat",
    });
    expect(result.range).toMatchObject({
      startDay: "2026-07-26",
      endDay: "2026-08-01",
    });
    expect(result.previousRange).toEqual({
      startDay: "2026-07-19",
      endDay: "2026-07-25",
    });
  });

  it.each(["7d", "30d", "90d"] as const)(
    "fetches exactly two windows for period=%s",
    async (period) => {
      respondByWindow({});
      await service().getOverview(container, period);

      expect(mockedFetchOrders).toHaveBeenCalledTimes(2);
    },
  );

  it("returns a complete, empty payload when the shop has no orders", async () => {
    respondByWindow({});

    const result = await service().getOverview(container, "30d");

    expect(result.kpis.salesVolume.value).toBe(0);
    expect(result.kpis.salesVolume.change).toBeNull();
    expect(result.salesTrend).toHaveLength(30);
    expect(result.salesTrend.every((point) => point.sales === 0)).toBe(true);
    expect(result.bestsellers).toEqual([]);
    expect(result.topCustomers).toEqual([]);
    expect(result.recentOrders).toEqual([]);
    expect(result.breakdown.total).toBe(0);
    expect(result.coverage).toEqual({ orders: 0, truncated: false });
  });

  it("labels the payload with the currency the orders were placed in", async () => {
    respondByWindow({
      "2026-07-26": [makeOrder({ currency_code: "usd", total: 10 })],
    });

    const result = await service().getOverview(container, "7d");
    expect(result.currencyCode).toBe("usd");
  });

  it("falls back to the store currency for an empty window", async () => {
    respondByWindow({});
    mockedCurrency.mockResolvedValue("gbp");

    const result = await service().getOverview(container, "7d");
    expect(result.currencyCode).toBe("gbp");
  });

  it("reports truncation so a partial total is not read as a full one", async () => {
    respondByWindow({ "2026-07-26": [makeOrder()] }, { truncated: true });

    const result = await service().getOverview(container, "7d");
    expect(result.coverage.truncated).toBe(true);
  });

  it("resolves sales-channel names", async () => {
    respondByWindow({
      "2026-07-26": [makeOrder({ total: 60, sales_channel_id: "sc_1" })],
    });

    const result = await service().getOverview(container, "7d");
    expect(result.bySalesChannel).toEqual([
      { key: "sc_1", label: "Webshop", orders: 1, sales: 60 },
    ]);
  });

  it("carries no customer email into the payload", async () => {
    respondByWindow({
      "2026-07-26": [
        makeOrder({
          total: 100,
          email: "person@example.invalid",
          customer_id: "cus_1",
          customer: makeCustomer(),
        }),
      ],
    });

    const result = await service().getOverview(container, "7d");
    expect(JSON.stringify(result)).not.toContain("@");
  });

  it("serves a second identical call from the cache", async () => {
    process.env.ANALYTICS_CACHE_TTL_SECONDS = "30";
    respondByWindow({ "2026-07-26": [makeOrder()] });

    const instance = service();
    const first = await instance.getOverview(container, "7d");
    const second = await instance.getOverview(container, "7d");

    expect(first.cache.status).toBe("miss");
    expect(second.cache.status).toBe("hit");
    expect(mockedFetchOrders).toHaveBeenCalledTimes(2); // two windows, once
  });

  it("keeps periods on separate cache keys", async () => {
    process.env.ANALYTICS_CACHE_TTL_SECONDS = "30";
    respondByWindow({});

    const instance = service();
    await instance.getOverview(container, "7d");
    await instance.getOverview(container, "30d");

    expect(mockedFetchOrders).toHaveBeenCalledTimes(4);
  });
});

describe("getLive", () => {
  it("covers today only, in the reporting zone", async () => {
    respondByWindow({
      "2026-08-01": [
        makeOrder({
          total: 120,
          createdAt: "2026-08-01T08:00:00.000Z",
          payment_collections: [makeCapturedPayment(120)],
          payment_status: "captured",
        }),
      ],
    });

    const result = await service().getLive(container);

    expect(mockedFetchOrders).toHaveBeenCalledTimes(1);
    expect(result.day).toBe("2026-08-01");
    expect(result.ordersToday).toBe(1);
    expect(result.revenueToday).toBe(120);
    expect(result.paidRevenueToday).toBe(120);
    expect(result.recentOrders).toHaveLength(1);
  });

  it("counts orders still needing fulfilment", async () => {
    respondByWindow({
      "2026-08-01": [
        makeOrder({ fulfillment_status: "not_fulfilled" }),
        makeOrder({ fulfillment_status: "delivered" }),
      ],
    });

    const result = await service().getLive(container);
    expect(result.unfulfilledOrders).toBe(1);
  });

  it("is empty rather than absent on a day with no orders", async () => {
    respondByWindow({});

    const result = await service().getLive(container);
    expect(result).toMatchObject({
      ordersToday: 0,
      revenueToday: 0,
      paidRevenueToday: 0,
      recentOrders: [],
    });
  });
});

describe("getConversion", () => {
  it("separates created orders from paid ones", async () => {
    respondByWindow({
      "2026-07-26": [
        makeOrder({
          total: 100,
          payment_status: "captured",
          payment_collections: [makeCapturedPayment(100)],
          summary: { paid_total: 100, refunded_total: 0 },
        }),
        makeOrder({ total: 50, payment_status: "not_paid" }),
      ],
    });

    const result = await service().getConversion(container, "7d");

    expect(result.orders).toBe(2);
    expect(result.paidOrders).toBe(1);
    expect(result.paymentCompletionRate).toBe(0.5);
    expect(result.paidSales).toBe(100);
    expect(result.sales).toBe(150);
  });

  it("reports no attribution for orders this storefront creates", async () => {
    respondByWindow({
      "2026-07-26": [
        makeOrder({ metadata: { bank_reference: "TEST-0001" } }),
        makeOrder({ metadata: { vat_id: "DE000000000" } }),
      ],
    });

    const result = await service().getConversion(container, "7d");

    expect(result.tracking.attributionAvailable).toBe(false);
    expect(result.tracking.ordersWithSource).toBe(0);
    expect(result.tracking.ordersWithoutSource).toBe(2);
  });

  it("flips attribution on once an order carries a source", async () => {
    respondByWindow({
      "2026-07-26": [makeOrder({ metadata: { utm_source: "newsletter" } })],
    });

    const result = await service().getConversion(container, "7d");
    expect(result.tracking.attributionAvailable).toBe(true);
    expect(result.tracking.ordersWithSource).toBe(1);
  });

  it("includes line items in the sales figures", async () => {
    respondByWindow({
      "2026-07-26": [
        makeOrder({ total: 180, items: [makeItem({ quantity: 2, total: 180 })] }),
      ],
    });

    const result = await service().getConversion(container, "7d");
    expect(result.sales).toBe(180);
  });
});

describe("buildFunnel", () => {
  const funnel = buildFunnel(
    [makeOrder(), makeOrder(), makeOrder()],
    [makeOrder()],
  );

  it("keeps all five steps so the shape is not silently a three-step funnel", () => {
    expect(funnel.map((step) => step.key)).toEqual([
      "visitors",
      "add_to_cart",
      "checkout_started",
      "order_created",
      "payment_confirmed",
    ]);
  });

  it("counts the two Medusa steps exactly", () => {
    expect(funnel.find((step) => step.key === "order_created")).toMatchObject({
      count: 3,
      source: "medusa",
    });
    expect(funnel.find((step) => step.key === "payment_confirmed")).toMatchObject({
      count: 1,
      source: "medusa",
    });
  });

  /**
   * The point of the whole exercise: no number is invented for a step nothing
   * measures, and the reason is carried with the gap.
   */
  it.each(["add_to_cart", "checkout_started"])(
    "reports %s as unavailable with a reason",
    (key) => {
      const step = funnel.find((candidate) => candidate.key === key);

      expect(step?.count).toBeNull();
      expect(step?.source).toBe("unavailable");
      expect(step?.note).toMatch(/no data source/i);
    },
  );

  it("leaves the visitors step for the client's GA4 query", () => {
    const visitors = funnel.find((step) => step.key === "visitors");
    expect(visitors).toMatchObject({ count: null, source: "ga4" });
  });
});
