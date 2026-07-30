import type { APIRoute, GetStaticPaths } from "astro";

/**
 * The IndexNow key file: `https://<host>/<key>.txt`, containing exactly the key.
 *
 * That file is how the protocol proves whoever submits URLs controls the host,
 * which is why the key is the *filename* — hence a dynamic route whose only
 * param is the key itself. It is public by design and not a secret (see
 * docs/indexnow.md); the variable is unprefixed only because no browser code
 * needs it, and Astro exposes unprefixed variables to build-time code.
 *
 * Astro gives static routes priority over dynamic ones, so this cannot shadow
 * `robots.txt`, `llms.txt` or `llms-full.txt`.
 */

/** The protocol's charset: 8–128 characters of a-z, A-Z, 0-9 and dashes. */
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

const rawKey = (import.meta.env.INDEXNOW_KEY ?? process.env.INDEXNOW_KEY ?? "").trim();

/**
 * Unset is a complete off switch, matching `PUBLIC_GA_MEASUREMENT_ID`: no file,
 * and `scripts/indexnow-submit.mjs` skips for the same reason.
 *
 * A malformed key is refused rather than emitted. Serving it would produce a URL
 * the API later rejects with a 403 that gives no hint where the bad value came
 * from — far cheaper to fail here, where the cause is on screen.
 */
export const getStaticPaths: GetStaticPaths = () => {
	if (!rawKey) return [];

	if (!KEY_PATTERN.test(rawKey)) {
		console.warn(
			`[indexnow] INDEXNOW_KEY is not 8-128 chars of [A-Za-z0-9-] — no key file emitted.`,
		);
		return [];
	}

	return [{ params: { indexnowKey: rawKey } }];
};

export const GET: APIRoute = ({ params }) =>
	new Response(params.indexnowKey ?? "", {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
