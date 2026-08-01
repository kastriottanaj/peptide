/**
 * Turning a list of orders into the numbers the dashboard shows.
 *
 * Every function here is pure: orders in, plain JSON out, no container, no
 * database, no clock beyond what is passed in. That is what makes the whole
 * commerce side of the dashboard testable against fabricated orders — which
 * matters more than usual here, because this shop has taken no orders yet, so
 * the only way to know a sum is right is to compute it over data we wrote.
 *
 * Two rules hold throughout:
 *
 *  - **Cancelled orders are excluded from money, counted nowhere else.** An
 *    order with `canceled_at` set never happened as far as revenue goes, and
 *    including it would make the dashboard disagree with the orders list.
 *  - **Nothing is invented.** Where a figure cannot be derived from an order
 *    record it is omitted or marked unavailable rather than approximated; the
 *    conversion funnel in particular reports `null` for steps no data source
 *    covers. See `docs/analytics-dashboard.md`.
 */

import { amount, percentChange, ratio, roundMoney, sumBy } from "./money";
import { addDays, dayKey, daysInWindow, type DateWindow } from "./period";
import type {
  Bestseller,
  CustomerMetrics,
  FulfillmentBreakdown,
  Kpi,
  NamedTotal,
  OrderRow,
  RecentOrder,
  SalesBreakdown,
  SalesTrendPoint,
  TopCustomer,
} from "./types";

/** Statuses that mean money has actually arrived. */
const PAID_STATUSES = new Set(["captured", "partially_captured", "refunded", "partially_refunded"]);

/** Fulfillment statuses that still need someone to pack or post something. */
const OPEN_FULFILLMENT_STATUSES = new Set([
  "not_fulfilled",
  "partially_fulfilled",
  "partially_shipped",
]);

export function isCancelled(order: OrderRow): boolean {
  return Boolean(order.canceled_at) || order.status === "canceled";
}

/** Orders that count towards revenue: everything not cancelled. */
export function billableOrders(orders: readonly OrderRow[]): OrderRow[] {
  return orders.filter((order) => !isCancelled(order));
}

export function orderTotal(order: OrderRow): number {
  return amount(order.total);
}

/**
 * What the customer has actually paid.
 *
 * Read from the order summary when present and from the payment collections
 * otherwise. The two agree in normal operation; the fallback exists because
 * `summary` is an expandable field and a caller that forgot to request it would
 * otherwise silently report every order as unpaid.
 */
export function orderPaidTotal(order: OrderRow): number {
  const fromSummary = amount(order.summary?.paid_total);
  if (fromSummary) return fromSummary;

  return sumBy(order.payment_collections ?? [], (pc) => pc.captured_amount);
}

export function orderRefundedTotal(order: OrderRow): number {
  const fromSummary = amount(order.summary?.refunded_total);
  if (fromSummary) return fromSummary;

  return sumBy(order.payment_collections ?? [], (pc) => pc.refunded_amount);
}

export function isPaid(order: OrderRow): boolean {
  if (order.payment_status && PAID_STATUSES.has(order.payment_status)) {
    return true;
  }
  return orderPaidTotal(order) > 0;
}

export function hasOpenShipment(order: OrderRow): boolean {
  if (isCancelled(order)) return false;
  const status = order.fulfillment_status ?? "not_fulfilled";
  return OPEN_FULFILLMENT_STATUSES.has(status);
}

/** Net sales for the window: order totals less what has been refunded. */
export function salesVolume(orders: readonly OrderRow[]): number {
  const billable = billableOrders(orders);
  const gross = billable.reduce((sum, order) => sum + orderTotal(order), 0);
  const refunds = billable.reduce(
    (sum, order) => sum + orderRefundedTotal(order),
    0,
  );
  return roundMoney(gross - refunds);
}

export function averageOrderValue(orders: readonly OrderRow[]): number {
  const billable = billableOrders(orders);
  if (billable.length === 0) return 0;
  return roundMoney(salesVolume(billable) / billable.length);
}

/** Build a KPI from a current and a previous value. */
export function kpi(value: number, previous: number): Kpi {
  const change = percentChange(value, previous);
  const trend: Kpi["trend"] =
    value === previous ? "flat" : value > previous ? "up" : "down";

  return { value, previous, change, trend };
}

/**
 * Daily sales, with a row for every day in the window.
 *
 * Empty days are filled with zeros rather than skipped: a line chart drawn from
 * sparse points slopes straight across a day with no orders, which reads as
 * "some sales" instead of "none".
 */
export function salesTrend(
  orders: readonly OrderRow[],
  window: DateWindow,
  timeZone: string,
): SalesTrendPoint[] {
  const buckets = new Map<string, { sales: number; orders: number }>();
  for (const day of daysInWindow(window)) {
    buckets.set(day, { sales: 0, orders: 0 });
  }

  for (const order of billableOrders(orders)) {
    const day = dayKey(new Date(order.created_at), timeZone);
    const bucket = buckets.get(day);
    // An order outside the window means the caller filtered wrong; dropping it
    // is better than inventing a bucket the chart's axis does not have.
    if (!bucket) continue;

    bucket.sales += orderTotal(order) - orderRefundedTotal(order);
    bucket.orders += 1;
  }

  return [...buckets.entries()].map(([day, bucket]) => ({
    day,
    sales: roundMoney(bucket.sales),
    orders: bucket.orders,
    averageOrderValue: bucket.orders
      ? roundMoney(bucket.sales / bucket.orders)
      : 0,
  }));
}

export function salesBreakdown(orders: readonly OrderRow[]): SalesBreakdown {
  const billable = billableOrders(orders);

  const subtotal = roundMoney(sumBy(billable, (order) => order.subtotal));
  const shipping = roundMoney(sumBy(billable, (order) => order.shipping_total));
  const tax = roundMoney(sumBy(billable, (order) => order.tax_total));
  const discounts = roundMoney(
    sumBy(billable, (order) => order.discount_total),
  );
  const refunds = roundMoney(
    billable.reduce((sum, order) => sum + orderRefundedTotal(order), 0),
  );
  const total = salesVolume(billable);

  return { subtotal, shipping, discounts, tax, refunds, total };
}

/** Generic "group orders by a key, sum orders and money" helper. */
function groupOrders(
  orders: readonly OrderRow[],
  keysFor: (order: OrderRow) => Array<{ key: string; label: string }>,
): NamedTotal[] {
  const groups = new Map<string, NamedTotal>();

  for (const order of billableOrders(orders)) {
    const net = orderTotal(order) - orderRefundedTotal(order);

    for (const { key, label } of keysFor(order)) {
      const existing = groups.get(key) ?? { key, label, orders: 0, sales: 0 };
      existing.orders += 1;
      existing.sales += net;
      groups.set(key, existing);
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, sales: roundMoney(group.sales) }))
    .sort((a, b) => b.sales - a.sales || b.orders - a.orders);
}

/**
 * Sales by payment provider.
 *
 * An order can in principle carry more than one payment collection, so a
 * provider appearing twice on one order is counted once — otherwise the sum of
 * the column exceeds the shop's takings.
 */
export function byPaymentMethod(orders: readonly OrderRow[]): NamedTotal[] {
  return groupOrders(orders, (order) => {
    const providers = new Set<string>();
    for (const collection of order.payment_collections ?? []) {
      for (const payment of collection.payments ?? []) {
        if (payment.provider_id) providers.add(payment.provider_id);
      }
    }
    if (providers.size === 0) {
      return [{ key: "unpaid", label: "Not paid" }];
    }
    return [...providers].map((id) => ({ key: id, label: id }));
  });
}

/**
 * Sales by promotion code.
 *
 * Codes come off line-item and shipping adjustments, which is where Medusa
 * records which promotion produced a discount. This shop's promotions are
 * automatic quantity and free-shipping rules rather than codes a customer
 * types, so the column reads as "which rule fired", not "which coupon was
 * redeemed" — the underlying record is the same either way.
 */
export function byDiscountCode(orders: readonly OrderRow[]): NamedTotal[] {
  return groupOrders(orders, (order) => {
    const codes = new Set<string>();

    for (const item of order.items ?? []) {
      for (const adjustment of item.adjustments ?? []) {
        if (adjustment.code) codes.add(adjustment.code);
      }
    }
    for (const method of order.shipping_methods ?? []) {
      for (const adjustment of method.adjustments ?? []) {
        if (adjustment.code) codes.add(adjustment.code);
      }
    }

    if (codes.size === 0) return [];
    return [...codes].map((code) => ({ key: code, label: code }));
  });
}

export function bySalesChannel(
  orders: readonly OrderRow[],
  channelNames: ReadonlyMap<string, string>,
): NamedTotal[] {
  return groupOrders(orders, (order) => {
    const id = order.sales_channel_id;
    if (!id) return [{ key: "none", label: "No sales channel" }];
    return [{ key: id, label: channelNames.get(id) ?? id }];
  });
}

/**
 * Units and revenue per product.
 *
 * Keyed on `product_id` where present and on the item title otherwise, so a
 * line item whose product has since been deleted still appears rather than
 * collapsing every orphaned line into one row.
 */
export function bestsellers(
  orders: readonly OrderRow[],
  limit = 10,
): Bestseller[] {
  const products = new Map<string, Bestseller>();

  for (const order of billableOrders(orders)) {
    for (const item of order.items ?? []) {
      const title = item.product_title ?? item.title ?? "Unknown product";
      const key = item.product_id ?? `title:${title}`;

      const existing = products.get(key) ?? {
        productId: item.product_id ?? null,
        title,
        units: 0,
        sales: 0,
      };
      existing.units += amount(item.quantity);
      existing.sales += amount(item.total ?? item.subtotal);
      products.set(key, existing);
    }
  }

  return [...products.values()]
    .map((product) => ({ ...product, sales: roundMoney(product.sales) }))
    .sort((a, b) => b.units - a.units || b.sales - a.sales)
    .slice(0, limit);
}

/**
 * A customer's name for display, without leaking an address book.
 *
 * A registered customer shows their name or company. A guest order shows
 * "Guest" — deliberately not their email, which the dashboard has no reason to
 * put on screen and which turns a shared browser tab into a disclosure.
 */
export function customerDisplayName(order: OrderRow): string {
  const customer = order.customer;
  const name = [customer?.first_name, customer?.last_name]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();

  if (name) return name;
  if (customer?.company_name) return customer.company_name;
  return order.customer_id ? "Customer" : "Guest";
}

export function topCustomers(
  orders: readonly OrderRow[],
  limit = 8,
): TopCustomer[] {
  const customers = new Map<string, TopCustomer>();

  for (const order of billableOrders(orders)) {
    // Guests are grouped under one row rather than one row each: without a
    // customer id there is nothing to say two guest orders are the same person.
    const key = order.customer_id ?? "guest";
    const existing = customers.get(key) ?? {
      customerId: order.customer_id ?? null,
      name: customerDisplayName(order),
      orders: 0,
      sales: 0,
    };
    existing.orders += 1;
    existing.sales += orderTotal(order) - orderRefundedTotal(order);
    customers.set(key, existing);
  }

  return [...customers.values()]
    .map((customer) => ({ ...customer, sales: roundMoney(customer.sales) }))
    .sort((a, b) => b.sales - a.sales || b.orders - a.orders)
    .slice(0, limit);
}

/**
 * Customer-level aggregates for the window.
 *
 * `newCustomers` counts customers whose *first* order in this dataset falls in
 * the current window — which requires the caller to pass the previous window's
 * orders too, otherwise every customer looks new. `repurchaseRate` is the share
 * of identified customers with more than one order in the window; guests are
 * excluded from both, because two guest orders cannot be shown to be one person.
 */
export function customerMetrics(
  currentOrders: readonly OrderRow[],
  previousOrders: readonly OrderRow[],
): CustomerMetrics {
  const current = billableOrders(currentOrders);
  const seenBefore = new Set(
    billableOrders(previousOrders)
      .map((order) => order.customer_id)
      .filter((id): id is string => Boolean(id)),
  );

  const ordersPerCustomer = new Map<string, number>();
  for (const order of current) {
    if (!order.customer_id) continue;
    ordersPerCustomer.set(
      order.customer_id,
      (ordersPerCustomer.get(order.customer_id) ?? 0) + 1,
    );
  }

  const identified = [...ordersPerCustomer.keys()];
  const repurchasing = identified.filter(
    (id) => (ordersPerCustomer.get(id) ?? 0) > 1,
  ).length;
  const newCustomers = identified.filter((id) => !seenBefore.has(id)).length;

  const sales = salesVolume(current);

  return {
    averageOrderValue: averageOrderValue(current),
    revenuePerCustomer: identified.length
      ? roundMoney(sales / identified.length)
      : 0,
    repurchaseRate: ratio(repurchasing, identified.length),
    newCustomers,
    returningCustomers: identified.length - newCustomers,
    totalCustomers: identified.length,
  };
}

function countByStatus(
  orders: readonly OrderRow[],
  pick: (order: OrderRow) => string,
): FulfillmentBreakdown[] {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const status = pick(order);
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, orders: count }))
    .sort((a, b) => b.orders - a.orders || a.status.localeCompare(b.status));
}

export function fulfillmentBreakdown(
  orders: readonly OrderRow[],
): FulfillmentBreakdown[] {
  return countByStatus(
    billableOrders(orders),
    (order) => order.fulfillment_status ?? "not_fulfilled",
  );
}

export function paymentStatusBreakdown(
  orders: readonly OrderRow[],
): FulfillmentBreakdown[] {
  return countByStatus(
    billableOrders(orders),
    (order) => order.payment_status ?? "not_paid",
  );
}

export function recentOrders(
  orders: readonly OrderRow[],
  limit = 8,
): RecentOrder[] {
  return [...orders]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, limit)
    .map((order) => ({
      id: order.id,
      displayId: typeof order.display_id === "number" ? order.display_id : null,
      createdAt: new Date(order.created_at).toISOString(),
      customer: customerDisplayName(order),
      paymentStatus: order.payment_status ?? "not_paid",
      fulfillmentStatus: order.fulfillment_status ?? "not_fulfilled",
      total: roundMoney(orderTotal(order)),
    }));
}

/**
 * Median seconds between an order being created and its first capture.
 *
 * Median rather than mean: this shop is paid by bank transfer, so the
 * distribution has a long tail — one customer who paid three weeks late would
 * drag a mean into uselessness. `null` when nothing in the window has been
 * captured, which the UI shows as unavailable rather than as zero.
 */
export function medianSecondsToPayment(
  orders: readonly OrderRow[],
): number | null {
  const durations: number[] = [];

  for (const order of billableOrders(orders)) {
    const created = new Date(order.created_at).getTime();
    if (!Number.isFinite(created)) continue;

    let earliest: number | null = null;
    for (const collection of order.payment_collections ?? []) {
      for (const payment of collection.payments ?? []) {
        if (!payment.captured_at) continue;
        const captured = new Date(payment.captured_at).getTime();
        if (!Number.isFinite(captured)) continue;
        if (earliest === null || captured < earliest) earliest = captured;
      }
    }

    if (earliest === null || earliest < created) continue;
    durations.push(Math.round((earliest - created) / 1000));
  }

  if (durations.length === 0) return null;

  durations.sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2
    ? durations[middle]
    : Math.round((durations[middle - 1] + durations[middle]) / 2);
}

/**
 * The currency to format the dashboard in.
 *
 * Taken from the orders themselves when there are any, so the figures are
 * labelled with the currency they were actually summed in. A window with orders
 * in more than one currency has no single correct answer — the most common one
 * is used and the caller is expected to be a single-region shop, which this is
 * (one region, EUR). Falls back to the store default when there are no orders
 * at all, which is the normal case on a quiet day.
 */
export function dominantCurrency(
  orders: readonly OrderRow[],
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const code = order.currency_code?.toLowerCase();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  let best = fallback;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Average order value per day.
 *
 * Derived from the trend rather than recomputed so the two panels cannot
 * disagree about a day.
 */
export function averageOrderValueTrend(
  trend: readonly SalesTrendPoint[],
): Array<{ day: string; averageOrderValue: number }> {
  return trend.map(({ day, averageOrderValue: aov }) => ({
    day,
    averageOrderValue: aov,
  }));
}

/**
 * Whether any order in the window carries an acquisition source.
 *
 * The storefront does not currently persist one — there is no UTM capture, no
 * landing-page field and no referrer on the cart or the order (verified against
 * `storefront/src/lib/cart.ts`, which writes only `vat_id`, and the
 * `order.placed` subscriber, which writes only `bank_reference`). This function
 * still *looks*, on the well-known metadata keys, so that the day attribution
 * is added the dashboard starts reporting it without another change here.
 */
const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_page",
  "referrer",
  "attribution_source",
] as const;

export function orderAttributionSource(order: OrderRow): string | null {
  const metadata = order.metadata ?? {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function ordersWithAttribution(orders: readonly OrderRow[]): number {
  return orders.filter((order) => orderAttributionSource(order) !== null).length;
}

/** Day-over-day helper used by the KPI cards' supporting labels. */
export function previousDayKey(day: string): string {
  return addDays(day, -1);
}
