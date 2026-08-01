/**
 * The stylesheet, read as text.
 *
 * Jest has no CSSOM worth querying and no layout engine, so these are not
 * "does it look right" tests. They pin the two properties that make it safe to
 * ship a stylesheet into somebody else's application: **everything is scoped**,
 * so the Analytics page cannot restyle the orders page, and **the tokens are
 * declared on `.pa`, not `:root`**, so removing the route removes the styling
 * with it. Both are the kind of thing that gets broken by a well-meaning
 * one-line edit.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const source = readFileSync(join(__dirname, "..", "analytics.css"), "utf8");

/**
 * Comments stripped. The file *documents* the rules it must not break — it
 * mentions `:root` and `--pa-` in prose — so a naive text search would match
 * the explanation instead of the code.
 */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Every selector in the file, one per entry.
 *
 * At-rule preludes (`@media …`) and keyframe stops (`0%`, `from`) are dropped —
 * they are not selectors and cannot match an element.
 */
function selectors(): string[] {
  return [...css.matchAll(/([^{}]*)\{/g)]
    .map((match) => match[1].trim().split("\n").pop()?.trim() ?? "")
    .filter(Boolean)
    .filter((group) => !group.startsWith("@"))
    .flatMap((group) => group.split(",").map((one) => one.trim()))
    .filter(Boolean)
    .filter((selector) => !["from", "to"].includes(selector))
    .filter((selector) => !/^\d+%$/.test(selector));
}

describe("scoping", () => {
  /**
   * Nothing may match an element outside the Analytics page. Every selector
   * therefore mentions `.pa` — either as the root or as an ancestor — with the
   * single documented exception of the `.dark` theme prefix the admin puts on
   * the html element.
   */
  it("scopes every rule under .pa", () => {
    // A selector qualifies if it contains a class beginning `.pa` — `.pa`
    // itself, `.pa-card`, or `.dark .pa` for the theme override.
    const unscoped = selectors().filter(
      (selector) => !/\.pa(?![a-z0-9])/i.test(selector),
    );

    expect(unscoped).toEqual([]);
    expect(selectors().length).toBeGreaterThan(40);
  });

  it("declares no bare element selectors", () => {
    const bare = selectors().filter((selector) =>
      /^(html|body|a|p|div|table|th|td|button|input|h[1-6])\b/.test(selector),
    );

    expect(bare).toEqual([]);
  });

  /**
   * Tokens on `:root` would leak into the whole admin and outlive the page.
   */
  it("declares its custom properties on .pa, never on :root", () => {
    expect(css).not.toContain(":root");
    expect(css).toMatch(/^\.pa\s*\{/m);
  });

  it("prefixes every custom property so it cannot collide with Medusa's", () => {
    // Declarations only. A class like `.pa-button--primary:hover` would
    // otherwise read as a custom property named `--primary`.
    const properties = [...css.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map(
      (match) => match[1],
    );

    expect(properties.length).toBeGreaterThan(20);
    expect(properties.every((property) => property.startsWith("--pa-"))).toBe(
      true,
    );
  });
});

describe("design tokens", () => {
  it("defines the palette the design calls for", () => {
    for (const token of [
      "--pa-bg",
      "--pa-surface",
      "--pa-nav",
      "--pa-border",
      "--pa-accent",
      "--pa-success",
      "--pa-warning",
      "--pa-danger",
      "--pa-primary",
    ]) {
      expect(css).toContain(`${token}:`);
    }
  });

  it("uses an 8px card radius and 16–20px card padding", () => {
    expect(css).toMatch(/--pa-radius:\s*8px/);

    const padding = css.match(/--pa-pad:\s*(\d+)px/);
    expect(padding).not.toBeNull();
    expect(Number(padding?.[1])).toBeGreaterThanOrEqual(16);
    expect(Number(padding?.[1])).toBeLessThanOrEqual(20);
  });

  it("uses small, information-dense type", () => {
    const fontSize = css.match(/\.pa\s*\{[\s\S]*?font-size:\s*(\d+)px/);
    expect(Number(fontSize?.[1])).toBeLessThanOrEqual(14);
  });

  it("gives cards a small shadow rather than a heavy one", () => {
    expect(css).toMatch(/--pa-shadow:\s*0 1px 2px/);
  });

  /**
   * The admin ships a theme toggle that puts `.dark` on the html element. A
   * page that stays bright white inside a dark admin reads as broken.
   */
  it("redefines the palette for dark mode", () => {
    expect(css).toContain(".dark .pa {");
    expect(css).toMatch(/\.dark \.pa \{[\s\S]*?--pa-bg:/);
  });
});

describe("layout", () => {
  it("lays out on a twelve-column grid", () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(12,/);
  });

  it("collapses the grid at tablet and phone widths", () => {
    expect(css).toContain("@media (max-width: 1100px)");
    expect(css).toContain("@media (max-width: 720px)");
  });

  /**
   * A dashboard whose *body* scrolls sideways on a laptop is unusable. Wide
   * tables scroll inside their own card instead.
   */
  it("keeps wide tables scrolling inside their own container", () => {
    expect(css).toMatch(/\.pa-tablewrap\s*\{[\s\S]*?overflow-x:\s*auto/);
    expect(css).toMatch(/\.pa-table--wide\s*\{[\s\S]*?min-width:\s*\d+px/);
  });

  it("divides table rows with a single thin border, not a full grid", () => {
    expect(css).toMatch(/\.pa-table td \{[^}]*border-bottom:\s*1px solid/);
    expect(css).not.toMatch(/\.pa-table td \{[^}]*border:\s*1px solid/);
  });

  it("rounds status pills fully", () => {
    expect(css).toMatch(/\.pa-pill \{[\s\S]*?border-radius:\s*999px/);
  });

  it("draws progress bars as horizontal tracks with a green fill", () => {
    expect(css).toMatch(/\.pa-bar__track \{[\s\S]*?border-radius:\s*999px/);
    expect(css).toMatch(/\.pa-bar__fill \{[\s\S]*?background:\s*var\(--pa-accent\)/);
  });
});

describe("skeletons", () => {
  /**
   * Skeletons hold the final dimensions so nothing on the page moves when the
   * data lands.
   */
  it("sizes each skeleton variant explicitly", () => {
    for (const variant of ["label", "value", "foot", "row", "chart"]) {
      expect(css).toMatch(
        new RegExp(`\\.pa-skel--${variant} \\{[\\s\\S]*?height:\\s*\\d+px`),
      );
    }
  });

  it("stops animating for readers who asked for less motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(
      /prefers-reduced-motion[\s\S]*?\.pa-skel \{\s*animation:\s*none/,
    );
  });
});

describe("accessibility", () => {
  it("provides a visually-hidden class for the chart data tables", () => {
    expect(css).toMatch(/\.pa-sr \{[\s\S]*?clip:\s*rect\(0, 0, 0, 0\)/);
  });

  it("gives interactive controls a visible focus ring", () => {
    expect(css).toContain(".pa-segment__button:focus-visible");
    expect(css).toContain(".pa-button:focus-visible");
    expect(css).toMatch(/focus-visible \{\s*outline:\s*2px solid/);
  });
});

/**
 * A guard over the shipped admin sources, not the stylesheet.
 *
 * The blended Medusa ÷ GA4 ratio was once labelled "Conversion rate" and
 * described as a lower bound. Both were wrong — it divides a complete numerator
 * by a consent-limited denominator, so it reads *high*. A grep is a blunt
 * instrument, but it is the one that catches the mistake being reintroduced by
 * someone who has not read `lib/metrics.ts`.
 */
describe("conversion-rate vocabulary", () => {
  const adminRoot = join(__dirname, "..", "..", "..");

  /** Every shipped `.ts`/`.tsx` under `src/admin`, tests excluded. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : sourceFiles(full);
      }
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  /**
   * Comments stripped. `metrics.ts` *documents* the mistake — "an earlier
   * version called it a lower bound" — and prose explaining why a phrase is
   * banned must not itself trip the ban. What is checked is the code: string
   * literals, labels and identifiers.
   */
  const sources = sourceFiles(adminRoot).map((file) => ({
    file,
    text: readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, ""),
  }));

  it("finds the admin sources it is meant to be checking", () => {
    expect(sources.length).toBeGreaterThan(8);
  });

  it.each(["lower bound", "real conversion", "site conversion", "siteConversion"])(
    "never uses the phrase %p",
    (phrase) => {
      const offenders = sources
        .filter(({ text }) => text.toLowerCase().includes(phrase.toLowerCase()))
        .map(({ file }) => file);

      expect(offenders).toEqual([]);
    },
  );

  /**
   * `metrics.ts` is allowed to say "conversion rate" — it exists to explain
   * what the ratio is not, and holds the unavailable-state copy. Everywhere
   * else the phrase may only appear alongside a negation or the word
   * "unavailable".
   */
  it("labels no computed figure as a conversion rate", () => {
    const offenders = sources
      .filter(({ file }) => !file.endsWith("metrics.ts"))
      .flatMap(({ file, text }) =>
        [...text.matchAll(/label=\{?["'`]([^"'`]*[Cc]onversion rate[^"'`]*)["'`]/g)].map(
          (match) => `${file}: ${match[1]}`,
        ),
      );

    expect(offenders).toEqual([]);
  });
});
