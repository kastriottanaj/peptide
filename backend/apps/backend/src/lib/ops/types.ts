/**
 * The shapes the ops analytics endpoints read and return.
 *
 * `OrderRow` deliberately declares almost everything optional. It describes what
 * `getOrdersListWorkflow` *may* hand back for a given field selection, not a
 * guaranteed record — an order with no line items, no payment collection and no
 * customer is a real thing in a shop whose checkout is closed, and the
 * aggregations must survive it. Anything that is genuinely required to place an
 * order at all (`id`, `currency_code`, `created_at`) is required here too.
 *
 * The response types are the contract the admin UI is written against. They
 * carry no customer email, no address, no payment token and no identifiers
 * beyond the ids the admin already routes on — see the note on `RecentOrder`.
 */

import type { DateWindow, OpsPeriod } from "./period";

export type OrderAdjustmentRow = {
  code?: string | null;
  amount?: unknown;
  promotion_id?: string | null;
};

export type OrderItemRow = {
  id?: string;
  title?: string | null;
  product_id?: string | null;
  product_title?: string | null;
  variant_id?: string | null;
  variant_title?: string | null;
  quantity?: unknown;
  unit_price?: unknown;
  subtotal?: unknown;
  total?: unknown;
  adjustments?: OrderAdjustmentRow[] | null;
};

export type OrderPaymentRow = {
  id?: string;
  provider_id?: string | null;
  amount?: unknown;
  captured_at?: string | Date | null;
  canceled_at?: string | Date | null;
};

export type OrderPaymentCollectionRow = {
  id?: string;
  status?: string | null;
  amount?: unknown;
  captured_amount?: unknown;
  refunded_amount?: unknown;
  payments?: OrderPaymentRow[] | null;
};

export type OrderFulfillmentRow = {
  id?: string;
  packed_at?: string | Date | null;
  shipped_at?: string | Date | null;
  delivered_at?: string | Date | null;
  canceled_at?: string | Date | null;
};

export type OrderShippingMethodRow = {
  id?: string;
  amount?: unknown;
  total?: unknown;
  adjustments?: OrderAdjustmentRow[] | null;
};

export type OrderCustomerRow = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  /**
   * Present because the workflow returns it, never forwarded to a response. The
   * dashboard's "top customers" list displays a name or a masked fallback; see
   * `customerDisplayName`.
   */
  email?: string | null;
};

export type OrderRow = {
  id: string;
  display_id?: number | null;
  status?: string | null;
  currency_code: string;
  created_at: string | Date;
  canceled_at?: string | Date | null;
  customer_id?: string | null;
  sales_channel_id?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | null;

  total?: unknown;
  subtotal?: unknown;
  discount_total?: unknown;
  shipping_total?: unknown;
  tax_total?: unknown;
  summary?: { paid_total?: unknown; refunded_total?: unknown } | null;

  payment_status?: string | null;
  fulfillment_status?: string | null;

  items?: OrderItemRow[] | null;
  shipping_methods?: OrderShippingMethodRow[] | null;
  payment_collections?: OrderPaymentCollectionRow[] | null;
  fulfillments?: OrderFulfillmentRow[] | null;
  customer?: OrderCustomerRow | null;
};

/** A KPI card's number, its comparison, and the direction to paint it. */
export type Kpi = {
  value: number;
  previous: number;
  /** Fraction, e.g. `0.125` for +12.5%. `null` when there is no baseline. */
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

/**
 * A row of the recent-orders table.
 *
 * No email, no address, no line items. The admin already has a page that shows
 * all of that behind its own permission check; a dashboard that reproduces it
 * turns one careless screen-share into a data incident, and none of it is
 * needed to answer "what came in today".
 */
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
  /** Share of customers in the window with more than one order. */
  repurchaseRate: number;
  newCustomers: number;
  returningCustomers: number;
  totalCustomers: number;
};

export type FulfillmentBreakdown = {
  status: string;
  orders: number;
};

/**
 * Whether a list was cut short by the fetch cap.
 *
 * Surfaced rather than swallowed: a merchant reading "€12,400" needs to know if
 * that is all of it. See `MAX_ORDERS` in `orders.ts`.
 */
export type Coverage = {
  orders: number;
  truncated: boolean;
};

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
  fulfillmentBreakdown: FulfillmentBreakdown[];
  recentOrders: RecentOrder[];
  coverage: Coverage;
  generatedAt: string;
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
};

export type FunnelStep = {
  key: string;
  label: string;
  /** `null` when no data source backs this step — rendered as unavailable. */
  count: number | null;
  source: "medusa" | "ga4" | "unavailable";
  /** Why the step has no number, when it has none. */
  note?: string;
};

export type TrackingQuality = {
  ordersTotal: number;
  ordersWithSource: number;
  ordersWithoutSource: number;
  paymentPending: number;
  paymentCaptured: number;
  paymentRefunded: number;
  /**
   * Whether the storefront persists an acquisition source on the order at all.
   * `false` here is what makes the attribution table and the source-summary
   * table render as a documented data gap instead of as an empty result.
   */
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
  /** Median seconds from order creation to first capture. `null` if none. */
  medianSecondsToPayment: number | null;
  byPaymentStatus: FulfillmentBreakdown[];
  funnel: FunnelStep[];
  tracking: TrackingQuality;
  coverage: Coverage;
  generatedAt: string;
};

export type OrdersInWindow = {
  rows: OrderRow[];
  window: DateWindow;
  truncated: boolean;
};
