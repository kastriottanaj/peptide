/**
 * Text folding shared by the build-time search haystacks and the client-side
 * filter that matches against them.
 *
 * The editorial content is German, so someone typing "qualitat" or "packgrosse"
 * should still reach "Qualität" and "Packgröße". Decomposing to NFD and dropping
 * the combining marks handles the umlauts; "ß" has no decomposition, so it is
 * folded explicitly.
 *
 * Both sides must fold identically — a haystack folded differently from the
 * query is a silent miss — which is why this lives here rather than in either
 * caller.
 */
export function foldSearchText(value: string): string {
	return value
		.toLowerCase()
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

/** Folded query terms; a match requires every term (AND), in any order. */
export function searchTerms(query: string): string[] {
	return foldSearchText(query).split(/\s+/).filter(Boolean);
}
