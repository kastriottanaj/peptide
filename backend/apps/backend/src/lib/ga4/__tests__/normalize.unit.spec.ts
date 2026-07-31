import {
  formatGa4Date,
  rowsToObjects,
  toNumber,
  totalsFromResponse,
} from "../normalize";

describe("toNumber", () => {
  it("converts the strings GA4 actually returns", () => {
    expect(toNumber("0")).toBe(0);
    expect(toNumber("1234")).toBe(1234);
    // Revenue arrives with decimals; rounding it here would lose cents.
    expect(toNumber("12.34")).toBe(12.34);
    expect(toNumber("  42  ")).toBe(42);
    expect(toNumber("1e3")).toBe(1000);
  });

  it("falls back to 0 rather than producing NaN", () => {
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber("")).toBe(0);
    expect(toNumber("n/a")).toBe(0);
    expect(toNumber("Infinity")).toBe(0);
  });

  it("returns a real number type, not a numeric string", () => {
    const value = toNumber("7");
    expect(typeof value).toBe("number");
    expect(value).not.toBe("7" as unknown as number);
  });
});

describe("totalsFromResponse", () => {
  const METRICS = ["activeUsers", "sessions", "purchaseRevenue"] as const;

  it("reads metrics positionally, in request order", () => {
    const response = {
      rows: [
        {
          metricValues: [
            { value: "12" },
            { value: "34" },
            { value: "56.78" },
          ],
        },
      ],
    };

    expect(totalsFromResponse(response, METRICS)).toEqual({
      activeUsers: 12,
      sessions: 34,
      purchaseRevenue: 56.78,
    });
  });

  it("returns zeros for an empty response instead of throwing", () => {
    // A property with no traffic today returns no rows at all — the quiet-day
    // case that must not break a dashboard.
    for (const empty of [{}, { rows: [] }, { rows: null }, null, undefined]) {
      expect(totalsFromResponse(empty, METRICS)).toEqual({
        activeUsers: 0,
        sessions: 0,
        purchaseRevenue: 0,
      });
    }
  });

  it("zero-fills metrics the response did not carry", () => {
    const response = { rows: [{ metricValues: [{ value: "9" }] }] };

    expect(totalsFromResponse(response, METRICS)).toEqual({
      activeUsers: 9,
      sessions: 0,
      purchaseRevenue: 0,
    });
  });
});

describe("rowsToObjects", () => {
  it("pairs the dimension with its metrics", () => {
    const response = {
      rows: [
        {
          dimensionValues: [{ value: "Germany" }],
          metricValues: [{ value: "5" }],
        },
        {
          dimensionValues: [{ value: "Austria" }],
          metricValues: [{ value: "2" }],
        },
      ],
    };

    expect(rowsToObjects(response, "country", ["activeUsers"])).toEqual([
      { country: "Germany", activeUsers: 5 },
      { country: "Austria", activeUsers: 2 },
    ]);
  });

  it("returns an empty array for an empty response", () => {
    expect(rowsToObjects({ rows: [] }, "country", ["activeUsers"])).toEqual([]);
    expect(rowsToObjects(undefined, "country", ["activeUsers"])).toEqual([]);
  });

  it("applies the dimension transform", () => {
    const response = {
      rows: [
        {
          dimensionValues: [{ value: "20260731" }],
          metricValues: [{ value: "3" }],
        },
      ],
    };

    expect(
      rowsToObjects(response, "date", ["sessions"], formatGa4Date),
    ).toEqual([{ date: "2026-07-31", sessions: 3 }]);
  });

  it("survives a row missing its dimension value", () => {
    const response = { rows: [{ metricValues: [{ value: "1" }] }] };

    expect(rowsToObjects(response, "country", ["activeUsers"])).toEqual([
      { country: "", activeUsers: 1 },
    ]);
  });
});

describe("formatGa4Date", () => {
  it("expands the compact GA4 date", () => {
    expect(formatGa4Date("20260731")).toBe("2026-07-31");
    expect(formatGa4Date("20260101")).toBe("2026-01-01");
  });

  it("passes through anything that is not a GA4 date", () => {
    // GA4 buckets overflow rows as `(other)`; mangling that into a date would
    // be worse than leaving it alone.
    expect(formatGa4Date("(other)")).toBe("(other)");
    expect(formatGa4Date("")).toBe("");
  });
});
