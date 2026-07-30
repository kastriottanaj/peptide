import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  updateProductVariantsWorkflow,
  updateProductsWorkflow,
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
 * Run with:  npx medusa exec ./src/scripts/seed-peptides.ts
 *
 * The script is convergent, not merely skip-on-exists. Re-running it writes the
 * definitions below onto the products it owns — that is the whole point, because
 * replacing the placeholder purity, COA and price values is the update this
 * catalog needs before launch, and a seed that skipped every existing handle
 * could never deliver it.
 *
 * It only ever touches products whose handle appears below AND which carry
 * metadata.demo = "true"; anything else aborts the run rather than overwrite a
 * real product with placeholder data.
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

  const seedHandles = new Set(peptides.map((p) => p.handle));

  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata", "variants.id", "variants.title"],
  });

  // Only products this seed owns are ever touched. A handle collision with a
  // real product must stop the run rather than have the seed overwrite it with
  // placeholder purity values.
  const owned = new Map<string, (typeof existingProducts)[number]>();
  for (const product of existingProducts) {
    if (!seedHandles.has(product.handle as string)) continue;

    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    if (metadata.demo !== "true") {
      logger.error(
        `Product "${product.handle}" exists but is not marked metadata.demo = "true". ` +
          `Refusing to overwrite a non-demo product with placeholder data; ` +
          `rename or remove it first.`
      );
      return;
    }
    if (owned.has(product.handle as string)) {
      logger.error(
        `More than one product uses the handle "${product.handle}". ` +
          `Resolve the ambiguity before seeding.`
      );
      return;
    }
    owned.set(product.handle as string, product);
  }

  const toCreate = peptides.filter((p) => !owned.has(p.handle));
  const toConverge = peptides.filter((p) => owned.has(p.handle));

  const variantsFor = (p: PeptideSeed) =>
    p.packs.map((pk) => ({
      title: pk.size,
      sku: `${p.code}-${pk.size.replace(/\s+/g, "")}`,
      // Inventory is tracked and backorders are refused, so the catalog cannot
      // oversell. `manage_inventory: false` meant every variant was infinitely
      // available and the storefront's availability check could never be false.
      // Stock levels are an operational matter, set in the admin per location.
      manage_inventory: true,
      allow_backorder: false,
      options: { "Packgröße": pk.size },
      prices: eur(pk.price),
    }));

  if (toCreate.length) {
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
          variants: variantsFor(p),
          sales_channels: [{ id: salesChannel.id }],
        })),
      },
    });
    logger.info(
      `Created ${toCreate.length} DEMO peptide product(s) (placeholder analytical data).`
    );
  }

  // Converge, rather than skip.
  //
  // Skipping every existing handle meant a corrected purity value, COA status or
  // price could never reach a store that had already been seeded — the exact
  // update this catalog needs before launch would silently do nothing. Product
  // fields and per-variant prices are therefore written on every run.
  for (const p of toConverge) {
    const existing = owned.get(p.handle)!;

    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: existing.id as string },
        update: {
          title: p.title,
          description: p.description,
          status: ProductStatus.PUBLISHED,
          category_ids: catId(p.category),
          metadata: demoMeta(p.code),
        },
      },
    });

    const existingVariants = (existing.variants ?? []) as Array<{
      id: string;
      title: string | null;
    }>;

    for (const pack of p.packs) {
      const variant = existingVariants.find((v) => v.title === pack.size);
      if (!variant) {
        logger.warn(
          `Product "${p.handle}" has no "${pack.size}" variant to converge. ` +
            `Add the pack size in the admin; this seed does not restructure options.`
        );
        continue;
      }

      await updateProductVariantsWorkflow(container).run({
        input: {
          selector: { id: variant.id },
          update: {
            manage_inventory: true,
            allow_backorder: false,
            prices: eur(pack.price),
          },
        },
      });
    }

    logger.info(`Converged DEMO peptide product "${p.handle}".`);
  }

  if (!toCreate.length && !toConverge.length) {
    logger.info("No peptide demo products defined; nothing to do.");
  }
}
