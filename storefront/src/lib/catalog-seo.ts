/**
 * Search-result metadata for the Medusa-backed routes: `/produkte/<handle>` and
 * `/kategorie/<handle>`.
 *
 * Every other route owns its metadata in the record that already controls it —
 * a page's own `BaseLayout` props, or the `metaTitle`/`metaDescription`
 * frontmatter of a `wissen`/`lexikon` entry. Product and category routes cannot:
 * their authoritative record lives in Medusa, and the storefront reads it at
 * build time. Editing a product in the admin to change a `<title>` would also
 * move the visible H1, the breadcrumb and the JSON-LD `name`, because those all
 * render from `product.title`.
 *
 * So this module holds the one thing Medusa has no field for — the title and
 * description written for the search result — keyed by the handle in the URL.
 * It feeds `<title>`, `<meta name="description">` and their OpenGraph/Twitter
 * counterparts, and nothing else: the JSON-LD `Product`/`CollectionPage` nodes
 * keep deriving from the Medusa record, so structured data still describes the
 * catalogue rather than the search snippet.
 *
 * A handle that is absent here falls back to the composed title and description
 * the route built before, brand suffix included — adding a product in the admin
 * never ships a page with no metadata.
 */

export interface RouteSeo {
	/** Complete `<title>`, used verbatim — no brand suffix is appended. */
	title: string;
	description: string;
}

/**
 * What a route hands to `BaseLayout`. `rawTitle` is true only when `title` came
 * from a curated record and is therefore already complete; the fallback path
 * returns false so the composed title still gets the ` | Peptide Einkaufen`
 * suffix it has always had.
 */
export interface ResolvedSeo extends RouteSeo {
	rawTitle: boolean;
}

export const PRODUCT_SEO: Record<string, RouteSeo> = {
	"bpc-157": {
		title: "BPC-157 5 mg & 10 mg für Forschung und Analyse",
		description:
			"BPC-157 als lyophilisiertes Forschungspeptid in 5 mg und 10 mg mit Angaben zu Reinheit und COA. Produktdetails ansehen!",
	},
	retatrutide: {
		title: "Retatrutide 5 mg, 10 mg & 15 mg für Laborforschung",
		description:
			"Retatrutide als lyophilisiertes Forschungspeptid für metabolische Modellforschung mit Angaben zu Reinheit und COA. Produktdetails ansehen!",
	},
	"ghk-cu": {
		title: "GHK-Cu 50 mg & 100 mg für Forschung und Analyse",
		description:
			"GHK-Cu als Kupfer-Peptid-Komplex für Forschungs- und Analysezwecke mit Angaben zu Reinheit, COA und Packgrößen. Produktdetails ansehen!",
	},
	"mots-c": {
		title: "MOTS-c 10 mg für metabolische Studienmodelle",
		description:
			"MOTS-c Forschungspeptid für metabolische Studienmodelle mit Angaben zu Reinheit, COA und Packgröße. Jetzt Produktdetails ansehen!",
	},
	semax: {
		title: "Semax 30 mg für Neuropeptid-Forschung und Analyse",
		description:
			"Semax als Forschungspeptid für Studien zu neuronalen Signalwegen mit Angaben zu Reinheit, COA und Packgröße. Produktdetails ansehen!",
	},
	"tb-500": {
		title: "TB-500 5 mg & 10 mg für Forschung und Analyse",
		description:
			"TB-500: Überblick zu Reinheit, COA, Packgrößen und ausschließlich laborbezogener Nutzung. Produktinformationen ansehen.",
	},
};

export const CATEGORY_SEO: Record<string, RouteSeo> = {
	"neuropeptid-forschung": {
		title: "Neuropeptid-Forschung kaufen: Semax 30 mg",
		description:
			"Informationen zu Forschungspeptiden, Reinheit und Zertifikaten – ausschließlich für Laboranalysen. Jetzt Produktdetails ansehen!",
	},
	regenerationsforschung: {
		title: "Regenerationsforschung: Peptide für Labor & Analyse",
		description:
			"Forschungspeptide für Regenerationsforschung mit Angaben zu Reinheit und Produktdetails – ausschließlich für Laborzwecke. Jetzt ansehen!",
	},
	"signal-fragmentpeptide": {
		title: "Signal- & Fragmentpeptide kaufen für die Forschung",
		description:
			"Signal- und Fragmentpeptide für Analyse- und Laborzwecke mit klaren Angaben zu Reinheit und Produktdetails. Kategorie ansehen!",
	},
	"stoffwechsel-forschung": {
		title: "Stoffwechsel-Forschung: Peptide für Labor & Analyse",
		description:
			"Forschungspeptide für Stoffwechsel-Forschung mit Angaben zu Reinheit und Produktdokumentation. Kategorie für Laborzwecke ansehen!",
	},
};

/**
 * Resolve the metadata for a handle, falling back to what the route composed
 * before. `fallback.title` is a composed string, so it keeps the brand suffix.
 */
function resolve(
	table: Record<string, RouteSeo>,
	handle: string | null | undefined,
	fallback: RouteSeo,
): ResolvedSeo {
	const curated = handle ? table[handle] : undefined;
	return curated
		? { ...curated, rawTitle: true }
		: { ...fallback, rawTitle: false };
}

export function productSeo(
	handle: string | null | undefined,
	fallback: RouteSeo,
): ResolvedSeo {
	return resolve(PRODUCT_SEO, handle, fallback);
}

export function categorySeo(
	handle: string | null | undefined,
	fallback: RouteSeo,
): ResolvedSeo {
	return resolve(CATEGORY_SEO, handle, fallback);
}
