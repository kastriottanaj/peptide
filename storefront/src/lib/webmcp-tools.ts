/**
 * WebMCP tool descriptors: name, description and input schema for every tool
 * the storefront registers with an agentic browser.
 * See https://developer.chrome.com/docs/ai/webmcp
 *
 * The descriptors live here rather than inside the component because two places
 * need them: `WebMCPTools.astro`, which attaches an `execute` function to each,
 * and `llms.txt`, which advertises the list to models that never run our
 * JavaScript. Keeping one definition means the advertised tools and the
 * registered tools cannot drift apart.
 *
 * Descriptions are written in English because they are read by the model, not
 * by the customer. Everything a tool *returns* is German, like the rest of the
 * storefront.
 */

export type WebMcpToolDescriptor = {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, Record<string, unknown>>;
		required?: string[];
	};
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

export const WEBMCP_TOOLS = {
	search_site: {
		name: "search_site",
		description:
			"Search this peptide shop by keyword and return matching products, " +
			"knowledge-base articles and glossary entries with title, URL and a short " +
			"summary. Matches German text with or without umlauts, so 'packgrosse' " +
			"finds 'Packgröße'.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"Keyword or phrase, plain text. A product name, a research code such " +
						"as BPC-157, or a topic such as Lagerung.",
				},
				type: {
					type: "string",
					enum: ["alle", "produkt", "kategorie", "wissen", "lexikon", "seite"],
					description: "Restrict results to one content type. Defaults to alle.",
					default: "alle",
				},
				limit: {
					type: "integer",
					description: "Maximum number of results, default 5, maximum 10.",
					default: 5,
				},
			},
			required: ["query"],
		},
		annotations: { readOnlyHint: true },
	},

	get_product_details: {
		name: "get_product_details",
		description:
			"Get the purity, available pack sizes, prices and variant identifiers for " +
			"one product, addressed by its handle or its name. Use the returned " +
			"variant_id to add a specific pack size to the cart.",
		inputSchema: {
			type: "object",
			properties: {
				product: {
					type: "string",
					description:
						"Product handle such as bpc-157, or the product name such as BPC-157.",
				},
			},
			required: ["product"],
		},
		annotations: { readOnlyHint: true },
	},

	add_to_cart: {
		name: "add_to_cart",
		description:
			"Add one pack size of a product to the shopping cart and return the new " +
			"cart contents. Call get_product_details first to obtain the variant_id " +
			"for the wanted pack size. Confirm the pack size with the customer before " +
			"calling this.",
		inputSchema: {
			type: "object",
			properties: {
				variant_id: {
					type: "string",
					description:
						"The variant identifier of the pack size, as returned by " +
						"get_product_details.",
				},
				quantity: {
					type: "integer",
					description: "Number of units to add, default 1, maximum 20.",
					default: 1,
				},
			},
			required: ["variant_id"],
		},
		annotations: { readOnlyHint: false, destructiveHint: false },
	},
} as const satisfies Record<string, WebMcpToolDescriptor>;

/**
 * The declarative form in the header carries these attributes. It is listed
 * alongside the scripted tools in llms.txt so the advertised set is complete.
 */
export const WEBMCP_FORM_TOOL = {
	name: "search_site_form",
	description:
		"Submit the site search form to load the product listing filtered by a keyword.",
} as const;

export const WEBMCP_TOOL_LIST: ReadonlyArray<{ name: string; description: string }> = [
	...Object.values(WEBMCP_TOOLS).map(({ name, description }) => ({
		name,
		description,
	})),
	WEBMCP_FORM_TOOL,
];

/**
 * `navigator.modelContext` is not in lib.dom yet. Declared narrowly: only the
 * surface we actually call, so a future official type cannot silently disagree
 * with a broad guess.
 */
declare global {
	interface ModelContextTool {
		name: string;
		description: string;
		inputSchema: unknown;
		annotations?: Record<string, boolean>;
		execute: (input: Record<string, never>) => Promise<string> | string;
	}

	interface Navigator {
		modelContext?: {
			registerTool: (tool: ModelContextTool) => void;
			getTools?: () => Promise<unknown[]>;
		};
	}
}
