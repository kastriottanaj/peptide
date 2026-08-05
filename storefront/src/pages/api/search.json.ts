import type { APIRoute } from "astro";
import { canonicalUrl } from "../../lib/site";
import { foldSearchText } from "../../lib/search";
import { listProducts } from "../../lib/catalog";
import { BUILD_DATE } from "../../lib/build-time";
import {
	allStaticEntries,
	articleEntries,
	allCategoryEntries,
	termEntries,
	type IndexedEntry,
} from "../../lib/content-index";

/**
 * The search index behind the WebMCP `search_site` tool.
 *
 * IMPORTANT: the storefront builds to static output, so this endpoint is
 * prerendered to one fixed file. A query string on it does nothing: there is no
 * server left at runtime to read `?q=`. The whole index therefore ships in one
 * response and the caller filters it in the browser, which is the same shape
 * the on-page product and article filters already use.
 *
 * The index is small (tens of documents), so this is cheaper than any search
 * service would be. Revisit if the catalog grows past a few hundred products.
 *
 * `robots.txt` disallows `/api/`, which is correct and harmless here: crawlers
 * have no use for the index, and WebMCP fetches it from the page at runtime
 * rather than by crawling.
 */

export type SearchVariant = {
	id: string;
	title: string;
	price: string | null;
};

export type SearchDoc = {
	type: "produkt" | "kategorie" | "wissen" | "lexikon" | "seite";
	title: string;
	url: string;
	excerpt: string;
	/** Pre-folded haystack, so the client only has to fold the query. */
	search: string;
	handle?: string;
	purity?: string;
	variants?: SearchVariant[];
};

const formatPrice = (amount: number | null | undefined, currency: string) =>
	typeof amount === "number"
		? new Intl.NumberFormat("de-DE", {
				style: "currency",
				currency: currency.toUpperCase(),
			}).format(amount)
		: null;

/** Same ascending pack-size order the rest of the agent surfaces use. */
const packAmount = (title: string) => {
	const match = title.match(/^\s*([\d.,]+)/);
	return match ? Number(match[1].replace(",", ".")) : Number.POSITIVE_INFINITY;
};

const fromEntry = (type: SearchDoc["type"]) => (entry: IndexedEntry): SearchDoc => ({
	type,
	title: entry.title,
	url: canonicalUrl(entry.path),
	excerpt: entry.description ?? "",
	search: foldSearchText(
		[
			entry.title,
			entry.description ?? "",
			...(entry.keywords ?? []),
			entry.path.replace(/[/-]/g, " "),
		].join(" "),
	),
});

export const GET: APIRoute = async () => {
	const [products, categories, articles, terms] = await Promise.all([
		listProducts({ limit: 1000 }),
		allCategoryEntries(),
		articleEntries(),
		termEntries(),
	]);

	const productDocs: SearchDoc[] = products.map((product) => {
		const meta = (product.metadata ?? {}) as Record<string, unknown>;
		const purity = typeof meta.purity === "string" ? meta.purity : undefined;
		const researchCode =
			typeof meta.research_code === "string" ? meta.research_code : "";

		const variants: SearchVariant[] = (product.variants ?? [])
			.map((variant) => ({
				id: variant.id,
				title: variant.title?.trim() ?? "",
				price: formatPrice(
					variant.calculated_price?.calculated_amount,
					variant.calculated_price?.currency_code ?? "eur",
				),
			}))
			.filter((variant) => variant.id && variant.title)
			.sort((a, b) => packAmount(a.title) - packAmount(b.title));

		return {
			type: "produkt",
			title: product.title,
			url: canonicalUrl(`/produkte/${product.handle}`),
			excerpt: product.description?.trim() ?? "",
			search: foldSearchText(
				[
					product.title,
					product.handle ?? "",
					researchCode,
					product.description ?? "",
					purity ?? "",
					...(product.categories ?? []).map((category) => category.name),
					...variants.map((variant) => variant.title),
				].join(" "),
			),
			handle: product.handle ?? undefined,
			purity,
			variants,
		};
	});

	const body = {
		/** Build date, so a tool can tell the model how fresh the numbers are. */
		generated: BUILD_DATE,
		results: [
			...productDocs,
			...categories.map(fromEntry("kategorie")),
			...articles.map(fromEntry("wissen")),
			...terms.map(fromEntry("lexikon")),
			...allStaticEntries().map(fromEntry("seite")),
		],
	};

	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json; charset=utf-8" },
	});
};
