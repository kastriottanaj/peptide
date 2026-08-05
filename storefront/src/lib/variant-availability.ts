import type { HttpTypes } from "@medusajs/types";

/** Shared inventory rule for every storefront surface that exposes a variant. */
export function isVariantAvailable(
	variant: HttpTypes.StoreProductVariant,
): boolean {
	if (variant.manage_inventory === false) return true;
	if (variant.allow_backorder) return true;
	return (variant.inventory_quantity ?? 0) > 0;
}
