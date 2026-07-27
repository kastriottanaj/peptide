import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

/**
 * Guest order lookup by order number + email.
 *
 * Payment is bank transfer and the payment reference is shown only on the
 * confirmation page, so a customer who closes that tab currently has no way to
 * pay correctly. Medusa's store API cannot list guest orders by email (rightly
 * so), hence this route.
 *
 * Security posture:
 *  - Both the order number AND the matching email are required; neither alone
 *    reveals anything.
 *  - Every failure returns the same generic message, so the response cannot be
 *    used to test whether an order number or an address exists.
 *  - POST rather than GET, so the email does not end up in access logs,
 *    browser history or referrer headers.
 *  - Only the fields the customer needs to pay are returned — no address, no
 *    customer record, no internal ids.
 *
 * Not rate-limited at the application layer. Put that in front of it (Cloudflare
 * or similar) before this is publicly reachable — see docs/go-live-checklist.md.
 */

const GENERIC_ERROR =
  "Zu diesen Angaben wurde keine Bestellung gefunden. Bitte prüfen Sie Bestellnummer und E-Mail-Adresse.";

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawNumber = String(body.orderNumber ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  // Accept "1", "#1" or "PE-000001"-ish input; we only need the digits.
  const displayId = Number.parseInt(rawNumber.replace(/[^0-9]/g, ""), 10);

  if (!Number.isFinite(displayId) || !email) {
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  try {
    // query.graph resolves the computed totals with the right version context;
    // listOrders with those fields selected throws on shipping adjustments.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "display_id",
        "email",
        "currency_code",
        "created_at",
        "metadata",
        "total",
        "item_total",
        "shipping_total",
        "discount_total",
        "items.*",
      ],
      // The filter type is string-shaped even though the column is numeric.
      filters: { display_id: String(displayId) },
    });

    const order = orders[0];

    // Compare case-insensitively; the same generic error either way.
    if (!order || (order.email ?? "").toLowerCase() !== email) {
      return res.status(404).json({ error: GENERIC_ERROR });
    }

    const metadata = (order.metadata ?? {}) as Record<string, unknown>;

    return res.json({
      order: {
        display_id: order.display_id,
        email: order.email,
        currency_code: order.currency_code,
        created_at: order.created_at,
        bank_reference:
          typeof metadata.bank_reference === "string"
            ? metadata.bank_reference
            : null,
        item_total: order.item_total,
        shipping_total: order.shipping_total,
        discount_total: order.discount_total,
        total: order.total,
        items: (order.items ?? []).map((item: any) => ({
          title: item.product_title ?? item.title,
          variant_title: item.variant_title,
          quantity: item.quantity,
          total: item.total,
        })),
      },
    });
  } catch (error) {
    logger.error(`Order lookup failed: ${error}`);
    return res.status(404).json({ error: GENERIC_ERROR });
  }
}
