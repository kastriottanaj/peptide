/**
 * Conversion & Sources.
 *
 * This is the tab where the honest answer is mostly "we do not record that",
 * and it says so rather than filling the gaps.
 *
 * What *is* measurable: how many orders were created, how many of those were
 * paid, how long payment took, and how sessions divide across channels. What is
 * not: which channel an order came from, how many visitors added to cart, and
 * how many started checkout. The storefront persists no acquisition source on
 * the cart or the order, and it deliberately excludes the entire cart–checkout–
 * confirmation funnel from analytics measurement so that order identifiers
 * never reach Google (`storefront/src/lib/analytics.ts`). Both facts are
 * reported as data gaps with the reason attached.
 */

import {
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  humanizeStatus,
} from "../../lib/format";
import { PERIOD_DESCRIPTIONS, type OpsPeriod } from "../../lib/periods";
import {
  GA4_TRANSACTION_RATE_LABEL,
  GA4_TRANSACTION_RATE_NOTE,
  ORDERS_PER_SESSION_LABEL,
  ORDERS_PER_SESSION_WARNING,
  SHOP_CONVERSION_UNAVAILABLE,
  canCompareFunnelSteps,
  ga4TransactionRate,
  ordersPerTrackedSession,
} from "../../lib/metrics";
import type { Ga4Summary, OpsConversion } from "../../lib/types";
import {
  BarList,
  BarRow,
  Card,
  Col,
  EmptyState,
  Ga4RevenueNotice,
  Grid,
  KpiCard,
  Section,
  SkeletonRows,
  Stat,
  type SectionState,
} from "./primitives";

type Props = {
  period: OpsPeriod;
  ops: SectionState<OpsConversion>;
  ga4: SectionState<Ga4Summary>;
};

export function ConversionTab({ period, ops, ga4 }: Props) {
  const currency = ops.data?.currencyCode ?? "eur";
  const money = (value: number) => formatCurrency(value, currency);

  const sessions = ga4.data?.totals.sessions;
  const orders = ops.data?.orders;

  /**
   * The two ratios this tab is allowed to compute, and the one it is not.
   *
   * `transactionRate` is GA4 ÷ GA4 — one population, so it means what it says.
   * `ordersPerSession` is Medusa ÷ GA4 and is **not a conversion rate**: the
   * numerator counts every order, the denominator only consenting sessions, so
   * it reads high by an unknown amount. It is rendered once, as a diagnostic,
   * with its warning attached — never as a KPI and never in a table. A true
   * shop-wide conversion rate is shown as unavailable, because it is.
   */
  const transactionRate = ga4TransactionRate(
    ga4.data?.totals.transactions,
    sessions,
  );
  const ordersPerSession = ordersPerTrackedSession(orders, sessions);

  return (
    <>
      {/* ------------------------------------------------ context cards -- */}
      <Grid>
        <Col span={4}>
          <Card title="Selected period" hint="Reporting window">
            <p className="pa-kpi__value">{PERIOD_DESCRIPTIONS[period]}</p>
            <div className="pa-kpi__foot">
              {ops.data
                ? `${ops.data.range.startDay} → ${ops.data.range.endDay} · ${ops.data.timeZone}`
                : "—"}
            </div>
          </Card>
        </Col>
        <Col span={4}>
          <Card title="Google Analytics" hint="Sessions and users">
            <Section state={ga4} skeleton={<SkeletonRows rows={2} />}>
              {(data) => (
                <div className="pa-statlist">
                  <Stat
                    label="Sessions"
                    value={formatNumber(data.totals.sessions)}
                  />
                  <Stat
                    label="Users"
                    value={formatNumber(data.totals.totalUsers)}
                  />
                </div>
              )}
            </Section>
          </Card>
        </Col>
        <Col span={4}>
          <Card title="Medusa sales total" hint="Source of truth">
            <Section state={ops} skeleton={<SkeletonRows rows={2} />}>
              {(data) => (
                <div className="pa-statlist">
                  <Stat label="Sales volume" value={money(data.sales)} />
                  <Stat label="Received" value={money(data.paidSales)} />
                </div>
              )}
            </Section>
          </Card>
        </Col>
      </Grid>

      {/* ----------------------------------------------- conversion KPIs -- */}
      <Grid>
        <Col span={3}>
          {/*
            Where a shop-wide conversion rate would go. It stays empty
            deliberately: the only denominator available counts consenting
            sessions, and dividing every order by it produces a number that
            reads high by however many visitors declined — a quantity nobody
            measures. An unavailable card is the honest occupant of this slot.
          */}
          <Card title="Shop conversion rate" hint="Not available">
            <EmptyState
              title="No first-party session count"
              description={SHOP_CONVERSION_UNAVAILABLE}
            />
          </Card>
        </Col>
        <Col span={3}>
          <KpiCard
            label="Payment completion"
            value={
              ops.data ? formatPercent(ops.data.paymentCompletionRate, 1) : "—"
            }
            previousLabel={
              ops.data
                ? `${formatNumber(ops.data.paidOrders)} of ${formatNumber(ops.data.orders)} orders paid`
                : undefined
            }
            loading={ops.data === undefined && !ops.error}
          />
        </Col>
        <Col span={3}>
          <KpiCard
            label="Time to payment"
            value={
              ops.data ? formatDuration(ops.data.medianSecondsToPayment) : "—"
            }
            previousLabel="Median, order created → captured"
            loading={ops.data === undefined && !ops.error}
          />
        </Col>
        <Col span={3}>
          <KpiCard
            label="Average order value"
            value={ops.data ? money(ops.data.averageOrderValue) : "—"}
            previousLabel={
              ops.data ? `${formatNumber(ops.data.orders)} orders` : undefined
            }
            loading={ops.data === undefined && !ops.error}
          />
        </Col>
      </Grid>

      {/* ------------------------------------ GA4-only rate + diagnostic -- */}
      <Grid>
        <Col span={6}>
          <Card
            title={GA4_TRANSACTION_RATE_LABEL}
            hint="GA4 only"
            note={GA4_TRANSACTION_RATE_NOTE}
          >
            <Section state={ga4} skeleton={<SkeletonRows rows={2} />}>
              {(data) =>
                // Rendered only when both sides are genuinely available; a zero
                // session count yields null rather than a division by zero.
                transactionRate === null ? (
                  <EmptyState
                    title="Not enough data"
                    description="GA4 recorded no sessions in this period, so there is nothing to divide by."
                  />
                ) : (
                  <div className="pa-statlist">
                    <Stat
                      label={GA4_TRANSACTION_RATE_LABEL}
                      value={formatPercent(transactionRate, 2)}
                    />
                    <Stat
                      label="GA4 transactions"
                      value={formatNumber(data.totals.transactions)}
                    />
                    <Stat
                      label="GA4 sessions"
                      value={formatNumber(data.totals.sessions)}
                    />
                  </div>
                )
              }
            </Section>
          </Card>
        </Col>

        <Col span={6}>
          {/*
            The blended ratio, kept only because it is genuinely useful for
            spotting a tracking regression — and only under this name, with
            this warning. It is not a KPI card and appears in no table.
          */}
          <Card
            title={ORDERS_PER_SESSION_LABEL}
            hint="Diagnostic · mixes two populations"
            note={ORDERS_PER_SESSION_WARNING}
          >
            {ordersPerSession === null ? (
              <EmptyState
                title="Not enough data"
                description="Needs both Medusa orders and a non-zero GA4 session count for this period."
              />
            ) : (
              <div className="pa-statlist">
                <Stat
                  label={ORDERS_PER_SESSION_LABEL}
                  value={formatPercent(ordersPerSession, 2)}
                />
                <Stat
                  label="Medusa orders"
                  value={formatNumber(orders ?? 0)}
                />
                <Stat
                  label="Tracked GA4 sessions"
                  value={formatNumber(sessions ?? 0)}
                />
              </div>
            )}
          </Card>
        </Col>
      </Grid>

      {/* ---------------------------------------------- channels + funnel -- */}
      <Grid>
        <Col span={7}>
          <Card
            title="Channels"
            hint="GA4 · sessions and users by default channel group"
            note="Cart rate, checkout rate, per-channel orders and per-channel sales volume are omitted. The storefront records no source, medium or landing page on the order, so there is no key on which a GA4 channel could be matched to a Medusa order."
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
              empty={<EmptyState title="No traffic in this period" />}
            >
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table pa-table--wide">
                    <thead>
                      <tr>
                        <th scope="col">Channel</th>
                        <th scope="col" className="pa-num">
                          Visitors
                        </th>
                        <th scope="col" className="pa-num">
                          Sessions
                        </th>
                        <th scope="col" className="pa-num">
                          Share of sessions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byChannelGroup.map((row) => {
                        const rowSessions = Number(row.sessions) || 0;
                        const total = data.byChannelGroup.reduce(
                          (sum, entry) => sum + (Number(entry.sessions) || 0),
                          0,
                        );
                        return (
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
                              {formatNumber(rowSessions)}
                            </td>
                            <td className="pa-num">
                              {total
                                ? formatPercent(rowSessions / total, 1)
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </Card>
        </Col>

        <Col span={5}>
          <Card
            title="Conversion funnel"
            hint="Medusa orders · GA4 visitors"
            note="Two steps have no data source in this codebase and are shown as unavailable rather than estimated. Step-to-step percentages are shown only between steps from the same system — a GA4 visitor count and a Medusa order count describe different populations, so a percentage across that boundary would be the same overstated ratio the diagnostic card above carries a warning about."
          >
            <Section state={ops} skeleton={<SkeletonRows rows={5} />}>
              {(data) => {
                // Visitors is GA4's step; the server leaves it null so the two
                // systems' failures stay independent, and it is filled in here
                // only when the GA4 query actually succeeded.
                const steps = data.funnel.map((step) =>
                  step.key === "visitors"
                    ? { ...step, count: ga4.data ? (sessions ?? null) : null }
                    : step,
                );
                const top = Math.max(
                  1,
                  ...steps.map((step) => step.count ?? 0),
                );

                return (
                  <div className="pa-funnel">
                    {steps.map((step, index) => {
                      const previous = steps
                        .slice(0, index)
                        .reverse()
                        .find((candidate) => candidate.count !== null);

                      // Same-source steps only. `Order created ÷ Visitors`
                      // would divide every Medusa order by consenting GA4
                      // sessions — a conversion rate in a funnel's clothing.
                      const conversion = canCompareFunnelSteps(step, previous)
                        ? (step.count as number) / (previous?.count as number)
                        : null;

                      return (
                        <div className="pa-funnel__step" key={step.key}>
                          <span className="pa-funnel__label">{step.label}</span>
                          <div>
                            <BarRow
                              label=""
                              value={
                                step.count === null
                                  ? "No data source"
                                  : formatNumber(step.count)
                              }
                              fraction={
                                step.count === null ? 0 : step.count / top
                              }
                              muted={step.count === null}
                            />
                          </div>
                          <span className="pa-funnel__conv">
                            {conversion === null
                              ? "—"
                              : formatPercent(conversion, 1)}
                          </span>
                        </div>
                      );
                    })}

                    {steps.some((step) => step.source === "unavailable") && (
                      <p className="pa-card__hint">
                        {
                          steps.find((step) => step.source === "unavailable")
                            ?.note
                        }
                      </p>
                    )}
                  </div>
                );
              }}
            </Section>
          </Card>
        </Col>
      </Grid>

      {/* ------------------------------------ attribution + payment status -- */}
      <Grid>
        <Col span={6}>
          <Card title="Order attribution" hint="Not available">
            <Section state={ops} skeleton={<SkeletonRows rows={4} />}>
              {(data) =>
                data.tracking.attributionAvailable ? (
                  <EmptyState
                    title="Attribution data present"
                    description={`${formatNumber(data.tracking.ordersWithSource)} of ${formatNumber(data.tracking.ordersTotal)} orders carry a source. The per-order table is not rendered yet — the storefront started recording attribution after this dashboard was built.`}
                  />
                ) : (
                  <EmptyState
                    title="No source is recorded on orders"
                    description="The storefront does not capture UTM parameters, referrer or landing page, and the checkout writes only a VAT id and a bank reference into order metadata. First-touch and last-touch source, channel group and landing page per order are therefore unavailable — this is a data gap in collection, not a reporting limitation."
                  />
                )
              }
            </Section>
          </Card>
        </Col>

        <Col span={6}>
          <Card title="Tracking quality" hint="Medusa">
            <Section state={ops} skeleton={<SkeletonRows rows={4} />}>
              {(data) => (
                <div className="pa-statlist">
                  <Stat
                    label="Orders with source"
                    value={formatNumber(data.tracking.ordersWithSource)}
                  />
                  <Stat
                    label="Untracked"
                    value={formatNumber(data.tracking.ordersWithoutSource)}
                  />
                  <Stat
                    label="Payment still open"
                    value={formatNumber(data.tracking.paymentPending)}
                  />
                  <Stat
                    label="Payment confirmed"
                    value={formatNumber(data.tracking.paymentCaptured)}
                  />
                  <Stat
                    label="Refunded"
                    value={formatNumber(data.tracking.paymentRefunded)}
                  />
                  <Stat
                    label="Checkout abandoned"
                    value={<span className="pa-card__hint">No data source</span>}
                  />
                </div>
              )}
            </Section>
          </Card>
        </Col>
      </Grid>

      <Grid>
        <Col span={6}>
          <Card title="Orders by payment status" hint="Medusa">
            <Section
              state={ops}
              skeleton={<SkeletonRows rows={4} />}
              isEmpty={(data) => data.byPaymentStatus.length === 0}
              empty={<EmptyState title="No orders in this period" />}
            >
              {(data) => {
                const max = Math.max(
                  0,
                  ...data.byPaymentStatus.map((row) => row.orders),
                );
                return (
                  <BarList>
                    {data.byPaymentStatus.map((row) => (
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

        <Col span={6}>
          <Card
            title="Source summary"
            hint="GA4 · source / medium"
            note="Orders created, paid orders, revenue and average order value cannot be broken down by source: no order carries one. The traffic side is shown alone rather than joined to unrelated totals."
            flush
          >
            <Section
              state={ga4}
              skeleton={
                <div style={{ padding: "0 18px 18px" }}>
                  <SkeletonRows rows={6} />
                </div>
              }
              isEmpty={(data) => data.bySourceMedium.length === 0}
              empty={<EmptyState title="No traffic sources recorded" />}
            >
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table">
                    <thead>
                      <tr>
                        <th scope="col">Source / medium</th>
                        <th scope="col" className="pa-num">
                          Sessions
                        </th>
                        <th scope="col" className="pa-num">
                          Users
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.bySourceMedium.slice(0, 10).map((row) => (
                        <tr key={String(row.sourceMedium)}>
                          <td>
                            <span className="pa-truncate">
                              {String(row.sourceMedium) || "(not set)"}
                            </span>
                          </td>
                          <td className="pa-num">
                            {formatNumber(Number(row.sessions) || 0)}
                          </td>
                          <td className="pa-num">
                            {formatNumber(Number(row.totalUsers) || 0)}
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
      </Grid>

      <Ga4RevenueNotice />
    </>
  );
}
