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

export type SmtpConfigProblem =
  | "MISSING_SMTP_HOST"
  | "MISSING_SMTP_USER"
  | "MISSING_SMTP_PASSWORD"
  | "MISSING_SMTP_FROM"
  | "INVALID_SMTP_FROM"
  | "INVALID_SMTP_PORT";

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

/**
 * Reply limits.
 *
 * A support reply is a few paragraphs. Ten thousand characters is far more
 * than anyone writes and small enough that a runaway client cannot post a book
 * through an authenticated session.
 */
const DEFAULT_MAX_REPLY_CHARS = 10_000;
const MIN_MAX_REPLY_CHARS = 500;
const MAX_MAX_REPLY_CHARS = 100_000;

/**
 * Reply rate limits, fixed rather than configurable.
 *
 * These exist to bound the damage of a stuck client or a compromised admin
 * session, not to pace a human typing: nobody writes two replies to the same
 * conversation inside ten seconds, and thirty an hour is well above what this
 * shop's support volume can produce. A number in the environment would be one
 * more thing to get wrong on a night when it matters.
 */
export const REPLY_RATE_LIMITS = {
  /** Minimum gap between two replies in the same thread. */
  perThreadIntervalMs: 10_000,
  /** Ceiling across all threads, over a rolling window. */
  globalMax: 30,
  globalWindowMs: 60 * 60 * 1000,
} as const;

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

/* ------------------------------------------------------------------ smtp -- */

export type SmtpConfig = {
  host: string;
  port: number;
  /** Implicit TLS (465). `false` means STARTTLS on 587 — never cleartext. */
  secure: boolean;
  user: string;
  /** Presence only. The value lives behind `smtpPassword()`. */
  passwordConfigured: true;
  /**
   * The one address replies are ever sent from. Not a default, not a
   * suggestion: the endpoint takes no `from` and there is no code path that
   * could put a caller-supplied address here.
   */
  from: string;
  maxReplyChars: number;
};

export type SmtpConfigResult =
  | { ok: true; config: SmtpConfig }
  | { ok: false; problem: SmtpConfigProblem };

const DEFAULT_SMTP_PORT = 465;

/**
 * The sending off switch, independent of the importer's.
 *
 * Reading mail and sending mail are different risks and different decisions:
 * an inbox that has been importing for a month should not start being able to
 * email customers because someone reused one variable. Same convention as
 * everywhere else here — unset is off, and only the exact string `true` is on.
 */
export function smtpEnabled(): boolean {
  return env("INBOX_SMTP_ENABLED").toLowerCase() === "true";
}

/**
 * A minimal address check for the configured sender.
 *
 * Not a full RFC 5322 grammar — but a `From` that is empty, has a space, or has
 * no `@` cannot be right, and finding that out at send time means finding it
 * out from a bounce.
 */
function looksLikeAddress(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1;
}

export function resolveSmtpConfig(): SmtpConfigResult {
  const host = env("INBOX_SMTP_HOST");
  if (!host) return { ok: false, problem: "MISSING_SMTP_HOST" };

  const rawPort = env("INBOX_SMTP_PORT");
  const port = rawPort ? Number(rawPort) : DEFAULT_SMTP_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { ok: false, problem: "INVALID_SMTP_PORT" };
  }

  const user = env("INBOX_SMTP_USER");
  if (!user) return { ok: false, problem: "MISSING_SMTP_USER" };

  // Presence only; the value is not carried out of this function.
  if (!env("INBOX_SMTP_PASSWORD")) {
    return { ok: false, problem: "MISSING_SMTP_PASSWORD" };
  }

  const from = env("INBOX_SMTP_FROM");
  if (!from) return { ok: false, problem: "MISSING_SMTP_FROM" };
  if (!looksLikeAddress(from)) return { ok: false, problem: "INVALID_SMTP_FROM" };

  return {
    ok: true,
    config: {
      host,
      port,
      secure: flag("INBOX_SMTP_SECURE", true),
      user,
      passwordConfigured: true,
      from: from.toLowerCase(),
      maxReplyChars: clampedInt(
        env("INBOX_MAX_REPLY_CHARS"),
        DEFAULT_MAX_REPLY_CHARS,
        MIN_MAX_REPLY_CHARS,
        MAX_MAX_REPLY_CHARS,
      ),
    },
  };
}

/**
 * The SMTP password, for handing to the mail transport and nothing else.
 *
 * Same isolation as `imapPassword()`: one accessor, one grep, and no object
 * that might be logged ever holds the value.
 */
export function smtpPassword(): string {
  return process.env.INBOX_SMTP_PASSWORD ?? "";
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
