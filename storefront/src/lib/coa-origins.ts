/**
 * The origins a linked analysis document may be served from.
 *
 * Derived from the two origins this deployment already knows — the Medusa
 * backend that stores uploaded files and the site itself — rather than a second
 * hard-coded list that would drift from `.env` the first time a domain changes.
 *
 * Kept apart from `coa-documents.ts` on purpose: that module is pure and is
 * imported by `node --test`, which has no `import.meta.env`. Anything that
 * reads the environment lives here, and the allowlist is passed into the
 * resolver as an argument.
 *
 * `https:` only, so a local `http://localhost:9000` backend contributes no
 * origin at all. That is the intended behaviour: a document must never be
 * linked over plaintext, and a dev build should not be able to produce output a
 * production build would reject.
 */

import { SITE_URL } from "./site";

function httpsOrigin(value: string | undefined): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? url.origin : null;
	} catch {
		return null;
	}
}

/**
 * Exact origins accepted by `isAllowedDocumentUrl`. Order is irrelevant;
 * duplicates are removed so the same origin configured twice cannot look like
 * two independent permissions.
 */
export function allowedDocumentOrigins(): string[] {
	const origins = [
		httpsOrigin(import.meta.env.PUBLIC_MEDUSA_BACKEND_URL),
		httpsOrigin(SITE_URL),
	].filter((origin): origin is string => origin !== null);

	return [...new Set(origins)];
}
