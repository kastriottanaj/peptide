import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Ga4Error } from "../errors";
import { getGa4Service } from "../service";

jest.mock("../service", () => ({
  ...jest.requireActual("../service"),
  getGa4Service: jest.fn(),
}));

import { GET as healthGET } from "../../../api/admin/analytics/ga4/health/route";
import { GET as realtimeGET } from "../../../api/admin/analytics/ga4/realtime/route";
import { GET as summaryGET } from "../../../api/admin/analytics/ga4/summary/route";

const mockedGetService = getGa4Service as jest.MockedFunction<
  typeof getGa4Service
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

describe("GET /admin/analytics/ga4/health", () => {
  it("returns the safe payload on success", async () => {
    serviceReturning({
      checkHealth: jest.fn().mockResolvedValue({
        configured: true,
        authenticated: true,
        propertyAccessible: true,
        propertyIdLastFour: "6789",
        measurementIdConfigured: true,
        generatedAt: "2026-07-31T10:00:00.000Z",
      }),
    });

    const res = fakeRes();
    await healthGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ propertyAccessible: true });
  });

  it.each([
    ["GA4_NOT_CONFIGURED", 503],
    ["GA4_INVALID_CREDENTIALS", 503],
    ["GA4_PERMISSION_DENIED", 403],
    ["GA4_PROPERTY_NOT_FOUND", 404],
    ["GA4_API_UNAVAILABLE", 502],
  ] as const)("maps %s to HTTP %i", async (code, status) => {
    serviceReturning({
      checkHealth: jest.fn().mockRejectedValue(new Ga4Error(code)),
    });

    const res = fakeRes();
    await healthGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({
      error: { code, message: expect.any(String) },
    });
  });

  it("never leaks the credential path when the key file is unreadable", async () => {
    // Shaped like a real fs failure, which always carries a `code`.
    const raw = Object.assign(
      new Error(
        "ENOENT: no such file or directory, open '/Users/x/secrets/key.json'",
      ),
      { code: "ENOENT" },
    );
    serviceReturning({ checkHealth: jest.fn().mockRejectedValue(raw) });

    const res = fakeRes();
    await healthGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(503);
    // Exact equality, not a substring check: nothing but the code and the
    // fixed message can be present if the whole body is these two fields.
    expect(res.body).toEqual({
      error: {
        code: "GA4_INVALID_CREDENTIALS",
        message: "The Google Analytics service-account credentials were rejected.",
      },
    });
    expect(JSON.stringify(res.body)).not.toContain("/Users/x/secrets/key.json");
  });

  it("does not let an unrecognised throw escape as a stack trace", async () => {
    const raw = new Error("totally unexpected internal failure");
    serviceReturning({ checkHealth: jest.fn().mockRejectedValue(raw) });

    const res = fakeRes();
    await healthGET(fakeReq(), res as never);

    // Unknown failures are reported as transient rather than blamed on the
    // credential — see classifyGa4Error.
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: { code: "GA4_API_UNAVAILABLE", message: expect.any(String) },
    });
    expect(JSON.stringify(res.body)).not.toContain("totally unexpected");
    expect(JSON.stringify(res.body)).not.toContain("stack");
  });
});

describe("GET /admin/analytics/ga4/realtime", () => {
  it("returns the report on success", async () => {
    serviceReturning({
      getRealtime: jest.fn().mockResolvedValue({ totals: { activeUsers: 4 } }),
    });

    const res = fakeRes();
    await realtimeGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ totals: { activeUsers: 4 } });
  });

  it("maps a service failure to its safe status", async () => {
    serviceReturning({
      getRealtime: jest
        .fn()
        .mockRejectedValue(new Ga4Error("GA4_API_UNAVAILABLE", true)),
    });

    const res = fakeRes();
    await realtimeGET(fakeReq(), res as never);

    expect(res.statusCode).toBe(502);
  });
});

describe("GET /admin/analytics/ga4/summary", () => {
  it("rejects an unsupported period without calling Google", async () => {
    const getSummary = jest.fn();
    serviceReturning({ getSummary });

    for (const period of ["1d", "90d", "yesterday", "7D", "", "all"]) {
      const res = fakeRes();
      await summaryGET(fakeReq({ period }), res as never);

      expect(res.statusCode).toBe(400);
      expect(res.body).toMatchObject({
        error: { code: "GA4_INVALID_PERIOD" },
      });
    }

    expect(getSummary).not.toHaveBeenCalled();
  });

  it("rejects a repeated query parameter", async () => {
    // `?period=7d&period=30d` arrives as an array; it must not be coerced.
    const getSummary = jest.fn();
    serviceReturning({ getSummary });

    const res = fakeRes();
    await summaryGET(fakeReq({ period: ["7d", "30d"] }), res as never);

    expect(res.statusCode).toBe(400);
    expect(getSummary).not.toHaveBeenCalled();
  });

  it("defaults to 7d when no period is given", async () => {
    const getSummary = jest.fn().mockResolvedValue({ period: "7d" });
    serviceReturning({ getSummary });

    const res = fakeRes();
    await summaryGET(fakeReq(), res as never);

    expect(getSummary).toHaveBeenCalledWith("7d");
    expect(res.statusCode).toBe(200);
  });

  it.each(["today", "7d", "30d"])("accepts period=%s", async (period) => {
    const getSummary = jest.fn().mockResolvedValue({ period });
    serviceReturning({ getSummary });

    const res = fakeRes();
    await summaryGET(fakeReq({ period }), res as never);

    expect(getSummary).toHaveBeenCalledWith(period);
    expect(res.statusCode).toBe(200);
  });

  it("maps a permission failure to 403", async () => {
    serviceReturning({
      getSummary: jest
        .fn()
        .mockRejectedValue(new Ga4Error("GA4_PERMISSION_DENIED")),
    });

    const res = fakeRes();
    await summaryGET(fakeReq({ period: "7d" }), res as never);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({
      error: { code: "GA4_PERMISSION_DENIED" },
    });
  });
});

/**
 * Authentication is structural in Medusa v2: `ApiLoader` applies
 * `authenticate("user", ["bearer","session","api-key"])` to `/admin` with no
 * `allowUnauthenticated`, while `/store` explicitly gets
 * `allowUnauthenticated: true`. So a route is protected by *where it lives* and
 * by not opting out — and those are exactly the two things asserted here.
 *
 * This is a real invariant, but it is not an end-to-end proof: only the
 * DB-backed `integration:http` suite can show the framework actually returning
 * 401 to an anonymous caller. What these tests do catch is the way this
 * protection realistically gets lost — a route copied to `src/api/store/`, or an
 * `AUTHENTICATE = false` added to silence a local 401.
 */
describe("admin-only by construction", () => {
  const apiRoot = join(__dirname, "..", "..", "..", "api");
  const ga4Root = join(apiRoot, "admin", "analytics", "ga4");
  const routes = ["health", "realtime", "summary"];

  /**
   * Source with comments removed. These routes *document* why they carry no
   * auth code, so a naive text search finds `allowUnauthenticated` in the very
   * comment explaining that it is not used.
   */
  function codeOnly(route: string): string {
    return readFileSync(join(ga4Root, route, "route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  it("keeps every GA4 route under the authenticated /admin namespace", () => {
    for (const route of routes) {
      expect(existsSync(join(ga4Root, route, "route.ts"))).toBe(true);
    }
  });

  it("has no analytics route under the public /store namespace", () => {
    // /store is loaded with allowUnauthenticated: true — an analytics route
    // there would need only a publishable key, which the storefront ships.
    const storeRoot = join(apiRoot, "store");
    const storeEntries = existsSync(storeRoot) ? readdirSync(storeRoot) : [];

    expect(storeEntries).not.toContain("analytics");
    expect(existsSync(join(storeRoot, "analytics"))).toBe(false);
  });

  it("does not opt any route out of authentication", () => {
    for (const route of routes) {
      const source = codeOnly(route);

      // `export const AUTHENTICATE = false` is the documented Medusa v2 escape
      // hatch. None of these routes may use it.
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

      expect(source).toContain("sendGa4Error");
      // No hand-built error body may bypass classification. The one exception
      // is the summary route's period validation, which reports no Google data.
      const handRolled = source.match(/res\.status\(\d+\)\.json/g) ?? [];
      const allowed = route === "summary" ? 1 : 0;
      expect(handRolled.length).toBe(allowed);
    }
  });
});
