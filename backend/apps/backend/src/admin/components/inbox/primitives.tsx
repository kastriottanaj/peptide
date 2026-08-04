/**
 * The small pieces the inbox is built from.
 *
 * A card, a pill, an empty state, an error state, a skeleton — deliberately the
 * same vocabulary as the Analytics dashboard's `primitives.tsx`, in this
 * feature's own class namespace so the two routes stay independent.
 *
 * Nothing here interpolates markup. Every value that reaches these components
 * came out of an email, so it is rendered as a React child and escaped by
 * construction. `dangerouslySetInnerHTML` appears nowhere in this feature, and
 * a test asserts that it stays that way.
 */

import type { ReactNode } from "react";
import { inboxErrorGuidance } from "../../lib/inbox-errors";

export function Card({
  title,
  hint,
  actions,
  flush,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="pi-card">
      {(title || actions) && (
        <div className="pi-card__head">
          <div>
            {title && <h2 className="pi-card__title">{title}</h2>}
            {hint && <p className="pi-card__hint">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      {flush ? children : <div className="pi-card__body">{children}</div>}
    </div>
  );
}

export type PillTone = "neutral" | "success" | "warning" | "danger" | "accent";

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: ReactNode;
}) {
  return <span className={`pi-pill pi-pill--${tone}`}>{children}</span>;
}

/**
 * Status colour.
 *
 * Accent for open (something to do), green for resolved, red for spam. An
 * unrecognised status stays neutral rather than guessing — a new status showing
 * up grey is fine, showing up green is not.
 */
export function statusTone(status: string): PillTone {
  switch (status) {
    case "open":
      return "accent";
    case "resolved":
      return "success";
    case "spam":
      return "danger";
    default:
      return "neutral";
  }
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="pi-empty">
      <span className="pi-empty__title">{title}</span>
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
    <p className={tone === "warning" ? "pi-notice pi-notice--warning" : "pi-notice"}>
      {children}
    </p>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { title, detail, code, retryable } = inboxErrorGuidance(error);

  return (
    <div className="pi-error" role="alert">
      <span className="pi-error__title">
        <span className="pi-dot pi-dot--error" aria-hidden="true" />
        {title}
      </span>
      <p className="pi-error__body">{detail}</p>
      <div className="pi-header__actions">
        {onRetry && retryable && (
          <button type="button" className="pi-button" onClick={onRetry}>
            Try again
          </button>
        )}
        <span className="pi-error__code">{code}</span>
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="pi-skel pi-skel--row" />
      ))}
    </div>
  );
}

export function SkeletonBlocks({ blocks = 3 }: { blocks?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: blocks }, (_, index) => (
        <div key={index} className="pi-skel pi-skel--block" />
      ))}
    </div>
  );
}

/**
 * Colour for a delivery status.
 *
 * Green only for `sent`: a pending send is amber because it is unfinished, and
 * a failed one is red because a customer is waiting for something that never
 * left. Nothing here paints an unsent message in the colour of a sent one.
 */
export function deliveryTone(status: string): PillTone {
	switch (status) {
		case "sent":
			return "success";
		case "pending":
			return "warning";
		case "failed":
			return "danger";
		default:
			return "neutral";
	}
}

/* ------------------------------------------------------------ formatting -- */

/**
 * Dates in the admin's own locale, in the store's timezone.
 *
 * German formatting, matching the analytics dashboard: this admin is read by
 * the same people, and two date formats in one application is one too many.
 */
const LOCALE = "de-DE";

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

/** Compact form for the list: a time today, a date before that. */
export function formatListTime(iso: string | null, now = new Date()): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  return new Intl.DateTimeFormat(
    LOCALE,
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "2-digit", year: "2-digit" },
  ).format(parsed);
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
