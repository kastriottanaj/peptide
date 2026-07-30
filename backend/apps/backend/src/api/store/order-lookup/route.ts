import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  displayIdForReference,
  referenceForDisplayId,
} from "../../../lib/bank-reference";

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

/** An order number the customer read off the confirmation, e.g. `12` or `#12`. */
const ORDER_NUMBER_PATTERN = /^#?\d{1,15}$/;

/**
 * Resolve whatever the customer typed into an order number.
 *
 * The only code most customers still have is the `PE-XXXXXX` payment reference
 * from their bank transfer. Stripping non-digits from it — which this route used
 * to do — reduces `PE-QK3M7P` to `37` and looks up a completely unrelated order,
 * so a reference has to be inverted rather than scraped.
 */
function resolveDisplayId(input: string): number | null {
  const normalized = input.trim();
  if (normalized.length === 0 || normalized.length > 32) return null;

  const fromReference = displayIdForReference(normalized);
  if (fromReference !== null) return fromReference;

  if (!ORDER_NUMBER_PATTERN.test(normalized)) return null;
  const parsed = Number.parseInt(normalized.replace("#", ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawNumber = typeof body.orderNumber === "string" ? body.orderNumber : "";
  const rawEmail = typeof body.email === "string" ? body.email : "";
  const email = rawEmail.trim().toLowerCase();

  const displayId = resolveDisplayId(rawNumber);

  // Length-bounded before anything reaches the database, so a large body cannot
  // be used to make the query do work.
  if (displayId === null || !email || email.length > 254) {
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
        "item_subtotal",
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
        // Derive when the subscriber has not written it yet, rather than
        // returning null and leaving the customer without the code they need
        // to pay. Both paths use the same definition, so they cannot disagree.
        bank_reference:
          typeof metadata.bank_reference === "string" && metadata.bank_reference
            ? metadata.bank_reference
            : typeof order.display_id === "number"
              ? referenceForDisplayId(order.display_id)
              : null,
        item_subtotal: order.item_subtotal,
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
