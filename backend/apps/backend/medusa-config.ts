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
  const isWeak =
    !value ||
    value === KNOWN_PLACEHOLDER ||
    Buffer.byteLength(value, 'utf8') < 32

  if (isProduction && isWeak) {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      `${name} must be a unique secret of at least 32 bytes when NODE_ENV=production. ` +
        `Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
    )
  }

  return value
}

const jwtSecret = signingSecret('JWT_SECRET')
const cookieSecret = signingSecret('COOKIE_SECRET')
if (isProduction && jwtSecret === cookieSecret) {
  throw new MedusaError(
    MedusaError.Types.INVALID_ARGUMENT,
    'JWT_SECRET and COOKIE_SECRET must be distinct in production.'
  )
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

/**
 * Keep uploaded product media outside immutable releases.
 *
 * The local provider defaults to process.cwd()/static. Production runs from a
 * read-only generated server, so relying on that default makes every upload
 * fail and would lose media on release replacement even if writes succeeded.
 * The deploy creates a persistent state directory and exposes it through the
 * generated server's `static` symlink.
 */
function fileModule(): NonNullable<ConfigModule['modules']> {
  const uploadDir =
    process.env.FILE_UPLOAD_DIR ||
    (isProduction ? '/var/lib/peptides/static' : `${process.cwd()}/static`)
  const backendUrl =
    process.env.FILE_BACKEND_URL ||
    (isProduction
      ? 'https://api.peptideeinkaufen.de/static'
      : 'http://localhost:9000/static')

  if (isProduction && uploadDir !== '/var/lib/peptides/static') {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      'FILE_UPLOAD_DIR must be /var/lib/peptides/static in production so media ' +
        'stays in the backed-up runtime state directory.'
    )
  }
  if (isProduction && backendUrl !== 'https://api.peptideeinkaufen.de/static') {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      'FILE_BACKEND_URL must be https://api.peptideeinkaufen.de/static in production.'
    )
  }

  return {
    [Modules.FILE]: {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              upload_dir: uploadDir,
              backend_url: backendUrl,
            },
          },
        ],
      },
    },
  }
}

/**
 * HTTP session storage.
 *
 * `redisUrl` on `projectConfig` is a separate setting from the Redis *modules*
 * below, and it is the only thing that moves admin/customer sessions out of
 * express-session's `MemoryStore`. Configuring the modules alone leaves the
 * store in process memory: every restart or deploy silently logs everyone out,
 * and because `MemoryStore` never evicts, session records accumulate for the
 * life of the process. Medusa logs `redisUrl not found. A fake redis instance
 * will be used.` when this is missing, which is easy to read as a note about
 * the modules rather than a warning about sessions.
 */
const sessionStorage = process.env.REDIS_URL
  ? {
      redisUrl: process.env.REDIS_URL,
      // Namespaced so session keys cannot collide with the cache, event bus or
      // workflow-engine keys sharing this Redis instance.
      redisPrefix: process.env.REDIS_PREFIX || 'peptides:sess:',
    }
  : {}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    ...sessionStorage,
    http: {
      storeCors: corsOrigins('STORE_CORS'),
      adminCors: corsOrigins('ADMIN_CORS'),
      authCors: corsOrigins('AUTH_CORS'),
      jwtSecret,
      cookieSecret,
    }
  },
  modules: {
    ...redisModules(),
    ...fileModule(),
    // The inbound email inbox. Registered unconditionally: `INBOX_ENABLED`
    // governs whether mail is *imported*, not whether already-imported mail can
    // be read, so switching the importer off must not make /app/inbox start
    // failing on the messages it already holds. See docs/inbox.md.
    inbox: {
      resolve: './src/modules/inbox',
    },
  },
})
