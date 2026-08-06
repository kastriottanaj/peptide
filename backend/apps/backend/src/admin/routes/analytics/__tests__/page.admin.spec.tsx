/**
 * The Analytics route, rendered.
 *
 * `lib/queries` is mocked rather than the network: these tests are about what
 * the page does with each query *state*, and driving that through fetch stubs
 * would mean testing react-query's scheduler instead of this code. Mocking the
 * module also keeps `lib/sdk` out of the graph entirely — it reads
 * `import.meta.env`, which only a bundler provides.
 *
 * The router is real. Tab and period state lives in the URL, so a fake router
 * would be testing nothing.
 */

import { render, screen, within, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ComponentType } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { AnalyticsError } from "../../../lib/errors";
import type { OpsOverview } from "../../../lib/types";
import * as fixtures from "../../../__tests__/fixtures";

jest.mock("../../../lib/queries", () => ({
  useOpsOverview: jest.fn(),
  useOpsConversion: jest.fn(),
  useOpsLive: jest.fn(),
  useGa4Summary: jest.fn(),
  useGa4Realtime: jest.fn(),
  useGa4Health: jest.fn(),
  useDocumentVisible: jest.fn(() => true),
  LIVE_POLL_MS: 60_000,
}));

import * as queries from "../../../lib/queries";
import AnalyticsPage, { config } from "../page";

const mocked = queries as jest.Mocked<typeof queries>;

/**
 * The slice of a react-query result the page reads.
 *
 * Declared rather than mocked wholesale so a change to what the page consumes
 * shows up here as a type error instead of as `undefined` at runtime.
 */
type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch: jest.Mock;
};

/** Cast to whatever hook signature the page expects. */
const asResult = <T,>(state: QueryState<T>) =>
  state as unknown as UseQueryResult<T, never>;

/** A settled, successful query result. */
function loaded<T>(data: T): QueryState<T> {
  return {
    data,
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: jest.fn(),
  };
}

/** A first load in flight — no data yet. */
function loading<T>(): QueryState<T> {
  return {
    data: undefined,
    isLoading: true,
    isFetching: true,
    error: null,
    refetch: jest.fn(),
  };
}

/** A failure with nothing cached to fall back to. */
function failed<T>(error: unknown): QueryState<T> {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error,
    refetch: jest.fn(),
  };
}

/** A failed refresh over data that did load once. */
function staleAfterFailure<T>(data: T, error: unknown): QueryState<T> {
  return { ...loaded(data), error };
}

function allHealthy() {
  mocked.useOpsOverview.mockReturnValue(asResult(loaded(fixtures.overview)));
  mocked.useOpsConversion.mockReturnValue(asResult(loaded(fixtures.conversion)));
  mocked.useOpsLive.mockReturnValue(asResult(loaded(fixtures.live)));
  mocked.useGa4Summary.mockReturnValue(asResult(loaded(fixtures.summary)));
  mocked.useGa4Realtime.mockReturnValue(asResult(loaded(fixtures.realtime)));
  mocked.useGa4Health.mockReturnValue(asResult(loaded(fixtures.health)));
  mocked.useDocumentVisible.mockReturnValue(true);
}

/**
 * `Intl` puts a non-breaking space between a number and its unit, which a
 * plain-space assertion misses in a way that reads as a value mismatch.
 */
const normalize = (value: string | null | undefined) =>
  (value ?? "").replace(/[\u00A0\u202F]/g, " ");

/** Exposes the current URL so the URL-state tests can assert on it. */
let currentSearch = "";

function LocationProbe() {
  currentSearch = useLocation().search;
  return null;
}

function renderPage(initialUrl = "/analytics"): RenderResult {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  currentSearch = "";
  allHealthy();
});

/* ------------------------------------------------------- navigation item -- */

describe("navigation item", () => {
  it("is registered with a label so it appears in the admin sidebar", () => {
    expect(config.label).toBe("Analytics");
  });

  /**
   * `defineRouteConfig` ignores an icon without a label, so both matter. The
   * icon is a renderable component — `@medusajs/icons` ships `forwardRef`
   * components, which are objects rather than plain functions.
   */
  it("carries a renderable icon component", () => {
    expect(config.icon).toBeDefined();
    expect(["function", "object"]).toContain(typeof config.icon);

    const Icon = config.icon as ComponentType;
    const { container } = render(<Icon />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("does not declare a nested position, so it sits at the top level", () => {
    expect(config.nested).toBeUndefined();
  });
});

/* ----------------------------------------------------------------- shell -- */

describe("page shell", () => {
  it("renders the title, the period and the connection state", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Analytics" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.getByText(/Google Analytics connected/)).toBeInTheDocument();
  });

  it("shows a last-updated time", () => {
    renderPage();
    expect(screen.getByText(/Updated /)).toBeInTheDocument();
  });

  it("offers exactly the three period buttons", () => {
    renderPage();

    const group = screen.getByRole("group", { name: "Reporting period" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["7D", "30D", "90D"]);
  });

  it("offers refresh and export actions", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeInTheDocument();
  });

  /**
   * One tablist inside the Medusa shell — this page adds a page-level tab bar,
   * never a second sidebar or a replacement layout.
   */
  it("renders one tablist with the three sections", () => {
    renderPage();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Live",
      "Conversion & Sources",
    ]);
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------ URL state -- */

describe("URL state", () => {
  it("defaults to the overview tab and 7 days", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "7D" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * A refresh in the middle of an investigation must not silently reset the
   * question being asked. This is the same thing a reload does: mount at the
   * URL that was in the address bar.
   */
  it.each([
    ["?tab=live", "Live"],
    ["?tab=conversion", "Conversion & Sources"],
    ["?tab=overview", "Overview"],
  ])("restores the tab from %s after a reload", (search, label) => {
    renderPage(`/analytics${search}`);

    expect(screen.getByRole("tab", { name: label })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it.each(["7d", "30d", "90d"])("restores period=%s after a reload", (period) => {
    renderPage(`/analytics?period=${period}`);

    expect(
      screen.getByRole("button", { name: period.toUpperCase() }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("restores tab and period together", () => {
    renderPage("/analytics?tab=conversion&period=90d");

    expect(
      screen.getByRole("tab", { name: "Conversion & Sources" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "90D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("falls back to the defaults for a nonsense URL rather than erroring", () => {
    renderPage("/analytics?tab=sales&period=all-time");

    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: "7D" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("writes the tab into the URL when one is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("tab", { name: "Live" }));

    expect(currentSearch).toContain("tab=live");
  });

  it("writes the period into the URL when one is clicked", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "30D" }));

    expect(currentSearch).toContain("period=30d");
  });

  it("keeps the tab when the period changes, and the period when the tab does", async () => {
    const user = userEvent.setup();
    renderPage("/analytics?tab=conversion&period=30d");

    await user.click(screen.getByRole("button", { name: "90D" }));
    expect(currentSearch).toContain("tab=conversion");
    expect(currentSearch).toContain("period=90d");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(currentSearch).toContain("tab=overview");
    expect(currentSearch).toContain("period=90d");
  });
});

/* -------------------------------------------------------- period fetching -- */

describe("period switching", () => {
  it.each(["7d", "30d", "90d"] as const)(
    "requests %s from both data sources",
    (period) => {
      renderPage(`/analytics?period=${period}`);

      expect(mocked.useOpsOverview).toHaveBeenCalledWith(period);
      expect(mocked.useGa4Summary).toHaveBeenCalledWith(period);
    },
  );

  it("refetches with the new period after a click", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(mocked.useOpsOverview).toHaveBeenLastCalledWith("7d");

    await user.click(screen.getByRole("button", { name: "90D" }));

    expect(mocked.useOpsOverview).toHaveBeenLastCalledWith("90d");
    // `useGa4Summary` is also called with "today" for the Live tab's card, so
    // the last call is not the period one.
    expect(mocked.useGa4Summary).toHaveBeenCalledWith("90d");
  });

  /**
   * A populated dashboard must not be replaced by skeletons on every period
   * click; the previous period stays on screen, dimmed, while the next loads.
   */
  it("keeps the previous data visible while the next period loads", () => {
    mocked.useOpsOverview.mockReturnValue(
      asResult({ ...loaded(fixtures.overview), isFetching: true }),
    );

    const { container } = render(
      <MemoryRouter initialEntries={["/analytics?period=30d"]}>
        <Routes>
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/2\.480,50/).length).toBeGreaterThan(0);
    expect(container.querySelector(".pa-dim")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- overview -- */

describe("Overview tab", () => {
  it("renders the four commerce KPIs from Medusa", () => {
    const { container } = renderPage();

    // Scoped to the KPI labels: several of these words also appear as table
    // headers further down the page.
    const labels = [...container.querySelectorAll(".pa-kpi__label")].map(
      (node) => node.textContent,
    );

    expect(labels).toEqual([
      "Sales volume",
      "Orders",
      "Average order value",
      "Open shipments",
    ]);
  });

  it("formats money in the store's currency", () => {
    renderPage();
    expect(screen.getAllByText(/2\.480,50\s?€/).length).toBeGreaterThan(0);
  });

  it("shows the change and the previous-period value on each KPI", () => {
    renderPage();

    expect(screen.getByText("+30,6 %")).toBeInTheDocument();
    expect(screen.getByText(/vs 1\.900,00\s?€ previous/)).toBeInTheDocument();
  });

  it("renders the sales trend chart with an accessible description", () => {
    renderPage();

    const chart = screen.getByRole("img", { name: /Daily sales from/ });
    expect(chart).toBeInTheDocument();
  });

  it("renders the panels the design asks for", () => {
    renderPage();

    for (const title of [
      "Sales trend",
      "Google Analytics",
      "Most visited pages",
      "Channels",
      "Recent orders",
      "Bestsellers",
      "Top customers",
      "Customer metrics",
      "Breakdown of total sales",
      "Average order value over time",
      "Fulfillment status",
      "Sales by payment method",
      "Sales after discount code",
      "Revenue by sales channel",
      "Sales by product",
      "Product sell-through rate",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("links a recent order to the admin's own order page", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "#1001" })).toHaveAttribute(
      "href",
      "/orders/order_test_001",
    );
  });

  it("shows compact status pills rather than raw enums", () => {
    renderPage();

    expect(screen.getAllByText("Captured").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not fulfilled").length).toBeGreaterThan(0);
    expect(screen.queryByText("not_fulfilled")).not.toBeInTheDocument();
  });

  it("shows no customer email anywhere on the page", () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/[\w.]+@[\w.]+/);
  });

  it("prints the GA4 revenue notice the policy requires", () => {
    renderPage();

    expect(
      screen.getByText(/Google Analytics revenue is processed/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Medusa orders remain the source of truth/),
    ).toBeInTheDocument();
  });

  /**
   * The storefront records no source on an order, so there is no key to join
   * GA4 channels to Medusa orders on. The panel must say that rather than
   * divide one aggregate by an unrelated other.
   */
  it("names the attribution gap instead of inventing a conversion rate", () => {
    renderPage();

    expect(
      screen.getByText(/Order attribution is not available/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/omitted rather than estimated/),
    ).toBeInTheDocument();
  });

  it("labels sell-through as unavailable and says why", () => {
    renderPage();

    expect(screen.getByText("No inventory history")).toBeInTheDocument();
    expect(
      screen.getByText(/stock level at the start of the period/),
    ).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- live -- */

describe("Live tab", () => {
  it("renders the four live cards from the right sources", () => {
    renderPage("/analytics?tab=live");

    expect(screen.getByText("Visitors now")).toBeInTheDocument();
    expect(screen.getByText("Visitors today")).toBeInTheDocument();
    expect(screen.getByText("Orders today")).toBeInTheDocument();
    expect(screen.getByText("Revenue today")).toBeInTheDocument();
  });

  it("shows the GA4 realtime visitor count on the 'visitors now' card", () => {
    const { container } = renderPage("/analytics?tab=live");

    const card = [...container.querySelectorAll(".pa-card")].find((node) =>
      node.querySelector(".pa-kpi__label")?.textContent === "Visitors now",
    );

    expect(card?.querySelector(".pa-kpi__value")?.textContent).toBe("7");
  });

  it("shows today's Medusa revenue in the store's currency", () => {
    renderPage("/analytics?tab=live");
    expect(screen.getByText(/269,80\s?€/)).toBeInTheDocument();
  });

  /**
   * GA4 realtime is a thirty-minute activity signal, not live revenue. Every
   * panel fed by it says so, and none of them uses the word "sales".
   */
  it("labels every GA4 realtime panel with its window", () => {
    renderPage("/analytics?tab=live");

    expect(
      screen.getAllByText(/approximately the last 30 minutes/).length,
    ).toBeGreaterThan(3);
  });

  it("attributes the money cards to Medusa, not to GA4", () => {
    renderPage("/analytics?tab=live");

    expect(screen.getByText(/Medusa · .* received/)).toBeInTheDocument();
  });

  it("renders a world map alongside the ranked list", () => {
    renderPage("/analytics?tab=live");

    expect(screen.getByText("Active users by country")).toBeInTheDocument();
    expect(screen.getByText("Top locations")).toBeInTheDocument();
    expect(screen.getAllByText("Germany").length).toBeGreaterThan(0);

    // The map is a picture of *where*; the list beside it stays because
    // reading an exact count off a choropleth is guesswork.
    const map = screen.getByRole("img", { name: /Active users by country/ });
    expect(map.tagName.toLowerCase()).toBe("svg");
  });

  it("renders the activity panels", () => {
    renderPage("/analytics?tab=live");

    for (const title of [
      "Active pages",
      "Events by name",
      "Active users by device",
      "Recent activity",
      "Orders placed today",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("names the missing product-activity and funnel data sources", () => {
    renderPage("/analytics?tab=live");

    expect(
      screen.getByText("Product activity and live funnel"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No ecommerce events are collected"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when nobody is on the site", () => {
    mocked.useGa4Realtime.mockReturnValue(asResult(loaded(fixtures.emptyRealtime)));
    mocked.useOpsLive.mockReturnValue(asResult(loaded(fixtures.emptyLive)));

    renderPage("/analytics?tab=live");

    expect(screen.getByText("Nobody is active right now")).toBeInTheDocument();
    expect(screen.getByText("No orders today")).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- polling -- */

describe("live polling", () => {
  it("polls only on the Live tab", () => {
    renderPage("/analytics?tab=overview");

    expect(mocked.useGa4Realtime).toHaveBeenCalledWith({
      enabled: false,
      poll: false,
    });
    expect(mocked.useOpsLive).toHaveBeenCalledWith({
      enabled: false,
      poll: false,
    });
  });

  it("polls both live sources while the Live tab is visible", () => {
    renderPage("/analytics?tab=live");

    expect(mocked.useGa4Realtime).toHaveBeenCalledWith({
      enabled: true,
      poll: true,
    });
    expect(mocked.useOpsLive).toHaveBeenCalledWith({
      enabled: true,
      poll: true,
    });
  });

  /**
   * A hidden tab costs Data API quota with nobody reading the result, and the
   * property's quota is shared with anyone else reporting on it.
   */
  it("stops polling when the browser tab is hidden", () => {
    mocked.useDocumentVisible.mockReturnValue(false);

    renderPage("/analytics?tab=live");

    expect(mocked.useGa4Realtime).toHaveBeenCalledWith({
      enabled: true,
      poll: false,
    });
    expect(mocked.useOpsLive).toHaveBeenCalledWith({
      enabled: true,
      poll: false,
    });
  });

  it("tells the reader why the numbers have stopped moving", () => {
    mocked.useDocumentVisible.mockReturnValue(false);

    renderPage("/analytics?tab=live");

    expect(
      screen.getByText(/Live updates are paused because this browser tab/),
    ).toBeInTheDocument();
  });

  it("says nothing about pausing while the tab is visible", () => {
    renderPage("/analytics?tab=live");

    expect(screen.queryByText(/Live updates are paused/)).not.toBeInTheDocument();
  });

  it("uses a 60 second interval", () => {
    expect(queries.LIVE_POLL_MS).toBe(60_000);
  });
});

/* ----------------------------------------------------------- conversion -- */

describe("Conversion & Sources tab", () => {
  it("renders the context and KPI cards", () => {
    renderPage("/analytics?tab=conversion");

    expect(screen.getByText("Selected period")).toBeInTheDocument();
    expect(screen.getByText("Medusa sales total")).toBeInTheDocument();
    expect(screen.getByText("Payment completion")).toBeInTheDocument();
    expect(screen.getByText("Time to payment")).toBeInTheDocument();
  });

  /**
   * Medusa orders ÷ GA4 sessions divides a complete numerator by a
   * consent-limited denominator, so it reads high. It may appear only under its
   * own name, as a diagnostic — never as a KPI and never in a table.
   */
  describe("the blended Medusa ÷ GA4 ratio", () => {
    it("is never presented under a generic conversion heading", () => {
      const { container } = renderPage("/analytics?tab=conversion");
      const text = container.textContent ?? "";

      // The words appear only in the unavailable card and the explanations of
      // why the ratio is not one — never as the label of a computed figure.
      const kpiLabels = [...container.querySelectorAll(".pa-kpi__label")].map(
        (node) => node.textContent,
      );
      expect(kpiLabels).not.toContain("Conversion rate");
      expect(kpiLabels).not.toContain("Shop conversion rate");

      expect(text).not.toContain("lower bound");
      expect(text).not.toContain("real conversion");
      expect(text).not.toMatch(/the real rate is higher/i);
    });

    it("appears only under the exact diagnostic name", () => {
      renderPage("/analytics?tab=conversion");

      expect(
        screen.getAllByText("Orders per tracked GA4 session").length,
      ).toBeGreaterThan(0);
    });

    it("carries its warning wherever it is shown", () => {
      renderPage("/analytics?tab=conversion");

      expect(
        screen.getByText(
          "This compares all Medusa orders with consent-dependent GA4 sessions. It is not a true shop-wide conversion rate and may be overstated.",
        ),
      ).toBeInTheDocument();
    });

    it("shows the value with both of its inputs, so the mixture is visible", () => {
      const { container } = renderPage("/analytics?tab=conversion");

      const card = [...container.querySelectorAll(".pa-card")].find((node) =>
        node.textContent?.includes("Orders per tracked GA4 session"),
      );

      // 14 Medusa orders ÷ 655 GA4 sessions.
      expect(normalize(card?.textContent)).toContain("2,14 %");
      expect(card?.textContent).toContain("Medusa orders");
      expect(card?.textContent).toContain("Tracked GA4 sessions");
    });

    it("is not rendered in any table", () => {
      const { container } = renderPage("/analytics?tab=conversion");

      const headers = [...container.querySelectorAll("th")].map(
        (node) => node.textContent,
      );
      expect(headers).not.toContain("Orders per tracked GA4 session");
      expect(headers).not.toContain("Conversion rate");
    });
  });

  /**
   * Where a true shop-wide conversion rate would go, and why it does not.
   */
  describe("shop-wide conversion rate", () => {
    it("shows an unavailable state with the reason", () => {
      renderPage("/analytics?tab=conversion");

      expect(screen.getByText("Shop conversion rate")).toBeInTheDocument();
      // "Not available" is also the hint on the order-attribution card.
      expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
      expect(
        screen.getByText(
          "A privacy-compliant first-party session denominator is not currently available.",
        ),
      ).toBeInTheDocument();
    });

    it("shows no percentage in that card", () => {
      const { container } = renderPage("/analytics?tab=conversion");

      const card = [...container.querySelectorAll(".pa-card")].find((node) =>
        node.textContent?.includes("Shop conversion rate"),
      );
      expect(card?.textContent).not.toMatch(/\d+,\d+\s?%/);
    });
  });

  describe("GA4 transaction rate", () => {
    /** GA4 transactions ÷ GA4 sessions — one population, so it means what it says. */
    it("is computed from GA4 figures only", () => {
      const { container } = renderPage("/analytics?tab=conversion");

      const card = [...container.querySelectorAll(".pa-card")].find((node) =>
        node.textContent?.includes("GA4 transaction rate"),
      );

      expect(card).toBeDefined();
      // Fixture: 0 transactions over 655 sessions.
      expect(normalize(card?.textContent)).toContain("0,00 %");

      // Scoped to the figures, not the prose: the note deliberately mentions
      // Medusa to say the rate is *not* the shop's. What must not appear is a
      // Medusa number among this card's inputs.
      const figures = [...(card?.querySelectorAll(".pa-stat__label") ?? [])].map(
        (node) => node.textContent,
      );
      expect(figures).toEqual([
        "GA4 transaction rate",
        "GA4 transactions",
        "GA4 sessions",
      ]);
      expect(figures).not.toContain("Medusa orders");
    });

    it("explains that it is not the shop's sales conversion", () => {
      renderPage("/analytics?tab=conversion");

      expect(
        screen.getByText(/This is not the shop's sales conversion/),
      ).toBeInTheDocument();
    });

    it("shows neither ratio when GA4 recorded no sessions", () => {
      mocked.useGa4Summary.mockReturnValue(asResult(loaded(fixtures.emptySummary)));

      const { container } = renderPage("/analytics?tab=conversion");
      const text = container.textContent ?? "";

      // Zero sessions must not become a division by zero, an Infinity or a NaN.
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("Infinity");
      expect(text).not.toContain("∞");
      expect(screen.getAllByText("Not enough data").length).toBe(2);
    });
  });

  it("renders the median time to payment in readable units", () => {
    renderPage("/analytics?tab=conversion");
    expect(screen.getByText("1 d 2 h")).toBeInTheDocument();
  });

  it("keeps all five funnel steps", () => {
    const { container } = renderPage("/analytics?tab=conversion");

    const steps = [...container.querySelectorAll(".pa-funnel__label")].map(
      (node) => node.textContent,
    );

    expect(steps).toEqual([
      "Visitors",
      "Added to cart",
      "Checkout started",
      "Order created",
      "Payment confirmed",
    ]);
  });

  /**
   * Two steps have no source. They must read as "no data source", never as a
   * zero, and never be quietly dropped so the funnel looks complete.
   */
  it("marks the two unmeasurable funnel steps as having no data source", () => {
    renderPage("/analytics?tab=conversion");
    expect(screen.getAllByText("No data source").length).toBeGreaterThanOrEqual(2);
  });

  it("fills the visitors step from GA4 sessions", () => {
    renderPage("/analytics?tab=conversion");
    expect(screen.getAllByText("655").length).toBeGreaterThan(0);
  });

  /**
   * `Order created ÷ Visitors` is the blended ratio wearing a funnel's
   * clothes — Medusa over GA4, with none of the labelling that makes the
   * diagnostic card honest. Step percentages stay within one system.
   */
  it("computes no step percentage across the GA4 to Medusa boundary", () => {
    const { container } = renderPage("/analytics?tab=conversion");

    const conversions = [
      ...container.querySelectorAll(".pa-funnel__conv"),
    ].map((node) => normalize(node.textContent));

    // Visitors, Added to cart, Checkout started, Order created all read "—";
    // only Payment confirmed ÷ Order created is same-source and computable.
    expect(conversions).toEqual(["—", "—", "—", "—", "64,3 %"]);
  });

  it("reports the order-attribution gap rather than an empty table", () => {
    renderPage("/analytics?tab=conversion");

    expect(
      screen.getByText("No source is recorded on orders"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/data gap in collection, not a reporting limitation/),
    ).toBeInTheDocument();
  });

  it("omits per-channel orders and sales, and says why", () => {
    renderPage("/analytics?tab=conversion");

    expect(
      screen.getByText(/no key on which a GA4 channel could be matched/),
    ).toBeInTheDocument();
  });

  it("renders the tracking-quality and source-summary panels", () => {
    renderPage("/analytics?tab=conversion");

    expect(screen.getByText("Tracking quality")).toBeInTheDocument();
    expect(screen.getByText("Source summary")).toBeInTheDocument();
    expect(screen.getByText("Orders by payment status")).toBeInTheDocument();
    expect(screen.getByText("Checkout abandoned")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- partial failure -- */

describe("partial failure", () => {
  const ga4Down = new AnalyticsError(
    "GA4_NOT_CONFIGURED",
    "Google Analytics reporting is not configured on this server.",
    503,
  );
  const opsDown = new AnalyticsError(
    "OPS_UNAVAILABLE",
    "Order analytics are temporarily unavailable. Please try again.",
    503,
    true,
  );

  /**
   * The single most important behaviour on this page: a Google outage must not
   * take the shop's own revenue off the screen.
   */
  it("keeps Medusa metrics on screen when every GA4 query fails", () => {
    mocked.useGa4Summary.mockReturnValue(asResult(failed(ga4Down)));
    mocked.useGa4Health.mockReturnValue(asResult(failed(ga4Down)));
    mocked.useGa4Realtime.mockReturnValue(asResult(failed(ga4Down)));

    renderPage();

    expect(screen.getAllByText(/2\.480,50\s?€/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sales volume").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "#1001" })).toBeInTheDocument();

    expect(
      screen.getAllByText("Google Analytics is not configured").length,
    ).toBeGreaterThan(0);
  });

  it("reassures the reader in the header that sales figures are unaffected", () => {
    mocked.useGa4Health.mockReturnValue(asResult(failed(ga4Down)));

    renderPage();

    expect(
      screen.getByText(/order and revenue figures are unaffected/),
    ).toBeInTheDocument();
  });

  it("keeps GA4 panels on screen when the Medusa aggregation fails", () => {
    mocked.useOpsOverview.mockReturnValue(asResult(failed(opsDown)));

    renderPage();

    // GA4's own figures are untouched...
    expect(screen.getByText("655")).toBeInTheDocument();
    expect(screen.getByText("Most visited pages")).toBeInTheDocument();
    expect(screen.getByText("/produkte")).toBeInTheDocument();

    // ...and the commerce side explains itself.
    expect(
      screen.getAllByText("Order analytics unavailable").length,
    ).toBeGreaterThan(0);
  });

  it("fails each panel independently on the conversion tab", () => {
    mocked.useGa4Summary.mockReturnValue(asResult(failed(ga4Down)));

    renderPage("/analytics?tab=conversion");

    expect(screen.getByText("Payment completion")).toBeInTheDocument();
    expect(screen.getAllByText("64,3 %").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Google Analytics is not configured").length,
    ).toBeGreaterThan(0);
  });

  it("shows the last successful data with a warning when a refresh fails", () => {
    mocked.useOpsOverview.mockReturnValue(
      asResult(staleAfterFailure(fixtures.overview, opsDown)),
    );

    renderPage();

    expect(screen.getAllByText(/2\.480,50\s?€/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Showing the last successful load/).length,
    ).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------- retrying -- */

describe("retry", () => {
  it("offers a retry button on a failed panel and calls refetch", async () => {
    const refetch = jest.fn();
    mocked.useOpsOverview.mockReturnValue(
      asResult<OpsOverview>({
        ...failed<OpsOverview>(
          new AnalyticsError("OPS_UNAVAILABLE", "unavailable", 503, true),
        ),
        refetch,
      }),
    );

    const user = userEvent.setup();
    renderPage();

    const [retry] = screen.getAllByRole("button", { name: /Try again|Retry/ });
    await user.click(retry);

    expect(refetch).toHaveBeenCalled();
  });

  it("refreshes both data sources from the header button", async () => {
    const opsRefetch = jest.fn();
    const ga4Refetch = jest.fn();

    mocked.useOpsOverview.mockReturnValue(
      asResult({ ...loaded(fixtures.overview), refetch: opsRefetch }),
    );
    mocked.useGa4Summary.mockReturnValue(
      asResult({ ...loaded(fixtures.summary), refetch: ga4Refetch }),
    );

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(opsRefetch).toHaveBeenCalled();
    expect(ga4Refetch).toHaveBeenCalled();
  });

  it("disables refresh while a fetch is in flight", () => {
    mocked.useOpsOverview.mockReturnValue(
      asResult({ ...loaded(fixtures.overview), isFetching: true }),
    );

    renderPage();

    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
  });
});

/* -------------------------------------------------------------- loading -- */

describe("loading", () => {
  it("shows skeletons that hold the final card dimensions", () => {
    mocked.useOpsOverview.mockReturnValue(asResult(loading()));
    mocked.useGa4Summary.mockReturnValue(asResult(loading()));

    const { container } = renderPage();

    expect(container.querySelectorAll(".pa-skel").length).toBeGreaterThan(0);
    // A KPI skeleton is a real card, so nothing reflows when data lands.
    expect(container.querySelectorAll(".pa-card").length).toBeGreaterThan(4);
  });

  it("keeps the header usable while everything is loading", () => {
    mocked.useOpsOverview.mockReturnValue(asResult(loading()));
    mocked.useGa4Summary.mockReturnValue(asResult(loading()));
    mocked.useGa4Health.mockReturnValue(asResult(loading()));

    renderPage();

    expect(screen.getByRole("heading", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByText(/Checking Google Analytics/)).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- empty -- */

describe("empty datasets", () => {
  beforeEach(() => {
    mocked.useOpsOverview.mockReturnValue(asResult(loaded(fixtures.emptyOverview)));
    mocked.useGa4Summary.mockReturnValue(asResult(loaded(fixtures.emptySummary)));
  });

  it("renders zeroed KPIs rather than blanks", () => {
    renderPage();

    expect(screen.getAllByText(/0,00\s?€/).length).toBeGreaterThan(0);
    expect(screen.getByText("Sales volume")).toBeInTheDocument();
  });

  /**
   * Growth from nothing is not a percentage. An em dash says "no comparison",
   * which is the truth on a shop with no previous orders.
   */
  it("shows an em dash instead of a fabricated percentage change", () => {
    renderPage();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("explains the empty sales trend", () => {
    renderPage();

    expect(screen.getByText("No orders in this period")).toBeInTheDocument();
    expect(
      screen.getByText(/Ordering is currently closed on the storefront/),
    ).toBeInTheDocument();
  });

  it("gives every empty panel its own message", () => {
    renderPage();

    expect(screen.getByText("No orders yet in this period")).toBeInTheDocument();
    // Bestsellers and "Sales by product" both say this.
    expect(
      screen.getAllByText("No products sold in this period").length,
    ).toBe(2);
    expect(screen.getByText("No customers with orders yet")).toBeInTheDocument();
    expect(screen.getByText("No page views recorded")).toBeInTheDocument();
    expect(
      screen.getByText("No traffic recorded in this period"),
    ).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- export -- */

describe("CSV export", () => {
  it("downloads the visible period's summary", async () => {
    const createObjectURL = jest
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const user = userEvent.setup();
    renderPage("/analytics?period=30d");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    createObjectURL.mockRestore();
    click.mockRestore();
  });

  it("exports the conversion report from the conversion tab", async () => {
    const blobs: Blob[] = [];
    const createObjectURL = jest
      .spyOn(URL, "createObjectURL")
      .mockImplementation((blob) => {
        blobs.push(blob as Blob);
        return "blob:test";
      });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const user = userEvent.setup();
    renderPage("/analytics?tab=conversion");

    await user.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(blobs).toHaveLength(1);

    createObjectURL.mockRestore();
    click.mockRestore();
  });
});

/* --------------------------------------------------------- no credentials -- */

/**
 * Nothing about the Google credential may reach the browser. The response
 * fixtures deliberately carry the safe health payload — a four-digit suffix and
 * a method name — and these assert that even that is not rendered as a full id,
 * and that no credential-shaped string appears at all.
 */
describe("no credentials in the UI", () => {
  it("renders no credential value, path or full property id", () => {
    const { container } = renderPage();
    const text = container.textContent ?? "";

    for (const secret of [
      "GA4_SERVICE_ACCOUNT_JSON",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "private_key",
      "client_email",
      "BEGIN PRIVATE KEY",
      "service_account",
      "gserviceaccount.com",
      ".iam.",
    ]) {
      expect(text).not.toContain(secret);
    }

    // No G-XXXXXXXXXX measurement id and no long numeric property id.
    expect(text).not.toMatch(/\bG-[A-Z0-9]{8,}\b/);
    expect(text).not.toMatch(/\b\d{9,}\b/);
  });

  it("shows only the last four digits of the property id", () => {
    renderPage();
    expect(screen.getByText(/\(…0000\)/)).toBeInTheDocument();
  });
});
