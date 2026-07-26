import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  updateServiceZonesWorkflow,
  createPromotionsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Configures the shipping rules the storefront advertises:
 *
 *   10 EUR inside Germany, 20 EUR elsewhere, free from 100 EUR merchandise.
 *
 * Without this the Medusa starter's flat 10 EUR applies everywhere, so the
 * cart's „Versandkostenfrei ✓" hint promises something the order does not
 * honour — the customer is quoted one price and charged another.
 *
 * Free-over-threshold is not expressible as a shipping-option price, so it is a
 * promotion targeting shipping methods, conditioned on the item total.
 *
 * Idempotent. Run with:
 *   npx medusa exec ./src/scripts/seed-shipping.ts
 */

const GERMANY = ["de"];
const REST_OF_EUROPE = ["at", "be", "dk", "es", "fi", "fr", "gb", "ie", "it", "lu", "nl", "pl", "pt", "se"];

const DOMESTIC_FEE = 10;
const INTERNATIONAL_FEE = 20;
const FREE_SHIPPING_THRESHOLD = 100;

export default async function seedShipping({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT);
  const promotionModule = container.resolve(Modules.PROMOTION);

  // --- Locate the fulfillment set and its shipping profile ---------------
  const { data: fulfillmentSets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id", "service_zones.name"],
  });
  const fulfillmentSet = fulfillmentSets[0];
  if (!fulfillmentSet) {
    logger.error("No fulfillment set found. Run the initial data seed first.");
    return;
  }

  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = profiles[0];
  if (!shippingProfile) {
    logger.error("No shipping profile found.");
    return;
  }

  // --- Zones: Germany and the rest --------------------------------------
  const zones: Record<string, string> = {};
  const existingZones = fulfillmentSet.service_zones ?? [];

  const germanyZone = existingZones.find((z: any) => z.name === "Deutschland");
  if (germanyZone) {
    zones.germany = germanyZone.id;
    logger.info("Zone Deutschland already exists.");
  } else {
    // Reuse the starter's zone rather than leaving an unused "Europe" behind.
    const starter = existingZones.find((z: any) => z.name === "Europe");
    if (starter) {
      await updateServiceZonesWorkflow(container).run({
        input: {
          selector: { id: starter.id },
          update: {
            name: "Deutschland",
            geo_zones: GERMANY.map((country_code) => ({
              country_code,
              type: "country" as const,
            })),
          },
        },
      });
      zones.germany = starter.id;
      logger.info("Repurposed the starter zone as Deutschland (de only).");
    } else {
      const { result } = await createServiceZonesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Deutschland",
              fulfillment_set_id: fulfillmentSet.id,
              geo_zones: GERMANY.map((country_code) => ({
                country_code,
                type: "country" as const,
              })),
            },
          ],
        },
      });
      zones.germany = result[0].id;
      logger.info("Created zone Deutschland.");
    }
  }

  const europeZone = existingZones.find(
    (z: any) => z.name === "Europa (ohne Deutschland)"
  );
  if (europeZone) {
    zones.europe = europeZone.id;
    logger.info("Zone Europa already exists.");
  } else {
    const { result } = await createServiceZonesWorkflow(container).run({
      input: {
        data: [
          {
            name: "Europa (ohne Deutschland)",
            fulfillment_set_id: fulfillmentSet.id,
            geo_zones: REST_OF_EUROPE.map((country_code) => ({
              country_code,
              type: "country" as const,
            })),
          },
        ],
      },
    });
    zones.europe = result[0].id;
    logger.info("Created zone Europa (ohne Deutschland).");
  }

  // --- Shipping options --------------------------------------------------
  const { data: existingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  });
  const optionNames = new Set(existingOptions.map((o: any) => o.name));

  // The starter's demo options span every country at a flat 10 EUR, which
  // would sit alongside ours and let a customer pick the wrong price.
  const starterOptions = existingOptions.filter((o: any) =>
    ["Standard Shipping", "Express Shipping"].includes(o.name)
  );
  if (starterOptions.length) {
    await fulfillmentModule.deleteShippingOptions(
      starterOptions.map((o: any) => o.id)
    );
    logger.info(`Removed ${starterOptions.length} starter shipping option(s).`);
  }

  const optionsToCreate = [
    {
      name: "Standardversand",
      zoneId: zones.germany,
      amount: DOMESTIC_FEE,
      description: "Versand innerhalb Deutschlands",
    },
    {
      name: "Standardversand Europa",
      zoneId: zones.europe,
      amount: INTERNATIONAL_FEE,
      description: "Versand innerhalb Europas außerhalb Deutschlands",
    },
  ];

  for (const option of optionsToCreate) {
    if (optionNames.has(option.name)) {
      logger.info(`Shipping option ${option.name} already exists — skipped.`);
      continue;
    }

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: option.name,
          price_type: "flat",
          service_zone_id: option.zoneId,
          shipping_profile_id: shippingProfile.id,
          provider_id: "manual_manual",
          type: {
            label: option.name,
            description: option.description,
            code: "standard",
          },
          prices: [{ currency_code: "eur", amount: option.amount }],
          rules: [
            {
              attribute: "enabled_in_store",
              value: "true",
              operator: "eq",
            },
            {
              attribute: "is_return",
              value: "false",
              operator: "eq",
            },
          ],
        },
      ],
    });

    logger.info(`Created ${option.name} at ${option.amount} EUR.`);
  }

  // --- Free shipping from 100 EUR ---------------------------------------
  const FREE_CODE = "VERSANDFREI100";
  const existingPromo = await promotionModule.listPromotions(
    { code: [FREE_CODE] },
    { select: ["id"] }
  );
  if (existingPromo.length) {
    await promotionModule.deletePromotions(existingPromo.map((p) => p.id));
  }

  await createPromotionsWorkflow(container).run({
    input: {
      promotionsData: [
        {
          code: FREE_CODE,
          type: "standard",
          is_automatic: true,
          status: "active",
          application_method: {
            type: "percentage",
            target_type: "shipping_methods",
            allocation: "across",
            value: 100,
            currency_code: "eur",
          },
          // `item_total` is merchandise after discounts — the same basis the
          // template used. NOT `subtotal`: on a cart that includes shipping,
          // so a 99.80 EUR order would clear a 100 EUR threshold on the
          // strength of its own 10 EUR shipping fee and then zero it out.
          rules: [
            {
              attribute: "item_total",
              operator: "gte",
              values: [String(FREE_SHIPPING_THRESHOLD)],
            },
          ],
        },
      ],
    },
  });

  logger.info(
    `Created promotion ${FREE_CODE}: free shipping from ${FREE_SHIPPING_THRESHOLD} EUR.`
  );
}
