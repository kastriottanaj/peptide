/**
 * Inbox configuration, read from the environment.
 *
 * Two rules shape this file, both borrowed from `lib/ga4/config.ts` because
 * they were right there:
 *
 *  - **The password is never on the config object.** It is reachable only
 *    through `imapPassword()`, so every use is one grep away and nobody can
 *    pick it up incidentally off an object they are already logging. The
 *    resolved config carries a boolean saying whether one is set, which is all
 *    any diagnostic needs.
 *  - **Nothing is validated unless the feature is on.** `INBOX_ENABLED` unset
 *    means a backend with no inbox variables boots and behaves exactly as it
 *    did before this feature existed — no connection, no warning, no failure.
 *
 * Numeric settings clamp rather than fail. A nonsense poll interval should
 * degrade to a sane one, not take a mail importer offline; a missing password,
 * by contrast, cannot degrade into anything.
 */

export type InboxConfigProblem =
  | "MISSING_HOST"
  | "MISSING_USER"
  | "MISSING_PASSWORD"
  | "INVALID_PORT";

export type InboxConfig = {
  host: string;
  port: number;
  /** Implicit TLS (993). `false` means STARTTLS on 143 — never cleartext. */
  secure: boolean;
  user: string;
  /** Presence only. The value lives behind `imapPassword()`. */
  passwordConfigured: true;
  mailbox: string;
  pollIntervalSeconds: number;
  /** Whether a first run may import mail that is already in the mailbox. */
  importExisting: boolean;
  /** How far back that first import may reach. Ignored when the above is off. */
  importSinceDays: number;
  /** `null` — the default — means nothing is ever deleted. */
  retentionDays: number | null;
  maxBodyChars: number;
  maxMessageBytes: number;
};

export type InboxConfigResult =
  | { ok: true; config: InboxConfig }
  | { ok: false; problem: InboxConfigProblem };

/* ------------------------------------------------------------- defaults -- */

const DEFAULT_PORT = 993;
const DEFAULT_MAILBOX = "INBOX";

const DEFAULT_POLL_SECONDS = 300;
const MIN_POLL_SECONDS = 60;
const MAX_POLL_SECONDS = 3600;

const DEFAULT_IMPORT_SINCE_DAYS = 14;
const MIN_IMPORT_SINCE_DAYS = 1;
const MAX_IMPORT_SINCE_DAYS = 365;

/**
 * Body limit. A hundred thousand characters is far more than anyone writes and
 * far less than a mail bomb; the excess is cut with a marker rather than
 * dropped silently.
 */
const DEFAULT_MAX_BODY_CHARS = 100_000;
const MIN_MAX_BODY_CHARS = 1_000;
const MAX_MAX_BODY_CHARS = 1_000_000;

/**
 * Per-message download cap. Messages above it are recorded from their envelope
 * with a placeholder body — the fact that they arrived is kept, the bytes are
 * not pulled through this process.
 */
const DEFAULT_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const MIN_MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_MAX_MESSAGE_BYTES = 50 * 1024 * 1024;

/** Address and header limits. Fixed, not configurable — these are RFC-shaped. */
export const INBOX_LIMITS = {
  /** RFC 5321 caps a path at 256 including the brackets; 320 is the usual max. */
  email: 320,
  displayName: 256,
  subject: 512,
  messageId: 512,
  /** `References` can be long; the useful part is the newest few. */
  references: 4_096,
  maxReferences: 20,
  maxRecipients: 50,
  maxAttachments: 25,
  filename: 255,
} as const;

/* ------------------------------------------------------------- reading --- */

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * A boolean env var, read the way `ORDERS_ENABLED` is read in
 * `src/api/middlewares.ts`: only the exact string `true` is true, so a
 * forgotten variable and a literal `"false"` both mean off.
 */
function flag(name: string, fallback: boolean): boolean {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "true";
}

function clampedInt(
  raw: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

/**
 * The off switch.
 *
 * Checked before anything else in the job, the route and the config resolver.
 * When this is false nothing in this feature opens a socket.
 */
export function inboxEnabled(): boolean {
  return env("INBOX_ENABLED").toLowerCase() === "true";
}

export function resolveInboxConfig(): InboxConfigResult {
  const host = env("INBOX_IMAP_HOST");
  if (!host) return { ok: false, problem: "MISSING_HOST" };

  const rawPort = env("INBOX_IMAP_PORT");
  const port = rawPort ? Number(rawPort) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, problem: "INVALID_PORT" };
  }

  const user = env("INBOX_IMAP_USER");
  if (!user) return { ok: false, problem: "MISSING_USER" };

  // Read only to check presence; the value is not carried out of this function.
  if (!env("INBOX_IMAP_PASSWORD")) return { ok: false, problem: "MISSING_PASSWORD" };

  // Unset means "keep everything", and so does an unreadable value: automatic
  // deletion of business correspondence is not something to infer from a typo.
  const retentionRaw = env("INBOX_RETENTION_DAYS");
  const retentionParsed = Number(retentionRaw);
  const retentionDays =
    retentionRaw && Number.isFinite(retentionParsed) && retentionParsed >= 1
      ? Math.min(Math.floor(retentionParsed), 3_650)
      : null;

  return {
    ok: true,
    config: {
      host,
      port,
      secure: flag("INBOX_IMAP_SECURE", true),
      user,
      passwordConfigured: true,
      mailbox: env("INBOX_IMAP_MAILBOX") || DEFAULT_MAILBOX,
      pollIntervalSeconds: clampedInt(
        env("INBOX_POLL_INTERVAL_SECONDS"),
        DEFAULT_POLL_SECONDS,
        MIN_POLL_SECONDS,
        MAX_POLL_SECONDS,
      ),
      importExisting: flag("INBOX_IMPORT_EXISTING", false),
      importSinceDays: clampedInt(
        env("INBOX_IMPORT_SINCE_DAYS"),
        DEFAULT_IMPORT_SINCE_DAYS,
        MIN_IMPORT_SINCE_DAYS,
        MAX_IMPORT_SINCE_DAYS,
      ),
      retentionDays,
      maxBodyChars: clampedInt(
        env("INBOX_MAX_BODY_CHARS"),
        DEFAULT_MAX_BODY_CHARS,
        MIN_MAX_BODY_CHARS,
        MAX_MAX_BODY_CHARS,
      ),
      maxMessageBytes: clampedInt(
        env("INBOX_MAX_MESSAGE_BYTES"),
        DEFAULT_MAX_MESSAGE_BYTES,
        MIN_MAX_MESSAGE_BYTES,
        MAX_MAX_MESSAGE_BYTES,
      ),
    },
  };
}

/**
 * The mailbox password, for handing to the IMAP client and nothing else.
 *
 * Isolated for the same reason `inlineServiceAccountJson()` is in the GA4
 * config: one accessor means one grep to find every use, and no object that
 * might be serialised ever holds the value.
 */
export function imapPassword(): string {
  return process.env.INBOX_IMAP_PASSWORD ?? "";
}

/**
 * The cron expression for the scheduled job, derived from the poll interval.
 *
 * Cron cannot express "every 90 seconds", so the interval is rounded to whole
 * minutes and capped at 59 — a step larger than the field's range stops meaning
 * what it looks like it means. The default 300s becomes the required five
 * minutes.
 */
export function inboxCronExpression(
  seconds = resolveInboxConfigOrDefaults().pollIntervalSeconds,
): string {
  const minutes = Math.min(Math.max(Math.round(seconds / 60), 1), 59);
  return `*/${minutes} * * * *`;
}

/**
 * The poll interval even when the rest of the configuration is incomplete.
 *
 * The job's schedule is fixed when the module is imported, which happens
 * whether or not the inbox is configured. It must not depend on a password
 * being present.
 */
function resolveInboxConfigOrDefaults(): { pollIntervalSeconds: number } {
  return {
    pollIntervalSeconds: clampedInt(
      env("INBOX_POLL_INTERVAL_SECONDS"),
      DEFAULT_POLL_SECONDS,
      MIN_POLL_SECONDS,
      MAX_POLL_SECONDS,
    ),
  };
}
