/**
 * The building blocks every analytics panel is made of.
 *
 * Deliberately small and unopinionated: a card, a KPI, a pill, a bar, a
 * skeleton, an empty state, an error state. Panels compose these rather than
 * styling themselves, which is what keeps a twenty-panel dashboard looking like
 * one thing.
 *
 * `Section` is the important one. It is a section-level error boundary in
 * function form — it decides, per panel, whether to show a skeleton, an error
 * with a retry, an empty state or the children. That is what makes "a GA4
 * failure must not hide Medusa's sales figures" true structurally instead of by
 * everyone remembering to check.
 */

import type { ReactNode } from "react";
import { errorGuidance } from "../../lib/errors";
import { formatChange, formatRelative } from "../../lib/format";
import type { Kpi } from "../../lib/types";

/**
 * Re-exported so a panel importing from this module does not also have to
 * import from `lib/errors` for the one thing it needs alongside `ErrorState`.
 */
export { errorGuidance };

/* --------------------------------------------------------------- layout -- */

export function Grid({ children }: { children: ReactNode }) {
  return <div className="pa-grid">{children}</div>;
}

export function Col({
  span,
  children,
}: {
  span: 3 | 4 | 5 | 6 | 7 | 8 | 12;
  children: ReactNode;
}) {
  return <div className={`pa-col-${span}`}>{children}</div>;
}

export function Card({
  title,
  hint,
  actions,
  note,
  flush,
  children,
}: {
  title?: string;
  hint?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={flush ? "pa-card pa-card--flush" : "pa-card"}>
      {(title || actions) && (
        <div className="pa-card__head">
          <div>
            {title && <h3 className="pa-card__title">{title}</h3>}
            {hint && <p className="pa-card__hint">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="pa-card__body">{children}</div>
      {note && <p className="pa-card__note">{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ kpi -- */

export function KpiCard({
  label,
  value,
  kpi,
  previousLabel,
  loading,
}: {
  label: string;
  value: string;
  kpi?: Kpi;
  previousLabel?: string;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="pa-card">
        <div className="pa-skel pa-skel--label" />
        <div className="pa-skel pa-skel--value" />
        <div className="pa-skel pa-skel--foot" />
      </div>
    );
  }

  // No baseline is drawn as flat and grey. Painting a first-ever order green
  // with "+100%" would be inventing a comparison that does not exist.
  const trend = kpi?.change === null ? "flat" : (kpi?.trend ?? "flat");
  const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "•";

  return (
    <div className="pa-card">
      <p className="pa-kpi__label">{label}</p>
      <p className="pa-kpi__value">{value}</p>
      <div className="pa-kpi__foot">
        {kpi && (
          <span className={`pa-trend pa-trend--${trend}`}>
            <span aria-hidden="true">{arrow}</span>
            {formatChange(kpi.change)}
          </span>
        )}
        {previousLabel && <span>{previousLabel}</span>}
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="pa-stat__label">{label}</p>
      <p className="pa-stat__value">{value}</p>
    </div>
  );
}

/* ----------------------------------------------------------------- pill -- */

export type PillTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return <span className={`pa-pill pa-pill--${tone}`}>{children}</span>;
}

/**
 * Status colour, shared by the payment and fulfillment columns.
 *
 * Amber for "someone still has to do something", green for done, red for money
 * that went back out. Anything unrecognised stays neutral rather than guessing
 * — a new Medusa status showing up grey is fine, showing up green is not.
 */
export function statusTone(status: string): PillTone {
  switch (status) {
    case "captured":
    case "fulfilled":
    case "delivered":
    case "shipped":
      return "success";
    case "awaiting":
    case "not_paid":
    case "not_fulfilled":
    case "requires_action":
    case "partially_captured":
    case "partially_fulfilled":
    case "partially_shipped":
      return "warning";
    case "refunded":
    case "partially_refunded":
    case "canceled":
      return "danger";
    default:
      return "neutral";
  }
}

/* ------------------------------------------------------------------ bar -- */

export function BarRow({
  label,
  value,
  fraction,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  fraction: number;
  muted?: boolean;
}) {
  const width = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));

  return (
    <div>
      <div className="pa-bar__head">
        <span className="pa-bar__label">{label}</span>
        <span className="pa-bar__value">{value}</span>
      </div>
      <div className="pa-bar__track">
        <div
          className={muted ? "pa-bar__fill pa-bar__fill--muted" : "pa-bar__fill"}
          style={{ width: `${(width * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  );
}

export function BarList({ children }: { children: ReactNode }) {
  return <div className="pa-barlist">{children}</div>;
}

/* -------------------------------------------------------------- messages -- */

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="pa-empty">
      <span className="pa-empty__title">{title}</span>
      {description && <span>{description}</span>}
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning";
  children: ReactNode;
}) {
  return (
    <p className={tone === "warning" ? "pa-notice pa-notice--warning" : "pa-notice"}>
      {children}
    </p>
  );
}

/**
 * The notice the spec requires beside every GA4 ecommerce figure.
 *
 * A component rather than a copied string so the wording cannot drift between
 * the three places it appears.
 */
export function Ga4RevenueNotice() {
  return (
    <Notice>
      Google Analytics revenue is processed, consent-dependent analytics data.
      Medusa orders remain the source of truth for sales and revenue.
    </Notice>
  );
}

export function ErrorState({
  error,
  onRetry,
  lastSuccessAt,
  timeZone,
}: {
  error: unknown;
  onRetry?: () => void;
  lastSuccessAt?: string;
  timeZone?: string;
}) {
  const { title, detail, code, retryable } = errorGuidance(error);

  return (
    <div className="pa-error" role="alert">
      <span className="pa-error__title">
        <span className="pa-dot pa-dot--error" aria-hidden="true" />
        {title}
      </span>
      <p className="pa-error__body">{detail}</p>
      {lastSuccessAt && (
        <p className="pa-error__body">
          Showing data last loaded {formatRelative(lastSuccessAt)}
          {timeZone ? ` (${timeZone})` : ""}.
        </p>
      )}
      <div className="pa-header__actions">
        {onRetry && (
          <button type="button" className="pa-button" onClick={onRetry}>
            {retryable ? "Try again" : "Retry"}
          </button>
        )}
        <span className="pa-error__code">{code}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- skeleton -- */

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="pa-skel pa-skel--row" />
      ))}
    </div>
  );
}

export function SkeletonChart() {
  return <div className="pa-skel pa-skel--chart" aria-hidden="true" />;
}

/* --------------------------------------------------------------- section -- */

export type SectionState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching?: boolean;
  error: unknown;
  refetch?: () => void;
};

/**
 * Render one panel's body according to its own query state.
 *
 * The order of the checks is the contract:
 *
 *  1. Data present → render it, even if the *latest* refetch failed. Stale
 *     numbers with a warning beat an empty card; the merchant can still read
 *     yesterday's figure and decide whether to trust it.
 *  2. No data and an error → the error, with a retry.
 *  3. Otherwise → the skeleton.
 *
 * Because each panel calls this with its own query, a GA4 panel in state 2 sits
 * next to a Medusa panel in state 1 without either knowing about the other.
 */
export function Section<T>({
  state,
  skeleton,
  children,
  isEmpty,
  empty,
}: {
  state: SectionState<T>;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
}) {
  if (state.data !== undefined) {
    const stale = Boolean(state.error);
    const body =
      isEmpty?.(state.data) && empty ? empty : children(state.data);

    return (
      <>
        {stale && (
          <p className="pa-stale">
            <span className="pa-dot pa-dot--warn" aria-hidden="true" />
            Showing the last successful load — refreshing failed.
          </p>
        )}
        <div className={state.isFetching ? "pa-dim" : undefined}>{body}</div>
      </>
    );
  }

  if (state.error) {
    return <ErrorState error={state.error} onRetry={state.refetch} />;
  }

  return <>{skeleton}</>;
}
