/**
 * Country matching, which is the part of the map that can be quietly wrong.
 *
 * A misdrawn coastline is obvious. A country that silently fails to match — or
 * worse, matches the wrong neighbour — looks exactly like a country with no
 * visitors, and the reader has no way to tell. So these tests cover the three
 * failure modes that matter: names GA4 spells differently, places the atlas
 * does not contain, and near-miss names that must *not* resolve.
 */

import {
  MAPPABLE_COUNTRIES,
  normalizeCountryName,
  resolveCountries,
  resolveCountry,
} from "../country-lookup";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../world-geo";

describe("normalizeCountryName", () => {
  it("expands Natural Earth's abbreviations onto GA4's spelling", () => {
    expect(normalizeCountryName("Bosnia and Herz.")).toBe("bosnia herzegovina");
    expect(normalizeCountryName("Bosnia & Herzegovina")).toBe(
      "bosnia herzegovina",
    );
    expect(normalizeCountryName("Dominican Rep.")).toBe("dominican republic");
    expect(normalizeCountryName("Solomon Is.")).toBe("solomon islands");
    expect(normalizeCountryName("Eq. Guinea")).toBe("equatorial guinea");
    expect(normalizeCountryName("W. Sahara")).toBe("western sahara");
    expect(normalizeCountryName("S. Sudan")).toBe("south sudan");
  });

  it("strips diacritics and punctuation", () => {
    expect(normalizeCountryName("Côte d'Ivoire")).toBe(
      normalizeCountryName("Cote d Ivoire"),
    );
    expect(normalizeCountryName("Timor-Leste")).toBe("timor leste");
  });
});

describe("resolveCountry", () => {
  it("resolves the names this shop actually sees", () => {
    for (const name of ["Germany", "Austria", "Switzerland", "Netherlands"]) {
      expect(resolveCountry(name)?.name).toBe(name);
    }
  });

  it.each([
    ["United States", "United States of America"],
    ["Czechia", "Czechia"],
    ["Czech Republic", "Czechia"],
    ["Bosnia & Herzegovina", "Bosnia and Herz."],
    ["Congo - Kinshasa", "Dem. Rep. Congo"],
    ["Congo - Brazzaville", "Congo"],
    ["Myanmar (Burma)", "Myanmar"],
    ["Côte d'Ivoire", "Côte d'Ivoire"],
    ["North Macedonia", "Macedonia"],
    ["Eswatini", "eSwatini"],
    ["Timor-Leste", "Timor-Leste"],
    ["Western Sahara", "W. Sahara"],
    ["South Sudan", "S. Sudan"],
    ["Central African Republic", "Central African Rep."],
    ["Falkland Islands (Islas Malvinas)", "Falkland Is."],
    ["French Southern Territories", "Fr. S. Antarctic Lands"],
    ["Türkiye", "Turkey"],
    ["Palestinian Territories", "Palestine"],
  ])("resolves GA4's %p to the atlas's %p", (ga4, atlas) => {
    expect(resolveCountry(ga4)?.name).toBe(atlas);
  });

  /**
   * Natural Earth 110m contains no micro-states at all, so these resolve to
   * hand-placed markers with no outline. Liechtenstein is not hypothetical
   * traffic for a German-language shop.
   */
  it.each(["Liechtenstein", "Malta", "Monaco", "Singapore", "Hong Kong"])(
    "gives %p a marker even though the atlas has no outline for it",
    (name) => {
      const country = resolveCountry(name);

      expect(country).not.toBeNull();
      expect(country?.d).toBe("");
      expect(country?.x).toBeGreaterThan(0);
    },
  );

  it("resolves an ISO 3166-1 numeric code, for the day GA4 sends one", () => {
    expect(resolveCountry("276")?.name).toBe("Germany");
    expect(resolveCountry("40")?.name).toBe("Austria"); // unpadded
  });

  it("returns null rather than guessing", () => {
    expect(resolveCountry("(not set)")).toBeNull();
    expect(resolveCountry("")).toBeNull();
    expect(resolveCountry("   ")).toBeNull();
    expect(resolveCountry("Atlantis")).toBeNull();
  });

  /**
   * The reason there is no fuzzy matching. Each of these is one or two edits
   * from a different real country, and a map that renders the wrong one is
   * more damaging than a map that renders neither.
   */
  it("never confuses countries with similar names", () => {
    expect(resolveCountry("Niger")?.name).toBe("Niger");
    expect(resolveCountry("Nigeria")?.name).toBe("Nigeria");
    expect(resolveCountry("Austria")?.name).toBe("Austria");
    expect(resolveCountry("Australia")?.name).toBe("Australia");
    expect(resolveCountry("Austri")).toBeNull();
  });
});

describe("the dataset itself", () => {
  it("has a unique id per country", () => {
    const ids = MAPPABLE_COUNTRIES.map((country) => country.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("places every marker inside the viewBox", () => {
    const outside = MAPPABLE_COUNTRIES.filter(
      (country) =>
        country.x < 0 ||
        country.x > WORLD_WIDTH ||
        country.y < 0 ||
        country.y > WORLD_HEIGHT,
    ).map((country) => country.name);

    expect(outside).toEqual([]);
  });

  /**
   * A spot check that the projection is the right way up and the right way
   * round, which a bad regeneration would break silently: Germany is north of
   * South Africa and east of Brazil.
   */
  it("orients the projection correctly", () => {
    const germany = resolveCountry("Germany");
    const southAfrica = resolveCountry("South Africa");
    const brazil = resolveCountry("Brazil");

    expect(germany!.y).toBeLessThan(southAfrica!.y);
    expect(germany!.x).toBeGreaterThan(brazil!.x);
  });
});

describe("resolveCountries", () => {
  it("keeps the total equal to the input, matched or not", () => {
    const result = resolveCountries([
      { name: "Germany", value: 5 },
      { name: "Austria", value: 2 },
      { name: "Atlantis", value: 3 },
    ]);

    expect(result.total).toBe(10);
    expect(result.located).toHaveLength(2);
    expect(result.unlocated).toEqual([{ label: "Atlantis", value: 3 }]);
  });

  it("sums two spellings of the same country instead of overwriting", () => {
    const result = resolveCountries([
      { name: "United States", value: 4 },
      { name: "United States of America", value: 3 },
    ]);

    expect(result.located).toHaveLength(1);
    expect(result.located[0].value).toBe(7);
    expect(result.total).toBe(7);
  });

  it("ranks by value and reports the peak for scaling", () => {
    const result = resolveCountries([
      { name: "Austria", value: 2 },
      { name: "Germany", value: 9 },
    ]);

    expect(result.located.map((entry) => entry.label)).toEqual([
      "Germany",
      "Austria",
    ]);
    expect(result.max).toBe(9);
  });

  it("drops rows with nothing to show", () => {
    const result = resolveCountries([
      { name: "Germany", value: 0 },
      { name: "Austria", value: Number.NaN },
      { name: "Spain", value: -1 },
    ]);

    expect(result.located).toEqual([]);
    expect(result.unlocated).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.max).toBe(0);
  });

  it("labels an unnamed row rather than rendering a blank", () => {
    const result = resolveCountries([{ name: "", value: 2 }]);

    expect(result.unlocated).toEqual([{ label: "(not set)", value: 2 }]);
  });
});
