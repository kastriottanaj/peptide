import { MedusaContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

/**
 * Tidies the product categories:
 *
 *  - removes the Medusa starter's clothing categories, which are empty and
 *    would otherwise show up in the storefront navigation
 *  - fixes the handle of "Signal- & Fragmentpeptide", which was auto-generated
 *    as `signal--&-fragmentpeptide`. A literal `&` in a URL path is a query
 *    separator waiting to happen, and it produces an ugly category URL.
 *
 * Idempotent, and refuses to delete a category that has products in it.
 *
 * Run with:  npx medusa exec ./src/scripts/clean-categories.ts
 */

const STARTER_HANDLES = ["sweatshirts", "shirts", "pants", "merch"];

const HANDLE_FIXES: Record<string, string> = {
  "signal--&-fragmentpeptide": "signal-fragmentpeptide",
};

export default async function cleanCategories({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productModule = container.resolve(Modules.PRODUCT);

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "products.id"],
  });

  // --- Remove the starter categories ------------------------------------
  const removable = categories.filter(
    (category: any) =>
      STARTER_HANDLES.includes(category.handle) &&
      (category.products ?? []).length === 0
  );

  const skipped = categories.filter(
    (category: any) =>
      STARTER_HANDLES.includes(category.handle) &&
      (category.products ?? []).length > 0
  );

  for (const category of skipped) {
    logger.warn(
      `Keeping "${category.name}" — it still has ${category.products.length} product(s). Reassign them first.`
    );
  }

  if (removable.length) {
    await productModule.deleteProductCategories(
      removable.map((c: any) => c.id)
    );
    logger.info(
      `Removed ${removable.length} starter categorie(s): ${removable
        .map((c: any) => c.name)
        .join(", ")}`
    );
  } else {
    logger.info("No starter categories to remove.");
  }

  // --- Fix malformed handles --------------------------------------------
  for (const [badHandle, goodHandle] of Object.entries(HANDLE_FIXES)) {
    const category = categories.find((c: any) => c.handle === badHandle);
    if (!category) {
      logger.info(`Handle ${badHandle} not present — already fixed.`);
      continue;
    }

    await productModule.updateProductCategories(category.id, {
      handle: goodHandle,
    });
    logger.info(`Handle: ${badHandle} → ${goodHandle}`);
  }
}
