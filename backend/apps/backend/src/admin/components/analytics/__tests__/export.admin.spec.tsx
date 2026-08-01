import { buildCsv, csvCell, csvFilename, downloadCsv } from "../../../lib/csv";
import { buildConversionCsv, buildOverviewCsv } from "../export";
import {
  conversion,
  emptyOverview,
  overview,
  summary,
} from "../../../__tests__/fixtures";

describe("csvCell", () => {
  it("quotes every cell", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell(42)).toBe('"42"');
  });

  it("escapes embedded quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("keeps a comma inside one field", () => {
    expect(csvCell("1.234,50 €")).toBe('"1.234,50 €"');
  });

  /**
   * Product titles are merchant-supplied. A title starting with `=` would
   * execute as a formula when the file is opened.
   */
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@import"])(
    "neutralises the formula prefix in %p",
    (value) => {
      expect(csvCell(value)).toBe(`"\t${value}"`);
    },
  );
});

describe("buildCsv", () => {
  it("writes a title, a header row and the data, separated by blank lines", () => {
    const csv = buildCsv([
      { title: "First", headers: ["a", "b"], rows: [[1, 2]] },
      { title: "Second", headers: ["c"], rows: [["x"]] },
    ]);

    expect(csv.split("\r\n")).toEqual([
      '"First"',
      '"a","b"',
      '"1","2"',
      "",
      '"Second"',
      '"c"',
      '"x"',
    ]);
  });

  it("uses CRLF, which is what Excel expects", () => {
    expect(buildCsv([{ title: "T", headers: ["a"], rows: [] }])).toContain("\r\n");
  });
});

describe("csvFilename", () => {
  it("names the tab, the period and the day", () => {
    expect(csvFilename("overview", "30d", new Date("2026-08-01T10:00:00Z"))).toBe(
      "analytics-overview-30d-2026-08-01.csv",
    );
  });
});

describe("buildOverviewCsv", () => {
  const sections = buildOverviewCsv("7d", overview, summary);
  const titles = sections.map((section) => section.title);
  const text = buildCsv(sections);

  it("leads with the report's own metadata", () => {
    expect(sections[0].title).toBe("Report");
    expect(sections[0].rows).toContainEqual(["period_key", "7d"]);
    expect(sections[0].rows).toContainEqual(["timezone", "Europe/Berlin"]);
  });

  it("exports the commerce and traffic sections", () => {
    expect(titles).toEqual(
      expect.arrayContaining([
        "Commerce KPIs (Medusa)",
        "Daily sales (Medusa)",
        "Sales breakdown (Medusa)",
        "Sales by product (Medusa)",
        "Google Analytics totals (processed, consent-dependent)",
        "Traffic by channel (Google Analytics)",
      ]),
    );
  });

  it("uses machine-readable headings and localized values", () => {
    const kpis = sections.find((s) => s.title === "Commerce KPIs (Medusa)");

    expect(kpis?.headers).toEqual([
      "metric",
      "value",
      "previous_period",
      "change",
    ]);
    expect(kpis?.rows[0][0]).toBe("sales_volume");
    expect(String(kpis?.rows[0][1])).toMatch(/2\.480,50/);
  });

  it("formats dates in the store's timezone", () => {
    const daily = sections.find((s) => s.title === "Daily sales (Medusa)");
    expect(daily?.rows[0][0]).toBe("26.07.2026");
  });

  /**
   * An export leaves the admin and outlives the session. Counts and sums are
   * what a period report is for; names, emails and order ids are not.
   */
  it("exports no customer name, email or order identifier", () => {
    expect(text).not.toContain("Testkunde");
    expect(text).not.toContain("order_test");
    expect(text).not.toContain("cus_test");
    expect(text).not.toContain("@");
    expect(titles).not.toContain("Recent orders");
    expect(titles).not.toContain("Top customers");
  });

  it("exports no credential or configuration value", () => {
    for (const secret of [
      "GA4_PROPERTY_ID",
      "GA4_SERVICE_ACCOUNT_JSON",
      "private_key",
      "client_email",
      "propertyIdLastFour",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  /**
   * A failed panel is simply absent. Fetching for an export would make a file
   * that claims to be "the visible summary" contain things that were not.
   */
  it("omits the GA4 sections when GA4 failed to load", () => {
    const withoutGa4 = buildOverviewCsv("7d", overview, undefined);
    const names = withoutGa4.map((section) => section.title);

    expect(names).toContain("Commerce KPIs (Medusa)");
    expect(names.some((name) => name.includes("Google Analytics"))).toBe(false);
  });

  it("omits the Medusa sections when the aggregation failed to load", () => {
    const withoutOps = buildOverviewCsv("7d", undefined, summary);
    const names = withoutOps.map((section) => section.title);

    expect(names).toContain("Traffic by channel (Google Analytics)");
    expect(names.some((name) => name.includes("(Medusa)"))).toBe(false);
  });

  it("still produces a valid file for a shop with no orders", () => {
    const empty = buildOverviewCsv("7d", emptyOverview, summary);
    const rendered = buildCsv(empty);

    expect(rendered).toContain('"sales_volume"');
    expect(rendered).toMatch(/0,00/);
  });
});

describe("buildConversionCsv", () => {
  const sections = buildConversionCsv("30d", conversion, summary);

  it("exports the payment, ratio, funnel and tracking sections", () => {
    expect(sections.map((section) => section.title)).toEqual(
      expect.arrayContaining([
        "Payments and orders (Medusa)",
        "Ratios (read the notes)",
        "Funnel",
        "Tracking quality (Medusa)",
        "Source / medium (Google Analytics)",
      ]),
    );
  });

  /**
   * The blended ratio must not travel under a conversion heading, and a CSV
   * outlives the screen it came from — so the caveat travels with it.
   */
  describe("the blended Medusa ÷ GA4 ratio", () => {
    const ratios = sections.find(
      (section) => section.title === "Ratios (read the notes)",
    );

    it("uses the exact diagnostic key, not a conversion one", () => {
      const keys = ratios?.rows.map((row) => row[0]);

      expect(keys).toContain("orders_per_tracked_ga4_session");
      expect(keys).not.toContain("site_conversion_rate");
      expect(keys).not.toContain("conversion_rate");
      expect(keys).not.toContain("shop_conversion_rate");
    });

    it("carries the warning in a note column", () => {
      const row = ratios?.rows.find(
        (candidate) => candidate[0] === "orders_per_tracked_ga4_session",
      );

      expect(row?.[2]).toBe(
        "This compares all Medusa orders with consent-dependent GA4 sessions. It is not a true shop-wide conversion rate and may be overstated.",
      );
    });

    it("never calls the ratio a conversion rate anywhere in the file", () => {
      const text = buildCsv(sections).toLowerCase();

      expect(text).not.toContain("lower bound");
      expect(text).not.toContain("real conversion");
      expect(text).not.toContain("site_conversion_rate");
    });
  });

  describe("shop conversion rate", () => {
    const payments = sections.find(
      (section) => section.title === "Payments and orders (Medusa)",
    );

    /**
     * A blank numeric cell reads as zero to a spreadsheet. The words are the
     * point.
     */
    it("is the literal string 'not available', never a blank or a number", () => {
      const row = payments?.rows.find(
        (candidate) => candidate[0] === "shop_conversion_rate",
      );

      expect(row?.[1]).toBe("not available");
    });

    it("gives the reason in its own row", () => {
      const row = payments?.rows.find(
        (candidate) => candidate[0] === "shop_conversion_rate_reason",
      );

      expect(row?.[1]).toBe(
        "A privacy-compliant first-party session denominator is not currently available.",
      );
    });
  });

  describe("GA4 transaction rate", () => {
    it("is computed from GA4 transactions and GA4 sessions only", () => {
      // Fixture: 0 transactions over 655 sessions.
      const ratios = sections.find(
        (section) => section.title === "Ratios (read the notes)",
      );
      const row = ratios?.rows.find(
        (candidate) => candidate[0] === "ga4_transaction_rate",
      );

      expect(String(row?.[1])).toMatch(/0,00/);
      expect(String(row?.[2])).toContain("GA4 transactions ÷ GA4 sessions");
    });

    it("reports 'not available' rather than dividing by zero sessions", () => {
      const withoutTraffic = buildConversionCsv("7d", conversion, {
        ...summary,
        totals: { ...summary.totals, sessions: 0, transactions: 0 },
      });
      const ratios = withoutTraffic.find(
        (section) => section.title === "Ratios (read the notes)",
      );

      for (const key of ["ga4_transaction_rate", "orders_per_tracked_ga4_session"]) {
        const row = ratios?.rows.find((candidate) => candidate[0] === key);
        expect(row?.[1]).toBe("not available");
      }

      const text = buildCsv(withoutTraffic);
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("Infinity");
      expect(text).not.toContain("∞");
    });

    it("reports 'not available' when GA4 did not load at all", () => {
      const withoutGa4 = buildConversionCsv("7d", conversion, undefined);
      const ratios = withoutGa4.find(
        (section) => section.title === "Ratios (read the notes)",
      );
      const row = ratios?.rows.find(
        (candidate) => candidate[0] === "ga4_transaction_rate",
      );

      expect(row?.[1]).toBe("not available");
    });
  });

  /**
   * The two steps nothing measures must say so in the file too — a blank cell
   * would read as zero.
   */
  it("marks the unmeasurable funnel steps as not available", () => {
    const funnel = sections.find((section) => section.title === "Funnel");

    expect(funnel?.rows).toContainEqual([
      "Added to cart",
      "not available",
      "unavailable",
    ]);
    expect(funnel?.rows).toContainEqual([
      "Checkout started",
      "not available",
      "unavailable",
    ]);
    expect(funnel?.rows).toContainEqual(["Order created", 14, "medusa"]);
  });

  it("fills the visitors step from the GA4 sessions total", () => {
    const funnel = sections.find((section) => section.title === "Funnel");
    expect(funnel?.rows[0]).toEqual(["Visitors", 655, "ga4"]);
  });

  it("marks checkout abandonment as unavailable rather than zero", () => {
    const tracking = sections.find(
      (section) => section.title === "Tracking quality (Medusa)",
    );
    expect(tracking?.rows).toContainEqual(["checkout_abandoned", "not available"]);
  });
});

describe("downloadCsv", () => {
  it("triggers a download with a UTF-8 BOM so Excel reads umlauts", () => {
    const createObjectURL = jest
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const revokeObjectURL = jest
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadCsv("analytics-overview-7d-2026-08-01.csv", '"Packgröße"');

    expect(click).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob.type).toContain("text/csv");

    // Nothing is left attached to the document once the click has happened.
    expect(document.querySelectorAll("a")).toHaveLength(0);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    click.mockRestore();
  });
});
