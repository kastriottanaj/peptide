/**
 * Browser-side cart. The storefront builds to static HTML, so the cart lives
 * entirely in the client: the cart id is kept in localStorage and every mutation
 * goes straight to Medusa, which stays authoritative for prices and totals.
 *
 * Every mutation dispatches `cart:updated` on `window` so the header badge and
 * the cart page can react without a framework.
 */
import type { HttpTypes } from "@medusajs/types";
import { medusa, getDefaultRegionId } from "./medusa";

const CART_ID_KEY = "peptide_cart_id";
export const CART_UPDATED_EVENT = "cart:updated";

/**
 * Medusa does not return per-line totals unless they are asked for — a cart read
 * without this yields `item.total === undefined` and every line renders 0,00 €.
 * Cart-level totals come back regardless.
 */
const CART_FIELDS = "*items,+items.total,+items.subtotal";

export type Cart = HttpTypes.StoreCart;

function readCartId(): string | null {
	try {
		return window.localStorage.getItem(CART_ID_KEY);
	} catch {
		return null; // private mode / storage disabled
	}
}

function writeCartId(id: string): void {
	try {
		window.localStorage.setItem(CART_ID_KEY, id);
	} catch {
		// Non-fatal: the cart simply will not survive a reload.
	}
}

function clearCartId(): void {
	try {
		window.localStorage.removeItem(CART_ID_KEY);
	} catch {
		// ignore
	}
}

function announce(cart: Cart | null): void {
	window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT, { detail: cart }));
}

/** Total number of units in the cart (not the number of distinct lines). */
export function cartItemCount(cart: Cart | null): number {
	return (cart?.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
}

/** Fetch the existing cart, or null if there is none / it no longer exists. */
export async function getCart(): Promise<Cart | null> {
	const id = readCartId();
	if (!id) return null;

	try {
		const { cart } = await medusa.store.cart.retrieve(id, { fields: CART_FIELDS });
		return cart;
	} catch {
		// Cart was completed or deleted server-side — start clean.
		clearCartId();
		return null;
	}
}

export async function getOrCreateCart(): Promise<Cart> {
	const existing = await getCart();
	if (existing) return existing;

	const regionId = await getDefaultRegionId();
	const { cart } = await medusa.store.cart.create({ region_id: regionId });
	writeCartId(cart.id);
	return cart;
}

export async function addLine(variantId: string, quantity = 1): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.createLineItem(
		current.id,
		{ variant_id: variantId, quantity },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

export async function updateLine(lineId: string, quantity: number): Promise<Cart> {
	if (quantity < 1) return removeLine(lineId);

	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.updateLineItem(
		current.id,
		lineId,
		{ quantity },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

export async function removeLine(lineId: string): Promise<Cart> {
	const id = readCartId();
	if (!id) throw new Error("No cart to remove a line from.");

	await medusa.store.cart.deleteLineItem(id, lineId);
	const { cart } = await medusa.store.cart.retrieve(id, { fields: CART_FIELDS });
	announce(cart);
	return cart;
}

/** Re-broadcast the current cart, e.g. on first page load. */
export async function refresh(): Promise<Cart | null> {
	const cart = await getCart();
	announce(cart);
	return cart;
}
