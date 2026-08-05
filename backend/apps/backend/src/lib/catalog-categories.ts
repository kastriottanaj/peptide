export type DesiredProductCategory = {
  name: string;
  handle: string;
  description: string;
};

export const EXPANDED_PRODUCT_CATEGORIES = [
  {
    name: "GLP-1-Forschung",
    handle: "glp-1-forschung",
    description:
      "Forschungsprodukte für GLP-1-bezogene Labor- und Analysezwecke.",
  },
  {
    name: "Peptid-Stacks",
    handle: "peptid-stacks",
    description: "Kategorie für Peptid-Stacks im Forschungs- und Laborkontext.",
  },
  {
    name: "Laborbedarf",
    handle: "laborbedarf",
    description: "Kategorie für Laborbedarf im Forschungs- und Laborkontext.",
  },
] as const satisfies readonly DesiredProductCategory[];

export const GLP_1_CATEGORY_HANDLE = "glp-1-forschung";

export type ExistingCategoryIdentity = {
  name: string | null | undefined;
  handle: string | null | undefined;
};

export function assertCompatibleCategory(
  existing: ExistingCategoryIdentity,
  desired: DesiredProductCategory,
): void {
  if (existing.handle !== desired.handle || existing.name !== desired.name) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Category conflict for handle "${desired.handle}": expected name ` +
        `"${desired.name}", found "${existing.name ?? ""}".`,
    );
  }
}

/** Return an additive, stable relationship update without duplicate IDs. */
export function unionCategoryIds(
  existingIds: readonly string[],
  requiredId: string,
): string[] {
  if (!requiredId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A required category ID is missing.",
    );
  }

  return [...new Set([...existingIds.filter(Boolean), requiredId])];
}
import { MedusaError } from "@medusajs/framework/utils";
