/**
 * Configuration.
 *
 * The two properties worth pinning are the off switch and the blast radius of a
 * missing value: nothing may be validated, connected to or complained about
 * while the inbox is off, and no resolved config may ever carry the password.
 */

import {
  imapPassword,
  inboxCronExpression,
  inboxEnabled,
  resolveInboxConfig,
  resolveSmtpConfig,
  smtpEnabled,
  smtpPassword,
} from "../config";

const INBOX_KEYS = [
  "INBOX_SMTP_ENABLED",
  "INBOX_SMTP_HOST",
  "INBOX_SMTP_PORT",
  "INBOX_SMTP_SECURE",
  "INBOX_SMTP_USER",
  "INBOX_SMTP_PASSWORD",
  "INBOX_SMTP_FROM",
  "INBOX_MAX_REPLY_CHARS",
  "INBOX_ENABLED",
  "INBOX_IMAP_HOST",
  "INBOX_IMAP_PORT",
  "INBOX_IMAP_SECURE",
  "INBOX_IMAP_USER",
  "INBOX_IMAP_PASSWORD",
  "INBOX_IMAP_MAILBOX",
  "INBOX_POLL_INTERVAL_SECONDS",
  "INBOX_IMPORT_EXISTING",
  "INBOX_IMPORT_SINCE_DAYS",
  "INBOX_RETENTION_DAYS",
  "INBOX_MAX_BODY_CHARS",
  "INBOX_MAX_MESSAGE_BYTES",
];

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of INBOX_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of INBOX_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

function configured(overrides: Record<string, string> = {}) {
  process.env.INBOX_IMAP_HOST = "imap.example.test";
  process.env.INBOX_IMAP_USER = "info@example.test";
  process.env.INBOX_IMAP_PASSWORD = "s3cret-not-real";
  Object.assign(process.env, overrides);
}

describe("the off switch", () => {
  it("is off when unset", () => {
    expect(inboxEnabled()).toBe(false);
  });

  /**
   * The `ORDERS_ENABLED` convention: a forgotten variable and a literal "false"
   * both mean off. Anything else reading as truthy is how a feature turns
   * itself on in production.
   */
  it.each(["false", "FALSE", "0", "no", "yes", "1", "on", " "])(
    "is off for %p",
    (value) => {
      process.env.INBOX_ENABLED = value;
      expect(inboxEnabled()).toBe(false);
    },
  );

  it.each(["true", "TRUE", " true "])("is on for %p", (value) => {
    process.env.INBOX_ENABLED = value;
    expect(inboxEnabled()).toBe(true);
  });
});

describe("validation", () => {
  it("reports the missing host first", () => {
    expect(resolveInboxConfig()).toEqual({
      ok: false,
      problem: "MISSING_HOST",
    });
  });

  it("reports a missing user", () => {
    process.env.INBOX_IMAP_HOST = "imap.example.test";
    expect(resolveInboxConfig()).toEqual({ ok: false, problem: "MISSING_USER" });
  });

  it("reports a missing password", () => {
    process.env.INBOX_IMAP_HOST = "imap.example.test";
    process.env.INBOX_IMAP_USER = "info@example.test";
    expect(resolveInboxConfig()).toEqual({
      ok: false,
      problem: "MISSING_PASSWORD",
    });
  });

  it.each(["0", "70000", "-1", "993.5", "nine-nine-three"])(
    "rejects port %p",
    (port) => {
      configured({ INBOX_IMAP_PORT: port });
      expect(resolveInboxConfig()).toEqual({
        ok: false,
        problem: "INVALID_PORT",
      });
    },
  );

  it("accepts a complete configuration and defaults the rest", () => {
    configured();
    const result = resolveInboxConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config).toMatchObject({
      host: "imap.example.test",
      port: 993,
      secure: true,
      mailbox: "INBOX",
      pollIntervalSeconds: 300,
      importExisting: false,
      importSinceDays: 14,
      retentionDays: null,
    });
  });
});

describe("credentials", () => {
  /**
   * The password may exist in exactly one place. A config object that carries
   * it is a config object that ends up in a log line.
   */
  it("never puts the password on the resolved config", () => {
    configured();
    const result = resolveInboxConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.config)).not.toContain("s3cret-not-real");
    expect(Object.values(result.config)).not.toContain("s3cret-not-real");
    expect(result.config).toHaveProperty("passwordConfigured", true);
  });

  it("exposes the password only through the dedicated accessor", () => {
    configured();
    expect(imapPassword()).toBe("s3cret-not-real");
  });
});

describe("numeric settings", () => {
  it("clamps a nonsense poll interval to the default rather than failing", () => {
    configured({ INBOX_POLL_INTERVAL_SECONDS: "not-a-number" });
    const result = resolveInboxConfig();
    expect(result.ok && result.config.pollIntervalSeconds).toBe(300);
  });

  it.each([
    ["10", 60],
    ["99999", 3600],
    ["600", 600],
  ])("clamps poll interval %s to %i", (raw, expected) => {
    configured({ INBOX_POLL_INTERVAL_SECONDS: raw });
    const result = resolveInboxConfig();
    expect(result.ok && result.config.pollIntervalSeconds).toBe(expected);
  });

  it("clamps the import window to a year", () => {
    configured({ INBOX_IMPORT_SINCE_DAYS: "9999" });
    const result = resolveInboxConfig();
    expect(result.ok && result.config.importSinceDays).toBe(365);
  });

  it("bounds the body and message limits", () => {
    configured({ INBOX_MAX_BODY_CHARS: "5", INBOX_MAX_MESSAGE_BYTES: "1" });
    const result = resolveInboxConfig();
    expect(result.ok && result.config.maxBodyChars).toBe(1_000);
    expect(result.ok && result.config.maxMessageBytes).toBe(64 * 1024);
  });
});

describe("retention", () => {
  it("is disabled when unset", () => {
    configured();
    const result = resolveInboxConfig();
    expect(result.ok && result.config.retentionDays).toBeNull();
  });

  /**
   * A typo must not start deleting business correspondence. Anything that is
   * not a number of at least one day reads as "keep everything".
   */
  it.each(["", "0", "-5", "soon", "30 days"])(
    "stays disabled for %p",
    (value) => {
      configured({ INBOX_RETENTION_DAYS: value });
      const result = resolveInboxConfig();
      expect(result.ok && result.config.retentionDays).toBeNull();
    },
  );

  it("accepts an explicit number of days", () => {
    configured({ INBOX_RETENTION_DAYS: "180" });
    const result = resolveInboxConfig();
    expect(result.ok && result.config.retentionDays).toBe(180);
  });
});

describe("the job schedule", () => {
  it("is every five minutes by default", () => {
    expect(inboxCronExpression()).toBe("*/5 * * * *");
  });

  it.each([
    [60, "*/1 * * * *"],
    [90, "*/2 * * * *"],
    [600, "*/10 * * * *"],
    [3600, "*/59 * * * *"],
  ])("derives %i seconds as %s", (seconds, expression) => {
    expect(inboxCronExpression(seconds)).toBe(expression);
  });

  /** The schedule is fixed at import time, before any password exists. */
  it("does not need a complete configuration", () => {
    process.env.INBOX_POLL_INTERVAL_SECONDS = "300";
    expect(() => inboxCronExpression()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ smtp -- */

function smtpConfigured(overrides: Record<string, string> = {}) {
  process.env.INBOX_SMTP_HOST = "smtp.example.test";
  process.env.INBOX_SMTP_USER = "info@example.test";
  process.env.INBOX_SMTP_PASSWORD = "smtp-not-real";
  process.env.INBOX_SMTP_FROM = "info@example.test";
  Object.assign(process.env, overrides);
}

describe("the sending switch", () => {
  /**
   * Reading mail and sending mail are separate decisions. An inbox that has
   * been importing for a month must not gain the ability to email customers
   * because someone reused one variable.
   */
  it("is independent of the importer's switch", () => {
    process.env.INBOX_ENABLED = "true";
    expect(smtpEnabled()).toBe(false);
  });

  it("is off when unset", () => {
    expect(smtpEnabled()).toBe(false);
  });

  it.each(["false", "0", "yes", "1", "on", " "])("is off for %p", (value) => {
    process.env.INBOX_SMTP_ENABLED = value;
    expect(smtpEnabled()).toBe(false);
  });

  it.each(["true", "TRUE", " true "])("is on for %p", (value) => {
    process.env.INBOX_SMTP_ENABLED = value;
    expect(smtpEnabled()).toBe(true);
  });
});

describe("smtp validation", () => {
  it("reports each missing setting in turn", () => {
    expect(resolveSmtpConfig()).toEqual({ ok: false, problem: "MISSING_SMTP_HOST" });

    process.env.INBOX_SMTP_HOST = "smtp.example.test";
    expect(resolveSmtpConfig()).toEqual({ ok: false, problem: "MISSING_SMTP_USER" });

    process.env.INBOX_SMTP_USER = "info@example.test";
    expect(resolveSmtpConfig()).toEqual({
      ok: false,
      problem: "MISSING_SMTP_PASSWORD",
    });

    process.env.INBOX_SMTP_PASSWORD = "smtp-not-real";
    expect(resolveSmtpConfig()).toEqual({ ok: false, problem: "MISSING_SMTP_FROM" });
  });

  it.each(["not-an-address", "two@at@signs.test", "has space@example.test", "@example.test"])(
    "refuses the sender address %p",
    (from) => {
      smtpConfigured({ INBOX_SMTP_FROM: from });
      expect(resolveSmtpConfig()).toEqual({ ok: false, problem: "INVALID_SMTP_FROM" });
    },
  );

  it.each(["0", "70000", "-1", "465.5"])("refuses port %p", (port) => {
    smtpConfigured({ INBOX_SMTP_PORT: port });
    expect(resolveSmtpConfig()).toEqual({ ok: false, problem: "INVALID_SMTP_PORT" });
  });

  it("accepts a complete configuration and defaults the rest", () => {
    smtpConfigured();
    const result = resolveSmtpConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config).toMatchObject({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      from: "info@example.test",
      maxReplyChars: 10_000,
    });
  });

  it("clamps a nonsense reply limit rather than failing", () => {
    smtpConfigured({ INBOX_MAX_REPLY_CHARS: "3" });
    const result = resolveSmtpConfig();
    expect(result.ok && result.config.maxReplyChars).toBe(500);
  });
});

describe("smtp credentials", () => {
  it("never put the password on the resolved config", () => {
    smtpConfigured();
    const result = resolveSmtpConfig();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(JSON.stringify(result.config)).not.toContain("smtp-not-real");
    expect(Object.values(result.config)).not.toContain("smtp-not-real");
    expect(result.config).toHaveProperty("passwordConfigured", true);
  });

  it("expose the password only through the dedicated accessor", () => {
    smtpConfigured();
    expect(smtpPassword()).toBe("smtp-not-real");
  });
});
