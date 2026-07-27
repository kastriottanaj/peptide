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

// --- Checkout ------------------------------------------------------------

export type CheckoutAddress = {
	first_name: string;
	last_name: string;
	company?: string;
	address_1: string;
	postal_code: string;
	city: string;
	country_code: string;
	phone?: string;
};

/** Store contact details and address. Billing mirrors shipping, as in the template. */
export async function setCustomerDetails(
	email: string,
	address: CheckoutAddress,
	/** Optional USt-IdNr., carried to the order for invoicing. */
	vatId?: string,
): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.update(
		current.id,
		{
			email,
			shipping_address: address,
			billing_address: address,
			// Medusa has no first-class VAT-id field on a cart, and the checkout
			// asks for one, so it rides along in metadata — which carries over to
			// the order and is visible in the admin. Without this the customer
			// fills the field in and it is silently discarded.
			...(vatId ? { metadata: { ...(current.metadata ?? {}), vat_id: vatId } } : {}),
		},
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

/**
 * Put just the delivery country on the cart.
 *
 * Medusa scopes shipping options to the cart's shipping address, so the option
 * list is only correct once the country is stored. The checkout calls this as
 * soon as the country changes and re-lists the options; the full address
 * follows on submit via `setCustomerDetails`.
 */
export async function setDeliveryCountry(countryCode: string): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.update(
		current.id,
		{ shipping_address: { ...(current.shipping_address ?? {}), country_code: countryCode } },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

/** Apply a promotion code; Medusa decides whether it is valid. */
export async function applyPromoCode(code: string): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.update(
		current.id,
		{ promo_codes: [code] },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

export async function clearPromoCodes(): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.update(
		current.id,
		{ promo_codes: [] },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

export async function listShippingOptions(cartId: string) {
	const { shipping_options } = await medusa.store.fulfillment.listCartOptions({
		cart_id: cartId,
	});
	return shipping_options;
}

export async function chooseShippingOption(optionId: string): Promise<Cart> {
	const current = await getOrCreateCart();
	const { cart } = await medusa.store.cart.addShippingMethod(
		current.id,
		{ option_id: optionId },
		{ fields: CART_FIELDS },
	);
	announce(cart);
	return cart;
}

/**
 * Complete the order: payment session with the manual provider (bank transfer),
 * then convert the cart into an order. Returns the created order.
 *
 * The cart id is only cleared once Medusa confirms the order, so a failure
 * mid-way leaves the customer's cart intact.
 */
export async function completeOrder(): Promise<HttpTypes.StoreOrder> {
	const cart = await getOrCreateCart();

	await medusa.store.payment.initiatePaymentSession(cart, {
		provider_id: "pp_system_default",
	});

	const result = await medusa.store.cart.complete(cart.id);

	if (result.type !== "order") {
		const message =
			("error" in result && (result.error as { message?: string })?.message) ||
			"Die Bestellung konnte nicht abgeschlossen werden.";
		throw new Error(message);
	}

	clearCartId();
	announce(null);
	return result.order;
}
