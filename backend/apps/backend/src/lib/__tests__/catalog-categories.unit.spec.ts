import {
  EXPANDED_PRODUCT_CATEGORIES,
  assertCompatibleCategory,
  unionCategoryIds,
} from "../catalog-categories";

describe("catalog category expansion", () => {
  it("pins the three approved category records", () => {
    expect(EXPANDED_PRODUCT_CATEGORIES).toEqual([
      {
        name: "GLP-1-Forschung",
        handle: "glp-1-forschung",
        description:
          "Forschungsprodukte für GLP-1-bezogene Labor- und Analysezwecke.",
      },
      {
        name: "Peptid-Stacks",
        handle: "peptid-stacks",
        description:
          "Kategorie für Peptid-Stacks im Forschungs- und Laborkontext.",
      },
      {
        name: "Laborbedarf",
        handle: "laborbedarf",
        description:
          "Kategorie für Laborbedarf im Forschungs- und Laborkontext.",
      },
    ]);
    expect(
      new Set(EXPANDED_PRODUCT_CATEGORIES.map(({ handle }) => handle)).size,
    ).toBe(3);
    expect(
      new Set(EXPANDED_PRODUCT_CATEGORIES.map(({ name }) => name)).size,
    ).toBe(3);
  });

  it("accepts only the approved name for an existing handle", () => {
    const desired = EXPANDED_PRODUCT_CATEGORIES[0];
    expect(() => assertCompatibleCategory(desired, desired)).not.toThrow();
    expect(() =>
      assertCompatibleCategory(
        { handle: desired.handle, name: "Conflicting category" },
        desired,
      ),
    ).toThrow(/Category conflict/);
  });

  it("adds GLP-1 without removing or duplicating existing relationships", () => {
    expect(unionCategoryIds(["stoffwechsel", "other"], "glp-1")).toEqual([
      "stoffwechsel",
      "other",
      "glp-1",
    ]);
    expect(
      unionCategoryIds(["stoffwechsel", "glp-1", "stoffwechsel"], "glp-1"),
    ).toEqual(["stoffwechsel", "glp-1"]);
  });

  it("refuses to calculate an assignment without a category ID", () => {
    expect(() => unionCategoryIds(["stoffwechsel"], "")).toThrow(
      /required category ID/,
    );
  });
});
