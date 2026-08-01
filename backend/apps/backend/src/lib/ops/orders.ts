/**
 * Fetching the orders an analytics window needs.
 *
 * Reads through `getOrdersListWorkflow`, the same workflow the built-in
 * `GET /admin/orders` route uses. That is deliberate and worth defending: the
 * workflow is where `payment_status` and `fulfillment_status` are *derived* —
 * they are not columns, they are aggregated from payment collections and
 * fulfillments by `getLastPaymentStatus` / `getLastFulfillmentStatus`. Querying
 * the order module directly would return orders without them, and the obvious
 * repair is to reimplement that aggregation here, at which point the dashboard
 * and the orders list start disagreeing about what "fulfilled" means.
 *
 * No raw SQL. The project has no ad-hoc SQL pattern to follow, and none of this
 * needs it.
 */

import { getOrdersListWorkflow } from "@medusajs/core-flows";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { MedusaContainer } from "@medusajs/framework/types";
import type { DateWindow } from "./period";
import type { OrderRow, OrdersInWindow } from "./types";

/**
 * Fields requested per order.
 *
 * Kept to what the dashboard actually renders. Notably absent: addresses,
 * `items.metadata`, transactions and anything on the customer beyond a name —
 * an aggregation endpoint that pulls a customer's postal address to compute a
 * sum is a data-protection problem waiting for its incident report.
 *
 * `payment_collections` and `fulfillments` must stay in this list even though
 * the response never forwards them: the workflow only computes the two status
 * fields when it sees them requested, and drops the raw relations afterwards.
 */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "currency_code",
  "created_at",
  "canceled_at",
  "customer_id",
  "sales_channel_id",
  "metadata",
  "total",
  "subtotal",
  "discount_total",
  "shipping_total",
  "tax_total",
  "summary",
  "items.id",
  "items.title",
  "items.product_id",
  "items.product_title",
  "items.variant_id",
  "items.variant_title",
  "items.quantity",
  "items.unit_price",
  "items.subtotal",
  "items.total",
  "items.adjustments.code",
  "items.adjustments.amount",
  "items.adjustments.promotion_id",
  "shipping_methods.id",
  "shipping_methods.amount",
  "shipping_methods.total",
  "shipping_methods.adjustments.code",
  "shipping_methods.adjustments.amount",
  "payment_collections.id",
  "payment_collections.status",
  "payment_collections.amount",
  "payment_collections.captured_amount",
  "payment_collections.refunded_amount",
  "payment_collections.payments.id",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.amount",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.canceled_at",
  "fulfillments.id",
  "fulfillments.packed_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.canceled_at",
  "customer.id",
  "customer.first_name",
  "customer.last_name",
  "customer.company_name",
] as const;

/** Rows per workflow call. */
const PAGE_SIZE = 200;

/**
 * Hard ceiling on orders pulled into memory for one report.
 *
 * The aggregations run in this process, so an unbounded window on a busy shop
 * would be an out-of-memory bug that only appears once the shop succeeds. 5000
 * covers ninety days of a shop taking fifty orders a day; past that the report
 * is marked `truncated` and the UI says so, which is the honest failure. If this
 * ever trips in production, the fix is a database-side aggregation, not a bigger
 * number here.
 */
export const MAX_ORDERS = 5000;

export type FetchOrdersOptions = {
  /** Newest first. Only matters when the cap truncates. */
  container: MedusaContainer;
  window: DateWindow;
};

export async function fetchOrdersInWindow({
  container,
  window,
}: FetchOrdersOptions): Promise<OrdersInWindow> {
  const rows: OrderRow[] = [];
  let skip = 0;
  let truncated = false;

  for (;;) {
    const take = Math.min(PAGE_SIZE, MAX_ORDERS - rows.length);
    if (take <= 0) {
      truncated = true;
      break;
    }

    const { result } = await getOrdersListWorkflow(container).run({
      input: {
        fields: [...ORDER_FIELDS],
        variables: {
          filters: {
            created_at: {
              $gte: window.start.toISOString(),
              $lt: window.end.toISOString(),
            },
            is_draft_order: false,
          },
          skip,
          take,
          order: { created_at: "DESC" },
        },
      },
    });

    const page = normalizePage(result);
    rows.push(...page);

    if (page.length < take) break;
    skip += page.length;
  }

  return { rows, window, truncated };
}

/**
 * The workflow returns either a bare array or `{ rows, metadata }`, depending
 * on whether the remote query was asked to paginate. Both are accepted rather
 * than asserted, because which one comes back is not something this module
 * controls.
 */
function normalizePage(result: unknown): OrderRow[] {
  if (Array.isArray(result)) return result as OrderRow[];

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as OrderRow[];
  }

  return [];
}

/**
 * Sales-channel names, so the revenue-by-channel table reads as names rather
 * than as `sc_01J…`. Failure is not fatal: an empty map makes the table fall
 * back to ids, which is worse-looking but still correct.
 */
export async function fetchSalesChannelNames(
  container: MedusaContainer,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "name"],
    });

    for (const channel of data ?? []) {
      if (channel?.id) names.set(channel.id, channel.name ?? channel.id);
    }
  } catch {
    // Left empty on purpose; see the doc comment.
  }

  return names;
}

/**
 * The store's default currency, for windows that contain no orders.
 *
 * Read from the store module rather than hardcoded: `AGENTS.md` requires the
 * storefront to format prices from the API, and an admin dashboard that assumes
 * EUR would be the one place the rule is broken. Falls back to the store's
 * single configured region currency, and to `eur` only if neither answers.
 */
export async function fetchStoreCurrency(
  container: MedusaContainer,
): Promise<string> {
  try {
    const storeModule = container.resolve(Modules.STORE);
    const [store] = await storeModule.listStores(
      {},
      { select: ["id"], relations: ["supported_currencies"], take: 1 },
    );

    const currencies = store?.supported_currencies ?? [];
    const preferred =
      currencies.find((currency) => currency.is_default) ?? currencies[0];

    if (preferred?.currency_code) return preferred.currency_code.toLowerCase();
  } catch {
    // Fall through to the region lookup.
  }

  try {
    const regionModule = container.resolve(Modules.REGION);
    const [region] = await regionModule.listRegions(
      {},
      { select: ["id", "currency_code"], take: 1 },
    );
    if (region?.currency_code) return region.currency_code.toLowerCase();
  } catch {
    // Fall through to the default.
  }

  return "eur";
}
