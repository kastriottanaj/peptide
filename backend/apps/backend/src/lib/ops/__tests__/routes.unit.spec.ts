import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { OpsError } from "../errors";
import { getOpsAnalyticsService } from "../service";

jest.mock("../service", () => ({
  ...jest.requireActual("../service"),
  getOpsAnalyticsService: jest.fn(),
}));

import { GET as overviewGET } from "../../../api/admin/analytics/ops/overview/route";
import { GET as liveGET } from "../../../api/admin/analytics/ops/live/route";
import { GET as conversionGET } from "../../../api/admin/analytics/ops/conversion/route";

const mockedGetService = getOpsAnalyticsService as jest.MockedFunction<
  typeof getOpsAnalyticsService
>;

type FakeRes = {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

function fakeReq(query: Record<string, unknown> = {}) {
  return { query, scope: { resolve: () => logger } } as never;
}

function serviceReturning(overrides: Record<string, unknown>) {
  mockedGetService.mockReturnValue(overrides as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /admin/analytics/ops/overview", () => {
  it("defaults to 7d when no period is given", async () => {
    const getOverview = jest.fn().mockResolvedValue({ period: "7d" });
    serviceReturning({ getOverview });

    const res = fakeRes();
    await overviewGET(fakeReq(), res as never);

    expect(getOverview).toHaveBeenCalledWith(expect.anything(), "7d");
    expect(res.statusCode).toBe(200);
  });

  it.each(["7d", "30d", "90d"])("accepts period=%s", async (period) => {
    const getOverview = jest.fn().mockResolvedValue({ period });
    serviceReturning({ getOverview });

    const res = fakeRes();
    await overviewGET(fakeReq({ period }), res as never);

    expect(getOverview).toHaveBeenCalledWith(expect.anything(), period);
    expect(res.statusCode).toBe(200);
  });

  /**
   * Strict validation, not a passthrough: the period is a cache key and a fixed
   * set of database windows, and an arbitrary one would defeat both.
   */
  it.each(["today", "1d", "365d", "7", "', 1=1 --", ""])(
    "rejects period=%p with 400",
    async (period) => {
      serviceReturning({ getOverview: jest.fn() });

      const res = fakeRes();
      await overviewGET(fakeReq({ period }), res as never);

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({ error: { code: "OPS_INVALID_PERIOD" } });
    },
  );

  it("names the accepted values in the rejection", async () => {
    serviceReturning({ getOverview: jest.fn() });

    const res = fakeRes();
    await overviewGET(fakeReq({ period: "nope" }), res as never);

    expect((res.body as { message: string }).message).toContain("7d, 30d, 90d");
  });

  it("does not let an internal failure reach the client", async () => {
    serviceReturning({
      getOverview: jest
        .fn()
        .mockRejectedValue(
          new Error("connect ECONNREFUSED 127.0.0.1:5432 medusa_peptides"),
        ),
    });

    const res = fakeRes();
    await overviewGET(fakeReq({ period: "7d" }), res as never);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "OPS_UNAVAILABLE" } });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("5432");
    expect(serialized).not.toContain("medusa_peptides");
  });

  /**
   * `@medusajs/js-sdk` keeps only the body's top-level `message` when it turns
   * a non-2xx into a `FetchError`. Without these the admin shows "Service
   * Unavailable" instead of the sentence written for it.
   *
   * The flattened pair is **additive**: the nested `error` object is the shape
   * the docs describe and any existing client reads, and it stays.
   */
  it("carries both the nested error object and the flat SDK fields", async () => {
    serviceReturning({
      getOverview: jest.fn().mockRejectedValue(new Error("boom")),
    });

    const res = fakeRes();
    await overviewGET(fakeReq({ period: "7d" }), res as never);

    const body = res.body as {
      error: { code: string; message: string };
      code: string;
      message: string;
    };

    // Nested — the documented, backward-compatible shape.
    expect(body.error).toEqual({
      code: "OPS_UNAVAILABLE",
      message: expect.stringContaining("temporarily unavailable"),
    });

    // Flat — what the admin SDK can actually read.
    expect(body.code).toBe(body.error.code);
    expect(body.message).toBe(body.error.message);

    // And nothing else.
    expect(Object.keys(body).sort()).toEqual(["code", "error", "message"]);
  });

  it("keeps both shapes on a period rejection too", async () => {
    serviceReturning({ getOverview: jest.fn() });

    const res = fakeRes();
    await overviewGET(fakeReq({ period: "1d" }), res as never);

    const body = res.body as {
      error: { code: string; message: string };
      code: string;
      message: string;
    };

    expect(body.error.code).toBe("OPS_INVALID_PERIOD");
    expect(body.code).toBe("OPS_INVALID_PERIOD");
    expect(body.message).toBe(body.error.message);
  });
});

describe("GET /admin/analytics/ops/live", () => {
  it("takes no period", async () => {
    const getLive = jest.fn().mockResolvedValue({ ordersToday: 0 });
    serviceReturning({ getLive });

    const res = fakeRes();
    await liveGET(fakeReq({ period: "90d" }), res as never);

    expect(getLive).toHaveBeenCalledWith(expect.anything());
    expect(getLive).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("reports a failure safely", async () => {
    serviceReturning({
      getLive: jest.fn().mockRejectedValue(new OpsError("OPS_UNAVAILABLE")),
    });

    const res = fakeRes();
    await liveGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(503);
  });
});

describe("GET /admin/analytics/ops/conversion", () => {
  it.each(["7d", "30d", "90d"])("accepts period=%s", async (period) => {
    const getConversion = jest.fn().mockResolvedValue({ period });
    serviceReturning({ getConversion });

    const res = fakeRes();
    await conversionGET(fakeReq({ period }), res as never);

    expect(getConversion).toHaveBeenCalledWith(expect.anything(), period);
    expect(res.statusCode).toBe(200);
  });

  it("rejects an unsupported period", async () => {
    serviceReturning({ getConversion: jest.fn() });

    const res = fakeRes();
    await conversionGET(fakeReq({ period: "today" }), res as never);

    expect(res.statusCode).toBe(400);
  });
});

/**
 * Authentication is structural in Medusa v2: `ApiLoader` applies
 * `authenticate("user", ["bearer","session","api-key"])` to `/admin` with no
 * `allowUnauthenticated`, while `/store` explicitly gets
 * `allowUnauthenticated: true`. So an admin route is protected by *where it
 * lives* and by not opting out, and those are the two things asserted here.
 *
 * These are not an end-to-end proof — only the DB-backed `integration:http`
 * suite can show the framework returning 401 to an anonymous caller. What they
 * catch is how the protection realistically gets lost: a route copied under
 * `src/api/store/`, or an `AUTHENTICATE = false` added to silence a local 401.
 * The same reasoning, and the same tests, guard the GA4 routes.
 */
describe("admin-only by construction", () => {
  const apiRoot = join(__dirname, "..", "..", "..", "api");
  const opsRoot = join(apiRoot, "admin", "analytics", "ops");
  const routes = ["overview", "live", "conversion"];

  function codeOnly(route: string): string {
    return readFileSync(join(opsRoot, route, "route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  it("keeps every ops route under the authenticated /admin namespace", () => {
    for (const route of routes) {
      expect(existsSync(join(opsRoot, route, "route.ts"))).toBe(true);
    }
  });

  it("has no analytics route under the public /store namespace", () => {
    const storeRoot = join(apiRoot, "store");
    const storeEntries = existsSync(storeRoot) ? readdirSync(storeRoot) : [];

    expect(storeEntries).not.toContain("analytics");
    expect(existsSync(join(storeRoot, "analytics"))).toBe(false);
  });

  it("does not opt any route out of authentication", () => {
    for (const route of routes) {
      const source = codeOnly(route);

      expect(source).not.toMatch(/AUTHENTICATE\s*=/);
      expect(source).not.toMatch(/allowUnauthenticated/);
    }
  });

  it("exposes only GET", () => {
    for (const route of routes) {
      const source = codeOnly(route);

      expect(source).toMatch(/export\s+async\s+function\s+GET/);
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(source).not.toMatch(
          new RegExp(`export\\s+async\\s+function\\s+${method}`),
        );
      }
    }
  });

  it("routes every failure through the one safe error funnel", () => {
    for (const route of routes) {
      const source = codeOnly(route);

      expect(source).toContain("sendOpsError");
      // No hand-built error body anywhere: even the period rejection goes
      // through `sendOpsError` with an `OpsError`.
      expect(source).not.toMatch(/res\.status\(\d+\)\.json/);
    }
  });

  /**
   * Nothing about the Google credential may travel to a browser, and the
   * cheapest place to keep that true is a grep over the sources that answer
   * admin requests.
   */
  it("never names a credential variable", () => {
    for (const route of routes) {
      const source = readFileSync(join(opsRoot, route, "route.ts"), "utf8");

      for (const secret of [
        "GA4_SERVICE_ACCOUNT_JSON",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "private_key",
        "client_email",
      ]) {
        expect(source).not.toContain(secret);
      }
    }
  });
});
