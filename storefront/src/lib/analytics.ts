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
	gtag("config", id);

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

	apply(isGranted("statistics"));
	onConsentChange((state) => apply(state.statistics));
}
