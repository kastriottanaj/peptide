import { MedusaContainer } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  EXPANDED_PRODUCT_CATEGORIES,
  GLP_1_CATEGORY_HANDLE,
  assertCompatibleCategory,
  unionCategoryIds,
} from "../lib/catalog-categories";

/**
 * Idempotently expands the live catalog category records and adds the existing
 * repository-owned Retatrutide product to GLP-1-Forschung. It never creates a
 * product and preserves every existing product-category relationship.
 *
 * Verify without writes:
 *   CATEGORY_EXPANSION_DRY_RUN=true npx medusa exec ./src/scripts/expand-product-categories.ts
 * Apply explicitly:
 *   npx medusa exec ./src/scripts/expand-product-categories.ts
 */
export default async function expandProductCategories({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const dryRun = process.env.CATEGORY_EXPANSION_DRY_RUN === "true";

  const readCategories = async () => {
    const { data } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "handle", "description", "is_active"],
    });
    return data;
  };

  const readRetatrutide = async () => {
    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "handle",
        "metadata",
        "categories.id",
        "categories.handle",
      ],
    });
    const matches = data.filter((product) => product.handle === "retatrutide");
    if (matches.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Expected exactly one Retatrutide product, found ${matches.length}. No changes made.`,
      );
    }
    const product = matches[0];
    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    if (metadata.demo !== "true") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Retatrutide is not the repository-owned demo record. No changes made.",
      );
    }
    return product;
  };

  // Finish every conflict/ownership check possible before the first write.
  const beforeCategories = await readCategories();
  const beforeRetatrutide = await readRetatrutide();
  for (const desired of EXPANDED_PRODUCT_CATEGORIES) {
    const conflictingNames = beforeCategories.filter(
      (category) =>
        category.name === desired.name && category.handle !== desired.handle,
    );
    if (conflictingNames.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Category name "${desired.name}" already uses another handle. No changes made.`,
      );
    }
    const matches = beforeCategories.filter(
      (category) => category.handle === desired.handle,
    );
    if (matches.length > 1) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Found duplicate category handle "${desired.handle}". No changes made.`,
      );
    }
    if (matches[0]) assertCompatibleCategory(matches[0], desired);
  }

  const missing = EXPANDED_PRODUCT_CATEGORIES.filter(
    (desired) =>
      !beforeCategories.some((category) => category.handle === desired.handle),
  );

  logger.info(
    `${dryRun ? "DRY RUN: would create" : "Creating"} ${missing.length} ` +
      `categor${missing.length === 1 ? "y" : "ies"}: ` +
      `${missing.map(({ name }) => name).join(", ") || "none"}.`,
  );

  if (!dryRun && missing.length) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missing.map((category) => ({
          ...category,
          is_active: true,
        })),
      },
    });
  }

  if (dryRun) {
    const existingGlp = beforeCategories.find(
      (category) => category.handle === GLP_1_CATEGORY_HANDLE,
    );
    const alreadyAssigned = existingGlp
      ? (beforeRetatrutide.categories ?? []).some(
          (category) => category?.id === existingGlp.id,
        )
      : false;
    logger.info(
      `DRY RUN: Retatrutide GLP-1 assignment is ${
        alreadyAssigned ? "already present" : "required"
      }; no records were changed.`,
    );
    return;
  }

  const persistedCategories = await readCategories();
  for (const desired of EXPANDED_PRODUCT_CATEGORIES) {
    const matches = persistedCategories.filter(
      (category) => category.handle === desired.handle,
    );
    if (matches.length !== 1) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Expected one persisted category "${desired.handle}", found ${matches.length}.`,
      );
    }
    assertCompatibleCategory(matches[0], desired);
  }

  const glpCategory = persistedCategories.find(
    (category) => category.handle === GLP_1_CATEGORY_HANDLE,
  )!;
  const beforeIds = (beforeRetatrutide.categories ?? [])
    .map((category) => category?.id)
    .filter((id): id is string => Boolean(id));
  const categoryIds = unionCategoryIds(beforeIds, glpCategory.id);

  if (categoryIds.length !== new Set(beforeIds).size) {
    await updateProductsWorkflow(container).run({
      input: {
        selector: { id: beforeRetatrutide.id },
        update: { category_ids: categoryIds },
      },
    });
    logger.info("Added Retatrutide to GLP-1-Forschung.");
  } else {
    logger.info("Retatrutide is already assigned to GLP-1-Forschung.");
  }

  const afterRetatrutide = await readRetatrutide();
  const afterIds = new Set(
    (afterRetatrutide.categories ?? [])
      .map((category) => category?.id)
      .filter((id): id is string => Boolean(id)),
  );
  for (const id of categoryIds) {
    if (!afterIds.has(id)) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Post-write verification failed: Retatrutide lost category ${id}.`,
      );
    }
  }
  logger.info("Category expansion verified successfully.");
}
