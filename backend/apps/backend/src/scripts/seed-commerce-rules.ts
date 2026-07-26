import { MedusaContainer } from "@medusajs/framework";
import type { CreatePromotionRuleDTO } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { createPromotionsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Makes the pricing rules the storefront advertises actually binding.
 *
 * src/lib/pricing.ts in the storefront shows the customer a quantity discount
 * and a free-shipping threshold; without matching rules here, the cart promises
 * something the order does not honour. Values mirror peptidebestellung.de — see
 * docs/specs/2026-07-26-checkout-workflow.md.
 *
 * Idempotent: existing promotions (by code) are skipped.
 *
 * Run with:  npx medusa exec ./src/scripts/seed-commerce-rules.ts
 */

/** [minimum total quantity, percentage off] */
const QUANTITY_TIERS: Array<[number, number]> = [
  [3, 3],
  [4, 5],
  [5, 7],
  [6, 8],
  [7, 10],
  [8, 12],
  [9, 13],
  [10, 15],
];

export default async function seedCommerceRules({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const promotionModule = container.resolve(Modules.PROMOTION);

  // --- Quantity discount tiers -----------------------------------------
  //
  // One automatic promotion per tier. Medusa applies every matching rule, so
  // each tier is bounded on both sides (>= min, < next min) to make sure a cart
  // of 5 units gets 7% only, not 3% + 5% + 7% stacked.
  const codes = QUANTITY_TIERS.map(([qty]) => `MENGE${qty}`);

  // Rebuild from scratch so re-running fixes a bad earlier definition rather
  // than skipping past it.
  const existing = await promotionModule.listPromotions(
    { code: codes },
    { select: ["id", "code"] }
  );
  if (existing.length) {
    await promotionModule.deletePromotions(existing.map((p) => p.id));
    logger.info(`Removed ${existing.length} existing quantity promotion(s).`);
  }

  for (const [index, [minQuantity, percent]] of QUANTITY_TIERS.entries()) {
    const code = `MENGE${minQuantity}`;
    const nextTier = QUANTITY_TIERS[index + 1];

    // These select WHICH line items are discounted, so they belong in
    // target_rules. As plain `rules` they are cart-level conditions and no item
    // is ever targeted, which silently yields a 0 discount.
    const targetRules: CreatePromotionRuleDTO[] = [
      {
        attribute: "items.quantity",
        operator: "gte",
        values: [String(minQuantity)],
      },
    ];
    if (nextTier) {
      targetRules.push({
        attribute: "items.quantity",
        operator: "lt",
        values: [String(nextTier[0])],
      });
    }

    await createPromotionsWorkflow(container).run({
      input: {
        promotionsData: [
          {
            code,
            type: "standard",
            is_automatic: true,
            // Promotions default to `draft`, and a draft promotion never
            // applies to a cart.
            status: "active",
            application_method: {
              type: "percentage",
              target_type: "items",
              allocation: "across",
              value: percent,
              currency_code: "eur",
              target_rules: targetRules,
            },
          },
        ],
      },
    });

    logger.info(`Created promotion ${code}: ${percent}% from ${minQuantity} units.`);
  }

  // --- Shipping ---------------------------------------------------------
  //
  // Medusa's starter ships two flat 10 EUR options. The template's rule is
  // 10 EUR inside Germany, 20 EUR outside, free from 100 EUR merchandise.
  // Free-over-threshold is not expressible as a plain shipping-option price, so
  // it is reported here rather than silently half-applied.
  const { data: shippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  });

  logger.info(
    `Shipping options present: ${shippingOptions
      .map((option) => option.name)
      .join(", ")}`
  );
  logger.warn(
    "Shipping prices still come from the Medusa starter (flat 10 EUR). " +
      "The 20 EUR non-Germany rate and the free-from-100-EUR threshold are NOT " +
      "configured yet — set them in the admin under Settings > Locations & Shipping, " +
      "or the storefront's free-shipping hint will over-promise."
  );
}
