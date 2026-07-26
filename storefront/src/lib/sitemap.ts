/**
 * Sitemap rendering. The storefront serves a sitemap index pointing at
 * per-type sitemaps (pages, products) rather than one flat file, so each
 * content type carries its own changefreq/priority and can grow independently.
 *
 * Product entries include the Google image sitemap extension — image search is
 * a real traffic source for this catalog.
 */

export type ChangeFrequency =
	| "always"
	| "hourly"
	| "daily"
	| "weekly"
	| "monthly"
	| "yearly"
	| "never";

export type SitemapImage = {
	loc: string;
	title?: string;
	caption?: string;
};

export type SitemapUrl = {
	loc: string;
	lastModified?: Date | string;
	changeFrequency?: ChangeFrequency;
	priority?: number;
	images?: SitemapImage[];
};

/** Static routes with their crawl hints. Add new indexable pages here. */
export const staticRoutes: Array<{
	path: string;
	changeFrequency: ChangeFrequency;
	priority: number;
}> = [
	{ path: "/", changeFrequency: "daily", priority: 1 },
	{ path: "/produkte", changeFrequency: "daily", priority: 0.95 },
	{ path: "/about", changeFrequency: "monthly", priority: 0.5 },
	{ path: "/contact", changeFrequency: "monthly", priority: 0.45 },
	// The legal pages (/impressum, /datenschutz, /agb, /widerruf) are
	// deliberately absent: they still carry the `draft` flag and therefore
	// `noindex`, and listing a noindex URL in a sitemap is a contradictory
	// signal. Add them here at priority 0.2 once they are final.
];

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function toW3cDate(value: Date | string): string {
	const date = value instanceof Date ? value : new Date(value);
	return date.toISOString();
}

function renderUrl(entry: SitemapUrl): string {
	const parts = [`<loc>${escapeXml(entry.loc)}</loc>`];
	if (entry.lastModified) parts.push(`<lastmod>${toW3cDate(entry.lastModified)}</lastmod>`);
	if (entry.changeFrequency) parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
	if (typeof entry.priority === "number") parts.push(`<priority>${entry.priority}</priority>`);

	for (const image of entry.images ?? []) {
		const imageParts = [`<image:loc>${escapeXml(image.loc)}</image:loc>`];
		if (image.title) imageParts.push(`<image:title>${escapeXml(image.title)}</image:title>`);
		if (image.caption) imageParts.push(`<image:caption>${escapeXml(image.caption)}</image:caption>`);
		parts.push(`<image:image>${imageParts.join("")}</image:image>`);
	}

	return `<url>${parts.join("")}</url>`;
}

export function renderUrlset(entries: SitemapUrl[]): string {
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
		`xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">` +
		`${entries.map(renderUrl).join("")}</urlset>`
	);
}

export function renderSitemapIndex(
	sitemaps: Array<{ loc: string; lastModified?: Date | string }>,
): string {
	const body = sitemaps
		.map(({ loc, lastModified }) => {
			const lastmod = lastModified ? `<lastmod>${toW3cDate(lastModified)}</lastmod>` : "";
			return `<sitemap><loc>${escapeXml(loc)}</loc>${lastmod}</sitemap>`;
		})
		.join("");
	return (
		`<?xml version="1.0" encoding="UTF-8"?>` +
		`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
		`${body}</sitemapindex>`
	);
}

export const xmlResponse = (body: string) =>
	new Response(body, {
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
