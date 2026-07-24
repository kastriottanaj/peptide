import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * One-off cleanup: removes the Medusa demo clothing products so the catalog is
 * peptide-only. Matches by handle, so it is safe to re-run (deletes nothing if
 * they are already gone).
 *
 * Run with:  npx medusa exec ./src/scripts/delete-demo-clothing.ts
 */
export default async function deleteDemoClothing({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const handles = ["t-shirt", "sweatshirt", "sweatpants", "shorts"];

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle"],
    filters: { handle: handles },
  });

  if (!products.length) {
    logger.info("No demo clothing products found. Nothing to delete.");
    return;
  }

  await deleteProductsWorkflow(container).run({
    input: { ids: products.map((p) => p.id) },
  });

  logger.info(
    `Deleted ${products.length} demo clothing products: ${products
      .map((p) => p.title)
      .join(", ")}.`
  );
}
