/**
 * Server-side Google Analytics 4 reporting.
 *
 * **What this is for.** GA4 answers questions about *visitors*: how many, from
 * where, through which channel, on which pages, on what device, firing which
 * events. It also reports ecommerce figures, but those are GA4's own processed,
 * sampled, consent-dependent view of the browser events the storefront sent.
 *
 * **What it is not for.** Medusa's order records are the source of truth for
 * orders and revenue. GA4 revenue will not match the shop's books and is not
 * meant to: it misses everyone who declined statistics consent (this is a German
 * storefront with a hard consent gate — see docs/analytics.md), it attributes on
 * its own model, and it is subject to Google's processing latency. Realtime in
 * particular is an activity signal, **not live revenue reporting** — do not
 * present it as such.
 *
 * Nothing here is reachable from the storefront. All three callers are Medusa
 * admin routes, and the credential never leaves this process.
 */

import { Ga4Cache, type CacheMeta } from "./cache";
import { getGa4Client, type Ga4DataClient } from "./client";
import {
  resolveGa4Config,
  type Ga4AuthMethod,
  type Ga4Config,
} from "./config";
import { Ga4Error, classifyGa4Error, notConfigured } from "./errors";
import {
  formatGa4Date,
  rowsToObjects,
  totalsFromResponse,
  type Ga4ReportResponse,
} from "./normalize";

/** Only what this module logs through. Matches Medusa's logger structurally. */
export type Ga4Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

export const GA4_PERIODS = ["today", "7d", "30d"] as const;
export type Ga4Period = (typeof GA4_PERIODS)[number];

export function isGa4Period(value: unknown): value is Ga4Period {
  return (
    typeof value === "string" &&
    (GA4_PERIODS as readonly string[]).includes(value)
  );
}

/**
 * Date ranges per period, in GA4's relative-date form so the boundaries follow
 * the *property's* timezone rather than this server's. `7d` means the last seven
 * days including today, not the eight days that `7daysAgo`..`today` would span.
 */
const DATE_RANGES: Record<Ga4Period, { startDate: string; endDate: string }> = {
  today: { startDate: "today", endDate: "today" },
  "7d": { startDate: "6daysAgo", endDate: "today" },
  "30d": { startDate: "29daysAgo", endDate: "today" },
};

const REALTIME_TOTAL_METRICS = [
  "activeUsers",
  "screenPageViews",
  "eventCount",
  "keyEvents",
] as const;

const SUMMARY_TOTAL_METRICS = [
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
] as const;

/**
 * Daily series metrics.
 *
 * Deliberately excludes `itemsPurchased`: it is item-scoped, and GA4 rejects
 * some item-scoped/dimension pairings outright. The totals block carries it.
 */
const SUMMARY_DAILY_METRICS = [
  "activeUsers",
  "totalUsers",
  "newUsers",
  "sessions",
  "screenPageViews",
  "transactions",
  "purchaseRevenue",
  "keyEvents",
] as const;

/** Session-scoped metrics, safe against acquisition dimensions. */
const SUMMARY_CHANNEL_METRICS = [
  "sessions",
  "totalUsers",
  "newUsers",
  "transactions",
  "purchaseRevenue",
] as const;

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 250;

export type Ga4HealthResult = {
  configured: true;
  authenticated: true;
  propertyAccessible: true;
  propertyIdLastFour: string;
  measurementIdConfigured: boolean;
  /**
   * Which credential source won. Names a mechanism, never a value — and it is
   * the first thing worth knowing when production authenticates as something
   * other than what was intended.
   */
  authMethod: Ga4AuthMethod;
  generatedAt: string;
};

export type Ga4RealtimeResult = {
  totals: Record<(typeof REALTIME_TOTAL_METRICS)[number], number>;
  activeUsersByCountry: Array<Record<string, string | number>>;
  activeUsersByDeviceCategory: Array<Record<string, string | number>>;
  topPages: Array<Record<string, string | number>>;
  eventCountsByEventName: Array<Record<string, string | number>>;
  generatedAt: string;
  cache: CacheMeta;
};

export type Ga4SummaryResult = {
  period: Ga4Period;
  dateRange: { startDate: string; endDate: string };
  totals: Record<(typeof SUMMARY_TOTAL_METRICS)[number], number>;
  daily: Array<Record<string, string | number>>;
  byChannelGroup: Array<Record<string, string | number>>;
  bySourceMedium: Array<Record<string, string | number>>;
  generatedAt: string;
  cache: CacheMeta;
};

export type Ga4ServiceOptions = {
  client?: Ga4DataClient;
  cache?: Ga4Cache;
  logger?: Ga4Logger;
  /** Injectable so retry backoff does not make tests slow. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Ga4Service {
  #cache: Ga4Cache;
  #logger?: Ga4Logger;
  #client?: Ga4DataClient;
  #sleep: (ms: number) => Promise<void>;

  constructor(options: Ga4ServiceOptions = {}) {
    this.#cache = options.cache ?? new Ga4Cache();
    this.#logger = options.logger;
    this.#client = options.client;
    this.#sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Resolve config or throw `GA4_NOT_CONFIGURED`.
   *
   * Read per call rather than captured at construction: `medusa develop`
   * restarts on env changes, but a service pinned to a snapshot of the
   * environment is a debugging trap for the one time it does not.
   */
  #config(): Ga4Config {
    const result = resolveGa4Config();
    if (!result.ok) {
      // The specific problem is logged for the operator and generalised for the
      // client — which of the three variables is wrong is not a caller's
      // business, and "MISSING_CREDENTIALS" names no path.
      this.#logger?.warn(`[ga4] not configured: ${result.problem}`);
      throw notConfigured();
    }
    return result.config;
  }

  #resolveClient(config: Ga4Config): Ga4DataClient {
    return this.#client ?? getGa4Client(config);
  }

  /**
   * Cache key scoped to the configuration that produced the data.
   *
   * The property id and the credential fingerprint are part of every key, so
   * repointing `GA4_PROPERTY_ID` or rotating a credential under a running
   * process cannot serve a report fetched for the previous one. Both values are
   * process-internal — cache keys are never returned to a client — and the
   * fingerprint is not reversible in any case.
   */
  #cacheKey(config: Ga4Config, suffix: string): string {
    return `${config.propertyId}:${config.authFingerprint}:${suffix}`;
  }

  /**
   * One Google call, with a deadline and bounded retries.
   *
   * Retryability is decided by `classifyGa4Error`, never here — this loop must
   * not develop its own opinion about which of Google's failures are transient.
   * Invalid credentials and permission denials break out on the first attempt.
   */
  async #call<T>(label: string, run: () => Promise<T>): Promise<T> {
    let lastError: Ga4Error | undefined;

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
      try {
        return await run();
      } catch (error) {
        const ga4Error = classifyGa4Error(error);
        lastError = ga4Error;

        if (!ga4Error.retryable || attempt === RETRY_ATTEMPTS) {
          // Code and attempt count only. The original message is not logged:
          // a missing key file reports its full path in the message, and a
          // permission error names the service account.
          this.#logger?.error(
            `[ga4] ${label} failed code=${ga4Error.code} attempts=${attempt}`,
          );
          throw ga4Error;
        }

        this.#logger?.warn(
          `[ga4] ${label} transient code=${ga4Error.code} attempt=${attempt}, retrying`,
        );
        await this.#sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? classifyGa4Error(new Error("unreachable"));
  }

  async #runReport(
    config: Ga4Config,
    label: string,
    request: Record<string, unknown>,
  ): Promise<Ga4ReportResponse> {
    // Resolved inside the call so that a credential that fails to parse is
    // logged and classified on the same path as a failure from Google.
    return this.#call(label, async () => {
      const [response] = await this.#resolveClient(config).runReport(
        { property: config.property, ...request },
        { timeout: config.requestTimeoutMs },
      );
      return (response ?? {}) as Ga4ReportResponse;
    });
  }

  async #runRealtimeReport(
    config: Ga4Config,
    label: string,
    request: Record<string, unknown>,
  ): Promise<Ga4ReportResponse> {
    return this.#call(label, async () => {
      const [response] = await this.#resolveClient(config).runRealtimeReport(
        { property: config.property, ...request },
        { timeout: config.requestTimeoutMs },
      );
      return (response ?? {}) as Ga4ReportResponse;
    });
  }

  /**
   * Prove the service account can actually read the configured property.
   *
   * A config check alone would pass with a revoked key or a property the service
   * account was never granted, so this issues the smallest real report there is.
   *
   * Not cached, unlike the reporting endpoints: this is the button an operator
   * presses *because* they changed something, and answering from a 60-second-old
   * success would be worse than useless. Concurrent calls are still coalesced.
   */
  async checkHealth(): Promise<Ga4HealthResult> {
    const config = this.#config();

    await this.#cache.fetch(this.#cacheKey(config, "health"), 0, () =>
      this.#runReport(config, "health", {
        dateRanges: [DATE_RANGES.today],
        metrics: [{ name: "activeUsers" }],
        limit: 1,
      }),
    );

    return {
      configured: true,
      authenticated: true,
      propertyAccessible: true,
      propertyIdLastFour: config.propertyIdLastFour,
      measurementIdConfigured: config.measurementIdConfigured,
      authMethod: config.authMethod,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Current activity, from the Realtime API.
   *
   * Five separate calls rather than one: the Realtime API supports a much
   * narrower set of dimensions and metrics than the core API and rejects most
   * multi-dimension requests, so each breakdown has to be asked for on its own.
   * They run concurrently, so the wall-clock cost is one round trip.
   *
   * This is presence, not revenue. See the module comment.
   */
  async getRealtime(): Promise<Ga4RealtimeResult> {
    const config = this.#config();

    const { value, cache } = await this.#cache.fetch(
      this.#cacheKey(config, "realtime"),
      config.cacheTtlMs,
      async () => {
        const [totals, byCountry, byDevice, byPage, byEvent] =
          await Promise.all([
            this.#runRealtimeReport(config, "realtime.totals", {
              metrics: REALTIME_TOTAL_METRICS.map((name) => ({ name })),
            }),
            this.#runRealtimeReport(config, "realtime.country", {
              dimensions: [{ name: "country" }],
              metrics: [{ name: "activeUsers" }],
              limit: 25,
            }),
            this.#runRealtimeReport(config, "realtime.device", {
              dimensions: [{ name: "deviceCategory" }],
              metrics: [{ name: "activeUsers" }],
              limit: 10,
            }),
            this.#runRealtimeReport(config, "realtime.pages", {
              dimensions: [{ name: "unifiedScreenName" }],
              metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
              limit: 20,
            }),
            this.#runRealtimeReport(config, "realtime.events", {
              dimensions: [{ name: "eventName" }],
              metrics: [{ name: "eventCount" }],
              limit: 25,
            }),
          ]);

        return {
          totals: totalsFromResponse(totals, REALTIME_TOTAL_METRICS),
          activeUsersByCountry: rowsToObjects(byCountry, "country", [
            "activeUsers",
          ]),
          activeUsersByDeviceCategory: rowsToObjects(
            byDevice,
            "deviceCategory",
            ["activeUsers"],
          ),
          topPages: rowsToObjects(byPage, "unifiedScreenName", [
            "screenPageViews",
            "activeUsers",
          ]),
          eventCountsByEventName: rowsToObjects(byEvent, "eventName", [
            "eventCount",
          ]),
        };
      },
    );

    return { ...value, generatedAt: new Date().toISOString(), cache };
  }

  /**
   * Aggregated reporting for a fixed period.
   *
   * Four calls, split for the same compatibility reason as realtime, plus one of
   * its own: `itemsPurchased` is item-scoped and does not combine reliably with
   * session-scoped acquisition dimensions, so it lives only in `totals`.
   *
   * Ecommerce figures here are GA4's, not the shop's. Reconcile against Medusa
   * orders before quoting a number to anyone.
   */
  async getSummary(period: Ga4Period): Promise<Ga4SummaryResult> {
    const config = this.#config();
    const dateRange = DATE_RANGES[period];

    const { value, cache } = await this.#cache.fetch(
      this.#cacheKey(config, `summary:${period}`),
      config.cacheTtlMs,
      async () => {
        const [totals, daily, byChannel, bySourceMedium] = await Promise.all([
          this.#runReport(config, "summary.totals", {
            dateRanges: [dateRange],
            metrics: SUMMARY_TOTAL_METRICS.map((name) => ({ name })),
          }),
          this.#runReport(config, "summary.daily", {
            dateRanges: [dateRange],
            dimensions: [{ name: "date" }],
            metrics: SUMMARY_DAILY_METRICS.map((name) => ({ name })),
            orderBys: [{ dimension: { dimensionName: "date" } }],
            limit: 40,
          }),
          this.#runReport(config, "summary.channel", {
            dateRanges: [dateRange],
            dimensions: [{ name: "sessionDefaultChannelGroup" }],
            metrics: SUMMARY_CHANNEL_METRICS.map((name) => ({ name })),
            orderBys: [
              { metric: { metricName: "sessions" }, desc: true },
            ],
            limit: 25,
          }),
          this.#runReport(config, "summary.sourceMedium", {
            dateRanges: [dateRange],
            dimensions: [{ name: "sessionSourceMedium" }],
            metrics: SUMMARY_CHANNEL_METRICS.map((name) => ({ name })),
            orderBys: [
              { metric: { metricName: "sessions" }, desc: true },
            ],
            limit: 25,
          }),
        ]);

        return {
          totals: totalsFromResponse(totals, SUMMARY_TOTAL_METRICS),
          daily: rowsToObjects(
            daily,
            "date",
            SUMMARY_DAILY_METRICS,
            formatGa4Date,
          ),
          byChannelGroup: rowsToObjects(
            byChannel,
            "channelGroup",
            SUMMARY_CHANNEL_METRICS,
          ),
          bySourceMedium: rowsToObjects(
            bySourceMedium,
            "sourceMedium",
            SUMMARY_CHANNEL_METRICS,
          ),
        };
      },
    );

    return {
      period,
      dateRange,
      ...value,
      generatedAt: new Date().toISOString(),
      cache,
    };
  }
}

/**
 * Process-wide service.
 *
 * Shared so the cache and the client are shared — a per-request instance would
 * cache nothing and coalesce nothing, which is most of the point.
 */
let sharedService: Ga4Service | null = null;

export function getGa4Service(logger?: Ga4Logger): Ga4Service {
  if (!sharedService) sharedService = new Ga4Service({ logger });
  return sharedService;
}

/** Tests only. */
export function resetGa4Service(): void {
  sharedService = null;
}
