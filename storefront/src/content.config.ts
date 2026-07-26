import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Editorial content. Two collections, mirroring the structure that worked on
 * peptidebestellung.de:
 *
 *   wissen  — long-form explainers, the primary organic-search entry point
 *   lexikon — short glossary definitions, one term per entry
 *
 * Both are German. Content is scientific background only: no dosing, no
 * administration guidance, no health claims — the catalogue is sold strictly
 * for laboratory research.
 */

const wissenCategories = [
	"grundlagen",
	"labor-praxis",
	"wirkstoffgruppen",
	"qualitaet",
] as const;

export const WISSEN_CATEGORY_LABELS: Record<
	(typeof wissenCategories)[number],
	string
> = {
	grundlagen: "Grundlagen",
	"labor-praxis": "Laborpraxis",
	wirkstoffgruppen: "Wirkstoffgruppen",
	qualitaet: "Qualität & Analytik",
};

const wissen = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/wissen" }),
	schema: z.object({
		title: z.string(),
		/** Overrides the <title>; falls back to `title` when absent. */
		metaTitle: z.string().optional(),
		metaDescription: z.string(),
		excerpt: z.string(),
		category: z.enum(wissenCategories),
		datePublished: z.coerce.date(),
		dateModified: z.coerce.date(),
		readingMinutes: z.number().int().positive(),
		relatedTerms: z.array(z.string()).default([]),
		/** Content awaiting expert review is kept out of the index. */
		draft: z.boolean().default(false),
	}),
});

const lexikon = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/lexikon" }),
	schema: z.object({
		/** The term itself, e.g. "Lyophilisat". */
		term: z.string(),
		/** Synonyms and abbreviations, used for the A–Z index and search. */
		aliases: z.array(z.string()).default([]),
		metaDescription: z.string(),
		/** One-sentence definition, shown in the index and used for JSON-LD. */
		summary: z.string(),
		researchArea: z.string().optional(),
		dateModified: z.coerce.date(),
		relatedTerms: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
	}),
});

export const collections = { wissen, lexikon };
