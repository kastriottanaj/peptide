/**
 * The map component.
 *
 * jsdom has no layout engine, so nothing here asserts that the map *looks*
 * right — the geometry is fixed data and the projection is checked in
 * `country-lookup.admin.spec.tsx`. What is checked is the behaviour that keeps
 * the picture honest: the total on the map matches the data it was given, a
 * country with visitors is always visible however small it is, and the numbers
 * are reachable without seeing the picture at all.
 */

import { render, screen } from "@testing-library/react";
import { WorldMap } from "../world-map";

const format = (value: number) => String(value);

function renderMap(rows: Array<{ name: string; value: number }>) {
  return render(
    <WorldMap rows={rows} unit="active users" formatValue={format} />,
  );
}

describe("accessibility", () => {
  it("describes itself rather than announcing 'image'", () => {
    renderMap([
      { name: "Germany", value: 5 },
      { name: "Austria", value: 2 },
    ]);

    const map = screen.getByRole("img", {
      name: "Active users by country. 7 in total across 2 countries, led by Germany with 5.",
    });

    expect(map).toBeInTheDocument();
  });

  it("repeats the numbers in a visually hidden table", () => {
    const { container } = renderMap([
      { name: "Germany", value: 5 },
      { name: "Atlantis", value: 1 },
    ]);

    const table = container.querySelector("table.pa-sr");
    expect(table).not.toBeNull();

    // Both the placed country and the unplaceable one.
    const rows = [...table!.querySelectorAll("tbody tr")].map((row) =>
      row.textContent,
    );
    expect(rows).toEqual(["Germany5", "Atlantis1"]);
  });

  it("does not repeat the panel heading as the table caption", () => {
    const { container } = renderMap([{ name: "Germany", value: 5 }]);

    expect(container.querySelector("caption")?.textContent).toBe(
      "Active users per country",
    );
  });
});

describe("what gets drawn", () => {
  it("draws the whole world, not only the active countries", () => {
    const { container } = renderMap([{ name: "Germany", value: 5 }]);

    const countries = container.querySelectorAll(".pa-worldmap__country");
    const active = container.querySelectorAll(".pa-worldmap__country--active");

    expect(countries.length).toBeGreaterThan(150);
    expect(active).toHaveLength(1);
  });

  it("shades a country by its share of the peak", () => {
    const { container } = renderMap([
      { name: "Germany", value: 10 },
      { name: "Austria", value: 1 },
    ]);

    const [germany, austria] = [...container.querySelectorAll<SVGPathElement>(
      ".pa-worldmap__country--active",
    )].sort(
      (a, b) =>
        Number(b.getAttribute("fill-opacity")) -
        Number(a.getAttribute("fill-opacity")),
    );

    expect(Number(germany.getAttribute("fill-opacity"))).toBe(1);
    // The floor keeps the smallest participant legible rather than invisible.
    expect(Number(austria.getAttribute("fill-opacity"))).toBeGreaterThan(0.3);
    expect(Number(austria.getAttribute("fill-opacity"))).toBeLessThan(1);
  });

  /**
   * The reason markers exist at all. Fill alone cannot show a country whose
   * outline is smaller than a pixel, and this dashboard's most likely small
   * market is a real one.
   */
  it("marks a country the atlas has no outline for", () => {
    const { container } = renderMap([{ name: "Liechtenstein", value: 1 }]);

    expect(container.querySelectorAll(".pa-worldmap__country--active")).toHaveLength(
      0,
    );
    expect(container.querySelectorAll(".pa-worldmap__dot")).toHaveLength(1);

    // Queried directly rather than with `getByTitle`, which only matches a
    // `<title>` that is an immediate child of the `<svg>` — this one belongs
    // to the marker group.
    expect(
      container.querySelector(".pa-worldmap__marker title")?.textContent,
    ).toBe("Liechtenstein: 1");
  });

  it("marks every active country, so size never hides one", () => {
    const { container } = renderMap([
      { name: "Germany", value: 5 },
      { name: "Malta", value: 2 },
      { name: "Brazil", value: 1 },
    ]);

    expect(container.querySelectorAll(".pa-worldmap__dot")).toHaveLength(3);
  });

  it("sizes markers by value, largest for the leader", () => {
    const { container } = renderMap([
      { name: "Germany", value: 10 },
      { name: "Austria", value: 1 },
    ]);

    const radii = [...container.querySelectorAll(".pa-worldmap__dot")].map(
      (dot) => Number(dot.getAttribute("r")),
    );

    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });
});

describe("honesty about what it cannot place", () => {
  it("names unplaceable countries under the map", () => {
    renderMap([
      { name: "Germany", value: 5 },
      { name: "Atlantis", value: 2 },
    ]);

    expect(screen.getByText(/Not on the map: Atlantis \(2\)/)).toBeInTheDocument();
  });

  it("says nothing when everything was placed", () => {
    renderMap([{ name: "Germany", value: 5 }]);

    expect(screen.queryByText(/Not on the map/)).not.toBeInTheDocument();
  });

  it("survives a breakdown with nothing in it", () => {
    const { container } = renderMap([]);

    expect(
      screen.getByRole("img", { name: /No active users to show\./ }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".pa-worldmap__dot")).toHaveLength(0);
  });
});

/**
 * The panel shipped once with the ranked list's empty-state guard still in
 * front of it, so the map was invisible whenever nobody was on the site —
 * which is this shop's normal state, and is exactly when someone opens the
 * dashboard to look. These pin the map to the screen.
 */
describe("with nothing active", () => {
  it("still draws the world", () => {
    const { container } = renderMap([]);

    expect(
      container.querySelectorAll(".pa-worldmap__country").length,
    ).toBeGreaterThan(150);
  });

  it("puts the explanation over the map rather than replacing it", () => {
    const { container } = render(
      <WorldMap
        rows={[]}
        unit="active users"
        formatValue={format}
        emptyTitle="Nobody is active right now"
        emptyDescription="No visitors with statistics consent in the last 30 minutes."
      />,
    );

    expect(screen.getByText("Nobody is active right now")).toBeInTheDocument();
    expect(
      container.querySelectorAll(".pa-worldmap__country").length,
    ).toBeGreaterThan(150);
  });

  it("hides the legend, which would otherwise scale nothing", () => {
    const { container } = renderMap([]);

    expect(container.querySelector(".pa-worldmap__legend")).toBeNull();
  });

  it("shows the legend again as soon as there is data", () => {
    const { container } = renderMap([{ name: "Germany", value: 3 }]);

    expect(container.querySelector(".pa-worldmap__legend")).not.toBeNull();
  });

  it("keeps the empty copy out of the way once data arrives", () => {
    render(
      <WorldMap
        rows={[{ name: "Germany", value: 3 }]}
        unit="active users"
        formatValue={format}
        emptyTitle="Nobody is active right now"
      />,
    );

    expect(
      screen.queryByText("Nobody is active right now"),
    ).not.toBeInTheDocument();
  });
});
