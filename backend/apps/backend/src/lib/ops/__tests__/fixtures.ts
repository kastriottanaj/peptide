/**
 * Fabricated orders for the aggregation tests.
 *
 * Everything here is invented. No real order, customer, email, address, amount
 * or identifier from this shop or any other appears in this directory — the
 * local database has no orders at all, and if it had, tests reading it would be
 * both non-deterministic and a place for customer data to leak into a repo.
 *
 * Ids follow Medusa's prefix convention (`order_…`, `cus_…`) so the shapes are
 * realistic, but the suffixes are sequential test values.
 */

import type { OrderRow } from "../types";

let counter = 0;

export function resetFixtureCounter(): void {
  counter = 0;
}

export type OrderOverrides = Partial<OrderRow> & {
  /** Convenience: `createdAt` as an ISO string or a `Date`. */
  createdAt?: string | Date;
};

/**
 * One order, with sane totals unless overridden.
 *
 * Defaults describe the common case in this shop: a single paid line, no
 * discount, shipping included in the total, nothing refunded.
 */
export function makeOrder(overrides: OrderOverrides = {}): OrderRow {
  counter += 1;
  const { createdAt, ...rest } = overrides;

  const total = rest.total ?? 100;
  const id = rest.id ?? `order_test_${String(counter).padStart(3, "0")}`;

  return {
    id,
    display_id: counter,
    status: "pending",
    currency_code: "eur",
    created_at: (createdAt ?? "2026-07-30T10:00:00.000Z").toString(),
    customer_id: null,
    sales_channel_id: null,
    metadata: null,
    total,
    subtotal: 90,
    discount_total: 0,
    shipping_total: 10,
    tax_total: 0,
    summary: { paid_total: 0, refunded_total: 0 },
    payment_status: "not_paid",
    fulfillment_status: "not_fulfilled",
    items: [],
    shipping_methods: [],
    payment_collections: [],
    fulfillments: [],
    customer: null,
    ...rest,
  };
}

export function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: `item_test_${counter}`,
    title: "Test peptide 10 mg",
    product_id: "prod_test_001",
    product_title: "Test peptide",
    variant_id: "variant_test_001",
    variant_title: "10 mg",
    quantity: 1,
    unit_price: 90,
    subtotal: 90,
    total: 90,
    adjustments: [],
    ...overrides,
  };
}

/** A payment collection that has been captured in full. */
export function makeCapturedPayment(
  amount: number,
  options: { providerId?: string; capturedAt?: string } = {},
) {
  return {
    id: `pay_col_test_${counter}`,
    status: "completed",
    amount,
    captured_amount: amount,
    refunded_amount: 0,
    payments: [
      {
        id: `pay_test_${counter}`,
        provider_id: options.providerId ?? "pp_system_default",
        amount,
        captured_at: options.capturedAt ?? "2026-07-30T12:00:00.000Z",
        canceled_at: null,
      },
    ],
  };
}

export function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: `cus_test_${counter}`,
    first_name: "Test",
    last_name: "Person",
    company_name: null,
    ...overrides,
  };
}
