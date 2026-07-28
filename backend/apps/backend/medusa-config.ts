import { loadEnv, defineConfig, MedusaError, Modules } from '@medusajs/framework/utils'
import type { ConfigModule } from '@medusajs/framework/types'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const isProduction = process.env.NODE_ENV === 'production'

/** The value the Medusa scaffold used to ship in `.env.template`. */
const KNOWN_PLACEHOLDER = 'supersecret'

/**
 * Reads a signing secret, refusing to boot a production server with a guessable
 * one.
 *
 * `jwtSecret` and `cookieSecret` sign admin and customer sessions. Medusa falls
 * back to a built-in default when they are unset, and this project's template
 * used to ship the literal string `supersecret` — so the natural "copy the
 * template, fill in DATABASE_URL, deploy" path produced a store whose admin
 * tokens anyone could forge. Boot time is the only reliable place to catch
 * that: a weak signing key looks identical to a strong one at runtime, right up
 * until someone uses it.
 *
 * Development is deliberately left alone — local work should not need secret
 * management to run `medusa develop`.
 */
function signingSecret(name: 'JWT_SECRET' | 'COOKIE_SECRET'): string | undefined {
  const value = process.env[name]

  if (isProduction && (!value || value === KNOWN_PLACEHOLDER)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      `${name} must be set to a unique value when NODE_ENV=production ` +
        `(it is currently ${value ? 'the shared placeholder' : 'unset'}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
    )
  }

  return value
}

/**
 * CORS origins. Left unset in production these previously reached Medusa as
 * `undefined` behind a non-null assertion, which quietly hands the decision
 * about who may call the admin and auth APIs to a framework default.
 */
function corsOrigins(name: 'STORE_CORS' | 'ADMIN_CORS' | 'AUTH_CORS'): string {
  const value = process.env[name]

  if (!value) {
    if (isProduction) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        `${name} must be set when NODE_ENV=production.`
      )
    }
    return ''
  }

  return value
}

/**
 * Redis-backed infrastructure modules.
 *
 * Without `REDIS_URL`, Medusa falls back to in-memory implementations and logs
 * "a fake redis instance will be used". That is fine for `medusa develop` — it
 * keeps local work free of a Redis dependency — but on a server it means the
 * event bus, the cache and the workflow engine all live in process memory, so
 * every restart or deploy silently drops queued subscriber work and in-flight
 * workflows. The order confirmation email (go-live-checklist §6) will run as an
 * `order.placed` subscriber, so this has to be real before the shop takes money.
 *
 * `REDIS_URL` has been in `.env.template` since the scaffold, but nothing read
 * it until now.
 */
function redisModules(): ConfigModule['modules'] {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    if (isProduction) {
      throw new MedusaError(
        MedusaError.Types.INVALID_ARGUMENT,
        'REDIS_URL must be set when NODE_ENV=production. Without it the event ' +
          'bus, cache and workflow engine run in process memory and lose queued ' +
          'work on every restart.'
      )
    }
    return {}
  }

  return {
    [Modules.EVENT_BUS]: {
      resolve: '@medusajs/event-bus-redis',
      options: { redisUrl },
    },
    [Modules.CACHE]: {
      resolve: '@medusajs/cache-redis',
      options: { redisUrl },
    },
    [Modules.WORKFLOW_ENGINE]: {
      // Note the extra nesting and the different key: this module reads
      // `options.redis.redisUrl`, not `options.redisUrl` like the two above.
      // Passing it flat loads without error and then fails at boot.
      resolve: '@medusajs/workflow-engine-redis',
      options: { redis: { redisUrl } },
    },
    // Locking is deliberately left on Medusa's in-memory default. It only needs
    // to be shared when more than one Medusa instance runs against the same
    // database, and this deploy runs a single container. It is also shaped
    // differently from the modules above — a module with `providers`, not a
    // direct `resolve` — so it cannot simply be added to this list.
  }
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: corsOrigins('STORE_CORS'),
      adminCors: corsOrigins('ADMIN_CORS'),
      authCors: corsOrigins('AUTH_CORS'),
      jwtSecret: signingSecret('JWT_SECRET'),
      cookieSecret: signingSecret('COOKIE_SECRET'),
    }
  },
  modules: redisModules(),
})
