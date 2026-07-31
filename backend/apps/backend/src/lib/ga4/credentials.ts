/**
 * Service-account credentials supplied inline, for hosts without a filesystem
 * to put a key file on.
 *
 * The parsed credential exists only as a local value handed straight to the
 * Google client constructor. It is never written to disk, never attached to the
 * config object, never logged, and never returned. The only thing derived from
 * it that outlives the call is a fingerprint — a truncated SHA-256 — which
 * identifies *which* credential is in use without being usable as one.
 */

import { createHash } from "crypto";
import { Ga4Error } from "./errors";

export type InlineServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse and validate `GA4_SERVICE_ACCOUNT_JSON`.
 *
 * Every failure — unparseable JSON, a JSON array, a missing `client_email`, an
 * empty `private_key` — is the same `GA4_INVALID_CREDENTIALS`. Reporting *which*
 * field is wrong would be more helpful to an operator and would also be the one
 * place where the shape of a secret leaks into a response, so the detail stays
 * out. `JSON.parse`'s own message is dropped for the same reason: it quotes the
 * offending input, which here is a private key.
 */
export function parseInlineServiceAccount(raw: string): InlineServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Ga4Error("GA4_INVALID_CREDENTIALS");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Ga4Error("GA4_INVALID_CREDENTIALS");
  }

  const candidate = parsed as Record<string, unknown>;

  if (
    !nonEmptyString(candidate.client_email) ||
    !nonEmptyString(candidate.private_key)
  ) {
    throw new Ga4Error("GA4_INVALID_CREDENTIALS");
  }

  return {
    client_email: candidate.client_email,
    // A key pasted into an env var arrives with its newlines escaped — one
    // literal `\n` sequence per line rather than an actual line break. OpenSSL
    // rejects that outright, and the resulting error is an opaque PEM routines
    // failure that looks nothing like "your newlines are wrong".
    private_key: candidate.private_key.replace(/\\n/g, "\n"),
    project_id: nonEmptyString(candidate.project_id)
      ? candidate.project_id
      : undefined,
  };
}

/**
 * A stable, non-reversible id for a piece of credential material.
 *
 * Used as part of the client cache identity and the report cache key, so that
 * rotating a credential or repointing the property cannot serve an answer
 * fetched with the previous one. Truncated because it only has to distinguish
 * between the handful of values one process will ever see, and a shorter token
 * is less tempting to treat as if it were the secret.
 */
export function credentialFingerprint(material: string): string {
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 12);
}
