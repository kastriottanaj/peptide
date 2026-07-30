import { defineMiddlewares } from "@medusajs/framework/http";
import type {
	MedusaNextFunction,
	MedusaRequest,
	MedusaResponse,
} from "@medusajs/framework/http";

/**
 * Refuse to turn a cart into an order while the shop is closed.
 *
 * The storefront hides add-to-cart and the checkout form (see
 * docs/specs/2026-07-30-orders-closed.md), but that is presentation only: the
 * store API is public, needs nothing but a publishable key, and a cart id left
 * in someone's localStorage plus a single fetch would still place an order we
 * cannot be paid for — the bank account does not exist yet, so the confirmation
 * would show PLATZHALTER and no email would follow.
 *
 * `ORDERS_ENABLED` comes from the same env file `medusa.service` already loads,
 * and `deploy.sh` derives the storefront's `PUBLIC_ORDERS_ENABLED` from it, so
 * one value on the server governs both. **Unset means closed**, and only the
 * exact string `true` opens it: a forgotten variable must not open a shop that
 * cannot take money, and a literal "false" must not read as truthy.
 *
 * Completion is the only route blocked. Carts, line items and shipping options
 * stay open so an existing cart remains viewable, and no order can come into
 * existence without this call.
 */
const ordersEnabled = () =>
	(process.env.ORDERS_ENABLED ?? "").trim().toLowerCase() === "true";

const requireOpenShop = (
	_req: MedusaRequest,
	res: MedusaResponse,
	next: MedusaNextFunction,
) => {
	if (ordersEnabled()) return next();

	// 503, not 403: this is temporary and not about the caller's permissions.
	// German, because the storefront surfaces backend messages to the customer.
	res.status(503).json({
		type: "not_allowed",
		message:
			"Der Shop nimmt derzeit keine Bestellungen an. Bitte versuchen Sie es später erneut.",
	});
};

export default defineMiddlewares({
	routes: [
		{
			matcher: "/store/carts/:id/complete",
			method: "POST",
			middlewares: [requireOpenShop],
		},
	],
});
