import {
  DAYS_IN_PERIOD,
  OPS_PERIODS,
  addDays,
  dayKey,
  daysInWindow,
  isOpsPeriod,
  resolvePeriod,
  resolveTimezone,
  todayWindow,
  zonedDayStart,
} from "../period";

describe("period validation", () => {
  it.each(["7d", "30d", "90d"])("accepts %s", (value) => {
    expect(isOpsPeriod(value)).toBe(true);
  });

  it.each(["today", "1d", "365d", "", "7D", null, undefined, 7])(
    "rejects %p",
    (value) => {
      expect(isOpsPeriod(value)).toBe(false);
    },
  );

  it("exposes exactly the three supported periods", () => {
    expect([...OPS_PERIODS]).toEqual(["7d", "30d", "90d"]);
  });
});

describe("resolveTimezone", () => {
  it("defaults to the store's zone when unset", () => {
    expect(resolveTimezone("")).toBe("Europe/Berlin");
    expect(resolveTimezone(undefined)).toBe("Europe/Berlin");
  });

  it("accepts a valid IANA zone", () => {
    expect(resolveTimezone("America/New_York")).toBe("America/New_York");
  });

  /**
   * A typo in an env file must degrade, not 500. `Intl` throws on an unknown
   * zone, and that throw would otherwise reach every analytics request.
   */
  it("falls back rather than throwing on a nonsense zone", () => {
    expect(resolveTimezone("Not/AZone")).toBe("Europe/Berlin");
    expect(resolveTimezone("   ")).toBe("Europe/Berlin");
  });
});

describe("dayKey", () => {
  it("buckets by the reporting zone, not by UTC", () => {
    // 23:30 UTC on 30 July is already 01:30 on 31 July in Berlin (CEST, +2).
    const instant = new Date("2026-07-30T23:30:00.000Z");

    expect(dayKey(instant, "UTC")).toBe("2026-07-30");
    expect(dayKey(instant, "Europe/Berlin")).toBe("2026-07-31");
  });

  it("buckets a late-evening order behind UTC correctly", () => {
    // 02:00 UTC on 31 July is still 22:00 on 30 July in New York.
    const instant = new Date("2026-07-31T02:00:00.000Z");
    expect(dayKey(instant, "America/New_York")).toBe("2026-07-30");
  });
});

describe("zonedDayStart", () => {
  it("returns the UTC instant of local midnight in summer", () => {
    // CEST is UTC+2, so midnight Berlin is 22:00 the previous day UTC.
    expect(zonedDayStart("2026-07-31", "Europe/Berlin").toISOString()).toBe(
      "2026-07-30T22:00:00.000Z",
    );
  });

  it("returns the UTC instant of local midnight in winter", () => {
    // CET is UTC+1.
    expect(zonedDayStart("2026-01-15", "Europe/Berlin").toISOString()).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });

  it("is the identity in UTC", () => {
    expect(zonedDayStart("2026-07-31", "UTC").toISOString()).toBe(
      "2026-07-31T00:00:00.000Z",
    );
  });

  /**
   * The spring-forward day is the case the two-pass correction exists for: the
   * first guess lands on the other side of the jump.
   */
  it("handles the day a DST transition starts", () => {
    // Clocks go forward at 02:00 on 29 March 2026 in Berlin. Midnight is still
    // CET (+1), so local midnight is 23:00 UTC the previous day.
    expect(zonedDayStart("2026-03-29", "Europe/Berlin").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
  });
});

describe("addDays", () => {
  it("moves forward and back across a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });

  it("moves across a year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("handles a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("resolvePeriod", () => {
  const now = new Date("2026-08-01T09:00:00.000Z");

  it.each([
    ["7d", 7, "2026-07-26", "2026-08-01"],
    ["30d", 30, "2026-07-03", "2026-08-01"],
    ["90d", 90, "2026-05-04", "2026-08-01"],
  ] as const)(
    "%s covers %i days ending today",
    (period, days, startDay, endDay) => {
      const windows = resolvePeriod(period, { timeZone: "UTC", now });

      expect(windows.days).toBe(days);
      expect(DAYS_IN_PERIOD[period]).toBe(days);
      expect(windows.current.startDay).toBe(startDay);
      expect(windows.current.endDay).toBe(endDay);
      expect(daysInWindow(windows.current)).toHaveLength(days);
    },
  );

  /**
   * The comparison window has to be the same length, or a "+12%" is comparing
   * thirty days against twenty-eight.
   */
  it("gives the previous window the same length, ending the day before", () => {
    const windows = resolvePeriod("7d", { timeZone: "UTC", now });

    expect(windows.previous.endDay).toBe("2026-07-25");
    expect(windows.previous.startDay).toBe("2026-07-19");
    expect(daysInWindow(windows.previous)).toHaveLength(7);
  });

  it("makes the two windows adjacent and non-overlapping", () => {
    const windows = resolvePeriod("30d", { timeZone: "Europe/Berlin", now });

    expect(windows.previous.end.getTime()).toBe(windows.current.start.getTime());
    expect(windows.previous.start.getTime()).toBeLessThan(
      windows.previous.end.getTime(),
    );
  });

  it("closes the window on an exclusive upper bound", () => {
    const windows = resolvePeriod("7d", { timeZone: "UTC", now });

    // The last second of the last day is inside; the next midnight is not.
    expect(windows.current.end.toISOString()).toBe("2026-08-02T00:00:00.000Z");
  });

  it("shifts the window with the reporting zone", () => {
    const late = new Date("2026-08-01T23:30:00.000Z");

    expect(resolvePeriod("7d", { timeZone: "UTC", now: late }).current.endDay).toBe(
      "2026-08-01",
    );
    expect(
      resolvePeriod("7d", { timeZone: "Europe/Berlin", now: late }).current.endDay,
    ).toBe("2026-08-02");
  });
});

describe("todayWindow", () => {
  it("covers exactly one day", () => {
    const window = todayWindow({
      timeZone: "Europe/Berlin",
      now: new Date("2026-08-01T09:00:00.000Z"),
    });

    expect(window.startDay).toBe("2026-08-01");
    expect(window.endDay).toBe("2026-08-01");
    expect(window.start.toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-01T22:00:00.000Z");
  });
});
