/**
 * Guards on the four trust pages: `/about/`, `/contact/`, `/datenschutz/` and
 * `/agb/`.
 *
 * Two kinds of check live here, and the split matters:
 *
 * 1. **Source scans**, which always run. These pin the rule that no company or
 *    legal identifier may be invented — a register number, VAT id, IBAN,
 *    street address, telephone number or email literal written into a page is a
 *    fabricated trust signal, and by the time it reaches `dist/` it is already
 *    a claim the business would be held to. Contact details are configuration
 *    (`lib/contact.ts`), never source.
 *
 * 2. **Built-output audits**, skipped when `dist/` is absent — `npm test` must
 *    not require a build (which needs the Medusa backend on :9000). Run
 *    `npm run build` first to exercise them. These pin what actually ships:
 *    one self-referencing canonical per page, `noindex` retained while
 *    placeholders remain, footer trust links answering 200 without a redirect,
 *    parseable structured data and exactly one Organization entity.
 *
 * `canonical-output.test.ts` and `links-output.test.ts` already cover the whole
 * site for canonicals and internal redirects. The overlap here is deliberate
 * and narrow: these four pages are the ones being rewritten, so a regression on
 * them should name them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(DIST);
const skip = built ? false : "no dist/ — run `npm run build` first";

/** The four routes this file governs, with the served path of each. */
const TRUST_PAGES = {
	about: { path: "/about/", file: "about/index.html", source: "pages/about.astro" },
	contact: { path: "/contact/", file: "contact/index.html", source: "pages/contact.astro" },
	privacy: {
		path: "/datenschutz/",
		file: "datenschutz/index.html",
		source: "pages/datenschutz.astro",
	},
	terms: { path: "/agb/", file: "agb/index.html", source: "pages/agb.astro" },
} as const;

const ALL = Object.values(TRUST_PAGES);
/** The two that are meant to be indexed, and the two that are not. */
const INDEXABLE = [TRUST_PAGES.about, TRUST_PAGES.contact];
const LEGAL = [TRUST_PAGES.privacy, TRUST_PAGES.terms];

const html = (page: (typeof ALL)[number]): string =>
	readFileSync(join(DIST, page.file), "utf8");

const source = (page: (typeof ALL)[number]): string =>
	readFileSync(join(SRC, page.source), "utf8");

// ---------------------------------------------------------------------------
// 1. No invented company or legal identifiers — source scan, always runs
// ---------------------------------------------------------------------------

/**
 * Shapes that only a real company record can supply. Each is a claim a reader
 * would act on, so none may be written into a page: they arrive from the
 * environment or they do not appear at all.
 *
 * `[Platzhalter]` markers are stripped before matching — a bracketed field is
 * the opposite of an invented one, and `[HRB / HRA-Nummer]` should not read as
 * a register number.
 */
const INVENTED_IDENTIFIERS: Array<[label: string, pattern: RegExp]> = [
	["a commercial register number", /\bHR[AB]\s*\d/i],
	["a VAT identification number", /\bDE\s?\d{9}\b/],
	["an IBAN", /\b[A-Z]{2}\d{2}[\sA-Z0-9]{12,32}\b/],
	["a BIC", /\b[A-Z]{4}DE[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/],
	["a German postcode with a town", /\b\d{5}\s+[A-ZÄÖÜ][a-zäöüß]{2,}/],
	["a street with a house number", /\b[A-ZÄÖÜ][a-zäöüß]+(?:straße|strasse|weg|allee|platz)\s+\d/i],
	["a telephone number", /(?:\+49|\b0\d{2,5})[\s/-]?\d{3,}/],
	["an email address", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i],
];

/** Remove bracketed placeholder markers, JSON-LD-free. */
function withoutPlaceholders(text: string): string {
	return text.replace(/\[[^\]]*\]/g, "");
}

for (const page of ALL) {
	test(`${page.path} hard-codes no company identifier`, () => {
		// Strip the leading block comment: it documents *why* fields are missing
		// and cites the checklist, which is prose about identifiers, not one.
		const body = withoutPlaceholders(source(page).replace(/^---[\s\S]*?^---/m, ""));
		const found = INVENTED_IDENTIFIERS.filter(([, pattern]) => pattern.test(body)).map(
			([label]) => `${page.source}: contains ${label}`,
		);

		assert.deepEqual(found, []);
	});
}

/**
 * Wording that asserts something about the operating company itself.
 *
 * `ORDERS_ENABLED` establishes exactly one fact: whether the shop takes orders.
 * It does not establish who runs the shop, whether a company exists, or what
 * stage of formation or registration it is in — so a notice derived from it may
 * not say any of that. The same goes for the Impressum: pointing at it is fine,
 * claiming the details it does not yet carry are already published is not.
 */
const UNSUPPORTED_COMPANY_CLAIMS: Array<[label: string, pattern: RegExp]> = [
	["a company-formation status", /in Gründung|gegründet|Firmengründung|in Formierung/i],
	["a shop-being-set-up status", /(shop|kontaktwege|unternehmen)[^.]{0,40}\b(wird|werden)\s+(gerade\s+|derzeit\s+)?eingerichtet/i],
	[
		"a claim that operator details are already published",
		/vollständige (Anbieterkennzeichnung|Postanschrift|Firmierung)|Anbieterkennzeichnung mit (Anschrift|Firmierung)/i,
	],
	["a claim about where the business operates", /Geschäftsbetrieb findet/i],
];

for (const page of ALL) {
	test(`${page.path} claims no company status the code cannot establish`, () => {
		const body = withoutPlaceholders(source(page).replace(/^---[\s\S]*?^---/m, ""));
		const found = UNSUPPORTED_COMPANY_CLAIMS.filter(([, pattern]) => pattern.test(body)).map(
			([label]) => `${page.source}: asserts ${label}`,
		);

		assert.deepEqual(found, []);
	});
}

test("contact details are read from configuration, never written into a page", () => {
	// The mechanism the rule above depends on. If a page stops importing the
	// resolver, the next person to "just add the address" has nothing stopping
	// them.
	assert.match(source(TRUST_PAGES.contact), /from "\.\.\/lib\/company"/);
	assert.match(source(TRUST_PAGES.privacy), /from "\.\.\/lib\/company"/);
});

// ---------------------------------------------------------------------------
// 2. Built output
// ---------------------------------------------------------------------------

test("all four trust pages build", { skip }, () => {
	const missing = ALL.filter((page) => !existsSync(join(DIST, page.file))).map(
		(page) => page.path,
	);

	assert.deepEqual(missing, []);
});

test("each trust page has exactly one H1, with the expected wording", { skip }, () => {
	const expected: Array<[(typeof ALL)[number], string]> = [
		[TRUST_PAGES.about, "Über uns"],
		[TRUST_PAGES.contact, "Kontakt"],
		[TRUST_PAGES.privacy, "Datenschutzerklärung"],
		[TRUST_PAGES.terms, "Allgemeine Geschäftsbedingungen"],
	];

	for (const [page, heading] of expected) {
		const headings = [...html(page).matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) =>
			match[1].replace(/<[^>]*>/g, "").trim(),
		);

		assert.equal(headings.length, 1, `${page.path}: expected one <h1>, got ${headings.length}`);
		assert.equal(headings[0], heading, `${page.path}: unexpected H1`);
	}
});

test("headings on each trust page descend without skipping a level", { skip }, () => {
	for (const page of ALL) {
		const levels = [...html(page).matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
		const jumps: string[] = [];

		for (let i = 1; i < levels.length; i++) {
			if (levels[i] > levels[i - 1] + 1) {
				jumps.push(`${page.path}: h${levels[i - 1]} followed by h${levels[i]}`);
			}
		}

		assert.deepEqual(jumps, []);
	}
});

test("each trust page declares exactly one canonical, self-referencing and slashed", { skip }, () => {
	for (const page of ALL) {
		const canonicals = [...html(page).matchAll(/<link rel="canonical" href="([^"]*)"/g)].map(
			(match) => match[1],
		);

		assert.equal(canonicals.length, 1, `${page.path}: expected one canonical`);

		const url = new URL(canonicals[0]);
		assert.equal(url.pathname, page.path, `${page.path}: canonical points elsewhere`);
		assert.ok(url.pathname.endsWith("/"), `${page.path}: canonical lost its trailing slash`);
		assert.equal(url.search, "", `${page.path}: canonical carries a query`);
	}
});

/** The visible text of a page's `<main>`, tags and entities removed. */
function mainText(page: (typeof ALL)[number]): string {
	const main = html(page).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
	assert.ok(main, `${page.path}: no <main>`);
	return main[1]
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ");
}

test("REGRESSION: no indexable page shows a placeholder or a bracketed legal field", { skip }, () => {
	// `/contact/` used to ship "[Platzhalter – bitte echte E-Mail-Adresse
	// ergänzen]" on a public, crawlable page. Legal drafts may carry markers —
	// they are noindex — but an indexable page may not.
	const leaking: string[] = [];

	for (const page of INDEXABLE) {
		const text = mainText(page);
		if (/platzhalter/i.test(text)) leaking.push(`${page.path}: renders "Platzhalter"`);
		for (const match of text.matchAll(/\[[^\]]{3,80}\]/g)) {
			leaking.push(`${page.path}: bracketed field ${match[0]}`);
		}
	}

	assert.deepEqual(leaking, []);
});

test("REGRESSION: no indexable page asserts a company-formation status", { skip }, () => {
	// The built-output counterpart to the source scan above: whichever branch of
	// `ORDERS_ENABLED` or `CONTACT` this build took, the rendered text may not
	// claim a company status.
	const leaking: string[] = [];

	for (const page of INDEXABLE) {
		const text = mainText(page);
		for (const [label, pattern] of UNSUPPORTED_COMPANY_CLAIMS) {
			if (pattern.test(text)) leaking.push(`${page.path}: asserts ${label}`);
		}
	}

	assert.deepEqual(leaking, []);
});

test("no page ships an empty contact link", { skip }, () => {
	// `mailto:` / `tel:` with nothing after the scheme is what an unguarded
	// template produces when the value is missing.
	const empty: string[] = [];

	for (const page of ALL) {
		for (const match of html(page).matchAll(/href="(mailto:|tel:)\s*"/gi)) {
			empty.push(`${page.path}: ${match[1]}`);
		}
	}

	assert.deepEqual(empty, []);
});

test("About and Kontakt stay indexable", { skip }, () => {
	for (const page of INDEXABLE) {
		assert.doesNotMatch(
			html(page),
			/<meta name="robots"[^>]*noindex/i,
			`${page.path}: unexpectedly noindex`,
		);
	}
});

/**
 * The legal pages were made indexable on 2026-08-15 by owner decision, while
 * they still carry placeholders, so that they are filled in in public.
 *
 * That reverses what the two tests below used to assert, so they now pin the
 * half of the rule that still holds. The half that is gone — "a placeholder
 * implies noindex" — is replaced by an explicit, enumerated exception: these
 * four routes and no others. A fifth page cannot join them by accident, which
 * is the failure mode the original test existed for.
 */
const INDEXABLE_WITH_PLACEHOLDERS = new Set(["/datenschutz/", "/agb/"]);

test("REGRESSION: the legal pages keep their draft banner", { skip }, () => {
	// What survived the 2026-08-15 decision. Indexing was relaxed; telling the
	// reader the text is not final was not. A page carrying a `[Platzhalter]`
	// that reads as finished legal text is the mistake this now pins — see
	// "the legal pages still mark every field that is genuinely missing" below
	// for the fields themselves.
	for (const page of LEGAL) {
		assert.match(
			html(page),
			/Noch nicht rechtsverbindlich/,
			`${page.path}: lost its draft banner`,
		);
	}
});

test("REGRESSION: only the agreed pages are indexable with placeholders", { skip }, () => {
	// Stated as the general rule plus a closed exception list, so a new page
	// that renders a `.todo` marker is still covered the day it is added.
	const leaking = ALL.filter((page) => {
		if (INDEXABLE_WITH_PLACEHOLDERS.has(page.path)) return false;
		const markup = html(page);
		const hasPlaceholder = /class="todo\b/.test(markup) || /\[Platzhalter/.test(markup);
		const noindex = /<meta name="robots"[^>]*noindex/i.test(markup);
		return hasPlaceholder && !noindex;
	}).map((page) => `${page.path}: renders a placeholder but is indexable`);

	assert.deepEqual(leaking, []);
});

test("the legal pages still mark every field that is genuinely missing", { skip }, () => {
	// The other direction: a rewrite must not quietly delete a placeholder
	// instead of filling it. These fields have no source in the repository (see
	// docs/launch-data-needed.md), so each must still be visibly outstanding.
	//
	// The controller's own Firmierung and Anschrift were removed from this list
	// on 2026-08-15 — deliberately, not by deletion. They are now supplied by
	// PUBLIC_COMPANY_* and rendered through `lib/legal-entity.ts`, which falls
	// back to the same `[…]` markers when a value is unset. Asserting the marker
	// here would now fail on a correctly configured build, which is the opposite
	// of what this test is for. What replaces the guard: "contact details are
	// read from configuration, never written into the page" below, plus the
	// hard-coded-identifier scan at the top of this file, which together forbid
	// the only dangerous version of this change — writing the company into
	// source. The third-party names below stay: none of them is configurable.
	const required: Array<[(typeof ALL)[number], string[]]> = [
		[
			TRUST_PAGES.privacy,
			[
				"Versanddienstleister",
				// The processor's own address, and the Art. 27 DSGVO representative
				// the non-EU controller still has to appoint.
				"Vollständige Anschrift der Hetzner Online GmbH",
				"Art. 27",
			],
		],
		// `[Firmierung` left this list on 2026-08-15 for the same reason it left
		// the privacy list: AGB § 1 now names the provider from PUBLIC_COMPANY_*.
		// What stays are the two genuinely unanswered questions — the VAT
		// treatment that waits on §3, and the Gerichtsstand clause that waits on
		// the same B2B/B2C decision.
		[TRUST_PAGES.terms, ["Umsatzsteuer", "Gerichtsstand"]],
	];

	for (const [page, fields] of required) {
		const markup = html(page);
		const dropped = fields.filter((field) => !markup.includes(field));
		assert.deepEqual(dropped, [], `${page.path}: placeholder removed without replacement`);
	}

	for (const page of LEGAL) {
		assert.match(
			html(page),
			/Noch nicht rechtsverbindlich/,
			`${page.path}: lost the draft banner`,
		);
	}
});

test("the legal pages carry a table of contents whose anchors all resolve", { skip }, () => {
	for (const page of LEGAL) {
		const markup = html(page);
		const anchors = [...markup.matchAll(/<a href="#([^"]+)"/g)].map((match) => match[1]);

		assert.ok(anchors.length >= 8, `${page.path}: expected a table of contents`);

		const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
		const dangling = anchors.filter((anchor) => !ids.has(anchor));

		assert.deepEqual(dangling, [], `${page.path}: table of contents points at nothing`);
	}
});

test("no trust page ships an empty or icon-only link", { skip }, () => {
	for (const page of ALL) {
		const empty = [...html(page).matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
			.filter((match) => {
				const inner = match[1];
				const text = inner.replace(/<[^>]*>/g, "").replace(/\s|&nbsp;/g, "");
				if (text.length > 0) return false;
				// An image or SVG carrying its own accessible name is fine.
				return !/aria-label=|<img[^>]+alt="[^"]+"/i.test(match[0] + inner);
			})
			.map((match) => `${page.path}: ${match[0].slice(0, 80)}`);

		assert.deepEqual(empty, []);
	}
});

// ---------------------------------------------------------------------------
// Contact page specifics
// ---------------------------------------------------------------------------

test("the contact page ships no form, because nothing would receive it", { skip }, () => {
	// There is no form endpoint in a static build and no mail transport in the
	// backend (docs/go-live-checklist.md §6). A form here would accept a message
	// and drop it — worse than none, because the customer believes they wrote in.
	// The site search form is rendered into every page by BaseLayout, so it is
	// the one form allowed to appear.
	const forms = [...html(TRUST_PAGES.contact).matchAll(/<form\b[^>]*>/gi)].map(
		(match) => match[0],
	);

	const unexpected = forms.filter((form) => !/action="\/produkte\/"/.test(form));
	assert.deepEqual(unexpected, [], "contact page grew a form with no backend");
});

test("every mailto and tel link on a trust page is well formed", { skip }, () => {
	const bad: string[] = [];

	for (const page of ALL) {
		for (const match of html(page).matchAll(/href="(mailto:|tel:)([^"]*)"/gi)) {
			const [, scheme, value] = match;
			if (scheme.toLowerCase() === "mailto:") {
				if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value)) {
					bad.push(`${page.path}: mailto:${value}`);
				}
			} else if (!/^\+?\d{3,}$/.test(value)) {
				bad.push(`${page.path}: tel:${value}`);
			}
		}
	}

	assert.deepEqual(bad, []);
});

test("external links on a trust page keep their origin and open safely", { skip }, () => {
	for (const page of ALL) {
		for (const tag of html(page).matchAll(/<a\b[^>]*href="(https?:\/\/[^"]*)"[^>]*>/gi)) {
			assert.match(tag[1], /^https:\/\//, `${page.path}: insecure external link ${tag[1]}`);
			if (/target="_blank"/i.test(tag[0])) {
				assert.match(
					tag[0],
					/rel="[^"]*noopener/i,
					`${page.path}: _blank link without rel=noopener`,
				);
			}
		}
	}
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Every path the built output answers with 200. */
function servedPaths(): Set<string> {
	const files: string[] = [];
	const walk = (dir: string, prefix = "") => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) walk(join(dir, entry.name), rel);
			else files.push(rel);
		}
	};
	walk(DIST);

	return new Set(
		files.map((file) => {
			if (file === "index.html") return "/";
			if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
			return `/${file}`;
		}),
	);
}

test("every footer trust link resolves directly, with no redirect", { skip }, () => {
	// The footer is rendered into every page, so one slashless href here is one
	// internal redirect per page on the site.
	const EXPECTED = [
		"/about/",
		"/contact/",
		"/impressum/",
		"/datenschutz/",
		"/agb/",
		"/widerruf/",
	];

	const served = servedPaths();
	const markup = html(TRUST_PAGES.about);

	for (const route of EXPECTED) {
		assert.ok(served.has(route), `${route} does not answer 200`);
		assert.ok(
			markup.includes(`href="${route}"`) || markup.includes(`href="${route}#`),
			`${route} is not linked from the footer`,
		);
	}
});

test("no internal link on a trust page needs a redirect", { skip }, () => {
	const served = servedPaths();
	const broken: string[] = [];

	for (const page of ALL) {
		for (const match of html(page).matchAll(/<a\b[^>]*href="(\/[^"]*)"/gi)) {
			const path = match[1].split("#")[0].split("?")[0];
			if (path === "") continue;
			if (!served.has(path)) broken.push(`${page.path}: ${match[1]}`);
		}
	}

	assert.deepEqual(broken, []);
});

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

function graphOf(page: (typeof ALL)[number]): Record<string, unknown>[] {
	const raw = html(page).match(
		/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/,
	);
	assert.ok(raw, `${page.path}: no JSON-LD block`);

	const parsed = JSON.parse(raw[1]) as { "@graph"?: Record<string, unknown>[] };
	assert.ok(Array.isArray(parsed["@graph"]), `${page.path}: JSON-LD has no @graph`);
	return parsed["@graph"];
}

test("structured data parses on every trust page", { skip }, () => {
	for (const page of ALL) assert.ok(graphOf(page).length > 0);
});

test("REGRESSION: no page introduces a second Organization entity", { skip }, () => {
	// `Seo.astro` emits the Organization node on every page and everything else
	// references it by @id. A page that restates it produces two entities with
	// the same identity, which is the duplicate this pattern exists to prevent.
	for (const page of ALL) {
		const graph = graphOf(page);

		const organizations = graph.filter((node) => node["@type"] === "Organization");
		assert.equal(
			organizations.length,
			1,
			`${page.path}: ${organizations.length} Organization nodes`,
		);

		const identified = graph.filter((node) => node["@id"]);
		const ids = new Set(identified.map((node) => node["@id"]));
		assert.equal(ids.size, identified.length, `${page.path}: two nodes share an @id`);
	}
});

test("About and Kontakt declare the page types that describe them", { skip }, () => {
	const expected: Array<[(typeof ALL)[number], string]> = [
		[TRUST_PAGES.about, "AboutPage"],
		[TRUST_PAGES.contact, "ContactPage"],
	];

	for (const [page, type] of expected) {
		const graph = graphOf(page);
		const node = graph.find((entry) => entry["@type"] === type);
		assert.ok(node, `${page.path}: no ${type} node`);

		// It must describe the one Organization entity, by reference.
		const organization = graph.find((entry) => entry["@type"] === "Organization")!;
		assert.deepEqual(
			node!.about,
			{ "@id": organization["@id"] },
			`${page.path}: ${type} does not reference the Organization`,
		);

		assert.ok(
			graph.some((entry) => entry["@type"] === "BreadcrumbList"),
			`${page.path}: no BreadcrumbList`,
		);
	}
});

test("structured-data URLs match the page canonical", { skip }, () => {
	for (const page of INDEXABLE) {
		const canonical = html(page).match(/<link rel="canonical" href="([^"]*)"/)![1];
		const node = graphOf(page).find((entry) =>
			["AboutPage", "ContactPage"].includes(String(entry["@type"])),
		)!;

		assert.equal(node.url, canonical, `${page.path}: JSON-LD url differs from the canonical`);
	}
});

// ---------------------------------------------------------------------------
// Mobile structure
// ---------------------------------------------------------------------------

test("nothing on a trust page is pinned to a width a phone cannot show", { skip }, () => {
	const offenders: string[] = [];

	for (const page of ALL) {
		const markup = html(page);

		// An inline pixel width is the one thing a media query cannot rescue.
		for (const match of markup.matchAll(/style="[^"]*width:\s*(\d+)px/gi)) {
			if (Number(match[1]) > 320) offenders.push(`${page.path}: inline width ${match[1]}px`);
		}

		// A table cannot reflow, so it has to scroll inside its own box.
		for (const match of markup.matchAll(/<table\b/gi)) {
			const before = markup.slice(Math.max(0, match.index! - 200), match.index!);
			if (!/class="[^"]*table-scroll/.test(before)) {
				offenders.push(`${page.path}: <table> outside a scroll container`);
			}
		}
	}

	assert.deepEqual(offenders, []);
});
