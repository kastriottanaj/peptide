/**
 * Google Analytics 4, loaded only after explicit statistics consent.
 *
 * Deliberately not Google Consent Mode: that loads the tag up front and sends
 * cookieless pings before the visitor decides. Here nothing reaches Google
 * until consent is granted — no script tag, no request, no cookie.
 *
 * `PUBLIC_GA_MEASUREMENT_ID` is inlined at build time, so the storefront must be
 * rebuilt and redeployed after changing it. See docs/analytics.md.
 */
import { isGranted, onConsentChange } from "./consent";

const MEASUREMENT_ID: string = import.meta.env.PUBLIC_GA_MEASUREMENT_ID ?? "";

/**
 * Whether analytics is configured at all. Read in `.astro` frontmatter to
 * decide whether the consent dialog and its footer entry point render: with no
 * tracking on the page there is nothing to consent to, and offering the choice
 * anyway would be misleading.
 */
export const ANALYTICS_ENABLED = MEASUREMENT_ID !== "";

declare global {
	interface Window {
		dataLayer: unknown[];
	}
}

/**
 * Paths that are never measured, whatever the consent state.
 *
 * These carry order and cart identifiers in the URL. GA's default
 * `page_location` is the full current URL, so measuring `/bestellung?id=<order>`
 * would hand Google a reusable capability that reads the customer's email, full
 * address and order lines. Consent does not make that acceptable: the visitor
 * agreed to usage statistics, not to their order being identifiable to a third
 * party. Excluding the whole funnel also keeps cart contents out of GA.
 */
const UNMEASURED_PATH_PREFIXES = ["/warenkorb", "/kasse", "/bestellung"];

function isUnmeasuredPath(pathname: string): boolean {
	return UNMEASURED_PATH_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

/**
 * The page URL to report, with the query string and fragment removed.
 *
 * Defence in depth behind the path exclusion above: any page reached with a
 * tracking, search or identifier parameter would otherwise send it verbatim.
 */
function measuredLocation(): string {
	const { origin, pathname } = window.location;
	return `${origin}${pathname}`;
}

let injected = false;

function gtag(..._args: unknown[]): void {
	// The tag distinguishes a gtag command from a plain dataLayer event by the
	// pushed value being an `arguments` object — `[object Arguments]`. Pushing
	// the rest array instead looks like an event and the command is ignored, so
	// `_args` exists only to give this function a call signature.
	window.dataLayer.push(arguments);
}

function inject(id: string): void {
	if (injected) return;
	injected = true;

	window.dataLayer = window.dataLayer ?? [];
	gtag("js", new Date());
	// A bare `gtag("config", id)` reports the full URL including the query
	// string. Both overrides are needed: `page_location` for the initial
	// page_view, and the referrer so a link out of the checkout does not carry
	// an order id into the next page's report either.
	gtag("config", id, {
		page_location: measuredLocation(),
		page_referrer: "",
	});

	const script = document.createElement("script");
	script.async = true;
	script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
	document.head.appendChild(script);
}

/**
 * Google's documented kill switch. Once gtag.js has evaluated it cannot be
 * unloaded, so withdrawal within a page view relies on this flag to stop all
 * further transmission.
 */
function setDisableFlag(id: string, disabled: boolean): void {
	(window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = disabled;
}

/**
 * Delete the cookies GA sets. It writes them on the registrable domain
 * (`.peptideeinkaufen.de`), so expiring them on the exact host alone leaves them
 * in place — every parent domain has to be tried.
 */
function clearGaCookies(): void {
	const names = document.cookie
		.split(";")
		.map((pair) => pair.split("=")[0]?.trim() ?? "")
		.filter((name) => name === "_ga" || name.startsWith("_ga_"));

	if (names.length === 0) return;

	const parts = window.location.hostname.split(".");
	const scopes = [""];
	for (let i = 0; i < parts.length - 1; i++) {
		scopes.push(`; domain=.${parts.slice(i).join(".")}`);
	}

	for (const name of names) {
		for (const scope of scopes) {
			document.cookie = `${name}=; path=/; max-age=0${scope}`;
		}
	}
}

function apply(granted: boolean): void {
	if (granted) {
		setDisableFlag(MEASUREMENT_ID, false);
		inject(MEASUREMENT_ID);
	} else {
		setDisableFlag(MEASUREMENT_ID, true);
		clearGaCookies();
	}
}

/**
 * Wire GA to the current and future consent state. Safe to call on every page:
 * without a measurement ID, or without consent, it does nothing observable.
 */
export function initAnalytics(): void {
	if (!MEASUREMENT_ID) return;

	// On an excluded page nothing is ever injected, and the kill switch is set
	// so a tag loaded by anything else cannot transmit either. Consent changes
	// are deliberately not observed here: there is no state in which this page
	// becomes measurable.
	if (isUnmeasuredPath(window.location.pathname)) {
		setDisableFlag(MEASUREMENT_ID, true);
		return;
	}

	apply(isGranted("statistics"));
	onConsentChange((state) => apply(state.statistics));
}
