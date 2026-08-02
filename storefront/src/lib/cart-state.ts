/**
 * The parts of the cart that need no Medusa client: the storage key, the
 * `cart:updated` contract and the item count.
 *
 * Split out of `cart.ts` for one reason — module weight. `cart.ts` imports
 * `@medusajs/js-sdk`, which is 141 kB of the built bundle, and anything that
 * touches `cart.ts` at module scope drags the whole SDK onto the page. The
 * header badge in `BaseLayout.astro` runs on all 37 pages and needs exactly
 * what is in this file plus, for the small minority of visitors who already
 * have a cart, one network read. Importing this instead lets it load the SDK
 * only when there is a cart to read.
 *
 * Nothing here talks to the network, so it stays safe to import from anywhere.
 * `cart.ts` re-exports the public names, so existing call sites are unchanged
 * and there is still one source of truth for the storage key and the event.
 */
import type { HttpTypes } from "@medusajs/types";

/** localStorage key holding the Medusa cart id. */
export const CART_ID_KEY = "peptide_cart_id";

/** Dispatched on `window` after every cart mutation, with the cart as detail. */
export const CART_UPDATED_EVENT = "cart:updated";

export type Cart = HttpTypes.StoreCart;

export function readCartId(): string | null {
	try {
		return window.localStorage.getItem(CART_ID_KEY);
	} catch {
		return null; // private mode / storage disabled
	}
}

export function writeCartId(id: string): void {
	try {
		window.localStorage.setItem(CART_ID_KEY, id);
	} catch {
		// Non-fatal: the cart simply will not survive a reload.
	}
}

export function clearCartId(): void {
	try {
		window.localStorage.removeItem(CART_ID_KEY);
	} catch {
		// ignore
	}
}

export function announce(cart: Cart | null): void {
	window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT, { detail: cart }));
}

/** Total number of units in the cart (not the number of distinct lines). */
export function cartItemCount(cart: Cart | null): number {
	return (cart?.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
}
