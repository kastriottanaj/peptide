#!/usr/bin/env node
/**
 * IndexNow submission for peptideeinkaufen.de.
 *
 *   node scripts/indexnow-submit.mjs [--dry-run] [--all] [--state <file>] [--dist <dir>]
 *
 * Tells Bing, Yandex and the other IndexNow participants which URLs changed, so
 * they recrawl in minutes instead of whenever they get round to it. Google does
 * not consume IndexNow — its path stays Search Console plus the sitemaps.
 *
 * Runs against the BUILT OUTPUT, after a deploy has published it. Not during the
 * build: at that point the live site still serves the previous release, and
 * pinging then invites a crawl of exactly the content we are replacing.
 *
 * Every reason not to submit is a clean skip with exit 0 — a missing key, no
 * changes, an unreachable key file. A deploy must never fail because a search
 * engine is unreachable. Only a rejected submission (bad key, wrong host) exits
 * non-zero, because that is a real misconfiguration.
 *
 * See docs/indexnow.md.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STOREFRONT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://api.indexnow.org/indexnow";
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const BATCH_SIZE = 10_000;
const STATE_VERSION = 1;

const log = (...args) => console.log("[indexnow]", ...args);
/** A reason not to submit — expected, not a failure. */
const skip = (reason) => {
	log(`skipped: ${reason}`);
	process.exit(0);
};
const fail = (reason) => {
	console.error(`[indexnow] failed: ${reason}`);
	process.exit(1);
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const options = { dryRun: false, all: false, state: null, dist: null };

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--all") options.all = true;
		else if (arg === "--state") options.state = argv[++i];
		else if (arg === "--dist") options.dist = argv[++i];
		else if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node scripts/indexnow-submit.mjs [--dry-run] [--all] [--state <file>] [--dist <dir>]",
			);
			process.exit(0);
		} else fail(`unknown argument: ${arg}`);
	}

	if (options.state === undefined) fail("--state needs a path");
	if (options.dist === undefined) fail("--dist needs a directory");
	return options;
}

const options = parseArgs(process.argv.slice(2));
const DIST_DIR = resolve(options.dist ?? join(STOREFRONT_DIR, "dist"));
const STATE_FILE = resolve(options.state ?? join(STOREFRONT_DIR, ".indexnow-state.json"));

// ---------------------------------------------------------------------------
// Configuration
//
// Read the real environment first, then fill gaps from storefront/.env. Doing it
// in that order keeps an explicitly exported value authoritative regardless of
// how Node's own .env precedence happens to be defined.
// ---------------------------------------------------------------------------

const fromEnvironment = {
	INDEXNOW_KEY: process.env.INDEXNOW_KEY,
	PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
};

try {
	process.loadEnvFile(join(STOREFRONT_DIR, ".env"));
} catch {
	// No .env — the real environment is the only source, which is how the server runs it.
}

const key = (fromEnvironment.INDEXNOW_KEY ?? process.env.INDEXNOW_KEY ?? "").trim();

// Same fallback as src/lib/site.ts, for the same reason: a missing variable must
// not silently mean localhost.
const siteUrl = (
	fromEnvironment.PUBLIC_SITE_URL ??
	process.env.PUBLIC_SITE_URL ??
	"https://peptideeinkaufen.de"
).replace(/\/+$/, "");

if (!key) skip("INDEXNOW_KEY is not set (this is the off switch)");
if (!KEY_PATTERN.test(key)) fail("INDEXNOW_KEY is not 8-128 chars of [A-Za-z0-9-]");

let origin;
try {
	origin = new URL(siteUrl);
} catch {
	fail(`PUBLIC_SITE_URL is not a URL: ${siteUrl}`);
}

// A local build has nothing a crawler could fetch.
if (origin.protocol !== "https:") skip(`origin is ${origin.origin}, not https`);
if (!existsSync(DIST_DIR)) skip(`no build output at ${DIST_DIR} — run \`npm run build\` first`);

const keyLocation = `${origin.origin}/${key}.txt`;

// ---------------------------------------------------------------------------
// URLs, from the built sitemaps
//
// The sitemaps come from content-index.ts, the single inventory of what this
// site publishes. Reading them back means this script cannot drift from what
// shipped, and draft filtering stays in exactly one place. `sitemap.xml` is the
// index (it lists sitemaps, not pages) and carries no dash, so the pattern below
// skips it.
// ---------------------------------------------------------------------------

const unescapeXml = (value) =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

function sitemapUrls() {
	const files = readdirSync(DIST_DIR).filter((name) => /^sitemap-.+\.xml$/.test(name));
	if (files.length === 0) skip(`no sitemap-*.xml in ${DIST_DIR}`);

	const locs = new Set();
	for (const file of files) {
		const xml = readFileSync(join(DIST_DIR, file), "utf8");
		// Per <url> block, and only its first <loc> — the image extension nests an
		// <image:loc> that is an asset, not a page to submit.
		for (const block of xml.split("<url>").slice(1)) {
			const match = block.match(/<loc>([^<]*)<\/loc>/);
			if (match) locs.add(unescapeXml(match[1].trim()));
		}
	}
	return [...locs];
}

/**
 * The built file behind a URL. Astro writes directory indexes
 * (`/produkte/bpc-157` → `produkte/bpc-157/index.html`), with the other shapes
 * kept as fallbacks so a change of `build.format` does not silently turn every
 * page into "no file, cannot hash".
 */
function builtFile(pathname) {
	const relative = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "");
	const candidates = relative
		? [join(relative, "index.html"), `${relative}.html`, relative]
		: ["index.html"];

	for (const candidate of candidates) {
		const path = resolve(DIST_DIR, candidate);
		// Refuse anything that escapes dist — a sitemap is generated input, but a
		// path built from one still gets checked before it reaches the filesystem.
		if (!path.startsWith(`${DIST_DIR}/`)) continue;
		if (existsSync(path) && statSync(path).isFile()) return path;
	}
	return null;
}

const contentHash = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);

/**
 * Stand-in hash for a sitemap URL with no file in `dist` — an anomaly worth
 * reporting, but a stable value so such a URL is submitted once and then treated
 * as unchanged instead of being resubmitted on every deploy.
 */
const NO_FILE = "no-built-file";

const published = new Map();
const foreign = [];

for (const loc of sitemapUrls()) {
	let url;
	try {
		url = new URL(loc);
	} catch {
		foreign.push(loc);
		continue;
	}

	// IndexNow rejects the whole batch (422) if one URL is off-host.
	if (url.origin !== origin.origin) {
		foreign.push(loc);
		continue;
	}

	const file = builtFile(url.pathname);
	published.set(loc, file ? contentHash(file) : NO_FILE);
}

if (foreign.length > 0) {
	log(`ignoring ${foreign.length} URL(s) not on ${origin.origin}: ${foreign.slice(0, 3).join(", ")}`);
}

const unbuilt = [...published].filter(([, hash]) => hash === NO_FILE).map(([loc]) => loc);
if (unbuilt.length > 0) {
	log(`warning: ${unbuilt.length} sitemap URL(s) have no file in dist: ${unbuilt.slice(0, 3).join(", ")}`);
}
if (published.size === 0) skip("the sitemaps list no URLs on this origin");

// ---------------------------------------------------------------------------
// What changed
//
// Hashing the built HTML rather than trusting <lastmod>: the pages and category
// sitemaps put build time in lastmod, so every deploy would look like a change to
// every page — and IndexNow asks for changed URLs only. The bytes answer the
// actual question.
// ---------------------------------------------------------------------------

function readState() {
	if (options.all || !existsSync(STATE_FILE)) return {};
	try {
		const state = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		if (state.version !== STATE_VERSION) return {};
		// A different host means a different site; its hashes say nothing about this one.
		if (state.host && state.host !== origin.host) return {};
		return state.urls ?? {};
	} catch (error) {
		log(`state file unreadable (${error.message}) — treating everything as changed`);
		return {};
	}
}

const previous = readState();

const changed = [...published.entries()]
	.filter(([loc, hash]) => previous[loc] !== hash)
	.map(([loc]) => loc);

/**
 * URLs that were published before, are no longer in a sitemap, and have no file
 * in `dist` either: genuinely gone. Submitting them gets the 404 seen and the
 * entry dropped from the index. A URL that merely left the sitemap while its page
 * still exists is left alone — that is a crawl-priority decision, not a deletion.
 */
const removed = Object.keys(previous).filter((loc) => {
	if (published.has(loc)) return false;
	try {
		const url = new URL(loc);
		return url.origin === origin.origin && builtFile(url.pathname) === null;
	} catch {
		return false;
	}
});

const urlList = [...changed, ...removed];

log(`${published.size} published, ${changed.length} changed, ${removed.length} removed`);
if (urlList.length === 0) skip("nothing changed since the last submission");

// ---------------------------------------------------------------------------
// Preflight: is the key file publicly readable?
//
// The one thing IndexNow authenticates on. If Bing cannot fetch this file it
// rejects the submission, so a failure here means there is nothing to do and no
// state to write: a key rotated in .env but not yet deployed, or a site put back
// behind basic auth.
// ---------------------------------------------------------------------------

async function keyFileServed() {
	let response;
	try {
		response = await fetch(keyLocation, {
			headers: { "User-Agent": "peptideeinkaufen-indexnow/1.0" },
			signal: AbortSignal.timeout(10_000),
		});
	} catch (error) {
		return `cannot reach ${keyLocation} (${error.message})`;
	}

	if (response.status === 401 || response.status === 403) {
		return `${keyLocation} returned ${response.status} — the site is asking for credentials, so a crawler cannot fetch it either`;
	}
	if (response.status === 404) {
		return `${keyLocation} returned 404 — the key file is not deployed; set INDEXNOW_KEY on the server and deploy`;
	}
	if (!response.ok) return `${keyLocation} returned ${response.status}`;

	const body = (await response.text()).trim();
	if (body !== key) {
		return `${keyLocation} does not contain the key — is the current build deployed?`;
	}
	return null;
}

if (options.dryRun) {
	log(`dry run — would submit ${urlList.length} URL(s) to ${ENDPOINT}:`);
	for (const url of urlList.slice(0, 20)) log(`  ${url}`);
	if (urlList.length > 20) log(`  … and ${urlList.length - 20} more`);
	const problem = await keyFileServed();
	log(problem ? `preflight would skip: ${problem}` : `preflight OK: ${keyLocation} serves the key`);
	process.exit(0);
}

const problem = await keyFileServed();
if (problem) skip(problem);

// ---------------------------------------------------------------------------
// Submit
//
// api.indexnow.org shares a submission with every participating engine, so Bing
// and Yandex need no separate calls.
// ---------------------------------------------------------------------------

const STATUS_HINTS = {
	400: "invalid request body",
	403: "key rejected — the key file does not match the submitted key",
	422: "URLs do not belong to the host, or the key does not match the schema",
	429: "too many requests — back off and try the next deploy",
};

async function submit(batch) {
	const response = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"User-Agent": "peptideeinkaufen-indexnow/1.0",
		},
		body: JSON.stringify({ host: origin.host, key, keyLocation, urlList: batch }),
		signal: AbortSignal.timeout(30_000),
	});

	// 202 is success with key validation still pending, per the protocol.
	if (response.status === 200 || response.status === 202) return;
	const hint = STATUS_HINTS[response.status] ?? (await response.text()).slice(0, 200);
	throw new Error(`HTTP ${response.status} — ${hint}`);
}

const batches = [];
for (let i = 0; i < urlList.length; i += BATCH_SIZE) batches.push(urlList.slice(i, i + BATCH_SIZE));

let submitted = 0;
try {
	for (const [index, batch] of batches.entries()) {
		await submit(batch);
		submitted += batch.length;
		log(`batch ${index + 1}/${batches.length}: ${batch.length} URL(s) accepted`);
	}
} catch (error) {
	// State is not written, so the next deploy retries these URLs.
	fail(`${error.message} (${submitted} of ${urlList.length} URL(s) submitted)`);
}

// ---------------------------------------------------------------------------
// Record what was submitted. Only reached when every batch was accepted, so a
// partial failure cannot leave URLs marked as done.
// ---------------------------------------------------------------------------

const urls = {};
for (const [loc, hash] of published) urls[loc] = hash;

writeFileSync(
	STATE_FILE,
	`${JSON.stringify({ version: STATE_VERSION, host: origin.host, updatedAt: new Date().toISOString(), urls }, null, 2)}\n`,
);

log(`submitted ${submitted} URL(s); state written to ${STATE_FILE}`);
