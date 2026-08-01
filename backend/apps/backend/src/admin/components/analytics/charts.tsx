/**
 * Charts, drawn as inline SVG.
 *
 * The repository has no charting library — not in the backend app, not in
 * `@medusajs/dashboard`, not transitively. Rather than add one for a single
 * line chart and a handful of bars, this draws them directly. Recharts and its
 * peers cost 90–350 kB in a bundle that is already the whole Medusa admin, and
 * every one of them would have to be wrapped anyway to reach the palette and
 * the accessibility behaviour below.
 *
 * Accessibility is not an afterthought here: the SVG carries `role="img"` and a
 * generated description, and every chart is followed by a visually hidden table
 * of the same numbers. A screen reader gets the data, not "chart".
 */

import { useId, useMemo, useState } from "react";

export type ChartPoint = {
  day: string;
  sales: number;
  orders: number;
  averageOrderValue: number;
};

export type ChartFormatters = {
  currency: (value: number) => string;
  number: (value: number) => string;
  day: (day: string) => string;
  dayLong: (day: string) => string;
};

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 22, left: 46 };

function scaleX(index: number, count: number): number {
  if (count <= 1) return PAD.left + (WIDTH - PAD.left - PAD.right) / 2;
  const span = WIDTH - PAD.left - PAD.right;
  return PAD.left + (index / (count - 1)) * span;
}

function scaleY(value: number, max: number): number {
  const span = HEIGHT - PAD.top - PAD.bottom;
  if (max <= 0) return HEIGHT - PAD.bottom;
  return HEIGHT - PAD.bottom - (value / max) * span;
}

function linePath(values: readonly number[], max: number): string {
  return values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${scaleX(index, values.length).toFixed(2)},${scaleY(value, max).toFixed(2)}`,
    )
    .join(" ");
}

/**
 * A "nice" axis maximum — 1, 2 or 5 times a power of ten above the peak.
 *
 * Without this the top gridline reads `1.247,33 €`, which is a number nobody
 * asked for on an axis.
 */
export function niceMax(peak: number): number {
  if (!Number.isFinite(peak) || peak <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const normalized = peak / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function SalesTrendChart({
  points,
  previous,
  formatters,
  emptyLabel,
}: {
  points: readonly ChartPoint[];
  previous?: readonly ChartPoint[];
  formatters: ChartFormatters;
  emptyLabel: string;
}) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(() => {
    const values = [
      ...points.map((point) => point.sales),
      ...(previous ?? []).map((point) => point.sales),
    ];
    return niceMax(Math.max(0, ...values));
  }, [points, previous]);

  const hasSales = points.some((point) => point.sales > 0);

  if (points.length === 0) {
    return (
      <div className="pa-empty">
        <span className="pa-empty__title">{emptyLabel}</span>
      </div>
    );
  }

  const sales = points.map((point) => point.sales);
  // The comparison line is resampled onto the current window's x positions, so
  // a 30-day period compared against a 30-day one lines up day-for-day even
  // when a month boundary makes the two windows different lengths.
  const previousSales = (previous ?? []).map((point) => point.sales);
  const active = hover !== null ? points[hover] : null;

  const gridValues = [0, 0.5, 1].map((fraction) => max * fraction);

  return (
    <div className="pa-chart-shell">
      <svg
        className="pa-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>
          {`Daily sales from ${formatters.dayLong(points[0].day)} to ${formatters.dayLong(points[points.length - 1].day)}. Peak ${formatters.currency(Math.max(0, ...sales))}.`}
        </title>

        {gridValues.map((value) => (
          <g key={value}>
            <line
              className="pa-chart__grid"
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={scaleY(value, max)}
              y2={scaleY(value, max)}
            />
            <text
              className="pa-chart__axis"
              x={PAD.left - 6}
              y={scaleY(value, max) + 3}
              textAnchor="end"
            >
              {formatters.currency(value)}
            </text>
          </g>
        ))}

        {hasSales && (
          <path
            className="pa-chart__area"
            d={`${linePath(sales, max)} L${scaleX(sales.length - 1, sales.length).toFixed(2)},${HEIGHT - PAD.bottom} L${scaleX(0, sales.length).toFixed(2)},${HEIGHT - PAD.bottom} Z`}
          />
        )}

        {previousSales.length > 1 && (
          <path
            className="pa-chart__line pa-chart__line--previous"
            d={linePath(previousSales, max)}
          />
        )}

        <path className="pa-chart__line" d={linePath(sales, max)} />

        {active && hover !== null && (
          <circle
            className="pa-chart__dot"
            cx={scaleX(hover, sales.length)}
            cy={scaleY(active.sales, max)}
            r={3.5}
          />
        )}

        {/*
          One transparent hit rectangle per day rather than a mousemove
          calculation: it keeps the hover target honest at the edges and makes
          the whole column clickable on a touch screen.
        */}
        {points.map((point, index) => {
          const step = (WIDTH - PAD.left - PAD.right) / Math.max(1, points.length - 1);
          return (
            <rect
              key={point.day}
              className="pa-chart__hit"
              x={scaleX(index, points.length) - step / 2}
              y={PAD.top}
              width={step}
              height={HEIGHT - PAD.top - PAD.bottom}
              onMouseEnter={() => setHover(index)}
            />
          );
        })}

        {points.map((point, index) => {
          // Roughly six labels regardless of period length.
          const every = Math.max(1, Math.ceil(points.length / 6));
          if (index % every !== 0 && index !== points.length - 1) return null;

          return (
            <text
              key={point.day}
              className="pa-chart__axis"
              x={scaleX(index, points.length)}
              y={HEIGHT - 6}
              textAnchor="middle"
            >
              {formatters.day(point.day)}
            </text>
          );
        })}
      </svg>

      {active && hover !== null && (
        <div
          className="pa-tooltip"
          style={{
            left: `${(scaleX(hover, points.length) / WIDTH) * 100}%`,
            top: `${(scaleY(active.sales, max) / HEIGHT) * 100}%`,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            {formatters.dayLong(active.day)}
          </div>
          <div className="pa-tooltip__row">
            <span>Sales</span>
            <span>{formatters.currency(active.sales)}</span>
          </div>
          <div className="pa-tooltip__row">
            <span>Orders</span>
            <span>{formatters.number(active.orders)}</span>
          </div>
          <div className="pa-tooltip__row">
            <span>AOV</span>
            <span>{formatters.currency(active.averageOrderValue)}</span>
          </div>
        </div>
      )}

      {previousSales.length > 1 && (
        <div className="pa-chart-legend">
          <span>
            <span
              className="pa-chart-legend__swatch"
              style={{ background: "var(--pa-accent)" }}
            />
            Selected period
          </span>
          <span>
            <span
              className="pa-chart-legend__swatch"
              style={{ background: "var(--pa-border-strong)" }}
            />
            Previous period
          </span>
        </div>
      )}

      {/* The same numbers, for a screen reader and for anyone who prefers them. */}
      <table className="pa-sr">
        <caption>Daily sales, orders and average order value</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Sales</th>
            <th scope="col">Orders</th>
            <th scope="col">Average order value</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{formatters.dayLong(point.day)}</th>
              <td>{formatters.currency(point.sales)}</td>
              <td>{formatters.number(point.orders)}</td>
              <td>{formatters.currency(point.averageOrderValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A minimal line, for the average-order-value-over-time card.
 *
 * Separate from `SalesTrendChart` rather than a mode of it: that one carries a
 * tooltip, a comparison series, an area fill and an axis, and folding a
 * sparkline into it would mean five props that only apply half the time.
 */
export function Sparkline({
  values,
  label,
  formatValue,
}: {
  values: readonly number[];
  label: string;
  formatValue: (value: number) => string;
}) {
  const titleId = useId();
  const max = niceMax(Math.max(0, ...values));

  if (values.length === 0) {
    return <div className="pa-empty">No data for this period.</div>;
  }

  return (
    <div>
      <svg
        className="pa-chart"
        viewBox="0 0 720 90"
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={titleId}
        style={{ height: 90 }}
      >
        <title id={titleId}>
          {`${label}. Peak ${formatValue(Math.max(0, ...values))}.`}
        </title>
        <path
          className="pa-chart__line"
          d={values
            .map((value, index) => {
              const x =
                values.length <= 1
                  ? 360
                  : (index / (values.length - 1)) * 712 + 4;
              const y = max <= 0 ? 85 : 85 - (value / max) * 78;
              return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
            })
            .join(" ")}
        />
      </svg>
    </div>
  );
}
