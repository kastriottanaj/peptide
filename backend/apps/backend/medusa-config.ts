import { loadEnv, defineConfig, MedusaError } from '@medusajs/framework/utils'

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
  }
})
