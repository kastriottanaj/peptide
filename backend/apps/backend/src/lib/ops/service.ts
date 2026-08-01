/**
 * Assembling the three Medusa-side analytics payloads.
 *
 * This module does the orchestration — resolve a period, fetch the orders,
 * hand them to the pure functions in `aggregate.ts`, cache the result. The
 * arithmetic lives there and not here, so it can be tested against fabricated
 * orders without a container.
 *
 * **Medusa is the source of truth for money on this dashboard.** Nothing in
 * this file reads GA4, and nothing in it should: the two halves of the
 * dashboard are fetched separately precisely so a Google outage cannot take the
 * shop's own order figures off the screen.
 */

import { Ga4Cache, type CacheMeta } from "../ga4/cache";
import type { MedusaContainer } from "@medusajs/framework/types";
import {
  averageOrderValue,
  averageOrderValueTrend,
  bestsellers,
  billableOrders,
  byDiscountCode,
  byPaymentMethod,
  bySalesChannel,
  customerMetrics,
  dominantCurrency,
  fulfillmentBreakdown,
  hasOpenShipment,
  isPaid,
  kpi,
  medianSecondsToPayment,
  orderPaidTotal,
  orderTotal,
  ordersWithAttribution,
  paymentStatusBreakdown,
  recentOrders,
  salesBreakdown,
  salesTrend,
  salesVolume,
  topCustomers,
} from "./aggregate";
import { ratio, roundMoney } from "./money";
import {
  fetchOrdersInWindow,
  fetchSalesChannelNames,
  fetchStoreCurrency,
} from "./orders";
import {
  resolvePeriod,
  resolveTimezone,
  todayWindow,
  type OpsPeriod,
} from "./period";
import type {
  FunnelStep,
  OpsConversion,
  OpsLive,
  OpsOverview,
  OrderRow,
} from "./types";

/**
 * Cache lifetime for an assembled report.
 *
 * Shorter than it could be. These reports cost database work rather than a
 * metered third-party quota, and a merchant who has just marked an order as
 * paid and reloads the dashboard should see it — 30 seconds is long enough to
 * absorb a burst of tab-switching and short enough that nobody thinks the page
 * is broken. `ANALYTICS_CACHE_TTL_SECONDS=0` turns it off.
 */
const DEFAULT_CACHE_TTL_SECONDS = 30;
const MAX_CACHE_TTL_SECONDS = 600;

export function resolveOpsCacheTtlMs(
  raw = process.env.ANALYTICS_CACHE_TTL_SECONDS,
): number {
  const value = (raw ?? "").trim();
  if (!value) return DEFAULT_CACHE_TTL_SECONDS * 1000;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_CACHE_TTL_SECONDS * 1000;
  }
  return Math.min(Math.floor(parsed), MAX_CACHE_TTL_SECONDS) * 1000;
}

export type OpsResult<T> = T & { cache: CacheMeta };

export type OpsServiceOptions = {
  cache?: Ga4Cache;
  now?: () => Date;
};

export class OpsAnalyticsService {
  #cache: Ga4Cache;
  #now: () => Date;

  constructor(options: OpsServiceOptions = {}) {
    this.#cache = options.cache ?? new Ga4Cache();
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Cache key.
   *
   * The day is part of it so a cached report cannot survive midnight in the
   * reporting zone — the window would silently be yesterday's, which is the
   * kind of wrong that nobody notices until month end.
   */
  #key(parts: readonly string[], timeZone: string): string {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(this.#now());

    return [...parts, timeZone, day].join(":");
  }

  async getOverview(
    container: MedusaContainer,
    period: OpsPeriod,
  ): Promise<OpsResult<OpsOverview>> {
    const timeZone = resolveTimezone();
    const { value, cache } = await this.#cache.fetch(
      this.#key(["overview", period], timeZone),
      resolveOpsCacheTtlMs(),
      () => this.#buildOverview(container, period, timeZone),
    );

    return { ...value, cache };
  }

  async #buildOverview(
    container: MedusaContainer,
    period: OpsPeriod,
    timeZone: string,
  ): Promise<OpsOverview> {
    const windows = resolvePeriod(period, { timeZone, now: this.#now() });

    // The two windows and the reference data are independent; running them
    // together makes a 90-day report one round trip deep rather than four.
    const [current, previous, channelNames, storeCurrency] = await Promise.all([
      fetchOrdersInWindow({ container, window: windows.current }),
      fetchOrdersInWindow({ container, window: windows.previous }),
      fetchSalesChannelNames(container),
      fetchStoreCurrency(container),
    ]);

    const trend = salesTrend(current.rows, windows.current, timeZone);

    return {
      period,
      timeZone,
      currencyCode: dominantCurrency(current.rows, storeCurrency),
      range: {
        start: windows.current.start.toISOString(),
        end: windows.current.end.toISOString(),
        startDay: windows.current.startDay,
        endDay: windows.current.endDay,
      },
      previousRange: {
        startDay: windows.previous.startDay,
        endDay: windows.previous.endDay,
      },
      kpis: {
        salesVolume: kpi(
          salesVolume(current.rows),
          salesVolume(previous.rows),
        ),
        orders: kpi(
          billableOrders(current.rows).length,
          billableOrders(previous.rows).length,
        ),
        averageOrderValue: kpi(
          averageOrderValue(current.rows),
          averageOrderValue(previous.rows),
        ),
        openShipments: kpi(
          current.rows.filter(hasOpenShipment).length,
          previous.rows.filter(hasOpenShipment).length,
        ),
      },
      salesTrend: trend,
      previousSalesTrend: salesTrend(
        previous.rows,
        windows.previous,
        timeZone,
      ),
      breakdown: salesBreakdown(current.rows),
      averageOrderValueTrend: averageOrderValueTrend(trend),
      byPaymentMethod: byPaymentMethod(current.rows),
      byDiscountCode: byDiscountCode(current.rows),
      bySalesChannel: bySalesChannel(current.rows, channelNames),
      byProduct: bestsellers(current.rows, 25),
      bestsellers: bestsellers(current.rows, 8),
      topCustomers: topCustomers(current.rows, 8),
      customerMetrics: customerMetrics(current.rows, previous.rows),
      fulfillmentBreakdown: fulfillmentBreakdown(current.rows),
      recentOrders: recentOrders(current.rows, 8),
      coverage: {
        orders: current.rows.length,
        truncated: current.truncated || previous.truncated,
      },
      generatedAt: this.#now().toISOString(),
    };
  }

  /**
   * Today's commerce figures, for the Live tab's Medusa half.
   *
   * Cached for a much shorter time than the period reports: this is the panel
   * beside a 60-second GA4 poll, and a minute-old order count next to a
   * real-time visitor count would look like the dashboard is stuck.
   */
  async getLive(container: MedusaContainer): Promise<OpsResult<OpsLive>> {
    const timeZone = resolveTimezone();
    const ttl = Math.min(resolveOpsCacheTtlMs(), 15_000);

    const { value, cache } = await this.#cache.fetch(
      this.#key(["live"], timeZone),
      ttl,
      () => this.#buildLive(container, timeZone),
    );

    return { ...value, cache };
  }

  async #buildLive(
    container: MedusaContainer,
    timeZone: string,
  ): Promise<OpsLive> {
    const window = todayWindow({ timeZone, now: this.#now() });

    const [today, storeCurrency] = await Promise.all([
      fetchOrdersInWindow({ container, window }),
      fetchStoreCurrency(container),
    ]);

    const billable = billableOrders(today.rows);

    return {
      timeZone,
      currencyCode: dominantCurrency(today.rows, storeCurrency),
      day: window.startDay,
      ordersToday: billable.length,
      revenueToday: salesVolume(today.rows),
      paidRevenueToday: roundMoney(
        billable.reduce((sum, order) => sum + orderPaidTotal(order), 0),
      ),
      unfulfilledOrders: today.rows.filter(hasOpenShipment).length,
      recentOrders: recentOrders(today.rows, 6),
      coverage: { orders: today.rows.length, truncated: today.truncated },
      generatedAt: this.#now().toISOString(),
    };
  }

  async getConversion(
    container: MedusaContainer,
    period: OpsPeriod,
  ): Promise<OpsResult<OpsConversion>> {
    const timeZone = resolveTimezone();
    const { value, cache } = await this.#cache.fetch(
      this.#key(["conversion", period], timeZone),
      resolveOpsCacheTtlMs(),
      () => this.#buildConversion(container, period, timeZone),
    );

    return { ...value, cache };
  }

  async #buildConversion(
    container: MedusaContainer,
    period: OpsPeriod,
    timeZone: string,
  ): Promise<OpsConversion> {
    const windows = resolvePeriod(period, { timeZone, now: this.#now() });

    const [current, storeCurrency] = await Promise.all([
      fetchOrdersInWindow({ container, window: windows.current }),
      fetchStoreCurrency(container),
    ]);

    const billable = billableOrders(current.rows);
    const paid = billable.filter(isPaid);
    const withSource = ordersWithAttribution(billable);

    return {
      period,
      timeZone,
      currencyCode: dominantCurrency(current.rows, storeCurrency),
      range: {
        startDay: windows.current.startDay,
        endDay: windows.current.endDay,
      },
      orders: billable.length,
      paidOrders: paid.length,
      sales: salesVolume(current.rows),
      paidSales: roundMoney(
        paid.reduce((sum, order) => sum + orderPaidTotal(order), 0),
      ),
      averageOrderValue: averageOrderValue(current.rows),
      paymentCompletionRate: ratio(paid.length, billable.length),
      medianSecondsToPayment: medianSecondsToPayment(current.rows),
      byPaymentStatus: paymentStatusBreakdown(current.rows),
      funnel: buildFunnel(billable, paid),
      tracking: {
        ordersTotal: billable.length,
        ordersWithSource: withSource,
        ordersWithoutSource: billable.length - withSource,
        paymentPending: billable.length - paid.length,
        paymentCaptured: paid.length,
        paymentRefunded: billable.filter(
          (order) => order.payment_status === "refunded",
        ).length,
        attributionAvailable: withSource > 0,
      },
      coverage: { orders: current.rows.length, truncated: current.truncated },
      generatedAt: this.#now().toISOString(),
    };
  }
}

/**
 * The conversion funnel, with the middle deliberately missing.
 *
 * Only two of the five canonical steps can be answered honestly here.
 *
 *  - **Visitors** is GA4's and is filled in by the client, which already has
 *    the summary response; the server does not fetch GA4 to avoid coupling the
 *    two failure domains.
 *  - **Added to cart** and **Checkout started** have no source. The storefront
 *    does not send `add_to_cart` or `begin_checkout` to GA4 — and could not
 *    usefully, because `/warenkorb`, `/kasse` and `/bestellung` are excluded
 *    from measurement entirely so that order ids never reach Google
 *    (`storefront/src/lib/analytics.ts`). Medusa has carts, but a cart row is
 *    created on the first page that needs one, not on an intent to buy, so
 *    counting them would overstate the step. They report `null`.
 *  - **Order created** and **Payment confirmed** are Medusa's, and exact.
 *
 * Returning `null` rather than omitting the rows is the point: the funnel keeps
 * its shape, and the UI can say *why* two bars are empty instead of quietly
 * drawing a three-step funnel that looks complete.
 */
export function buildFunnel(
  billable: readonly OrderRow[],
  paid: readonly OrderRow[],
): FunnelStep[] {
  return [
    {
      key: "visitors",
      label: "Visitors",
      count: null,
      source: "ga4",
      note: "Filled from the Google Analytics summary for the same period.",
    },
    {
      key: "add_to_cart",
      label: "Added to cart",
      count: null,
      source: "unavailable",
      note: "No data source. The storefront does not send an add_to_cart event, and the cart pages are excluded from measurement so order identifiers never reach Google.",
    },
    {
      key: "checkout_started",
      label: "Checkout started",
      count: null,
      source: "unavailable",
      note: "No data source. The checkout page is excluded from analytics measurement, and no begin_checkout event is sent.",
    },
    {
      key: "order_created",
      label: "Order created",
      count: billable.length,
      source: "medusa",
    },
    {
      key: "payment_confirmed",
      label: "Payment confirmed",
      count: paid.length,
      source: "medusa",
    },
  ];
}

/** Totals helper the routes use for the export header. Kept for symmetry. */
export function totalOrderValue(orders: readonly OrderRow[]): number {
  return roundMoney(
    billableOrders(orders).reduce((sum, order) => sum + orderTotal(order), 0),
  );
}

let sharedService: OpsAnalyticsService | null = null;

/**
 * Process-wide service, for the same reason GA4's is: the cache and its
 * in-flight de-duplication are only useful if every request shares them. Two
 * admins opening the dashboard at once produce one set of queries.
 */
export function getOpsAnalyticsService(): OpsAnalyticsService {
  if (!sharedService) sharedService = new OpsAnalyticsService();
  return sharedService;
}

/** Tests only. */
export function resetOpsAnalyticsService(): void {
  sharedService = null;
}
