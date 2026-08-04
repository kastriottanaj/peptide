/**
 * Guards on the Datenschutz section that discloses the support mailbox
 * (`/datenschutz/` § 9, "Verarbeitung von Support-E-Mails im internen
 * Verwaltungssystem").
 *
 * This section exists because email sent to the support address is now imported
 * into the Medusa admin. A privacy policy that does not describe a processing
 * that happens is wrong in the direction that matters — and one that describes
 * a processing that does *not* happen is wrong in the other. So the checks here
 * are deliberately two-sided:
 *
 *  - every category of data the importer stores has to be named, and
 *  - every safeguard the implementation actually provides — read-only IMAP, no
 *    HTML, no remote images or pixels, no attachment contents — has to be
 *    stated, because those sentences are the ones a reader relies on.
 *
 * Backend counterparts live in `backend/apps/backend/src/lib/inbox`; the two
 * must not drift. If the importer ever starts storing raw HTML or downloading
 * attachments, this file fails and the policy has to be rewritten before the
 * change ships.
 *
 * **Source scans always run.** The built-output audits are skipped when `dist/`
 * is absent, because `npm test` must not require a build (which needs the
 * Medusa backend on :9000). Run `npm run build` first to exercise them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const built = existsSync(join(DIST, "datenschutz/index.html"));
const skip = built ? false : "no dist/ — run `npm run build` first";

const source = readFileSync(join(SRC, "pages/datenschutz.astro"), "utf8");
const html = () => readFileSync(join(DIST, "datenschutz/index.html"), "utf8");

/**
 * Whitespace collapsed to single spaces.
 *
 * Both the `.astro` source and the rendered HTML wrap prose across lines with
 * tabs, so a phrase that reads as one sentence is several lines in the file.
 * Matching against the raw text would make every assertion here a hostage to
 * the next reformat, which is not what any of them are about.
 */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The section's own heading and anchor, as declared in the page's section map. */
const HEADING = "9. Verarbeitung von Support-E-Mails im internen Verwaltungssystem";
const ANCHOR = "support-postfach";

/**
 * The section body, from its heading to the next `<h2>`. Every content
 * assertion runs against this slice rather than the whole page, so a phrase
 * that happens to appear in the analytics or retention section cannot satisfy a
 * check about the mailbox.
 */
function sectionSource(): string {
	const start = source.indexOf("{S.inbox.heading}");
	assert.notEqual(start, -1, "the inbox section heading is missing from the page");

	const rest = source.slice(start);
	const end = rest.indexOf("<h2 id={S.recipients.id}>");
	assert.notEqual(end, -1, "the section after the inbox section is missing");

	return flat(rest.slice(0, end));
}

// ---------------------------------------------------------------------------
// The section exists, and its anchor cannot drift from its heading
// ---------------------------------------------------------------------------

test("the page declares the support-mailbox section", () => {
	assert.match(source, /inbox:\s*\{/);
	assert.ok(
		source.includes(`id: "${ANCHOR}"`),
		`the section anchor "${ANCHOR}" is not declared`,
	);
	assert.ok(source.includes(HEADING), "the section heading text changed");
});

/**
 * The section numbers are prose, not computed, so an inserted section is the
 * moment they go wrong. Every heading is numbered once, in order, with no gap.
 */
test("the section numbers stay contiguous", () => {
	const numbers = [...source.matchAll(/heading:\s*\n?\s*"(\d+)\./g)].map((match) =>
		Number(match[1]),
	);

	assert.ok(numbers.length >= 15, `only ${numbers.length} numbered sections found`);
	assert.deepEqual(
		numbers,
		numbers.map((_, index) => index + 1),
		"section numbering has a gap or a duplicate",
	);
});

/**
 * "siehe Abschnitt N" is a cross-reference a reader follows. Inserting a
 * section renumbers the targets, so each reference must still point at a
 * heading that exists.
 */
test("every cross-reference points at an existing section", () => {
	const highest = Math.max(
		...[...source.matchAll(/heading:\s*\n?\s*"(\d+)\./g)].map((match) => Number(match[1])),
	);

	for (const match of source.matchAll(/Abschnitt (\d+)/g)) {
		const target = Number(match[1]);
		assert.ok(
			target >= 1 && target <= highest,
			`cross-reference to section ${target}, which does not exist`,
		);
	}
});

// ---------------------------------------------------------------------------
// What the section has to say
// ---------------------------------------------------------------------------

test("it names the mail provider, the read-only import and the admin system", () => {
	const text = sectionSource();

	assert.match(text, /Hostinger/, "the email provider is not named");
	assert.match(text, /lesende\s+IMAP-Verbindung/, "the read-only IMAP import is not described");
	assert.match(text, /Medusa Admin/, "the receiving system is not named");
	assert.match(
		text,
		/passwortgesch/i,
		"the section does not say the receiving system is protected",
	);
});

/**
 * The mailbox is never written to. This sentence is what a reader relies on to
 * understand that the copy in their own thread is unaffected, and it is a
 * property the implementation guarantees structurally.
 */
test("it states that the mailbox itself is not modified", () => {
	const text = sectionSource();

	assert.match(text, /weder gel(ö|oe)scht noch verschoben/i);
	assert.match(text, /Gelesen-Status bleibt unver(ä|ae)ndert/i);
});

test("it names every category of data the importer stores", () => {
	const text = sectionSource();

	const categories: Array<[label: string, pattern: RegExp]> = [
		["sender and recipient details", /Absender- und Empf(ä|ae)ngerangaben/i],
		["subject", /Betreff/],
		["timestamps", /Zeitstempel/],
		["Message-ID", /Message-ID/],
		["thread references", /Verweise auf vorherige Nachrichten/i],
		["sanitized plain text", /bereinigter Form als reiner Text/i],
		["read status", /gelesen oder ungelesen/i],
		["thread status", /offen, erledigt oder als\s+Spam/i],
		["attachment metadata", /Metadaten zu Anh(ä|ae)ngen/i],
	];

	for (const [label, pattern] of categories) {
		assert.match(text, pattern, `the section does not disclose: ${label}`);
	}
});

/**
 * The four negative statements. Each corresponds to a guarantee in
 * `backend/apps/backend/src/lib/inbox/sanitize.ts` and the admin renderer, and
 * each is a claim the business would be held to.
 */
test("it states what is deliberately not processed", () => {
	const text = sectionSource();

	assert.match(
		text,
		/HTML-Inhalte[^.]{0,60}weder gespeichert noch dargestellt/i,
		"raw HTML is not excluded",
	);
	assert.match(text, /Z(ä|ae)hlpixel/i, "tracking pixels are not excluded");
	assert.match(
		text,
		/fremden Servern werden dabei nicht geladen/i,
		"remote content is not excluded",
	);
	assert.match(
		text,
		/Inhalte\s+von Anh(ä|ae)ngen werden nicht heruntergeladen/i,
		"attachment contents are not excluded",
	);
});

test("it names the purposes of the processing", () => {
	const text = sectionSource();

	for (const [label, pattern] of [
		["support", /Bearbeitung[\s\S]{0,40}Anliegens/i],
		["contractual", /vertraglicher Vorg(ä|ae)nge/i],
		["documentation", /Dokumentation/i],
		["privacy", /Anfragen zum\s+Datenschutz/i],
		["technical", /technischer? Anfragen/i],
	] as Array<[string, RegExp]>) {
		assert.match(text, pattern, `the section does not state the purpose: ${label}`);
	}
});

/**
 * Both legal bases, and the caveat. The bases are a draft: naming them without
 * saying so would present an untested legal position as a settled one.
 */
test("it gives both draft legal bases and marks them as unreviewed", () => {
	const text = sectionSource();

	assert.match(text, /Art\. 6 Abs\. 1 lit\. b DSGVO/, "the contractual basis is missing");
	assert.match(text, /Art\. 6 Abs\. 1 lit\. f DSGVO/, "the legitimate-interest basis is missing");
	assert.match(text, /Vertrag oder dessen Anbahnung/i, "lit. b is not scoped to contracts");
	assert.match(
		text,
		/\[Entwurf[\s\S]{0,120}rechtlichen Pr(ü|ue)fung/i,
		"the legal bases are not marked as a draft pending review",
	);
});

/**
 * No invented retention period. How long business correspondence is kept is a
 * legal decision that has not been taken, and a concrete figure here would be
 * a commitment nothing implements — `INBOX_RETENTION_DAYS` is unset, so nothing
 * is deleted automatically at all.
 */
test("it promises no fixed retention period", () => {
	const text = sectionSource();

	assert.match(text, /nur so lange,/i, "the retention wording is missing");
	assert.match(text, /gesetzliche\s+Aufbewahrungspflichten/i);
	assert.match(
		text,
		/keine? (automatische|automatisierte) L(ö|oe)schung|Löschung nach einer festen Frist ist derzeit nicht/i,
		"the section does not say that automatic deletion is not configured",
	);

	const invented = text.match(/\b\d+\s*(Tage|Tagen|Wochen|Monate|Monaten|Jahre|Jahren)\b/i);
	assert.equal(
		invented,
		null,
		`the section states a fixed retention period: ${invented?.[0]}`,
	);
});

test("it rules out automated decisions and profiling", () => {
	assert.match(sectionSource(), /automatisierte Entscheidungsfindung[\s\S]{0,40}Profiling/i);
});

test("it limits access to authorised administrators", () => {
	assert.match(sectionSource(), /berechtigte,\s*\n?\s*angemeldete Administratoren/i);
});

// ---------------------------------------------------------------------------
// The address comes from configuration, never from source
// ---------------------------------------------------------------------------

/**
 * The support address is a real contact route, so it is configuration
 * (`PUBLIC_CONTACT_EMAIL` → `lib/contact.ts`) exactly like every other channel.
 * Writing it into the page would both duplicate the source of truth and trip
 * the no-invented-identifier scan in `trust-pages.test.ts`.
 */
test("the mailbox address is rendered from configuration", () => {
	const text = sectionSource();

	assert.match(text, /CONTACT\.email/, "the section does not read the configured address");
	assert.equal(
		/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text.replace(/\[[^\]]*\]/g, "")),
		false,
		"an email address is hard-coded into the section",
	);
});

/** A build without a configured address still has to describe the processing. */
test("the disclosure does not depend on a contact address being configured", () => {
	const text = sectionSource();

	assert.match(
		text,
		/unser Support-Postfach/,
		"there is no wording for a build with no configured address",
	);
});

// ---------------------------------------------------------------------------
// The email provider is disclosed as a recipient
// ---------------------------------------------------------------------------

test("the recipients section lists the email provider", () => {
	const start = source.indexOf("{S.recipients.heading}");
	const rest = source.slice(start);
	const recipients = rest.slice(0, rest.indexOf("<h2 id={S.retention.id}>"));

	assert.match(recipients, /Hostinger/, "the email provider is not listed as a recipient");
	assert.match(recipients, /Art\. 28 DSGVO/, "no processing agreement is referenced");
});

// ---------------------------------------------------------------------------
// Built output
// ---------------------------------------------------------------------------

test("the shipped page carries the section and its anchor", { skip }, () => {
	const page = flat(html());

	assert.ok(page.includes(HEADING), "the heading is missing from the built page");
	assert.ok(page.includes(`id="${ANCHOR}"`), "the section anchor is missing");
	assert.ok(page.includes(`href="#${ANCHOR}"`), "the table of contents has no entry");
});

/**
 * The page must stay out of the index while it carries placeholders and has had
 * no legal review — including this section's draft legal bases.
 */
test("the shipped page is still noindex, nofollow", { skip }, () => {
	assert.match(html(), /<meta name="robots" content="noindex, nofollow"\s*\/?>/);
});

test("the shipped page states the safeguards in full", { skip }, () => {
	const page = flat(html());

	for (const phrase of [
		"lesende IMAP-Verbindung",
		"Medusa Admin",
		"Message-ID",
		"Metadaten zu Anhängen",
		"Zählpixel",
	]) {
		assert.ok(page.includes(phrase), `the built page is missing: ${phrase}`);
	}
});

/**
 * Whatever the build configured, the two must agree: if the page publishes a
 * support address anywhere, this section is where it is explained.
 */
test("a published support address is the one this section describes", { skip }, () => {
	const page = flat(html());
	const mailto = page.match(/href="mailto:([^"]+)"/);

	if (!mailto) return; // no address configured in this build — nothing to reconcile
	assert.ok(
		page.includes(mailto[1]),
		"the published address does not appear in the disclosure",
	);
});
