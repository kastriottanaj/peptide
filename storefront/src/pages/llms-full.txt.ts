import type { APIRoute } from "astro";
import { SITE_NAME, canonicalUrl } from "../lib/site";
import { editorialBodies } from "../lib/content-index";
import { BUILD_DATE } from "../lib/build-time";

/**
 * `/llms-full.txt` — the full German text of every non-draft Wissen article and
 * Lexikon entry, in one document. This is the file a model actually ingests;
 * `/llms.txt` only points at URLs.
 *
 * Deliberately editorial-only. Prices and stock levels go stale between builds,
 * and the catalog is still placeholder data — a model quoting a fabricated
 * purity figure back at a customer is worse than it not knowing.
 */

const HEADINGS = {
	wissen: "Wissen",
	lexikon: "Lexikon",
} as const;

/**
 * Shift a body's own headings down one level so they nest under the `##` title
 * we give the document, instead of sitting beside it. Fenced code blocks are
 * skipped — a `#` inside one is a comment, not a heading.
 */
function demoteHeadings(markdown: string): string {
	let inFence = false;

	return markdown
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) return line;
			return line.replace(/^(#{1,5})(\s)/, "#$1$2");
		})
		.join("\n");
}

export const GET: APIRoute = async () => {
	const docs = await editorialBodies();

	const parts: string[] = [
		`# ${SITE_NAME} — Wissen und Lexikon im Volltext`,
		"",
		"> Fachlicher Hintergrund zu Forschungspeptiden. Keine Dosierungs- oder",
		"> Anwendungshinweise, keine gesundheitsbezogenen Aussagen. Alle Produkte sind",
		"> ausschließlich für Forschungszwecke bestimmt.",
		"",
		`Quelle: ${canonicalUrl("/")}`,
		`Stand: ${BUILD_DATE}`,
		"",
	];

	let currentKind: keyof typeof HEADINGS | null = null;

	for (const doc of docs) {
		if (doc.kind !== currentKind) {
			currentKind = doc.kind;
			parts.push("---", "", `# ${HEADINGS[currentKind]}`, "");
		}

		parts.push(
			`## ${doc.entry.title}`,
			"",
			`URL: ${canonicalUrl(doc.entry.path)}`,
			...doc.meta,
			"",
		);

		if (doc.entry.description) parts.push(`> ${doc.entry.description}`, "");

		parts.push(demoteHeadings(doc.body).trim(), "");
	}

	return new Response(parts.join("\n"), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
