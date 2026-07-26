import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows";

/**
 * Seeds DEMO research-peptide products so the storefront's peptide card design
 * (vial image, research-code badge, purity badge, mg pack sizes, COA row) is
 * visible.
 *
 * IMPORTANT: every purity value, COA status and price below is a PLACEHOLDER for
 * design purposes only. Replace them with real, lab-verified analytical data
 * before this store is ever made live. Each product is tagged metadata.demo =
 * "true" and its description carries a visible German placeholder notice.
 *
 * Run once with:  npx medusa exec ./src/scripts/seed-peptides.ts
 * The script is idempotent: existing categories/products (by name/handle) are
 * skipped so re-running will not create duplicates.
 */
export default async function seedPeptides({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const demoNotice =
    "Demo-Produkt. Reinheit, COA-Status und Preise sind Platzhalter und müssen vor einer Veröffentlichung durch echte, laborgeprüfte Analysedaten ersetzt werden.";

  // Reuse the sales channel + shipping profile created by initial-data-seed.
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  });
  const salesChannel =
    salesChannels.find((s) => s.name === "Default Sales Channel") ??
    salesChannels[0];

  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = shippingProfiles[0];

  if (!salesChannel || !shippingProfile) {
    logger.error(
      "Missing sales channel or shipping profile. Run the initial data seed first."
    );
    return;
  }

  // --- Categories (create only the ones that do not exist yet) ---
  const categoryNames = [
    "Regenerationsforschung",
    "Stoffwechsel-Forschung",
    "Neuropeptid-Forschung",
    "Signal- & Fragmentpeptide",
  ];

  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  });
  const existingNames = new Set(existingCategories.map((c) => c.name));
  const missingNames = categoryNames.filter((n) => !existingNames.has(n));

  let createdCategories: { id: string; name: string }[] = [];
  if (missingNames.length) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingNames.map((name) => ({
          name,
          is_active: true,
        })),
      },
    });
    createdCategories = result;
  }

  const categoryByName = new Map<string, string>();
  for (const c of [...existingCategories, ...createdCategories]) {
    categoryByName.set(c.name, c.id);
  }

  const catId = (name: string) => {
    const id = categoryByName.get(name);
    return id ? [id] : [];
  };

  // Placeholder analytical metadata shared across demo products.
  const demoMeta = (research_code: string) => ({
    research_code,
    purity: ">99%",
    coa_status: "verfügbar",
    demo: "true",
    data_status: "placeholder",
  });

  const eur = (amount: number) => [{ amount, currency_code: "eur" }];

  type PeptideSeed = {
    title: string;
    handle: string;
    code: string;
    category: string;
    description: string;
    packs: { size: string; price: number }[];
  };

  const peptides: PeptideSeed[] = [
    {
      title: "Retatrutide",
      handle: "retatrutide",
      code: "PEK-RETA",
      category: "Stoffwechsel-Forschung",
      description:
        "Lyophilisiertes Forschungspeptid für metabolische Modellforschung. " +
        demoNotice,
      packs: [
        { size: "5 mg", price: 49.9 },
        { size: "10 mg", price: 79.9 },
        { size: "15 mg", price: 109.9 },
      ],
    },
    {
      title: "BPC-157",
      handle: "bpc-157",
      code: "PEK-BPC157",
      category: "Regenerationsforschung",
      description:
        "Lyophilisiertes Forschungspeptid für regenerationsbezogene Zellmodelle. " +
        demoNotice,
      packs: [
        { size: "5 mg", price: 29.9 },
        { size: "10 mg", price: 49.9 },
      ],
    },
    {
      title: "GHK-Cu",
      handle: "ghk-cu",
      code: "PEK-GHKCU",
      category: "Regenerationsforschung",
      description:
        "Kupfer-Peptid-Komplex für Forschungs- und Analysezwecke. " + demoNotice,
      packs: [
        { size: "50 mg", price: 39.9 },
        { size: "100 mg", price: 69.9 },
      ],
    },
    {
      title: "MOTS-c",
      handle: "mots-c",
      code: "PEK-MOTSC",
      category: "Stoffwechsel-Forschung",
      description:
        "Mitochondrial abgeleitetes Forschungspeptid für metabolische Studienmodelle. " +
        demoNotice,
      packs: [{ size: "10 mg", price: 34.9 }],
    },
    {
      title: "TB-500",
      handle: "tb-500",
      code: "PEK-TB500",
      category: "Signal- & Fragmentpeptide",
      description:
        "Fragmentpeptid für regenerations- und signalbezogene Forschungsmodelle. " +
        demoNotice,
      packs: [
        { size: "5 mg", price: 39.9 },
        { size: "10 mg", price: 64.9 },
      ],
    },
    {
      title: "Semax",
      handle: "semax",
      code: "PEK-SEMAX",
      category: "Neuropeptid-Forschung",
      description:
        "Neuropeptid für Forschung zu neuronalen Signalwegen. " + demoNotice,
      packs: [{ size: "30 mg", price: 44.9 }],
    },
  ];

  // Skip products whose handle already exists.
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["handle"],
  });
  const existingHandles = new Set(existingProducts.map((p) => p.handle));
  const toCreate = peptides.filter((p) => !existingHandles.has(p.handle));

  if (!toCreate.length) {
    logger.info("Peptide demo products already present. Nothing to create.");
    return;
  }

  await createProductsWorkflow(container).run({
    input: {
      products: toCreate.map((p) => ({
        title: p.title,
        handle: p.handle,
        description: p.description,
        status: ProductStatus.PUBLISHED,
        category_ids: catId(p.category),
        shipping_profile_id: shippingProfile.id,
        metadata: demoMeta(p.code),
        options: [
          {
            title: "Packgröße",
            values: p.packs.map((pk) => pk.size),
          },
        ],
        variants: p.packs.map((pk) => ({
          title: pk.size,
          sku: `${p.code}-${pk.size.replace(/\s+/g, "")}`,
          manage_inventory: false,
          options: { "Packgröße": pk.size },
          prices: eur(pk.price),
        })),
        sales_channels: [{ id: salesChannel.id }],
      })),
    },
  });

  logger.info(
    `Seeded ${toCreate.length} DEMO peptide products (placeholder analytical data).`
  );
}
