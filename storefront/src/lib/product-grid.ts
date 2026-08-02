/**
 * How many product cards in a `.grid` listing are inside the first viewport.
 *
 * `/produkte/` and `/kategorie/<handle>/` lay their cards out with the same
 * `repeat(auto-fill, minmax(220px, 1fr))` grid, so they agree on this or they
 * drift. It exists as a constant rather than a literal in two files because it
 * is the classification an image's `loading` attribute is derived from, and a
 * test asserts against it.
 *
 * ## Where the number comes from
 *
 * The grid sits in the 1120 px container with 1.5 rem of side padding and a
 * 1.4 rem gap, which fits four 220 px columns and not five. Measured in a
 * browser against the built pages, the first row starts ~80 px below the
 * viewport top at 1366×900 — fully visible — so those four images must not be
 * lazy-loaded. Everything after them is the second row or lower.
 *
 * On a 390 px viewport the grid collapses to one column, so cards two to four
 * are just below the fold rather than in it. They stay eager anyway: a browser's
 * lazy-loading threshold would fetch them immediately at that distance, and the
 * alternative — a viewport-dependent attribute — cannot be expressed in static
 * HTML.
 */
export const EAGER_CARD_COUNT = 4;

/**
 * Whether the card at `index` of a listing grid should load eagerly.
 *
 * Takes the index rather than being inlined so that a page which renders the
 * same grid somewhere below the fold (the homepage row does) simply does not
 * call it, instead of passing a flag that reads as if it had been considered.
 */
export function isAboveTheFoldCard(index: number): boolean {
	return index < EAGER_CARD_COUNT;
}
