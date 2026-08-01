import {
  formatChange,
  formatCurrency,
  formatDateTime,
  formatDay,
  formatDayLong,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  humanizeStatus,
} from "../format";
import {
  DEFAULT_PERIOD,
  DEFAULT_TAB,
  OPS_PERIODS,
  PERIOD_DESCRIPTIONS,
  TABS,
  parsePeriod,
  parseTab,
} from "../periods";
import { codeForStatus, errorGuidance, AnalyticsError } from "../errors";

/**
 * Non-breaking spaces are what `Intl` actually emits between a number and its
 * currency symbol, and asserting on a plain space would fail confusingly.
 */
const normalize = (value: string) =>
  value.replace(/[\u00A0\u202F]/g, " ");

describe("formatCurrency", () => {
  /**
   * The store's currency travels with every figure. Hardcoding EUR would be
   * right today — one region, one currency — and silently wrong the day a
   * second region exists.
   */
  it("formats in the currency it is given, not a hardcoded one", () => {
    expect(normalize(formatCurrency(1234.5, "eur"))).toBe("1.234,50 €");
    expect(normalize(formatCurrency(1234.5, "usd"))).toBe("1.234,50 $");
    expect(normalize(formatCurrency(1234.5, "gbp"))).toBe("1.234,50 £");
  });

  it("accepts an upper-case code", () => {
    expect(normalize(formatCurrency(10, "EUR"))).toBe("10,00 €");
  });

  it("falls back to EUR only when given nothing at all", () => {
    expect(normalize(formatCurrency(10, ""))).toBe("10,00 €");
  });

  it("uses German grouping and decimal separators", () => {
    expect(normalize(formatCurrency(1234567.89, "eur"))).toBe(
      "1.234.567,89 €",
    );
  });

  it("renders zero rather than an empty cell", () => {
    expect(normalize(formatCurrency(0, "eur"))).toBe("0,00 €");
  });

  it("never renders NaN", () => {
    expect(normalize(formatCurrency(NaN, "eur"))).toBe("0,00 €");
    expect(normalize(formatCurrency(Infinity, "eur"))).toBe("0,00 €");
  });

  it("compacts large values and drops the cents", () => {
    // German compact notation keeps thousands in full and abbreviates from a
    // million; either way the cents go, which is the point on a chart axis.
    expect(normalize(formatCurrency(12500, "eur", { compact: true }))).toBe(
      "12.500 €",
    );
    expect(normalize(formatCurrency(1234567, "eur", { compact: true }))).toBe(
      "1,2 Mio. €",
    );
  });
});

describe("formatNumber and formatPercent", () => {
  it("groups thousands", () => {
    expect(formatNumber(12345)).toBe("12.345");
  });

  it("renders a fraction as a percentage", () => {
    expect(normalize(formatPercent(0.1234))).toBe("12,3 %");
    expect(normalize(formatPercent(0))).toBe("0,0 %");
  });

  it("survives non-finite input", () => {
    expect(formatNumber(NaN)).toBe("0");
    expect(normalize(formatPercent(NaN))).toBe("0,0 %");
  });
});

describe("formatChange", () => {
  it("signs a positive change", () => {
    expect(normalize(formatChange(0.125))).toBe("+12,5 %");
  });

  it("leaves a negative change with its own sign", () => {
    expect(normalize(formatChange(-0.125))).toBe("-12,5 %");
  });

  /**
   * "No comparison" and "no change" are different facts. A card showing nothing
   * at all for the first reads as a rendering bug.
   */
  it("renders an em dash when there is no baseline", () => {
    expect(formatChange(null)).toBe("—");
  });
});

describe("dates", () => {
  it("formats a day in the reporting zone", () => {
    expect(formatDay("2026-07-31", "Europe/Berlin")).toBe("31.07.");
    expect(formatDayLong("2026-07-31", "Europe/Berlin")).toBe("31.07.2026");
  });

  /**
   * The server buckets days in the store's zone. Labelling them in the
   * browser's would put a chart and its total on different days.
   */
  it("renders a timestamp in the given zone, not the browser's", () => {
    const iso = "2026-07-31T22:30:00.000Z";

    expect(formatTime(iso, "UTC")).toBe("22:30:00");
    expect(formatTime(iso, "Europe/Berlin")).toBe("00:30:00");
    expect(formatDateTime(iso, "Europe/Berlin")).toBe("01.08., 00:30");
  });

  it("degrades rather than throwing on an unparseable value", () => {
    expect(formatDay("not-a-date", "UTC")).toBe("not-a-date");
    expect(formatTime("not-a-date", "UTC")).toBe("—");
  });
});

describe("formatDuration", () => {
  it.each([
    [null, "—"],
    [30, "30 s"],
    [90, "2 min"],
    [3600, "1 h"],
    [5400, "1 h 30 min"],
    [93600, "1 d 2 h"],
    [172800, "2 d"],
  ])("renders %p as %p", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it.each([
    ["2026-08-01T11:59:57.000Z", "just now"],
    ["2026-08-01T11:59:30.000Z", "30s ago"],
    ["2026-08-01T11:45:00.000Z", "15 min ago"],
    ["2026-08-01T09:00:00.000Z", "3 h ago"],
    ["2026-07-30T12:00:00.000Z", "2 d ago"],
  ])("renders %p as %p", (iso, expected) => {
    expect(formatRelative(iso, now)).toBe(expected);
  });
});

describe("humanizeStatus", () => {
  it("title-cases a Medusa enum", () => {
    expect(humanizeStatus("not_fulfilled")).toBe("Not fulfilled");
    expect(humanizeStatus("partially_captured")).toBe("Partially captured");
  });

  it("handles an empty status", () => {
    expect(humanizeStatus("")).toBe("—");
  });
});

describe("period and tab parsing", () => {
  it.each(["7d", "30d", "90d"])("accepts period %s from the URL", (value) => {
    expect(parsePeriod(value)).toBe(value);
  });

  /**
   * A hand-edited or stale URL should show a dashboard, not an error.
   */
  it.each(["today", "1d", "", "7D", null])(
    "falls back to the default for %p",
    (value) => {
      expect(parsePeriod(value)).toBe(DEFAULT_PERIOD);
    },
  );

  it.each(["overview", "live", "conversion"])(
    "accepts tab %s from the URL",
    (value) => {
      expect(parseTab(value)).toBe(value);
    },
  );

  it.each(["sources", "", null])("falls back to the default tab for %p", (value) => {
    expect(parseTab(value)).toBe(DEFAULT_TAB);
  });

  it("describes every period it offers", () => {
    for (const period of OPS_PERIODS) {
      expect(PERIOD_DESCRIPTIONS[period]).toMatch(/Last \d+ days/);
    }
    expect([...TABS]).toEqual(["overview", "live", "conversion"]);
  });
});

describe("error classification", () => {
  it.each([
    [503, "ga4", "GA4_NOT_CONFIGURED"],
    [403, "ga4", "GA4_PERMISSION_DENIED"],
    [404, "ga4", "GA4_PROPERTY_NOT_FOUND"],
    [502, "ga4", "GA4_API_UNAVAILABLE"],
    [400, "ga4", "GA4_INVALID_PERIOD"],
    [401, "ga4", "UNAUTHORIZED"],
    [503, "ops", "OPS_UNAVAILABLE"],
    [400, "ops", "OPS_INVALID_PERIOD"],
    [401, "ops", "UNAUTHORIZED"],
  ] as const)("maps %i on the %s API to %s", (status, scope, code) => {
    expect(codeForStatus(status, scope).code).toBe(code);
  });

  it("marks only genuinely transient failures as retryable", () => {
    expect(codeForStatus(502, "ga4").retryable).toBe(true);
    expect(codeForStatus(503, "ops").retryable).toBe(true);
    // Retrying a rejected key or a missing grant only delays the message that
    // tells the operator what to fix.
    expect(codeForStatus(403, "ga4").retryable).toBe(false);
    expect(codeForStatus(404, "ga4").retryable).toBe(false);
    expect(codeForStatus(503, "ga4").retryable).toBe(false);
  });

  it.each([
    "GA4_NOT_CONFIGURED",
    "GA4_INVALID_CREDENTIALS",
    "GA4_PERMISSION_DENIED",
    "GA4_PROPERTY_NOT_FOUND",
    "GA4_API_UNAVAILABLE",
    "GA4_INVALID_PERIOD",
    "OPS_INVALID_PERIOD",
    "OPS_UNAVAILABLE",
    "UNAUTHORIZED",
    "UNKNOWN",
  ] as const)("has actionable guidance for %s", (code) => {
    const guidance = errorGuidance(new AnalyticsError(code, "server message"));

    expect(guidance.code).toBe(code);
    expect(guidance.title.length).toBeGreaterThan(0);
    expect(guidance.detail.length).toBeGreaterThan(20);
  });

  /**
   * A GA4 failure must never read as though the shop's own numbers are in
   * doubt. Both GA4 configuration messages say so explicitly.
   */
  it.each(["GA4_NOT_CONFIGURED", "OPS_UNAVAILABLE"] as const)(
    "%s reassures the reader about the other data source",
    (code) => {
      expect(errorGuidance(new AnalyticsError(code, "")).detail).toMatch(
        /unaffected/i,
      );
    },
  );

  it("falls back safely for a non-AnalyticsError", () => {
    expect(errorGuidance(new Error("boom")).code).toBe("UNKNOWN");
    expect(errorGuidance(undefined).code).toBe("UNKNOWN");
  });

  /**
   * Guidance is written by us and must not interpolate a server string, which
   * is the one place a Google message could sneak onto the screen.
   */
  it("never echoes the raw error message", () => {
    const guidance = errorGuidance(
      new AnalyticsError("GA4_PERMISSION_DENIED", "ENOENT /secrets/key.json"),
    );

    expect(guidance.detail).not.toContain("ENOENT");
    expect(guidance.detail).not.toContain("/secrets");
  });
});
