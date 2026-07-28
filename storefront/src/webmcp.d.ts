/**
 * WebMCP declarative form attributes.
 *
 * `toolname`, `tooldescription` and `toolparamdescription` are lowercase HTML
 * attributes read by agentic browsers, not part of the HTML standard, so
 * Astro's JSX typings reject them until they are declared here.
 * See https://developer.chrome.com/docs/ai/webmcp
 */
declare namespace astroHTML.JSX {
	interface FormHTMLAttributes {
		/** Tool name the form is exposed as, e.g. `search_site_form`. */
		toolname?: string;
		/** What calling the form does, in one sentence. */
		tooldescription?: string;
	}

	interface InputHTMLAttributes {
		/** What this field expects, in one sentence. */
		toolparamdescription?: string;
	}

	interface SelectHTMLAttributes {
		toolparamdescription?: string;
	}

	interface TextareaHTMLAttributes {
		toolparamdescription?: string;
	}
}
