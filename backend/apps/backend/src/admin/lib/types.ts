/**
 * The response shapes the analytics UI reads.
 *
 * Declared here rather than imported from `src/lib/**`: those modules live in
 * the Node server build (`module: Node16`, server-only imports), and pulling
 * one into the browser bundle would drag Medusa's framework with it. Keeping a
 * hand-written mirror is the cost of that separation — the fields are asserted
 * against fabricated fixtures in the tests, so a drift shows up there.
 */

export type CacheMeta = {
  status: "hit" | "miss" | "coalesced";
  ageSeconds: number;
  ttlSeconds: number;
};

export type Ga4Period = "today" | "7d" | "30d" | "90d";

export type Ga4Health = {
  configured: true;
  authenticated: true;
  propertyAccessible: true;
  propertyIdLastFour: string;
  measurementIdConfigured: boolean;
  authMethod: "inline_json" | "key_file" | "adc";
  generatedAt: string;
};

export type Ga4Row = Record<string, string | number>;

export type Ga4Summary = {
  period: Ga4Period;
  dateRange: { startDate: string; endDate: string };
  totals: {
    activeUsers: number;
    totalUsers: number;
    newUsers: number;
    sessions: number;
    screenPageViews: number;
    transactions: number;
    purchaseRevenue: number;
    totalRevenue: number;
    itemsPurchased: number;
    keyEvents: number;
  };
  daily: Ga4Row[];
  byChannelGroup: Ga4Row[];
  bySourceMedium: Ga4Row[];
  topPages: Ga4Row[];
  generatedAt: string;
  cache: CacheMeta;
};

export type Ga4Realtime = {
  totals: {
    activeUsers: number;
    screenPageViews: number;
    eventCount: number;
    keyEvents: number;
  };
  activeUsersByCountry: Ga4Row[];
  activeUsersByDeviceCategory: Ga4Row[];
  topPages: Ga4Row[];
  eventCountsByEventName: Ga4Row[];
  generatedAt: string;
  cache: CacheMeta;
};

export type OpsPeriod = "7d" | "30d" | "90d";

export type Kpi = {
  value: number;
  previous: number;
  change: number | null;
  trend: "up" | "down" | "flat";
};

export type SalesTrendPoint = {
  day: string;
  sales: number;
  orders: number;
  averageOrderValue: number;
};

export type NamedTotal = {
  key: string;
  label: string;
  orders: number;
  sales: number;
};

export type Bestseller = {
  productId: string | null;
  title: string;
  units: number;
  sales: number;
};

export type TopCustomer = {
  customerId: string | null;
  name: string;
  orders: number;
  sales: number;
};

export type RecentOrder = {
  id: string;
  displayId: number | null;
  createdAt: string;
  customer: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  total: number;
};

export type SalesBreakdown = {
  subtotal: number;
  shipping: number;
  discounts: number;
  tax: number;
  refunds: number;
  total: number;
};

export type CustomerMetrics = {
  averageOrderValue: number;
  revenuePerCustomer: number;
  repurchaseRate: number;
  newCustomers: number;
  returningCustomers: number;
  totalCustomers: number;
};

export type StatusCount = { status: string; orders: number };

export type Coverage = { orders: number; truncated: boolean };

export type OpsOverview = {
  period: OpsPeriod;
  timeZone: string;
  currencyCode: string;
  range: { start: string; end: string; startDay: string; endDay: string };
  previousRange: { startDay: string; endDay: string };
  kpis: {
    salesVolume: Kpi;
    orders: Kpi;
    averageOrderValue: Kpi;
    openShipments: Kpi;
  };
  salesTrend: SalesTrendPoint[];
  previousSalesTrend: SalesTrendPoint[];
  breakdown: SalesBreakdown;
  averageOrderValueTrend: Array<{ day: string; averageOrderValue: number }>;
  byPaymentMethod: NamedTotal[];
  byDiscountCode: NamedTotal[];
  bySalesChannel: NamedTotal[];
  byProduct: Bestseller[];
  bestsellers: Bestseller[];
  topCustomers: TopCustomer[];
  customerMetrics: CustomerMetrics;
  fulfillmentBreakdown: StatusCount[];
  recentOrders: RecentOrder[];
  coverage: Coverage;
  generatedAt: string;
  cache: CacheMeta;
};

export type OpsLive = {
  timeZone: string;
  currencyCode: string;
  day: string;
  ordersToday: number;
  revenueToday: number;
  paidRevenueToday: number;
  unfulfilledOrders: number;
  recentOrders: RecentOrder[];
  coverage: Coverage;
  generatedAt: string;
  cache: CacheMeta;
};

export type FunnelStep = {
  key: string;
  label: string;
  count: number | null;
  source: "medusa" | "ga4" | "unavailable";
  note?: string;
};

export type TrackingQuality = {
  ordersTotal: number;
  ordersWithSource: number;
  ordersWithoutSource: number;
  paymentPending: number;
  paymentCaptured: number;
  paymentRefunded: number;
  attributionAvailable: boolean;
};

export type OpsConversion = {
  period: OpsPeriod;
  timeZone: string;
  currencyCode: string;
  range: { startDay: string; endDay: string };
  orders: number;
  paidOrders: number;
  sales: number;
  paidSales: number;
  averageOrderValue: number;
  paymentCompletionRate: number;
  medianSecondsToPayment: number | null;
  byPaymentStatus: StatusCount[];
  funnel: FunnelStep[];
  tracking: TrackingQuality;
  coverage: Coverage;
  generatedAt: string;
  cache: CacheMeta;
};
