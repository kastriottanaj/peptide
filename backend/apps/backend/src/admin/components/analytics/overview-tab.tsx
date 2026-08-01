/**
 * Overview: the shop's own numbers first, Google's second.
 *
 * The reading order is the argument. Sales, orders, average order value and
 * open shipments come from Medusa and sit at the top, because they are the
 * figures a merchant makes decisions on and the only ones that are exact. GA4's
 * traffic panels follow, labelled as GA4's, and the two are never added together
 * — see the channels panel, which refuses to divide one by the other.
 */

import { Link } from "react-router-dom";
import {
  formatCurrency,
  formatDay,
  formatDayLong,
  formatNumber,
  formatPercent,
  formatRelative,
  humanizeStatus,
} from "../../lib/format";
import { PERIOD_DESCRIPTIONS, type OpsPeriod } from "../../lib/periods";
import type {
  Bestseller,
  Ga4Summary,
  NamedTotal,
  OpsOverview,
} from "../../lib/types";
import { SalesTrendChart, Sparkline } from "./charts";
import {
  BarList,
  BarRow,
  Card,
  Col,
  EmptyState,
  Ga4RevenueNotice,
  Grid,
  KpiCard,
  Notice,
  Pill,
  Section,
  SkeletonChart,
  SkeletonRows,
  Stat,
  statusTone,
  type SectionState,
} from "./primitives";

type Props = {
  period: OpsPeriod;
  ops: SectionState<OpsOverview>;
  ga4: SectionState<Ga4Summary>;
};

/** Largest value in a list, for sizing relative bars. */
function peak(values: readonly number[]): number {
  return Math.max(0, ...values);
}

export function OverviewTab({ period, ops, ga4 }: Props) {
  const currency = ops.data?.currencyCode ?? "eur";
  const timeZone = ops.data?.timeZone ?? "Europe/Berlin";

  const money = (value: number) => formatCurrency(value, currency);

  return (
    <>
      {/* ------------------------------------------------ commerce KPIs -- */}
      <Grid>
        {ops.data === undefined && ops.error === undefined ? (
          <>
            <Col span={3}>
              <KpiCard label="Sales volume" value="" loading />
            </Col>
            <Col span={3}>
              <KpiCard label="Orders" value="" loading />
            </Col>
            <Col span={3}>
              <KpiCard label="Average order value" value="" loading />
            </Col>
            <Col span={3}>
              <KpiCard label="Open shipments" value="" loading />
            </Col>
          </>
        ) : ops.data ? (
          <>
            <Col span={3}>
              <KpiCard
                label="Sales volume"
                value={money(ops.data.kpis.salesVolume.value)}
                kpi={ops.data.kpis.salesVolume}
                previousLabel={`vs ${money(ops.data.kpis.salesVolume.previous)} previous`}
              />
            </Col>
            <Col span={3}>
              <KpiCard
                label="Orders"
                value={formatNumber(ops.data.kpis.orders.value)}
                kpi={ops.data.kpis.orders}
                previousLabel={`vs ${formatNumber(ops.data.kpis.orders.previous)} previous`}
              />
            </Col>
            <Col span={3}>
              <KpiCard
                label="Average order value"
                value={money(ops.data.kpis.averageOrderValue.value)}
                kpi={ops.data.kpis.averageOrderValue}
                previousLabel={`vs ${money(ops.data.kpis.averageOrderValue.previous)} previous`}
              />
            </Col>
            <Col span={3}>
              <KpiCard
                label="Open shipments"
                value={formatNumber(ops.data.kpis.openShipments.value)}
                kpi={ops.data.kpis.openShipments}
                previousLabel="Unfulfilled or partly shipped"
              />
            </Col>
          </>
        ) : (
          <Col span={12}>
            <Card title="Commerce KPIs">
              <Section state={ops} skeleton={<SkeletonRows rows={3} />}>
                {() => null}
              </Section>
            </Card>
          </Col>
        )}
      </Grid>

      {ops.data?.coverage.truncated && (
        <Notice tone="warning">
          This period contains more orders than one report can aggregate, so the
          figures below cover only the most recent {formatNumber(ops.data.coverage.orders)}{" "}
          orders. Narrow the period for an exact total.
        </Notice>
      )}

      {/* --------------------------------------- A. sales trend + B. GA4 -- */}
      <Grid>
        <Col span={8}>
          <Card
            title="Sales trend"
            hint={`${PERIOD_DESCRIPTIONS[period]} · Medusa orders · ${timeZone}`}
            actions={
              ops.data && (
                <span className="pa-kpi__value" style={{ fontSize: 17 }}>
                  {money(ops.data.kpis.salesVolume.value)}
                </span>
              )
            }
          >
            <Section
              state={ops}
              skeleton={<SkeletonChart />}
              isEmpty={(data) => data.salesTrend.every((p) => p.orders === 0)}
              empty={
                <EmptyState
                  title="No orders in this period"
                  description="Ordering is currently closed on the storefront, so no orders can be placed."
                />
              }
            >
              {(data) => (
                <SalesTrendChart
                  points={data.salesTrend}
                  previous={data.previousSalesTrend}
                  emptyLabel="No orders in this period"
                  formatters={{
                    currency: money,
                    number: (value) => formatNumber(value),
                    day: (day) => formatDay(day, timeZone),
                    dayLong: (day) => formatDayLong(day, timeZone),
                  }}
                />
              )}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          <Card
            title="Google Analytics"
            hint={
              ga4.data
                ? `GA4 · synced ${formatRelative(ga4.data.generatedAt)}`
                : "GA4"
            }
          >
            <Section state={ga4} skeleton={<SkeletonRows rows={4} />}>
              {(data) => (
                <>
                  <div className="pa-statlist">
                    <Stat
                      label="Users"
                      value={formatNumber(data.totals.totalUsers)}
                    />
                    <Stat
                      label="Sessions"
                      value={formatNumber(data.totals.sessions)}
                    />
                    <Stat
                      label="Page views"
                      value={formatNumber(data.totals.screenPageViews)}
                    />
                    <Stat
                      label="Key events"
                      value={formatNumber(data.totals.keyEvents)}
                    />
                    <Stat
                      label="New users"
                      value={formatNumber(data.totals.newUsers)}
                    />
                    <Stat
                      label="GA4 transactions"
                      value={formatNumber(data.totals.transactions)}
                    />
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Ga4RevenueNotice />
                  </div>
                </>
              )}
            </Section>
          </Card>
        </Col>
      </Grid>

      {/* ------------------------------ C. most visited pages + channels -- */}
      <Grid>
        <Col span={5}>
          <Card title="Most visited pages" hint="GA4 · page views">
            <Section
              state={ga4}
              skeleton={<SkeletonRows rows={8} />}
              isEmpty={(data) => data.topPages.length === 0}
              empty={
                <EmptyState
                  title="No page views recorded"
                  description="Nobody with statistics consent has visited in this period."
                />
              }
            >
              {(data) => {
                const rows = data.topPages.slice(0, 10);
                const max = peak(
                  rows.map((row) => Number(row.screenPageViews) || 0),
                );

                return (
                  <BarList>
                    {rows.map((row) => {
                      const views = Number(row.screenPageViews) || 0;
                      return (
                        <BarRow
                          key={String(row.pagePath)}
                          label={String(row.pagePath) || "(not set)"}
                          value={formatNumber(views)}
                          fraction={max ? views / max : 0}
                        />
                      );
                    })}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>

        <Col span={7}>
          <ChannelsPanel ga4={ga4} ops={ops} currency={currency} />
        </Col>
      </Grid>

      {/* ------------------------------ E. recent orders + F. bestsellers -- */}
      <Grid>
        <Col span={7}>
          <Card title="Recent orders" hint="Medusa" flush>
            <Section
              state={ops}
              skeleton={
                <div style={{ padding: "0 18px 18px" }}>
                  <SkeletonRows rows={6} />
                </div>
              }
              isEmpty={(data) => data.recentOrders.length === 0}
              empty={<EmptyState title="No orders yet in this period" />}
            >
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table pa-table--wide">
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Shipment</th>
                        <th scope="col" className="pa-num">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOrders.map((order) => (
                        <tr key={order.id}>
                          <td>
                            {/*
                              Links into the admin's own order detail route
                              rather than reproducing it. Relative to /app,
                              which is where this page is mounted.
                            */}
                            <Link to={`/orders/${order.id}`}>
                              #{order.displayId ?? "—"}
                            </Link>
                          </td>
                          <td>
                            <span className="pa-truncate">{order.customer}</span>
                          </td>
                          <td>
                            <Pill tone={statusTone(order.paymentStatus)}>
                              {humanizeStatus(order.paymentStatus)}
                            </Pill>
                          </td>
                          <td>
                            <Pill tone={statusTone(order.fulfillmentStatus)}>
                              {humanizeStatus(order.fulfillmentStatus)}
                            </Pill>
                          </td>
                          <td className="pa-num">
                            {formatCurrency(order.total, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Card>
        </Col>

        <Col span={5}>
          <Card title="Bestsellers" hint="Medusa · units sold">
            <Section
              state={ops}
              skeleton={<SkeletonRows rows={6} />}
              isEmpty={(data) => data.bestsellers.length === 0}
              empty={<EmptyState title="No products sold in this period" />}
            >
              {(data) => (
                <BestsellerBars
                  rows={data.bestsellers}
                  currency={currency}
                  by="units"
                />
              )}
            </Section>
          </Card>
        </Col>
      </Grid>

      {/* ------------------------- G. top customers + H. customer metrics -- */}
      <Grid>
        <Col span={7}>
          <Card title="Top customers" hint="Medusa · selected period">
            <Section
              state={ops}
              skeleton={<SkeletonRows rows={6} />}
              isEmpty={(data) => data.topCustomers.length === 0}
              empty={<EmptyState title="No customers with orders yet" />}
            >
              {(data) => {
                const max = peak(data.topCustomers.map((row) => row.sales));
                return (
                  <BarList>
                    {data.topCustomers.map((customer) => (
                      <BarRow
                        key={customer.customerId ?? customer.name}
                        label={
                          customer.customerId ? (
                            <Link to={`/customers/${customer.customerId}`}>
                              {customer.name}
                            </Link>
                          ) : (
                            customer.name
                          )
                        }
                        value={`${formatNumber(customer.orders)} · ${formatCurrency(customer.sales, currency)}`}
                        fraction={max ? customer.sales / max : 0}
                      />
                    ))}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>

        <Col span={5}>
          <Card title="Customer metrics" hint="Medusa · selected period">
            <Section state={ops} skeleton={<SkeletonRows rows={4} />}>
              {(data) => (
                <div className="pa-statlist">
                  <Stat
                    label="Average order value"
                    value={money(data.customerMetrics.averageOrderValue)}
                  />
                  <Stat
                    label="Revenue per customer"
                    value={money(data.customerMetrics.revenuePerCustomer)}
                  />
                  <Stat
                    label="Repurchase rate"
                    value={formatPercent(data.customerMetrics.repurchaseRate)}
                  />
                  <Stat
                    label="New customers"
                    value={formatNumber(data.customerMetrics.newCustomers)}
                  />
                </div>
              )}
            </Section>
          </Card>
        </Col>
      </Grid>

      {/* ------------------------------------------ I. further evaluations -- */}
      <Grid>
        <Col span={4}>
          <Card title="Breakdown of total sales" hint="Medusa">
            <Section state={ops} skeleton={<SkeletonRows rows={5} />}>
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table" style={{ margin: "-7px -18px" }}>
                    <tbody>
                      {(
                        [
                          ["Subtotal", data.breakdown.subtotal],
                          ["Shipping", data.breakdown.shipping],
                          ["Discounts", -data.breakdown.discounts],
                          ["Tax", data.breakdown.tax],
                          ["Refunds", -data.breakdown.refunds],
                          ["Total", data.breakdown.total],
                        ] as const
                      ).map(([label, value]) => (
                        <tr key={label}>
                          <td
                            style={
                              label === "Total" ? { fontWeight: 600 } : undefined
                            }
                          >
                            {label}
                          </td>
                          <td
                            className="pa-num"
                            style={
                              label === "Total" ? { fontWeight: 600 } : undefined
                            }
                          >
                            {money(value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          <Card title="Average order value over time" hint="Medusa">
            <Section
              state={ops}
              skeleton={<SkeletonRows rows={4} />}
              isEmpty={(data) =>
                data.averageOrderValueTrend.every(
                  (point) => point.averageOrderValue === 0,
                )
              }
              empty={<EmptyState title="No orders to average" />}
            >
              {(data) => (
                <Sparkline
                  values={data.averageOrderValueTrend.map(
                    (point) => point.averageOrderValue,
                  )}
                  label="Average order value per day"
                  formatValue={money}
                />
              )}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          <Card title="Fulfillment status" hint="Medusa">
            <Section
              state={ops}
              skeleton={<SkeletonRows rows={4} />}
              isEmpty={(data) => data.fulfillmentBreakdown.length === 0}
              empty={<EmptyState title="Nothing to fulfil" />}
            >
              {(data) => {
                const max = peak(
                  data.fulfillmentBreakdown.map((row) => row.orders),
                );
                return (
                  <BarList>
                    {data.fulfillmentBreakdown.map((row) => (
                      <BarRow
                        key={row.status}
                        label={humanizeStatus(row.status)}
                        value={formatNumber(row.orders)}
                        fraction={max ? row.orders / max : 0}
                      />
                    ))}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>
      </Grid>

      <Grid>
        <Col span={4}>
          <NamedTotalCard
            title="Sales by payment method"
            hint="Medusa · payment provider"
            state={ops}
            pick={(data) => data.byPaymentMethod}
            currency={currency}
            emptyTitle="No payments recorded"
          />
        </Col>

        <Col span={4}>
          <NamedTotalCard
            title="Sales after discount code"
            hint="Medusa · promotion applied"
            state={ops}
            pick={(data) => data.byDiscountCode}
            currency={currency}
            emptyTitle="No promotions applied"
            emptyDescription="This shop's promotions are automatic quantity and shipping rules; a row appears here once one has been applied to an order."
          />
        </Col>

        <Col span={4}>
          <NamedTotalCard
            title="Revenue by sales channel"
            hint="Medusa · attributed sales channel"
            state={ops}
            pick={(data) => data.bySalesChannel}
            currency={currency}
            emptyTitle="No sales channel attribution"
          />
        </Col>
      </Grid>

      <Grid>
        <Col span={8}>
          <Card title="Sales by product" hint="Medusa · units and revenue" flush>
            <Section
              state={ops}
              skeleton={
                <div style={{ padding: "0 18px 18px" }}>
                  <SkeletonRows rows={6} />
                </div>
              }
              isEmpty={(data) => data.byProduct.length === 0}
              empty={<EmptyState title="No products sold in this period" />}
            >
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table">
                    <thead>
                      <tr>
                        <th scope="col">Product</th>
                        <th scope="col" className="pa-num">
                          Units
                        </th>
                        <th scope="col" className="pa-num">
                          Sales volume
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byProduct.map((product) => (
                        <tr key={product.productId ?? product.title}>
                          <td>
                            <span className="pa-truncate">{product.title}</span>
                          </td>
                          <td className="pa-num">
                            {formatNumber(product.units)}
                          </td>
                          <td className="pa-num">
                            {formatCurrency(product.sales, currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          {/*
            Sell-through is (units sold ÷ units available at the start of the
            period). Medusa's inventory levels are a *current* quantity with no
            history table, so the opening stock for any past window cannot be
            reconstructed — adding sales back to today's level assumes nothing
            was restocked, adjusted or written off, which is exactly what a
            merchant would be using the number to find out. Stated rather than
            approximated.
          */}
          <Card title="Product sell-through rate" hint="Not available">
            <EmptyState
              title="No inventory history"
              description="Sell-through needs the stock level at the start of the period. Medusa stores only the current level, so any figure here would be an assumption rather than a measurement."
            />
          </Card>
        </Col>
      </Grid>
    </>
  );
}

/* ------------------------------------------------------------- channels -- */

/**
 * Channels, with GA4 traffic and Medusa orders kept visibly apart.
 *
 * The design asks for a conversion rate per channel. That requires knowing
 * which channel an order came from, and this storefront records nothing of the
 * sort: no UTM capture, no landing page, no referrer on the cart or the order.
 * The only join available would be "GA4 says 40% of sessions were organic, so
 * 40% of orders were" — which is not a measurement, it is an assumption
 * presented in a table with a percent sign after it.
 *
 * So the table shows what GA4 actually knows, the Medusa total sits beside it
 * as its own figure, and the gap is named.
 */
function ChannelsPanel({
  ga4,
  ops,
  currency,
}: {
  ga4: SectionState<Ga4Summary>;
  ops: SectionState<OpsOverview>;
  currency: string;
}) {
  return (
    <Card
      title="Channels"
      hint="GA4 traffic · Medusa orders shown separately"
      note={
        <>
          Order attribution is not available: the storefront does not record a
          source, medium, campaign or landing page on the order, so GA4 sessions
          and Medusa orders cannot be joined. Per-channel conversion rate, cart
          rate and checkout rate are omitted rather than estimated.
          {ops.data && (
            <>
              {" "}
              Medusa recorded{" "}
              <strong>{formatNumber(ops.data.kpis.orders.value)} orders</strong>{" "}
              worth{" "}
              <strong>
                {formatCurrency(ops.data.kpis.salesVolume.value, currency)}
              </strong>{" "}
              across all channels in this period.
            </>
          )}
        </>
      }
      flush
    >
      <Section
        state={ga4}
        skeleton={
          <div style={{ padding: "0 18px 18px" }}>
            <SkeletonRows rows={6} />
          </div>
        }
        isEmpty={(data) => data.byChannelGroup.length === 0}
        empty={<EmptyState title="No traffic recorded in this period" />}
      >
        {(data) => (
          <div className="pa-tablewrap">
            <table className="pa-table pa-table--wide">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col" className="pa-num">
                    Users
                  </th>
                  <th scope="col" className="pa-num">
                    New users
                  </th>
                  <th scope="col" className="pa-num">
                    Sessions
                  </th>
                  <th scope="col" className="pa-num">
                    GA4 transactions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.byChannelGroup.map((row) => (
                  <tr key={String(row.channelGroup)}>
                    <td>
                      <span className="pa-truncate">
                        {String(row.channelGroup) || "(not set)"}
                      </span>
                    </td>
                    <td className="pa-num">
                      {formatNumber(Number(row.totalUsers) || 0)}
                    </td>
                    <td className="pa-num">
                      {formatNumber(Number(row.newUsers) || 0)}
                    </td>
                    <td className="pa-num">
                      {formatNumber(Number(row.sessions) || 0)}
                    </td>
                    <td className="pa-num">
                      {formatNumber(Number(row.transactions) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Card>
  );
}

/* ---------------------------------------------------------------- shared -- */

function BestsellerBars({
  rows,
  currency,
  by,
}: {
  rows: readonly Bestseller[];
  currency: string;
  by: "units" | "sales";
}) {
  const max = peak(rows.map((row) => row[by]));

  return (
    <BarList>
      {rows.map((row) => (
        <BarRow
          key={row.productId ?? row.title}
          label={row.title}
          value={`${formatNumber(row.units)} × · ${formatCurrency(row.sales, currency)}`}
          fraction={max ? row[by] / max : 0}
        />
      ))}
    </BarList>
  );
}

function NamedTotalCard({
  title,
  hint,
  state,
  pick,
  currency,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  hint: string;
  state: SectionState<OpsOverview>;
  pick: (data: OpsOverview) => NamedTotal[];
  currency: string;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  return (
    <Card title={title} hint={hint}>
      <Section
        state={state}
        skeleton={<SkeletonRows rows={4} />}
        isEmpty={(data) => pick(data).length === 0}
        empty={
          <EmptyState title={emptyTitle} description={emptyDescription} />
        }
      >
        {(data) => {
          const rows = pick(data);
          const max = peak(rows.map((row) => row.sales));

          return (
            <BarList>
              {rows.map((row) => (
                <BarRow
                  key={row.key}
                  label={humanizeStatus(row.label)}
                  value={`${formatNumber(row.orders)} · ${formatCurrency(row.sales, currency)}`}
                  fraction={max ? row.sales / max : 0}
                />
              ))}
            </BarList>
          );
        }}
      </Section>
    </Card>
  );
}
