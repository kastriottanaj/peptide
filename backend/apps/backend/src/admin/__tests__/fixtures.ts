/**
 * Fabricated API responses for the admin tests.
 *
 * Nothing here corresponds to a real order, customer, product, property or
 * measurement id. The GA4 property id last-four is `0000`, the order ids are
 * `order_test_*`, and no email address appears anywhere — the dashboard never
 * renders one, and a fixture containing one would make that impossible to
 * assert.
 */

import type {
  Ga4Health,
  Ga4Realtime,
  Ga4Summary,
  OpsConversion,
  OpsLive,
  OpsOverview,
} from "../lib/types";

const CACHE = { status: "miss" as const, ageSeconds: 0, ttlSeconds: 30 };

export const health: Ga4Health = {
  configured: true,
  authenticated: true,
  propertyAccessible: true,
  propertyIdLastFour: "0000",
  measurementIdConfigured: true,
  authMethod: "inline_json",
  generatedAt: "2026-08-01T12:00:00.000Z",
};

export const summary: Ga4Summary = {
  period: "7d",
  dateRange: { startDate: "6daysAgo", endDate: "today" },
  totals: {
    activeUsers: 412,
    totalUsers: 480,
    newUsers: 305,
    sessions: 655,
    screenPageViews: 1840,
    transactions: 0,
    purchaseRevenue: 0,
    totalRevenue: 0,
    itemsPurchased: 0,
    keyEvents: 26,
  },
  daily: [
    { date: "2026-07-26", activeUsers: 50, sessions: 80, screenPageViews: 220 },
    { date: "2026-07-27", activeUsers: 62, sessions: 95, screenPageViews: 260 },
  ],
  byChannelGroup: [
    {
      channelGroup: "Organic Search",
      sessions: 410,
      totalUsers: 300,
      newUsers: 210,
      transactions: 0,
      purchaseRevenue: 0,
    },
    {
      channelGroup: "Direct",
      sessions: 180,
      totalUsers: 140,
      newUsers: 80,
      transactions: 0,
      purchaseRevenue: 0,
    },
  ],
  bySourceMedium: [
    {
      sourceMedium: "google / organic",
      sessions: 400,
      totalUsers: 295,
      newUsers: 205,
      transactions: 0,
      purchaseRevenue: 0,
    },
  ],
  topPages: [
    { pagePath: "/produkte", screenPageViews: 620, activeUsers: 300 },
    { pagePath: "/wissen", screenPageViews: 240, activeUsers: 150 },
  ],
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};

export const emptySummary: Ga4Summary = {
  ...summary,
  totals: {
    activeUsers: 0,
    totalUsers: 0,
    newUsers: 0,
    sessions: 0,
    screenPageViews: 0,
    transactions: 0,
    purchaseRevenue: 0,
    totalRevenue: 0,
    itemsPurchased: 0,
    keyEvents: 0,
  },
  daily: [],
  byChannelGroup: [],
  bySourceMedium: [],
  topPages: [],
};

export const realtime: Ga4Realtime = {
  totals: {
    activeUsers: 7,
    screenPageViews: 21,
    eventCount: 44,
    keyEvents: 2,
  },
  activeUsersByCountry: [
    { country: "Germany", activeUsers: 5 },
    { country: "Austria", activeUsers: 2 },
  ],
  activeUsersByDeviceCategory: [
    { deviceCategory: "desktop", activeUsers: 4 },
    { deviceCategory: "mobile", activeUsers: 3 },
  ],
  topPages: [
    { unifiedScreenName: "/produkte", screenPageViews: 12, activeUsers: 5 },
  ],
  eventCountsByEventName: [{ eventName: "page_view", eventCount: 21 }],
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};

export const emptyRealtime: Ga4Realtime = {
  totals: {
    activeUsers: 0,
    screenPageViews: 0,
    eventCount: 0,
    keyEvents: 0,
  },
  activeUsersByCountry: [],
  activeUsersByDeviceCategory: [],
  topPages: [],
  eventCountsByEventName: [],
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};

export const overview: OpsOverview = {
  period: "7d",
  timeZone: "Europe/Berlin",
  currencyCode: "eur",
  range: {
    start: "2026-07-25T22:00:00.000Z",
    end: "2026-08-01T22:00:00.000Z",
    startDay: "2026-07-26",
    endDay: "2026-08-01",
  },
  previousRange: { startDay: "2026-07-19", endDay: "2026-07-25" },
  kpis: {
    salesVolume: { value: 2480.5, previous: 1900, change: 0.3055, trend: "up" },
    orders: { value: 14, previous: 11, change: 0.2727, trend: "up" },
    averageOrderValue: {
      value: 177.18,
      previous: 172.73,
      change: 0.0258,
      trend: "up",
    },
    openShipments: { value: 3, previous: 5, change: -0.4, trend: "down" },
  },
  salesTrend: [
    { day: "2026-07-26", sales: 300, orders: 2, averageOrderValue: 150 },
    { day: "2026-07-27", sales: 0, orders: 0, averageOrderValue: 0 },
    { day: "2026-07-28", sales: 640.5, orders: 4, averageOrderValue: 160.13 },
  ],
  previousSalesTrend: [
    { day: "2026-07-19", sales: 200, orders: 1, averageOrderValue: 200 },
    { day: "2026-07-20", sales: 100, orders: 1, averageOrderValue: 100 },
    { day: "2026-07-21", sales: 0, orders: 0, averageOrderValue: 0 },
  ],
  breakdown: {
    subtotal: 2300,
    shipping: 190.5,
    discounts: 60,
    tax: 0,
    refunds: 10,
    total: 2480.5,
  },
  averageOrderValueTrend: [
    { day: "2026-07-26", averageOrderValue: 150 },
    { day: "2026-07-27", averageOrderValue: 0 },
    { day: "2026-07-28", averageOrderValue: 160.13 },
  ],
  byPaymentMethod: [
    { key: "pp_system_default", label: "pp_system_default", orders: 14, sales: 2480.5 },
  ],
  byDiscountCode: [{ key: "MENGE3", label: "MENGE3", orders: 3, sales: 540 }],
  bySalesChannel: [{ key: "sc_test", label: "Webshop", orders: 14, sales: 2480.5 }],
  byProduct: [
    { productId: "prod_test_a", title: "Testpeptid A", units: 18, sales: 1620 },
    { productId: "prod_test_b", title: "Testpeptid B", units: 7, sales: 860.5 },
  ],
  bestsellers: [
    { productId: "prod_test_a", title: "Testpeptid A", units: 18, sales: 1620 },
    { productId: "prod_test_b", title: "Testpeptid B", units: 7, sales: 860.5 },
  ],
  topCustomers: [
    { customerId: "cus_test_1", name: "Testkunde Eins", orders: 3, sales: 640 },
    { customerId: null, name: "Guest", orders: 5, sales: 520 },
  ],
  customerMetrics: {
    averageOrderValue: 177.18,
    revenuePerCustomer: 310.06,
    repurchaseRate: 0.25,
    newCustomers: 6,
    returningCustomers: 2,
    totalCustomers: 8,
  },
  fulfillmentBreakdown: [
    { status: "not_fulfilled", orders: 3 },
    { status: "shipped", orders: 11 },
  ],
  recentOrders: [
    {
      id: "order_test_001",
      displayId: 1001,
      createdAt: "2026-08-01T09:15:00.000Z",
      customer: "Testkunde Eins",
      paymentStatus: "captured",
      fulfillmentStatus: "shipped",
      total: 189.9,
    },
    {
      id: "order_test_002",
      displayId: 1002,
      createdAt: "2026-07-31T16:40:00.000Z",
      customer: "Guest",
      paymentStatus: "not_paid",
      fulfillmentStatus: "not_fulfilled",
      total: 79.9,
    },
  ],
  coverage: { orders: 14, truncated: false },
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};

/** A shop that has taken no orders — the state this repository is in today. */
export const emptyOverview: OpsOverview = {
  ...overview,
  kpis: {
    salesVolume: { value: 0, previous: 0, change: null, trend: "flat" },
    orders: { value: 0, previous: 0, change: null, trend: "flat" },
    averageOrderValue: { value: 0, previous: 0, change: null, trend: "flat" },
    openShipments: { value: 0, previous: 0, change: null, trend: "flat" },
  },
  salesTrend: [
    { day: "2026-07-26", sales: 0, orders: 0, averageOrderValue: 0 },
    { day: "2026-07-27", sales: 0, orders: 0, averageOrderValue: 0 },
  ],
  previousSalesTrend: [],
  breakdown: { subtotal: 0, shipping: 0, discounts: 0, tax: 0, refunds: 0, total: 0 },
  averageOrderValueTrend: [
    { day: "2026-07-26", averageOrderValue: 0 },
    { day: "2026-07-27", averageOrderValue: 0 },
  ],
  byPaymentMethod: [],
  byDiscountCode: [],
  bySalesChannel: [],
  byProduct: [],
  bestsellers: [],
  topCustomers: [],
  customerMetrics: {
    averageOrderValue: 0,
    revenuePerCustomer: 0,
    repurchaseRate: 0,
    newCustomers: 0,
    returningCustomers: 0,
    totalCustomers: 0,
  },
  fulfillmentBreakdown: [],
  recentOrders: [],
  coverage: { orders: 0, truncated: false },
};

export const live: OpsLive = {
  timeZone: "Europe/Berlin",
  currencyCode: "eur",
  day: "2026-08-01",
  ordersToday: 2,
  revenueToday: 269.8,
  paidRevenueToday: 189.9,
  unfulfilledOrders: 1,
  recentOrders: overview.recentOrders,
  coverage: { orders: 2, truncated: false },
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};

export const emptyLive: OpsLive = {
  ...live,
  ordersToday: 0,
  revenueToday: 0,
  paidRevenueToday: 0,
  unfulfilledOrders: 0,
  recentOrders: [],
  coverage: { orders: 0, truncated: false },
};

export const conversion: OpsConversion = {
  period: "7d",
  timeZone: "Europe/Berlin",
  currencyCode: "eur",
  range: { startDay: "2026-07-26", endDay: "2026-08-01" },
  orders: 14,
  paidOrders: 9,
  sales: 2480.5,
  paidSales: 1610.2,
  averageOrderValue: 177.18,
  paymentCompletionRate: 0.6429,
  medianSecondsToPayment: 93600,
  byPaymentStatus: [
    { status: "captured", orders: 9 },
    { status: "not_paid", orders: 5 },
  ],
  funnel: [
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
      note: "No data source. The storefront does not send an add_to_cart event.",
    },
    {
      key: "checkout_started",
      label: "Checkout started",
      count: null,
      source: "unavailable",
      note: "No data source. The checkout page is excluded from measurement.",
    },
    { key: "order_created", label: "Order created", count: 14, source: "medusa" },
    {
      key: "payment_confirmed",
      label: "Payment confirmed",
      count: 9,
      source: "medusa",
    },
  ],
  tracking: {
    ordersTotal: 14,
    ordersWithSource: 0,
    ordersWithoutSource: 14,
    paymentPending: 5,
    paymentCaptured: 9,
    paymentRefunded: 0,
    attributionAvailable: false,
  },
  coverage: { orders: 14, truncated: false },
  generatedAt: "2026-08-01T12:00:00.000Z",
  cache: CACHE,
};
