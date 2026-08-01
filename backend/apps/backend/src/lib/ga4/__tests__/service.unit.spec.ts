/**
 * `BetaAnalyticsDataClient` is mocked at the module boundary, so no test here
 * can open a socket to Google or read a credential file. Every test also points
 * `GOOGLE_APPLICATION_CREDENTIALS` at a path that does not exist — `loadEnv` in
 * `jest.config.js` puts the developer's real `.env` into `process.env`, and the
 * real service-account key must never be within reach of the suite.
 */

import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { Ga4Cache } from "../cache";
import { getGa4Client, resetGa4Client } from "../client";
import type { Ga4DataClient } from "../client";
import { resolveGa4Config, type Ga4Config } from "../config";
import { Ga4Service, isGa4Period, GA4_PERIODS } from "../service";

jest.mock("@google-analytics/data", () => ({
  BetaAnalyticsDataClient: jest.fn().mockImplementation(() => ({
    runReport: jest.fn().mockResolvedValue([{ rows: [] }]),
    runRealtimeReport: jest.fn().mockResolvedValue([{ rows: [] }]),
  })),
}));

const FAKE_CREDENTIALS = "/nonexistent/test-credentials.json";
const PROPERTY_ID = "123456789";

/** Fabricated. Not a key, not derived from one, and not valid anywhere. */
const FAKE_EMAIL = "fake-tests@fake-project-000000.iam.gserviceaccount.com";
const FAKE_KEY_BODY = "FAKEKEYMATERIALFORTESTS";
const ESCAPED_KEY = `-----BEGIN PRIVATE KEY-----\\n${FAKE_KEY_BODY}\\n-----END PRIVATE KEY-----\\n`;
const FAKE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: "service_account",
  project_id: "fake-project-000000",
  client_email: FAKE_EMAIL,
  private_key: ESCAPED_KEY,
});

const GA4_VARS = [
  "GA4_PROPERTY_ID",
  "GA4_MEASUREMENT_ID",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GA4_SERVICE_ACCOUNT_JSON",
  "GA4_ALLOW_DEFAULT_CREDENTIALS",
  "GA4_CACHE_TTL_SECONDS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(GA4_VARS.map((key) => [key, process.env[key]]));
  for (const key of GA4_VARS) delete process.env[key];

  process.env.GA4_PROPERTY_ID = PROPERTY_ID;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

  resetGa4Client();
  jest.clearAllMocks();
});

afterEach(() => {
  for (const key of GA4_VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
  resetGa4Client();
});

/** A stub standing in for the Google client. */
function stubClient(overrides: Partial<Ga4DataClient> = {}): Ga4DataClient & {
  runReport: jest.Mock;
  runRealtimeReport: jest.Mock;
} {
  return {
    runReport: jest.fn().mockResolvedValue([{ rows: [] }]),
    runRealtimeReport: jest.fn().mockResolvedValue([{ rows: [] }]),
    ...overrides,
  } as Ga4DataClient & { runReport: jest.Mock; runRealtimeReport: jest.Mock };
}

function makeService(client: Ga4DataClient, logger?: unknown) {
  return new Ga4Service({
    client,
    cache: new Ga4Cache(),
    logger: logger as never,
    // Retry backoff must not make the suite sleep for real.
    sleep: jest.fn().mockResolvedValue(undefined),
  });
}

function grpcError(code: number, message: string) {
  return Object.assign(new Error(message), { code });
}

function row(dimension: string | null, ...metrics: string[]) {
  return {
    ...(dimension === null
      ? {}
      : { dimensionValues: [{ value: dimension }] }),
    metricValues: metrics.map((value) => ({ value })),
  };
}

describe("configuration failures", () => {
  it("refuses every endpoint when the property id is missing", async () => {
    delete process.env.GA4_PROPERTY_ID;
    const client = stubClient();
    const service = makeService(client);

    for (const call of [
      () => service.checkHealth(),
      () => service.getRealtime(),
      () => service.getSummary("7d"),
    ]) {
      await expect(call()).rejects.toMatchObject({
        code: "GA4_NOT_CONFIGURED",
        status: 503,
      });
    }

    // Nothing was asked of Google — the failure is local.
    expect(client.runReport).not.toHaveBeenCalled();
    expect(client.runRealtimeReport).not.toHaveBeenCalled();
  });

  it("refuses when the credential variable is missing", async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const client = stubClient();

    await expect(makeService(client).checkHealth()).rejects.toMatchObject({
      code: "GA4_NOT_CONFIGURED",
      status: 503,
    });
    expect(client.runReport).not.toHaveBeenCalled();
  });

  it("refuses when the property id is not numeric", async () => {
    process.env.GA4_PROPERTY_ID = "G-TESTFAKE00";

    await expect(makeService(stubClient()).checkHealth()).rejects.toMatchObject({
      code: "GA4_NOT_CONFIGURED",
    });
  });

  it("names no variable and no path in the client-facing error", async () => {
    delete process.env.GA4_PROPERTY_ID;

    await makeService(stubClient())
      .checkHealth()
      .catch((error) => {
        const body = JSON.stringify(error.toResponse());
        expect(body).not.toContain(FAKE_CREDENTIALS);
        expect(body).not.toContain(PROPERTY_ID);
        expect(body).not.toContain("GA4_PROPERTY_ID");
      });
  });
});

/** Resolve the config for whatever the environment currently says. */
function currentConfig(): Ga4Config {
  const result = resolveGa4Config();
  if (!result.ok) throw new Error(`unexpected config problem: ${result.problem}`);
  return result.config;
}

describe("client construction", () => {
  it("builds one BetaAnalyticsDataClient and reuses it", () => {
    const config = currentConfig();
    const first = getGa4Client(config);
    const second = getGa4Client(config);

    expect(first).toBe(second);
    expect(BetaAnalyticsDataClient).toHaveBeenCalledTimes(1);
  });

  it("passes the credential path explicitly instead of relying on ADC", () => {
    getGa4Client(currentConfig());

    // Explicit, so an unset variable fails as "no credentials" rather than
    // silently authenticating as whatever else the machine offers.
    expect(BetaAnalyticsDataClient).toHaveBeenCalledWith({
      keyFilename: FAKE_CREDENTIALS,
    });
  });

  it("uses inline JSON credentials when they are configured", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;

    getGa4Client(currentConfig());

    expect(BetaAnalyticsDataClient).toHaveBeenCalledWith({
      credentials: {
        client_email: FAKE_EMAIL,
        // Escaped newlines are normalised on the way in.
        private_key: `-----BEGIN PRIVATE KEY-----\n${FAKE_KEY_BODY}\n-----END PRIVATE KEY-----\n`,
      },
      projectId: "fake-project-000000",
    });
    // No filesystem path is involved — the point of this path.
    const [options] = (BetaAnalyticsDataClient as unknown as jest.Mock).mock
      .calls[0];
    expect(options).not.toHaveProperty("keyFilename");
  });

  it("prefers inline JSON when both methods are present", () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = FAKE_CREDENTIALS;

    getGa4Client(currentConfig());

    const [options] = (BetaAnalyticsDataClient as unknown as jest.Mock).mock
      .calls[0];
    expect(options).toHaveProperty("credentials");
    expect(options).not.toHaveProperty("keyFilename");
  });

  it("omits projectId when the credential does not carry one", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: FAKE_EMAIL,
      private_key: ESCAPED_KEY,
    });

    getGa4Client(currentConfig());

    const [options] = (BetaAnalyticsDataClient as unknown as jest.Mock).mock
      .calls[0];
    expect(options).not.toHaveProperty("projectId");
  });

  it("lets the library discover ADC when that is the opted-in method", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GA4_ALLOW_DEFAULT_CREDENTIALS = "true";

    getGa4Client(currentConfig());

    expect(BetaAnalyticsDataClient).toHaveBeenCalledWith({});
  });

  it("rebuilds when the credential changes and not otherwise", () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.GA4_SERVICE_ACCOUNT_JSON = FAKE_SERVICE_ACCOUNT_JSON;
    getGa4Client(currentConfig());
    getGa4Client(currentConfig());
    expect(BetaAnalyticsDataClient).toHaveBeenCalledTimes(1);

    process.env.GA4_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "rotated@fake-project-000000.iam.gserviceaccount.com",
      private_key: ESCAPED_KEY,
    });
    getGa4Client(currentConfig());

    // A rotated credential must not keep using the client built from the old
    // one for the rest of the process lifetime.
    expect(BetaAnalyticsDataClient).toHaveBeenCalledTimes(2);
  });
});

describe("inline credential failures", () => {
  beforeEach(() => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON array", "[]"],
    ["a missing client_email", JSON.stringify({ private_key: ESCAPED_KEY })],
    ["a missing private_key", JSON.stringify({ client_email: FAKE_EMAIL })],
    [
      "an empty private_key",
      JSON.stringify({ client_email: FAKE_EMAIL, private_key: "" }),
    ],
  ])("reports %s as invalid credentials, not as unconfigured", async (_label, raw) => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = raw;

    // Not GA4_NOT_CONFIGURED: the variable is set, so the operator needs to
    // fix its contents rather than go looking for a variable to add.
    await expect(
      new Ga4Service({ cache: new Ga4Cache() }).checkHealth(),
    ).rejects.toMatchObject({
      code: "GA4_INVALID_CREDENTIALS",
      status: 503,
    });
  });

  it("keeps the credential out of the response and the log", async () => {
    process.env.GA4_SERVICE_ACCOUNT_JSON = `{"private_key": "${ESCAPED_KEY}", "client_email": "${FAKE_EMAIL}", oops}`;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    let thrown: { toResponse(): unknown } | undefined;
    await new Ga4Service({ cache: new Ga4Cache(), logger })
      .checkHealth()
      .catch((error) => {
        thrown = error;
      });

    const logged = [
      ...logger.error.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.info.mock.calls,
    ]
      .flat()
      .join(" ");
    const body = JSON.stringify(thrown?.toResponse());

    for (const secret of [FAKE_KEY_BODY, "PRIVATE KEY", FAKE_EMAIL]) {
      expect(body).not.toContain(secret);
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain("GA4_INVALID_CREDENTIALS");
  });
});

describe("checkHealth", () => {
  it("issues a real report against the configured property", async () => {
    const client = stubClient();
    await makeService(client).checkHealth();

    expect(client.runReport).toHaveBeenCalledTimes(1);
    const [request, options] = client.runReport.mock.calls[0];
    expect(request.property).toBe(`properties/${PROPERTY_ID}`);
    expect(request.metrics).toEqual([{ name: "activeUsers" }]);
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("returns only non-identifying fields", async () => {
    process.env.GA4_MEASUREMENT_ID = "G-TESTONLY123";
    const result = await makeService(stubClient()).checkHealth();

    expect(result).toEqual({
      configured: true,
      authenticated: true,
      propertyAccessible: true,
      propertyIdLastFour: "6789",
      measurementIdConfigured: true,
      // Names the mechanism, never a value.
      authMethod: "key_file",
      generatedAt: expect.any(String),
    });

    const body = JSON.stringify(result);
    expect(body).not.toContain(PROPERTY_ID);
    expect(body).not.toContain(FAKE_CREDENTIALS);
    expect(body).not.toContain("G-TESTONLY123");
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });

  it("is not served from cache — it is the button you press after changing something", async () => {
    const client = stubClient();
    const service = makeService(client);

    await service.checkHealth();
    await service.checkHealth();

    expect(client.runReport).toHaveBeenCalledTimes(2);
  });

  it("succeeds against a property with no traffic at all", async () => {
    const client = stubClient({
      runReport: jest.fn().mockResolvedValue([{}]),
    });

    await expect(makeService(client).checkHealth()).resolves.toMatchObject({
      propertyAccessible: true,
    });
  });
});

describe("error handling and retries", () => {
  it("does not retry a permission denial", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockRejectedValue(grpcError(7, "User does not have permissions")),
    });

    await expect(makeService(client).checkHealth()).rejects.toMatchObject({
      code: "GA4_PERMISSION_DENIED",
      status: 403,
    });
    expect(client.runReport).toHaveBeenCalledTimes(1);
  });

  it("does not retry invalid credentials", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockRejectedValue(grpcError(16, "invalid authentication credentials")),
    });

    await expect(makeService(client).checkHealth()).rejects.toMatchObject({
      code: "GA4_INVALID_CREDENTIALS",
      status: 503,
    });
    expect(client.runReport).toHaveBeenCalledTimes(1);
  });

  it("does not retry a quota error", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockRejectedValue(grpcError(8, "Exhausted property tokens")),
    });

    await expect(makeService(client).checkHealth()).rejects.toMatchObject({
      code: "GA4_API_UNAVAILABLE",
      status: 502,
    });
    // Retrying a quota failure deepens it for every other caller.
    expect(client.runReport).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and succeeds", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockRejectedValueOnce(grpcError(14, "unavailable"))
        .mockResolvedValueOnce([{ rows: [] }]),
    });

    await expect(makeService(client).checkHealth()).resolves.toMatchObject({
      propertyAccessible: true,
    });
    expect(client.runReport).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of attempts", async () => {
    const client = stubClient({
      runReport: jest.fn().mockRejectedValue(grpcError(14, "unavailable")),
    });

    await expect(makeService(client).checkHealth()).rejects.toMatchObject({
      code: "GA4_API_UNAVAILABLE",
      status: 502,
    });
    expect(client.runReport).toHaveBeenCalledTimes(3);
  });

  it("keeps Google's message out of the logger", async () => {
    const secret =
      "peptides-ga4@my-project-123456.iam.gserviceaccount.com key /Users/x/secrets/key.json";
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const client = stubClient({
      runReport: jest.fn().mockRejectedValue(grpcError(7, `Denied: ${secret}`)),
    });

    await expect(makeService(client, logger).checkHealth()).rejects.toThrow();

    const logged = [
      ...logger.error.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.info.mock.calls,
    ]
      .flat()
      .join(" ");

    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("iam.gserviceaccount.com");
    expect(logged).not.toContain(FAKE_CREDENTIALS);
    // What is logged is the code, which is what an operator needs.
    expect(logged).toContain("GA4_PERMISSION_DENIED");
  });
});

describe("getRealtime", () => {
  it("asks only for Realtime-supported dimensions and metrics", async () => {
    const client = stubClient();
    await makeService(client).getRealtime();

    // Five separate calls: the Realtime API rejects most multi-dimension
    // requests, so each breakdown is asked for on its own.
    expect(client.runRealtimeReport).toHaveBeenCalledTimes(5);

    const requests = client.runRealtimeReport.mock.calls.map(([r]) => r);
    const dimensions = requests
      .flatMap((r) => r.dimensions ?? [])
      .map((d: { name: string }) => d.name);
    const metrics = requests
      .flatMap((r) => r.metrics ?? [])
      .map((m: { name: string }) => m.name);

    expect(new Set(dimensions)).toEqual(
      new Set(["country", "deviceCategory", "unifiedScreenName", "eventName"]),
    );
    expect(new Set(metrics)).toEqual(
      new Set(["activeUsers", "screenPageViews", "eventCount", "keyEvents"]),
    );
    // The core-API-only dimensions would be rejected by Realtime.
    expect(dimensions).not.toContain("date");
    expect(dimensions).not.toContain("sessionSourceMedium");

    for (const [request] of client.runRealtimeReport.mock.calls) {
      expect(request.property).toBe(`properties/${PROPERTY_ID}`);
    }
  });

  it("normalizes every numeric string into a number", async () => {
    const client = stubClient({
      runRealtimeReport: jest
        .fn()
        .mockResolvedValueOnce([{ rows: [row(null, "17", "42", "88", "3")] }])
        .mockResolvedValueOnce([{ rows: [row("Germany", "12")] }])
        .mockResolvedValueOnce([{ rows: [row("mobile", "9")] }])
        .mockResolvedValueOnce([{ rows: [row("/produkte", "31", "8")] }])
        .mockResolvedValueOnce([{ rows: [row("page_view", "64")] }]),
    });

    const result = await makeService(client).getRealtime();

    expect(result.totals).toEqual({
      activeUsers: 17,
      screenPageViews: 42,
      eventCount: 88,
      keyEvents: 3,
    });
    expect(result.activeUsersByCountry).toEqual([
      { country: "Germany", activeUsers: 12 },
    ]);
    expect(result.activeUsersByDeviceCategory).toEqual([
      { deviceCategory: "mobile", activeUsers: 9 },
    ]);
    expect(result.topPages).toEqual([
      { unifiedScreenName: "/produkte", screenPageViews: 31, activeUsers: 8 },
    ]);
    expect(result.eventCountsByEventName).toEqual([
      { eventName: "page_view", eventCount: 64 },
    ]);

    for (const value of Object.values(result.totals)) {
      expect(typeof value).toBe("number");
    }
  });

  it("returns zeros and empty lists when nobody is on the site", async () => {
    const result = await makeService(stubClient()).getRealtime();

    expect(result.totals).toEqual({
      activeUsers: 0,
      screenPageViews: 0,
      eventCount: 0,
      keyEvents: 0,
    });
    expect(result.activeUsersByCountry).toEqual([]);
    expect(result.topPages).toEqual([]);
    expect(result.cache.status).toBe("miss");
    expect(result.generatedAt).toEqual(expect.any(String));
  });

  it("serves a second call from cache", async () => {
    const client = stubClient();
    const service = makeService(client);

    const first = await service.getRealtime();
    const second = await service.getRealtime();

    expect(first.cache.status).toBe("miss");
    expect(second.cache.status).toBe("hit");
    expect(client.runRealtimeReport).toHaveBeenCalledTimes(5);
  });

  it("does not cache a failed report", async () => {
    const failing = jest
      .fn()
      .mockRejectedValue(grpcError(7, "denied"))
      .mockName("runRealtimeReport");
    const client = stubClient({ runRealtimeReport: failing });
    const service = makeService(client);

    await expect(service.getRealtime()).rejects.toMatchObject({
      code: "GA4_PERMISSION_DENIED",
    });

    failing.mockResolvedValue([{ rows: [] }]);
    await expect(service.getRealtime()).resolves.toMatchObject({
      cache: { status: "miss" },
    });
  });
});

describe("getSummary", () => {
  it("accepts exactly the four supported periods", () => {
    expect(GA4_PERIODS).toEqual(["today", "7d", "30d", "90d"]);

    for (const period of GA4_PERIODS) expect(isGa4Period(period)).toBe(true);
    for (const invalid of [
      "1d",
      "180d",
      "7D",
      "yesterday",
      "",
      "  7d  ",
      null,
      undefined,
      7,
      ["7d"],
      { period: "7d" },
    ]) {
      expect(isGa4Period(invalid)).toBe(false);
    }
  });

  it("maps each period to its date range", async () => {
    const expected = {
      today: { startDate: "today", endDate: "today" },
      // Seven days *including* today, not the eight that 7daysAgo would span.
      "7d": { startDate: "6daysAgo", endDate: "today" },
      "30d": { startDate: "29daysAgo", endDate: "today" },
      "90d": { startDate: "89daysAgo", endDate: "today" },
    } as const;

    for (const period of GA4_PERIODS) {
      const client = stubClient();
      const result = await makeService(client).getSummary(period);

      expect(result.period).toBe(period);
      expect(result.dateRange).toEqual(expected[period]);
      for (const [request] of client.runReport.mock.calls) {
        expect(request.dateRanges).toEqual([expected[period]]);
      }
    }
  });

  it("requests the documented metrics and dimensions", async () => {
    const client = stubClient();
    await makeService(client).getSummary("7d");

    expect(client.runReport).toHaveBeenCalledTimes(5);

    const requests = client.runReport.mock.calls.map(([r]) => r);
    const totalsMetrics = (requests[0].metrics as { name: string }[]).map(
      (m) => m.name,
    );

    expect(totalsMetrics).toEqual([
      "activeUsers",
      "totalUsers",
      "newUsers",
      "sessions",
      "screenPageViews",
      "transactions",
      "purchaseRevenue",
      "totalRevenue",
      "itemsPurchased",
      "keyEvents",
    ]);

    const dimensions = requests
      .flatMap((r) => r.dimensions ?? [])
      .map((d: { name: string }) => d.name);
    expect(dimensions).toEqual([
      "date",
      "sessionDefaultChannelGroup",
      "sessionSourceMedium",
      "pagePath",
    ]);

    // itemsPurchased is item-scoped and only safe without a dimension.
    const dimensionedMetrics = requests
      .slice(1)
      .flatMap((r) => r.metrics as { name: string }[])
      .map((m) => m.name);
    expect(dimensionedMetrics).not.toContain("itemsPurchased");
  });

  it("normalizes totals, the daily series and the traffic breakdowns", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockResolvedValueOnce([
          {
            rows: [
              row(
                null,
                "100", "120", "45", "150", "480",
                "6", "749.94", "749.94", "11", "9",
              ),
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            rows: [
              row("20260730", "40", "48", "20", "60", "190", "2", "249.98", "4"),
              row("20260731", "60", "72", "25", "90", "290", "4", "499.96", "5"),
            ],
          },
        ])
        .mockResolvedValueOnce([
          { rows: [row("Organic Search", "90", "70", "30", "4", "499.96")] },
        ])
        .mockResolvedValueOnce([
          { rows: [row("google / organic", "85", "66", "28", "4", "499.96")] },
        ])
        .mockResolvedValueOnce([
          {
            rows: [
              row("/produkte", "210", "80"),
              row("/produkte/bpc-157", "140", "55"),
            ],
          },
        ]),
    });

    const result = await makeService(client).getSummary("7d");

    expect(result.totals).toEqual({
      activeUsers: 100,
      totalUsers: 120,
      newUsers: 45,
      sessions: 150,
      screenPageViews: 480,
      transactions: 6,
      purchaseRevenue: 749.94,
      totalRevenue: 749.94,
      itemsPurchased: 11,
      keyEvents: 9,
    });

    // Compact GA4 dates become ISO dates.
    expect(result.daily.map((d) => d.date)).toEqual(["2026-07-30", "2026-07-31"]);
    expect(result.daily[1]).toEqual({
      date: "2026-07-31",
      activeUsers: 60,
      totalUsers: 72,
      newUsers: 25,
      sessions: 90,
      screenPageViews: 290,
      transactions: 4,
      purchaseRevenue: 499.96,
      keyEvents: 5,
    });

    expect(result.byChannelGroup).toEqual([
      {
        channelGroup: "Organic Search",
        sessions: 90,
        totalUsers: 70,
        newUsers: 30,
        transactions: 4,
        purchaseRevenue: 499.96,
      },
    ]);
    expect(result.bySourceMedium[0].sourceMedium).toBe("google / organic");

    // Most-visited pages, ordered as Google returned them.
    expect(result.topPages).toEqual([
      { pagePath: "/produkte", screenPageViews: 210, activeUsers: 80 },
      { pagePath: "/produkte/bpc-157", screenPageViews: 140, activeUsers: 55 },
    ]);
  });

  it("returns zeros for a period with no data", async () => {
    const result = await makeService(stubClient()).getSummary("30d");

    expect(Object.values(result.totals).every((v) => v === 0)).toBe(true);
    expect(result.daily).toEqual([]);
    expect(result.byChannelGroup).toEqual([]);
    expect(result.bySourceMedium).toEqual([]);
    expect(result.topPages).toEqual([]);
  });

  /**
   * 90d was added after the endpoint shipped. These pin the two things that
   * could quietly break: the window really being ninety days, and the daily
   * series not being clipped by a row limit sized for thirty.
   */
  describe("90d", () => {
    it("asks Google for eighty-nine days ago through today", async () => {
      const client = stubClient();
      const result = await makeService(client).getSummary("90d");

      expect(result.period).toBe("90d");
      expect(result.dateRange).toEqual({
        startDate: "89daysAgo",
        endDate: "today",
      });
      for (const [request] of client.runReport.mock.calls) {
        expect(request.dateRanges).toEqual([
          { startDate: "89daysAgo", endDate: "today" },
        ]);
      }
    });

    it("allows enough daily rows for ninety days", async () => {
      const client = stubClient();
      await makeService(client).getSummary("90d");

      const daily = client.runReport.mock.calls
        .map(([request]) => request)
        .find((request) =>
          (request.dimensions ?? []).some(
            (dimension: { name: string }) => dimension.name === "date",
          ),
        );

      expect(daily.limit).toBeGreaterThanOrEqual(90);
    });

    it("returns all ninety days rather than the first forty", async () => {
      const days = Array.from({ length: 90 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 4, 4 + index));
        const compact = date.toISOString().slice(0, 10).replace(/-/g, "");
        return row(compact, "1", "1", "1", "1", "1", "0", "0", "0");
      });

      const client = stubClient({
        runReport: jest
          .fn()
          .mockResolvedValueOnce([{ rows: [] }])
          .mockResolvedValueOnce([{ rows: days }])
          .mockResolvedValue([{ rows: [] }]),
      });

      const result = await makeService(client).getSummary("90d");

      expect(result.daily).toHaveLength(90);
      expect(result.daily[0].date).toBe("2026-05-04");
      expect(result.daily[89].date).toBe("2026-08-01");
    });

    it("caches 90d separately from the shorter periods", async () => {
      const client = stubClient();
      const service = makeService(client);

      await service.getSummary("30d");
      const ninety = await service.getSummary("90d");

      expect(ninety.cache.status).toBe("miss");
      expect(client.runReport).toHaveBeenCalledTimes(10);
    });

    it("does not change the existing periods", async () => {
      const client = stubClient();
      const service = makeService(client);

      expect((await service.getSummary("today")).dateRange).toEqual({
        startDate: "today",
        endDate: "today",
      });
      expect((await service.getSummary("7d")).dateRange).toEqual({
        startDate: "6daysAgo",
        endDate: "today",
      });
      expect((await service.getSummary("30d")).dateRange).toEqual({
        startDate: "29daysAgo",
        endDate: "today",
      });
    });
  });

  it("caches each period independently", async () => {
    const client = stubClient();
    const service = makeService(client);

    await service.getSummary("7d");
    const cached = await service.getSummary("7d");
    const other = await service.getSummary("30d");

    expect(cached.cache.status).toBe("hit");
    expect(other.cache.status).toBe("miss");
    expect(client.runReport).toHaveBeenCalledTimes(10);
  });

  it("coalesces concurrent identical requests", async () => {
    const client = stubClient();
    const service = makeService(client);

    const [a, b] = await Promise.all([
      service.getSummary("7d"),
      service.getSummary("7d"),
    ]);

    expect(client.runReport).toHaveBeenCalledTimes(5);
    expect([a.cache.status, b.cache.status].sort()).toEqual([
      "coalesced",
      "miss",
    ]);
  });

  it("does not serve a cached report after the property changes", async () => {
    const client = stubClient({
      runReport: jest
        .fn()
        .mockResolvedValue([{ rows: [row(null, "1", "1", "1", "1", "1", "1", "1", "1", "1", "1")] }]),
    });
    const service = makeService(client);

    await service.getSummary("7d");
    expect((await service.getSummary("7d")).cache.status).toBe("hit");

    // Repointing the property mid-process must not answer from the previous
    // property's cache — that would report another site's numbers.
    process.env.GA4_PROPERTY_ID = "999888777";
    const afterSwitch = await service.getSummary("7d");

    expect(afterSwitch.cache.status).toBe("miss");
    const lastRequest = client.runReport.mock.calls.at(-1)?.[0];
    expect(lastRequest.property).toBe("properties/999888777");
  });

  it("does not serve a cached report after the credential changes", async () => {
    const client = stubClient();
    const service = makeService(client);

    await service.getSummary("7d");
    expect((await service.getSummary("7d")).cache.status).toBe("hit");

    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/nonexistent/rotated.json";

    expect((await service.getSummary("7d")).cache.status).toBe("miss");
  });

  it("never leaks configuration into a successful payload", async () => {
    process.env.GA4_MEASUREMENT_ID = "G-TESTONLY123";
    const result = await makeService(stubClient()).getSummary("7d");
    const body = JSON.stringify(result);

    for (const secret of [
      PROPERTY_ID,
      FAKE_CREDENTIALS,
      "G-TESTONLY123",
      "keyFilename",
      "gserviceaccount",
    ]) {
      expect(body).not.toContain(secret);
    }
  });
});
