/**
 * Small DOM builders shared by the cart, checkout, confirmation and order
 * lookup pages.
 *
 * All four render line items from server data. Assembling those rows as
 * template strings and assigning them to `innerHTML` makes every product and
 * variant title an HTML injection point: the titles are free text edited in the
 * Medusa admin, so nothing upstream stops a tag reaching the browser, and the
 * order pages render them next to bank details. Building real elements and
 * setting `textContent` escapes by construction — a new field cannot silently
 * reintroduce the hole the way another `${…}` in a template string can.
 */

/** `document.createElement` with the text and class in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	text?: string,
	className?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (text !== undefined) node.textContent = text;
	if (className) node.className = className;
	return node;
}

/**
 * One "3× Semaglutid 10 mg — 149,00 €" row, shared by the checkout summary, the
 * order confirmation and the guest order lookup so the three cannot drift.
 */
export function summaryLine(line: {
	quantity?: number | null;
	title?: string | null;
	variantTitle?: string | null;
	/** Already formatted through `formatEur`. */
	price: string;
}): HTMLLIElement {
	const li = document.createElement("li");

	const label = el("span", `${line.quantity ?? 0}× ${line.title ?? ""} `);
	if (line.variantTitle) label.appendChild(el("em", line.variantTitle));

	li.append(label, el("span", line.price));
	return li;
}
