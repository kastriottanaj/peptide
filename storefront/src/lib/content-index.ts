/**
 * The inventory of everything this site publishes, independent of output
 * format.
 *
 * Both the sitemaps and `/llms.txt` are built from these functions, so there is
 * exactly one place that decides which URLs exist and which are withheld. Add a
 * product in Medusa or drop a markdown file into `src/content/` and it reaches
 * every surface on the next build without a second edit.
 *
 * Draft filtering happens here and nowhere else — a `draft: true` entry cannot
 * leak into one surface while being hidden from another.
 */

import { getCollection } from "astro:content";
import type { HttpTypes } from "@medusajs/types";
import { absoluteUrl, canonicalUrl } from "./site";
import { listCategories, listProductsInSourceOrder } from "./catalog";
import { WISSEN_CATEGORY_LABELS } from "../content.config";
import type { ChangeFrequency, SitemapImage, SitemapUrl } from "./sitemap";
import { buildDate } from "./build-time";

export type IndexedEntry = {
	/** Site-relative path, e.g. `/produkte/bpc-157`. */
	path: string;
	title: string;
	/** One line, plain text. Used by llms.txt; ignored by the sitemap. */
	description?: string;
	/**
	 * Extra terms that should match in search but do not belong in the visible
	 * title or description: aliases, abbreviations, category labels. A glossary
	 * term is looked up by its abbreviation far more often than by its headword.
	 */
	keywords?: string[];
	lastModified?: Date;
	changeFrequency: ChangeFrequency;
	priority: number;
	images?: SitemapImage[];
};

/**
 * Adapt an entry for the XML sitemap, resolving the path to an absolute URL.
 *
 * `<loc>` uses the canonical form, so a sitemap URL is the same URL the page
 * canonicalises to and returns 200 rather than a redirect. Image locations stay
 * on `absoluteUrl` — they are files, not pages.
 */
export function toSitemapUrl(entry: IndexedEntry): SitemapUrl {
	return {
		loc: canonicalUrl(entry.path),
		lastModified: entry.lastModified,
		changeFrequency: entry.changeFrequency,
		priority: entry.priority,
		images: entry.images,
	};
}

/**
 * Hand-maintained, unlike the rest of this module: a static page has no source
 * record to derive a title or a priority from. Add new indexable static routes
 * here.
 *
 * The legal pages (/impressum, /datenschutz, /agb, /widerruf) are deliberately
 * absent: they still carry the `draft` flag and therefore `noindex`, and
 * listing a noindex URL in a sitemap is a contradictory signal. Add them here
 * at priority 0.2 once they are final.
 */
const STATIC_ROUTES: Array<Omit<IndexedEntry, "lastModified">> = [
	{
		path: "/",
		title: "Peptide kaufen – Forschungspeptide für Labor und Wissenschaft",
		description:
			"Forschungspeptide mit dokumentierter Reinheit und Packgrößen für wissenschaftliche und laborinterne Zwecke.",
		changeFrequency: "daily",
		priority: 1,
	},
	{
		path: "/produkte",
		title: "Alle Produkte",
		description: "Vollständiger Katalog aller verfügbaren Forschungspeptide.",
		changeFrequency: "daily",
		priority: 0.95,
	},
	{
		path: "/wissen",
		title: "Wissen",
		description:
			"Fachartikel zu Grundlagen, Laborpraxis, Wirkstoffgruppen sowie Qualität und Analytik.",
		changeFrequency: "weekly",
		priority: 0.7,
	},
	{
		path: "/wissen/lexikon",
		title: "Peptid-Lexikon",
		description: "A–Z-Glossar der Fachbegriffe rund um Forschungspeptide.",
		changeFrequency: "weekly",
		priority: 0.7,
	},
	{
		path: "/peptid-rechner",
		title: "Peptid-Rechner",
		description:
			"Rechner für Rekonstitution und Aliquotierung: Konzentration in mcg/ml, Volumen pro Aliquot und U-100-Units.",
		keywords: ["Rechner", "Rekonstitution", "Aliquot", "U-100", "mcg/ml"],
		changeFrequency: "monthly",
		priority: 0.75,
	},
	{
		path: "/about",
		title: "Über uns",
		description:
			"Wer den Shop betreibt, wofür die Forschungspeptide bestimmt sind und wie Bestellung, Zahlung und Versand ablaufen.",
		keywords: ["Über uns", "Anbieter", "Grundsätze", "Bestellablauf"],
		changeFrequency: "monthly",
		priority: 0.5,
	},
	{
		path: "/faq",
		title: "Häufige Fragen",
		description:
			"Antworten zu Verwendungszweck, Produktangaben, Analysedaten, Bestellstatus, Versand, Zahlung und Support.",
		keywords: ["FAQ", "Häufige Fragen", "Antworten", "Hilfe"],
		changeFrequency: "monthly",
		priority: 0.6,
	},
	{
		path: "/contact",
		title: "Kontakt",
		description:
			"Kontaktwege, Bestellsupport sowie die Bedingungen zu Versand und Zahlung.",
		keywords: ["Kontakt", "Support", "Versand", "Zahlung", "Versandkosten"],
		changeFrequency: "monthly",
		priority: 0.45,
	},
];

/**
 * `/wissen` and `/wissen/lexikon` live in STATIC_ROUTES so llms.txt can list
 * them alongside their entries, but each is emitted by the editorial sitemap
 * that carries the entries below it rather than by the pages sitemap. Keeping
 * them out of the pages sitemap avoids the same URL appearing in two sitemaps.
 */
const WISSEN_INDEX_PATH = "/wissen";
const LEXIKON_INDEX_PATH = "/wissen/lexikon";
const EDITORIAL_INDEX_PATHS = new Set([WISSEN_INDEX_PATH, LEXIKON_INDEX_PATH]);

const withTimestamp = (
	routes: Array<Omit<IndexedEntry, "lastModified">>,
	lastModified: Date,
): IndexedEntry[] => routes.map((route) => ({ ...route, lastModified }));

/** Static routes belonging to the pages sitemap (everything but the editorial indexes). */
export function staticEntries(lastModified = buildDate()): IndexedEntry[] {
	return withTimestamp(
		STATIC_ROUTES.filter((route) => !EDITORIAL_INDEX_PATHS.has(route.path)),
		lastModified,
	);
}

/**
 * An editorial index page, dated from the newest entry listed on it: the index
 * changes exactly when its newest entry does. Build time would not be a
 * modification date, and shipping no `lastmod` at all is the weakest possible
 * crawl signal — which is what these would get otherwise, coming from the
 * hand-maintained static routes with no date of their own to contribute.
 */
function editorialIndexEntries(path: string, listed: IndexedEntry[]): IndexedEntry[] {
	const times = listed
		.map((entry) => entry.lastModified?.getTime())
		.filter((time): time is number => time !== undefined);
	const newest = times.length ? new Date(Math.max(...times)) : undefined;

	return STATIC_ROUTES.filter((route) => route.path === path).map((route) => ({
		...route,
		lastModified: newest,
	}));
}

/** The `/wissen` index page, emitted by the wissen sitemap above its articles. */
export function wissenIndexEntries(articles: IndexedEntry[]): IndexedEntry[] {
	return editorialIndexEntries(WISSEN_INDEX_PATH, articles);
}

/** The `/wissen/lexikon` index page, emitted by the lexikon sitemap above its terms. */
export function lexikonIndexEntries(terms: IndexedEntry[]): IndexedEntry[] {
	return editorialIndexEntries(LEXIKON_INDEX_PATH, terms);
}

/** Every static route, in declaration order — what llms.txt enumerates. */
export function allStaticEntries(lastModified = buildDate()): IndexedEntry[] {
	return withTimestamp(STATIC_ROUTES, lastModified);
}

export async function categoryEntries(
	lastModified = buildDate(),
): Promise<IndexedEntry[]> {
	const categories = await listCategories();
	return categories.map((category) => ({
		path: `/kategorie/${category.handle}`,
		title: category.name ?? category.handle,
		description: category.description?.trim() || undefined,
		lastModified,
		changeFrequency: "weekly" as const,
		priority: 0.7,
	}));
}

/**
 * Pack sizes come from the "Packgröße" variants; the variant title carries the
 * size (e.g. `10 mg`). Sorted smallest first — Medusa returns them in creation
 * order, which reads as arbitrary. Titles without a leading number keep their
 * relative order at the end. Prices are deliberately left out: they change
 * between builds and the catalog is still placeholder data.
 */
function packSizes(product: HttpTypes.StoreProduct): string[] {
	const amount = (title: string) => {
		const match = title.match(/^\s*([\d.,]+)/);
		return match ? Number(match[1].replace(",", ".")) : Number.POSITIVE_INFINITY;
	};

	return (product.variants ?? [])
		.map((variant) => variant.title?.trim())
		.filter((title): title is string => Boolean(title))
		.sort((a, b) => amount(a) - amount(b));
}

export async function productEntries(): Promise<IndexedEntry[]> {
	const products = await listProductsInSourceOrder({ limit: 1000 });

	return products.map((product) => {
		const meta = (product.metadata ?? {}) as Record<string, unknown>;
		const purity = typeof meta.purity === "string" ? meta.purity : null;

		// The sitemap caption prefers the product's own prose; the llms.txt
		// description prefers the hard attributes, which is what a model needs.
		const caption =
			product.description?.trim() ||
			[product.title, purity ? `${purity} Reinheit` : null]
				.filter(Boolean)
				.join(" – ");

		const sizes = packSizes(product);
		const description =
			[
				purity ? `${purity} Reinheit` : null,
				sizes.length ? `Packgrößen: ${sizes.join(", ")}` : null,
			]
				.filter(Boolean)
				.join(" · ") || undefined;

		return {
			path: `/produkte/${product.handle}`,
			title: product.title,
			description,
			lastModified: product.updated_at
				? new Date(product.updated_at)
				: buildDate(),
			changeFrequency: "weekly" as const,
			priority: 0.9,
			images: product.thumbnail
				? [{ loc: absoluteUrl(product.thumbnail), title: product.title, caption }]
				: [],
		};
	});
}

/** Non-draft Wissen articles, newest first. */
export async function articleEntries(): Promise<IndexedEntry[]> {
	const articles = await getCollection("wissen", ({ data }) => !data.draft);

	return articles
		.sort((a, b) => b.data.datePublished.getTime() - a.data.datePublished.getTime())
		.map((article) => ({
			path: `/wissen/${article.id}`,
			title: article.data.title,
			description: article.data.excerpt,
			keywords: [
				WISSEN_CATEGORY_LABELS[article.data.category],
				article.data.metaDescription,
			],
			lastModified: article.data.dateModified,
			changeFrequency: "monthly" as const,
			priority: 0.6,
		}));
}

/** Non-draft Lexikon terms, sorted the way the A–Z index sorts them. */
export async function termEntries(): Promise<IndexedEntry[]> {
	const terms = await getCollection("lexikon", ({ data }) => !data.draft);

	return terms
		.sort((a, b) => a.data.term.localeCompare(b.data.term, "de"))
		.map((term) => ({
			path: `/wissen/lexikon/${term.id}`,
			title: term.data.term,
			description: term.data.summary,
			keywords: [
				...term.data.aliases,
				term.data.researchArea ?? "",
				term.data.metaDescription,
			],
			lastModified: term.data.dateModified,
			changeFrequency: "monthly" as const,
			priority: 0.5,
		}));
}

/**
 * Full text of the editorial content, for `/llms-full.txt`. Separate from
 * `articleEntries`/`termEntries` because loading every body is wasteful for the
 * consumers that only need URLs.
 */
export async function editorialBodies(): Promise<
	Array<{ kind: "wissen" | "lexikon"; entry: IndexedEntry; meta: string[]; body: string }>
> {
	const [articles, terms] = await Promise.all([
		getCollection("wissen", ({ data }) => !data.draft),
		getCollection("lexikon", ({ data }) => !data.draft),
	]);

	const articleDocs = articles
		.sort((a, b) => b.data.datePublished.getTime() - a.data.datePublished.getTime())
		.map((article) => ({
			kind: "wissen" as const,
			entry: {
				path: `/wissen/${article.id}`,
				title: article.data.title,
				description: article.data.excerpt,
				lastModified: article.data.dateModified,
				changeFrequency: "monthly" as const,
				priority: 0.6,
			},
			meta: [
				`Kategorie: ${WISSEN_CATEGORY_LABELS[article.data.category]}`,
				`Aktualisiert: ${article.data.dateModified.toISOString().slice(0, 10)}`,
			],
			body: article.body ?? "",
		}));

	const termDocs = terms
		.sort((a, b) => a.data.term.localeCompare(b.data.term, "de"))
		.map((term) => ({
			kind: "lexikon" as const,
			entry: {
				path: `/wissen/lexikon/${term.id}`,
				title: term.data.term,
				description: term.data.summary,
				lastModified: term.data.dateModified,
				changeFrequency: "monthly" as const,
				priority: 0.5,
			},
			meta: [
				...(term.data.aliases.length
					? [`Synonyme: ${term.data.aliases.join(", ")}`]
					: []),
				...(term.data.researchArea ? [`Bereich: ${term.data.researchArea}`] : []),
				`Aktualisiert: ${term.data.dateModified.toISOString().slice(0, 10)}`,
			],
			body: term.body ?? "",
		}));

	return [...articleDocs, ...termDocs];
}
