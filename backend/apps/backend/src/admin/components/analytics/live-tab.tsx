/**
 * Live: who is on the site, and what the shop has taken today.
 *
 * The two halves come from different systems and mean different things, and the
 * whole design of this tab is about not letting them blur together. GA4
 * realtime covers roughly the last thirty minutes of *activity* from visitors
 * who accepted statistics consent. Medusa covers *today's orders and money*,
 * exactly. Every GA4 panel here says so in its own subtitle, and no panel
 * fed by GA4 uses the words "sales" or "revenue".
 *
 * Polling is 60 seconds while the tab is visible and stops entirely when it is
 * not — see `useDocumentVisible` in `lib/queries.ts`. A hidden tab spending the
 * property's shared Data API quota is a cost with no reader.
 */

import {
  formatCurrency,
  formatDayLong,
  formatNumber,
  formatRelative,
  formatTime,
  humanizeStatus,
} from "../../lib/format";
import type { Ga4Realtime, Ga4Row, OpsLive } from "../../lib/types";
import {
  BarList,
  BarRow,
  Card,
  Col,
  EmptyState,
  Grid,
  KpiCard,
  Notice,
  Pill,
  Section,
  SkeletonRows,
  statusTone,
  type SectionState,
} from "./primitives";
import { WorldMap } from "./world-map";
import { Link } from "react-router-dom";

const REALTIME_WINDOW = "GA4 realtime · approximately the last 30 minutes";

type Props = {
  realtime: SectionState<Ga4Realtime>;
  live: SectionState<OpsLive>;
  todaySummary: SectionState<{ users: number; sessions: number; views: number }>;
  polling: boolean;
};

function rowsPeak(rows: readonly Ga4Row[], key: string): number {
  return Math.max(0, ...rows.map((row) => Number(row[key]) || 0));
}

export function LiveTab({ realtime, live, todaySummary, polling }: Props) {
  const currency = live.data?.currencyCode ?? "eur";
  const timeZone = live.data?.timeZone ?? "Europe/Berlin";

  return (
    <>
      {!polling && (
        <Notice tone="warning">
          Live updates are paused because this browser tab is in the background.
          They resume as soon as it is visible again.
        </Notice>
      )}

      {/* ------------------------------------------------------ top cards -- */}
      <Grid>
        <Col span={3}>
          {realtime.data ? (
            <KpiCard
              label="Visitors now"
              value={formatNumber(realtime.data.totals.activeUsers)}
              previousLabel={REALTIME_WINDOW}
            />
          ) : (
            <KpiCard label="Visitors now" value="" loading={!realtime.error} />
          )}
        </Col>
        <Col span={3}>
          {todaySummary.data ? (
            <KpiCard
              label="Visitors today"
              value={formatNumber(todaySummary.data.users)}
              previousLabel="GA4 · today, consent-dependent"
            />
          ) : (
            <KpiCard
              label="Visitors today"
              value=""
              loading={!todaySummary.error}
            />
          )}
        </Col>
        <Col span={3}>
          {live.data ? (
            <KpiCard
              label="Orders today"
              value={formatNumber(live.data.ordersToday)}
              previousLabel={`Medusa · ${live.data.unfulfilledOrders} awaiting fulfilment`}
            />
          ) : (
            <KpiCard label="Orders today" value="" loading={!live.error} />
          )}
        </Col>
        <Col span={3}>
          {live.data ? (
            <KpiCard
              label="Revenue today"
              value={formatCurrency(live.data.revenueToday, currency)}
              previousLabel={`Medusa · ${formatCurrency(live.data.paidRevenueToday, currency)} received`}
            />
          ) : (
            <KpiCard label="Revenue today" value="" loading={!live.error} />
          )}
        </Col>
      </Grid>

      {/* ------------------------------------ locations + right-hand cards -- */}
      <Grid>
        <Col span={8}>
          {/*
            The map draws from committed SVG path data, not a mapping library
            — see `world-map.tsx`. It is a picture of *where*, deliberately
            paired with the ranked list beside it for *how many*: reading an
            exact figure off a choropleth is guesswork, and this panel is
            often looking at single-digit counts.
          */}
          <Card
            title="Active users by country"
            hint={REALTIME_WINDOW}
            note="Shading and marker size show each country's share of active users. Exact counts are in Top locations."
          >
            {/*
              No `isEmpty` here, deliberately. Every other panel on this tab
              collapses to an empty state with nothing to report, and for a
              ranked list that is right. A map is different: the basemap is
              most of the information, and an idle half-hour is this shop's
              normal reading rather than an error. Collapsing it made the panel
              look broken — the map was invisible until someone happened to be
              on the site. The "nobody is active" copy now sits *over* the map.
            */}
            <Section state={realtime} skeleton={<SkeletonRows rows={6} />}>
              {(data) => (
                <WorldMap
                  rows={data.activeUsersByCountry.map((row) => ({
                    name: String(row.country ?? ""),
                    value: Number(row.activeUsers) || 0,
                  }))}
                  unit="active users"
                  formatValue={formatNumber}
                  emptyTitle="Nobody is active right now"
                  emptyDescription="No visitors with statistics consent in the last 30 minutes."
                />
              )}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          <Card title="Top locations" hint={REALTIME_WINDOW}>
            <Section
              state={realtime}
              skeleton={<SkeletonRows rows={5} />}
              isEmpty={(data) => data.activeUsersByCountry.length === 0}
              empty={<EmptyState title="No active locations" />}
            >
              {(data) => {
                const max = rowsPeak(data.activeUsersByCountry, "activeUsers");
                return (
                  <BarList>
                    {data.activeUsersByCountry.slice(0, 6).map((row) => {
                      const users = Number(row.activeUsers) || 0;
                      return (
                        <BarRow
                          key={String(row.country)}
                          label={String(row.country) || "(not set)"}
                          value={formatNumber(users)}
                          fraction={max ? users / max : 0}
                        />
                      );
                    })}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>
      </Grid>

      <Grid>
        <Col span={4}>
          <Card title="Active pages" hint={REALTIME_WINDOW}>
            <Section
              state={realtime}
              skeleton={<SkeletonRows rows={6} />}
              isEmpty={(data) => data.topPages.length === 0}
              empty={<EmptyState title="No pages being viewed" />}
            >
              {(data) => {
                const max = rowsPeak(data.topPages, "screenPageViews");
                return (
                  <BarList>
                    {data.topPages.slice(0, 8).map((row) => {
                      const views = Number(row.screenPageViews) || 0;
                      return (
                        <BarRow
                          key={String(row.unifiedScreenName)}
                          label={String(row.unifiedScreenName) || "(not set)"}
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

        <Col span={4}>
          <Card title="Events by name" hint={REALTIME_WINDOW}>
            <Section
              state={realtime}
              skeleton={<SkeletonRows rows={6} />}
              isEmpty={(data) => data.eventCountsByEventName.length === 0}
              empty={<EmptyState title="No events in the last 30 minutes" />}
            >
              {(data) => {
                const max = rowsPeak(data.eventCountsByEventName, "eventCount");
                return (
                  <BarList>
                    {data.eventCountsByEventName.slice(0, 8).map((row) => {
                      const count = Number(row.eventCount) || 0;
                      return (
                        <BarRow
                          key={String(row.eventName)}
                          label={String(row.eventName) || "(not set)"}
                          value={formatNumber(count)}
                          fraction={max ? count / max : 0}
                        />
                      );
                    })}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>

        <Col span={4}>
          <Card title="Active users by device" hint={REALTIME_WINDOW}>
            <Section
              state={realtime}
              skeleton={<SkeletonRows rows={3} />}
              isEmpty={(data) => data.activeUsersByDeviceCategory.length === 0}
              empty={<EmptyState title="No devices active" />}
            >
              {(data) => {
                const max = rowsPeak(
                  data.activeUsersByDeviceCategory,
                  "activeUsers",
                );
                return (
                  <BarList>
                    {data.activeUsersByDeviceCategory.map((row) => {
                      const users = Number(row.activeUsers) || 0;
                      return (
                        <BarRow
                          key={String(row.deviceCategory)}
                          label={humanizeStatus(String(row.deviceCategory))}
                          value={formatNumber(users)}
                          fraction={max ? users / max : 0}
                        />
                      );
                    })}
                  </BarList>
                );
              }}
            </Section>
          </Card>
        </Col>
      </Grid>

      <Grid>
        <Col span={5}>
          <Card title="Recent activity" hint={REALTIME_WINDOW}>
            <Section state={realtime} skeleton={<SkeletonRows rows={4} />}>
              {(data) => (
                <div className="pa-statlist">
                  <StatBlock
                    label="Active users"
                    value={formatNumber(data.totals.activeUsers)}
                  />
                  <StatBlock
                    label="Page views"
                    value={formatNumber(data.totals.screenPageViews)}
                  />
                  <StatBlock
                    label="Events"
                    value={formatNumber(data.totals.eventCount)}
                  />
                  <StatBlock
                    label="Key events"
                    value={formatNumber(data.totals.keyEvents)}
                  />
                </div>
              )}
            </Section>
          </Card>
        </Col>

        <Col span={7}>
          <Card
            title="Orders placed today"
            hint={
              live.data
                ? `Medusa · ${formatDayLong(live.data.day, timeZone)} (${timeZone})`
                : "Medusa"
            }
            flush
          >
            <Section
              state={live}
              skeleton={
                <div style={{ padding: "0 18px 18px" }}>
                  <SkeletonRows rows={4} />
                </div>
              }
              isEmpty={(data) => data.recentOrders.length === 0}
              empty={
                <EmptyState
                  title="No orders today"
                  description="Ordering is currently closed on the storefront."
                />
              }
            >
              {(data) => (
                <div className="pa-tablewrap">
                  <table className="pa-table">
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Time</th>
                        <th scope="col">Payment</th>
                        <th scope="col" className="pa-num">
                          Amount
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOrders.map((order) => (
                        <tr key={order.id}>
                          <td>
                            <Link to={`/orders/${order.id}`}>
                              #{order.displayId ?? "—"}
                            </Link>
                          </td>
                          <td>{formatTime(order.createdAt, timeZone)}</td>
                          <td>
                            <Pill tone={statusTone(order.paymentStatus)}>
                              {humanizeStatus(order.paymentStatus)}
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
      </Grid>

      {/*
        Product activity and a live funnel would need GA4 item-scoped events
        (`view_item`, `add_to_cart`) and the funnel events the storefront does
        not send. Named rather than filled with the closest-looking numbers.
      */}
      <Grid>
        <Col span={12}>
          <Card title="Product activity and live funnel" hint="Not available">
            <EmptyState
              title="No ecommerce events are collected"
              description="The storefront sends page views only, and its cart, checkout and confirmation pages are excluded from measurement so order identifiers never reach Google. Live product views, add-to-cart counts and checkout starts therefore have no data source."
            />
          </Card>
        </Col>
      </Grid>

      {realtime.data && (
        <p className="pa-card__hint" style={{ marginTop: -4 }}>
          GA4 realtime last updated {formatRelative(realtime.data.generatedAt)} ·
          cache {realtime.data.cache.status} ({realtime.data.cache.ageSeconds}s
          old)
          {live.data
            ? ` · Medusa last updated ${formatRelative(live.data.generatedAt)}`
            : ""}
        </p>
      )}
    </>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="pa-stat__label">{label}</p>
      <p className="pa-stat__value">{value}</p>
    </div>
  );
}
