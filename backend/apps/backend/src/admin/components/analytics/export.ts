/**
 * Turning what is on screen into CSV sections.
 *
 * One builder per tab, each taking exactly the data that tab renders. Nothing
 * is fetched for an export: if a panel failed to load, its section is simply
 * absent from the file, which is the truthful thing for a file that claims to
 * be "the visible summary".
 *
 * **No personal data leaves through here.** The recent-orders and top-customer
 * tables are not exported — not the names, not the order ids. What goes out is
 * counts and sums, which is what a period report is for. See `lib/csv.ts`.
 */

import type { CsvSection } from "../../lib/csv";
import {
  formatCurrency,
  formatDayLong,
  formatDuration,
  formatPercent,
  humanizeStatus,
} from "../../lib/format";
import {
  GA4_TRANSACTION_RATE_NOTE,
  ORDERS_PER_SESSION_KEY,
  ORDERS_PER_SESSION_WARNING,
  SHOP_CONVERSION_UNAVAILABLE,
  ga4TransactionRate,
  ordersPerTrackedSession,
} from "../../lib/metrics";
import { PERIOD_DESCRIPTIONS, type OpsPeriod } from "../../lib/periods";
import type { Ga4Summary, OpsConversion, OpsOverview } from "../../lib/types";

function header(period: OpsPeriod, generatedAt: string, timeZone: string): CsvSection {
  return {
    title: "Report",
    headers: ["field", "value"],
    rows: [
      ["period", PERIOD_DESCRIPTIONS[period]],
      ["period_key", period],
      ["timezone", timeZone],
      ["generated_at", generatedAt],
    ],
  };
}

export function buildOverviewCsv(
  period: OpsPeriod,
  ops: OpsOverview | undefined,
  ga4: Ga4Summary | undefined,
): CsvSection[] {
  const sections: CsvSection[] = [];
  const timeZone = ops?.timeZone ?? "Europe/Berlin";
  const currency = ops?.currencyCode ?? "eur";
  const money = (value: number) => formatCurrency(value, currency);

  sections.push(
    header(period, ops?.generatedAt ?? new Date().toISOString(), timeZone),
  );

  if (ops) {
    sections.push({
      title: "Commerce KPIs (Medusa)",
      headers: ["metric", "value", "previous_period", "change"],
      rows: [
        [
          "sales_volume",
          money(ops.kpis.salesVolume.value),
          money(ops.kpis.salesVolume.previous),
          ops.kpis.salesVolume.change === null
            ? ""
            : formatPercent(ops.kpis.salesVolume.change),
        ],
        [
          "orders",
          ops.kpis.orders.value,
          ops.kpis.orders.previous,
          ops.kpis.orders.change === null
            ? ""
            : formatPercent(ops.kpis.orders.change),
        ],
        [
          "average_order_value",
          money(ops.kpis.averageOrderValue.value),
          money(ops.kpis.averageOrderValue.previous),
          ops.kpis.averageOrderValue.change === null
            ? ""
            : formatPercent(ops.kpis.averageOrderValue.change),
        ],
        [
          "open_shipments",
          ops.kpis.openShipments.value,
          ops.kpis.openShipments.previous,
          "",
        ],
      ],
    });

    sections.push({
      title: "Daily sales (Medusa)",
      headers: ["date", "sales", "orders", "average_order_value"],
      rows: ops.salesTrend.map((point) => [
        formatDayLong(point.day, timeZone),
        money(point.sales),
        point.orders,
        money(point.averageOrderValue),
      ]),
    });

    sections.push({
      title: "Sales breakdown (Medusa)",
      headers: ["component", "amount"],
      rows: [
        ["subtotal", money(ops.breakdown.subtotal)],
        ["shipping", money(ops.breakdown.shipping)],
        ["discounts", money(ops.breakdown.discounts)],
        ["tax", money(ops.breakdown.tax)],
        ["refunds", money(ops.breakdown.refunds)],
        ["total", money(ops.breakdown.total)],
      ],
    });

    sections.push({
      title: "Sales by product (Medusa)",
      headers: ["product", "units", "sales_volume"],
      rows: ops.byProduct.map((product) => [
        product.title,
        product.units,
        money(product.sales),
      ]),
    });

    sections.push({
      title: "Sales by payment method (Medusa)",
      headers: ["payment_method", "orders", "sales_volume"],
      rows: ops.byPaymentMethod.map((row) => [
        row.label,
        row.orders,
        money(row.sales),
      ]),
    });

    sections.push({
      title: "Fulfillment status (Medusa)",
      headers: ["status", "orders"],
      rows: ops.fulfillmentBreakdown.map((row) => [
        humanizeStatus(row.status),
        row.orders,
      ]),
    });

    sections.push({
      title: "Customer metrics (Medusa)",
      headers: ["metric", "value"],
      rows: [
        ["average_order_value", money(ops.customerMetrics.averageOrderValue)],
        [
          "revenue_per_customer",
          money(ops.customerMetrics.revenuePerCustomer),
        ],
        [
          "repurchase_rate",
          formatPercent(ops.customerMetrics.repurchaseRate),
        ],
        ["new_customers", ops.customerMetrics.newCustomers],
        ["returning_customers", ops.customerMetrics.returningCustomers],
      ],
    });
  }

  if (ga4) {
    sections.push({
      title: "Google Analytics totals (processed, consent-dependent)",
      headers: ["metric", "value"],
      rows: [
        ["users", ga4.totals.totalUsers],
        ["new_users", ga4.totals.newUsers],
        ["sessions", ga4.totals.sessions],
        ["page_views", ga4.totals.screenPageViews],
        ["key_events", ga4.totals.keyEvents],
        ["ga4_transactions", ga4.totals.transactions],
      ],
    });

    sections.push({
      title: "Traffic by channel (Google Analytics)",
      headers: ["channel", "users", "new_users", "sessions"],
      rows: ga4.byChannelGroup.map((row) => [
        String(row.channelGroup),
        Number(row.totalUsers) || 0,
        Number(row.newUsers) || 0,
        Number(row.sessions) || 0,
      ]),
    });

    sections.push({
      title: "Most visited pages (Google Analytics)",
      headers: ["page_path", "page_views", "users"],
      rows: ga4.topPages
        .slice(0, 10)
        .map((row) => [
          String(row.pagePath),
          Number(row.screenPageViews) || 0,
          Number(row.activeUsers) || 0,
        ]),
    });
  }

  return sections;
}

export function buildConversionCsv(
  period: OpsPeriod,
  ops: OpsConversion | undefined,
  ga4: Ga4Summary | undefined,
): CsvSection[] {
  const sections: CsvSection[] = [];
  const timeZone = ops?.timeZone ?? "Europe/Berlin";
  const currency = ops?.currencyCode ?? "eur";
  const money = (value: number) => formatCurrency(value, currency);

  sections.push(
    header(period, ops?.generatedAt ?? new Date().toISOString(), timeZone),
  );

  if (ops) {
    const ordersPerSession = ordersPerTrackedSession(
      ops.orders,
      ga4?.totals.sessions,
    );
    const transactionRate = ga4TransactionRate(
      ga4?.totals.transactions,
      ga4?.totals.sessions,
    );

    sections.push({
      title: "Payments and orders (Medusa)",
      headers: ["metric", "value"],
      rows: [
        ["orders", ops.orders],
        ["paid_orders", ops.paidOrders],
        ["sales_volume", money(ops.sales)],
        ["received", money(ops.paidSales)],
        ["average_order_value", money(ops.averageOrderValue)],
        [
          "payment_completion_rate",
          formatPercent(ops.paymentCompletionRate),
        ],
        [
          "median_time_to_payment",
          formatDuration(ops.medianSecondsToPayment),
        ],
        // Named, not computed: a blank cell in a column called
        // "shop_conversion_rate" would be read as zero by the next person to
        // open this file in a spreadsheet.
        ["shop_conversion_rate", "not available"],
        ["shop_conversion_rate_reason", SHOP_CONVERSION_UNAVAILABLE],
      ],
    });

    /**
     * The two ratios, in their own section so neither can be mistaken for a
     * Medusa figure, and each carrying its own caveat as a row. A CSV outlives
     * the screen it was exported from — whatever is not written down here is
     * lost the moment the file is mailed on.
     */
    sections.push({
      title: "Ratios (read the notes)",
      headers: ["metric", "value", "note"],
      rows: [
        [
          "ga4_transaction_rate",
          transactionRate === null ? "not available" : formatPercent(transactionRate, 2),
          GA4_TRANSACTION_RATE_NOTE,
        ],
        [
          ORDERS_PER_SESSION_KEY,
          ordersPerSession === null
            ? "not available"
            : formatPercent(ordersPerSession, 2),
          ORDERS_PER_SESSION_WARNING,
        ],
      ],
    });

    sections.push({
      title: "Funnel",
      headers: ["step", "count", "source"],
      rows: ops.funnel.map((step) => [
        step.label,
        step.key === "visitors"
          ? (ga4?.totals.sessions ?? "")
          : (step.count ?? "not available"),
        step.source,
      ]),
    });

    sections.push({
      title: "Tracking quality (Medusa)",
      headers: ["metric", "value"],
      rows: [
        ["orders_total", ops.tracking.ordersTotal],
        ["orders_with_source", ops.tracking.ordersWithSource],
        ["orders_untracked", ops.tracking.ordersWithoutSource],
        ["payment_open", ops.tracking.paymentPending],
        ["payment_confirmed", ops.tracking.paymentCaptured],
        ["payment_refunded", ops.tracking.paymentRefunded],
        ["checkout_abandoned", "not available"],
      ],
    });

    sections.push({
      title: "Orders by payment status (Medusa)",
      headers: ["status", "orders"],
      rows: ops.byPaymentStatus.map((row) => [
        humanizeStatus(row.status),
        row.orders,
      ]),
    });
  }

  if (ga4) {
    sections.push({
      title: "Source / medium (Google Analytics)",
      headers: ["source_medium", "sessions", "users"],
      rows: ga4.bySourceMedium
        .slice(0, 25)
        .map((row) => [
          String(row.sourceMedium),
          Number(row.sessions) || 0,
          Number(row.totalUsers) || 0,
        ]),
    });
  }

  return sections;
}
