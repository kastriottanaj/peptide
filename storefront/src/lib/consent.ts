/**
 * Cookie / tracking consent — the single source of truth for the storefront.
 *
 * DSGVO and § 25 TTDSG both apply here: analytics is not required to run the
 * shop, so it may only start after an explicit opt-in. Nothing in this module
 * grants anything by default — `readConsent()` returns `null` until the visitor
 * actually decides, and `null` means "ask", never "allowed".
 *
 * The storage key carries the schema version rather than only the payload. A
 * shape change means bumping `CONSENT_VERSION`, which makes every stored
 * decision invisible to the reader and re-asks the visitor — the correct
 * outcome when what we are asking about has changed. Superseded keys are listed
 * in `LEGACY_KEYS` and swept on read so dead records do not pile up.
 *
 * Changes are announced as `consent:changed` on `window`, the same pattern the
 * cart uses, so consumers react without a framework.
 */

export const CONSENT_VERSION = 1;

const STORAGE_KEY = `pe_consent_v${CONSENT_VERSION}`;

/** Keys written by earlier versions of this module, deleted on read. */
const LEGACY_KEYS: readonly string[] = [];

export const CONSENT_CHANGED_EVENT = "consent:changed";
export const OPEN_CONSENT_EVENT = "consent:open";

/**
 * Only categories matching tracking actually present on the site may be
 * offered, so there is exactly one: `statistics` (Google Analytics 4).
 */
export type ConsentCategory = "statistics";

export interface ConsentState {
	version: number;
	/** ISO timestamp — the record of when the decision was given. */
	decidedAt: string;
	statistics: boolean;
}

/** The stored decision, or null when the visitor has not decided yet. */
export function readConsent(): ConsentState | null {
	let raw: string | null;
	try {
		for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
		raw = window.localStorage.getItem(STORAGE_KEY);
	} catch {
		return null; // private mode / storage disabled — ask every time
	}

	if (!raw) return null;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			(parsed as ConsentState).version !== CONSENT_VERSION ||
			typeof (parsed as ConsentState).statistics !== "boolean"
		) {
			return null; // wrong version or hand-edited — treat as undecided
		}

		const state = parsed as ConsentState;
		return {
			version: CONSENT_VERSION,
			decidedAt:
				typeof state.decidedAt === "string"
					? state.decidedAt
					: new Date(0).toISOString(),
			statistics: state.statistics,
		};
	} catch {
		return null; // truncated JSON
	}
}

/** Whether a decision exists at all. Drives whether the dialog opens. */
export function hasDecision(): boolean {
	return readConsent() !== null;
}

/** Whether a category is actively consented to. Absence of a decision is not consent. */
export function isGranted(category: ConsentCategory): boolean {
	return readConsent()?.[category] === true;
}

/** Record a decision and announce it. */
export function saveConsent(choice: Record<ConsentCategory, boolean>): ConsentState {
	const state: ConsentState = {
		version: CONSENT_VERSION,
		decidedAt: new Date().toISOString(),
		statistics: choice.statistics,
	};

	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Non-fatal: the choice still applies to this page view, and the visitor
		// is asked again next time — which errs towards not tracking.
	}

	window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: state }));
	return state;
}

export function onConsentChange(handler: (state: ConsentState) => void): void {
	window.addEventListener(CONSENT_CHANGED_EVENT, (event) => {
		handler((event as CustomEvent<ConsentState>).detail);
	});
}

/**
 * Reopen the dialog. The footer entry point calls this so a decision can always
 * be revisited, as a consent flow is required to allow.
 */
export function requestConsentDialog(): void {
	window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}
