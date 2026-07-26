import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * One-off: rebrand existing seeded products from the old PKD- research-code
 * prefix (Peptide Kaufen Deutschland) to PEK- (Peptide Einkaufen).
 *
 * seed-peptides.ts skips products that already exist, so changing the prefix
 * there does not touch already-seeded rows. Safe to re-run: products whose code
 * is already correct are left alone.
 *
 * Run with:  npx medusa exec ./src/scripts/rename-research-codes.ts
 */
export default async function renameResearchCodes({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "metadata"],
  });

  const stale = products.filter((product) => {
    const code = (product.metadata as Record<string, unknown> | null)
      ?.research_code;
    return typeof code === "string" && code.startsWith("PKD-");
  });

  if (!stale.length) {
    logger.info("No products with a PKD- research code. Nothing to do.");
    return;
  }

  for (const product of stale) {
    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    const oldCode = metadata.research_code as string;
    const newCode = oldCode.replace(/^PKD-/, "PEK-");

    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: product.id },
        update: { metadata: { ...metadata, research_code: newCode } },
      },
    });

    logger.info(`${product.title}: ${oldCode} → ${newCode}`);
  }

  logger.info(`Updated ${stale.length} research code(s).`);
}
