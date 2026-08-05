import type { APIRoute } from "astro";
import { SITE_NAME, absoluteUrl, canonicalUrl } from "../lib/site";
import {
	allStaticEntries,
	articleEntries,
	categoryEntries,
	coaCheckerEntries,
	productEntries,
	termEntries,
	type IndexedEntry,
} from "../lib/content-index";
import { WEBMCP_TOOL_LIST } from "../lib/webmcp-tools";

/**
 * `/llms.txt` — the llmstxt.org map of the site for language models.
 *
 * Built from the same `content-index.ts` functions as the sitemaps, so a new
 * product or article shows up here for exactly the same reason it shows up
 * there: no separate list to maintain.
 *
 * This is a map, not a corpus. The full text of the editorial content lives in
 * `/llms-full.txt`.
 */

const SUMMARY =
	"Onlineshop für Forschungspeptide mit dokumentierter Reinheit und definierten " +
	"Packgrößen. Alle Produkte sind ausschließlich für wissenschaftliche und " +
	"laborinterne Forschungszwecke bestimmt — nicht für die Anwendung am Menschen " +
	"oder am Tier.";

/**
 * The currency is stated because `formatEur` establishes it. The tax treatment
 * is not, and is not replaced by a different claim either: the
 * Kleinunternehmer question is open (docs/go-live-checklist.md §3), so AGB § 4
 * still carries a placeholder. A file that tells language models prices are
 * gross would be the one asserting an answer nobody has made.
 */
const NOTES = [
	"Alle Preise in EUR. Preise und Verfügbarkeit stehen auf der jeweiligen Produktseite.",
	"Die Inhalte im Bereich Wissen und Lexikon sind rein wissenschaftlicher Hintergrund. Sie enthalten keine Dosierungs- oder Anwendungshinweise und keine gesundheitsbezogenen Aussagen.",
];

/** Collapse a description to a single clean line — markdown lists hate newlines. */
function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function bullet(entry: IndexedEntry): string {
	const link = `- [${oneLine(entry.title)}](${canonicalUrl(entry.path)})`;
	return entry.description ? `${link}: ${oneLine(entry.description)}` : link;
}

function section(heading: string, entries: IndexedEntry[]): string[] {
	if (entries.length === 0) return [];
	return [`## ${heading}`, "", ...entries.map(bullet), ""];
}

export const GET: APIRoute = async () => {
	const [products, categories, articles, terms, coaChecker] = await Promise.all([
		productEntries(),
		categoryEntries(),
		articleEntries(),
		termEntries(),
		// Empty while no analysis document is linked, from the same predicate that
		// makes `/coa-pruefen/` noindex. A map for language models should not point
		// at a lookup page that can only answer "nothing linked".
		coaCheckerEntries(),
	]);

	const body = [
		`# ${SITE_NAME}`,
		"",
		`> ${oneLine(SUMMARY)}`,
		"",
		...NOTES.map((note) => `- ${oneLine(note)}`),
		"",
		...section("Produkte", products),
		...section("Kategorien", categories),
		...section("Wissen", articles),
		...section("Lexikon", terms),
		...section("Seiten", [...allStaticEntries(), ...coaChecker]),
		// Read from the same descriptors the page registers, so this list cannot
		// promise a tool that does not exist.
		"## Agent Tools Available",
		"",
		"Diese Seite registriert WebMCP-Werkzeuge (https://developer.chrome.com/docs/ai/webmcp).",
		"In einem Browser ohne WebMCP-Unterstützung stehen sie nicht zur Verfügung.",
		"",
		...WEBMCP_TOOL_LIST.map((tool) => `- \`${tool.name}\`: ${oneLine(tool.description)}`),
		"",
		"## Kontakt",
		"",
		`- [Kontaktseite](${canonicalUrl("/contact")}): Kontaktwege für Fragen zu Sortiment und Bestellungen.`,
		"",
		"## Optional",
		"",
		`- [Vollständiger Inhalt als Text](${absoluteUrl("/llms-full.txt")}): alle Wissens- und Lexikonartikel im Volltext.`,
		`- [Sitemap](${absoluteUrl("/sitemap.xml")}): maschinenlesbarer Index aller Seiten.`,
		"",
	].join("\n");

	return new Response(body, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
