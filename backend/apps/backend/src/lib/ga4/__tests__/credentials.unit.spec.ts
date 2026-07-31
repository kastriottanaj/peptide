import {
  credentialFingerprint,
  parseInlineServiceAccount,
} from "../credentials";

/**
 * Every credential in this file is fabricated. Nothing here reads the real
 * service-account key, and none of these values authenticate anywhere.
 */
const FAKE_EMAIL = "fake-tests@fake-project-000000.iam.gserviceaccount.com";
const FAKE_KEY_BODY = "FAKEKEYMATERIALFORTESTS";

/** A key as it appears inside an env var: newlines escaped, not real. */
const ESCAPED_KEY = `-----BEGIN PRIVATE KEY-----\\n${FAKE_KEY_BODY}\\n-----END PRIVATE KEY-----\\n`;

function fakeServiceAccount(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "service_account",
    project_id: "fake-project-000000",
    client_email: FAKE_EMAIL,
    private_key: ESCAPED_KEY,
    ...overrides,
  });
}

describe("parseInlineServiceAccount", () => {
  it("returns the fields the client constructor needs", () => {
    const parsed = parseInlineServiceAccount(fakeServiceAccount());

    expect(parsed.client_email).toBe(FAKE_EMAIL);
    expect(parsed.project_id).toBe("fake-project-000000");
  });

  it("turns escaped newlines into real ones", () => {
    const parsed = parseInlineServiceAccount(fakeServiceAccount());

    // OpenSSL rejects a PEM whose line breaks are the two characters `\` and
    // `n`, and says so in a way that looks nothing like "your newlines are
    // wrong" — hence normalising here rather than leaving it to whoever pasted
    // the value.
    expect(parsed.private_key).toBe(
      `-----BEGIN PRIVATE KEY-----\n${FAKE_KEY_BODY}\n-----END PRIVATE KEY-----\n`,
    );
    expect(parsed.private_key).not.toContain("\\n");
    expect(parsed.private_key.split("\n")).toHaveLength(4);
  });

  it("leaves a key that already has real newlines alone", () => {
    const real = `-----BEGIN PRIVATE KEY-----\n${FAKE_KEY_BODY}\n-----END PRIVATE KEY-----\n`;
    const parsed = parseInlineServiceAccount(
      JSON.stringify({ client_email: FAKE_EMAIL, private_key: real }),
    );

    expect(parsed.private_key).toBe(real);
  });

  it("rejects malformed JSON as a credential problem", () => {
    for (const malformed of [
      "{not json",
      "",
      "   ",
      "undefined",
      '{"client_email": }',
      "[]",
      '"a string"',
      "null",
      "42",
    ]) {
      expect(() => parseInlineServiceAccount(malformed)).toThrow(
        expect.objectContaining({ code: "GA4_INVALID_CREDENTIALS" }),
      );
    }
  });

  it("rejects a missing client_email", () => {
    expect(() =>
      parseInlineServiceAccount(
        JSON.stringify({ private_key: ESCAPED_KEY }),
      ),
    ).toThrow(expect.objectContaining({ code: "GA4_INVALID_CREDENTIALS" }));
  });

  it("rejects a missing private_key", () => {
    expect(() =>
      parseInlineServiceAccount(JSON.stringify({ client_email: FAKE_EMAIL })),
    ).toThrow(expect.objectContaining({ code: "GA4_INVALID_CREDENTIALS" }));
  });

  it("rejects present-but-empty or wrongly-typed fields", () => {
    const bad = [
      { client_email: "", private_key: ESCAPED_KEY },
      { client_email: "   ", private_key: ESCAPED_KEY },
      { client_email: FAKE_EMAIL, private_key: "" },
      { client_email: FAKE_EMAIL, private_key: null },
      { client_email: 42, private_key: ESCAPED_KEY },
      { client_email: FAKE_EMAIL, private_key: { key: "x" } },
    ];

    for (const overrides of bad) {
      expect(() =>
        parseInlineServiceAccount(JSON.stringify(overrides)),
      ).toThrow(expect.objectContaining({ code: "GA4_INVALID_CREDENTIALS" }));
    }
  });

  it("treats a missing project_id as optional", () => {
    const parsed = parseInlineServiceAccount(
      JSON.stringify({ client_email: FAKE_EMAIL, private_key: ESCAPED_KEY }),
    );

    expect(parsed.project_id).toBeUndefined();
  });

  it("never quotes the credential back in the error", () => {
    // JSON.parse's own message embeds the offending input — which here is a
    // private key.
    let thrown: unknown;
    try {
      parseInlineServiceAccount(`{"private_key": "${ESCAPED_KEY}", oops}`);
    } catch (error) {
      thrown = error;
    }

    const serialized = `${(thrown as Error).message} ${JSON.stringify(thrown)} ${
      (thrown as { stack?: string }).stack ?? ""
    }`;

    expect(serialized).not.toContain(FAKE_KEY_BODY);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain(FAKE_EMAIL);
  });

  it("keeps the parsed credential out of anything serializable", () => {
    const parsed = parseInlineServiceAccount(fakeServiceAccount());

    // The parsed value is handed straight to the client constructor and dropped.
    // What must never happen is it ending up somewhere that gets logged — so the
    // caller-visible contract is exactly three fields, nothing enumerable added.
    expect(Object.keys(parsed).sort()).toEqual([
      "client_email",
      "private_key",
      "project_id",
    ]);
  });
});

describe("credentialFingerprint", () => {
  it("is stable for the same input", () => {
    expect(credentialFingerprint("abc")).toBe(credentialFingerprint("abc"));
  });

  it("differs for different inputs", () => {
    expect(credentialFingerprint("abc")).not.toBe(credentialFingerprint("abd"));
  });

  it("is short hex that reveals nothing about the input", () => {
    const fingerprint = credentialFingerprint(fakeServiceAccount());

    expect(fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(fingerprint).not.toContain(FAKE_KEY_BODY);
    expect(fingerprint).not.toContain(FAKE_EMAIL);
    expect(fakeServiceAccount()).not.toContain(fingerprint);
  });
});
