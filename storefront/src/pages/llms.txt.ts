import type { APIRoute } from "astro";
import { SITE_NAME, absoluteUrl } from "../lib/site";
import {
	allStaticEntries,
	articleEntries,
	categoryEntries,
	productEntries,
	termEntries,
	type IndexedEntry,
} from "../lib/content-index";

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

const NOTES = [
	"Alle Preise in EUR inkl. deutscher Umsatzsteuer; Preise und Verfügbarkeit stehen auf der jeweiligen Produktseite.",
	"Die Inhalte im Bereich Wissen und Lexikon sind rein wissenschaftlicher Hintergrund. Sie enthalten keine Dosierungs- oder Anwendungshinweise und keine gesundheitsbezogenen Aussagen.",
];

/** Collapse a description to a single clean line — markdown lists hate newlines. */
function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function bullet(entry: IndexedEntry): string {
	const link = `- [${oneLine(entry.title)}](${absoluteUrl(entry.path)})`;
	return entry.description ? `${link}: ${oneLine(entry.description)}` : link;
}

function section(heading: string, entries: IndexedEntry[]): string[] {
	if (entries.length === 0) return [];
	return [`## ${heading}`, "", ...entries.map(bullet), ""];
}

export const GET: APIRoute = async () => {
	const [products, categories, articles, terms] = await Promise.all([
		productEntries(),
		categoryEntries(),
		articleEntries(),
		termEntries(),
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
		...section("Seiten", allStaticEntries()),
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
