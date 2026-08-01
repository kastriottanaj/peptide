import {
  GA4_ERROR_CODES,
  Ga4Error,
  classifyGa4Error,
  notConfigured,
} from "../errors";

/** A rejection shaped the way google-gax produces one. */
function grpcError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

describe("classifyGa4Error", () => {
  it("maps permission denial to 403 and never retries it", () => {
    const error = classifyGa4Error(
      grpcError(
        7,
        "User does not have sufficient permissions for this property. " +
          "Service account: peptides-ga4@my-project-123456.iam.gserviceaccount.com",
      ),
    );

    expect(error.code).toBe("GA4_PERMISSION_DENIED");
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
  });

  it("maps rejected credentials to 503 and never retries them", () => {
    const error = classifyGa4Error(grpcError(16, "Request had invalid authentication credentials"));

    expect(error.code).toBe("GA4_INVALID_CREDENTIALS");
    expect(error.status).toBe(503);
    // Retrying a rejected key just multiplies failed auth attempts at Google.
    expect(error.retryable).toBe(false);
  });

  it("maps a missing property to 404", () => {
    const error = classifyGa4Error(grpcError(5, "Property not found"));

    expect(error.code).toBe("GA4_PROPERTY_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.retryable).toBe(false);
  });

  it("treats quota exhaustion as unavailable but does not retry it", () => {
    const error = classifyGa4Error(
      grpcError(8, "Exhausted property tokens for realtime requests"),
    );

    expect(error.code).toBe("GA4_API_UNAVAILABLE");
    expect(error.status).toBe(502);
    // Retrying a quota error is the one case that makes things worse for
    // every other caller of the property.
    expect(error.retryable).toBe(false);
  });

  it("marks genuine transient failures retryable", () => {
    for (const code of [14, 4, 13, 10, 2, 1]) {
      const error = classifyGa4Error(grpcError(code, "backend error"));
      expect(error.code).toBe("GA4_API_UNAVAILABLE");
      expect(error.status).toBe(502);
      expect(error.retryable).toBe(true);
    }
  });

  it("treats an unreadable key file as a credential problem", () => {
    for (const syscall of ["ENOENT", "EACCES", "EISDIR"]) {
      const error = classifyGa4Error(
        Object.assign(
          new Error(`${syscall}: open '/some/path/service-account.json'`),
          { code: syscall },
        ),
      );
      expect(error.code).toBe("GA4_INVALID_CREDENTIALS");
      expect(error.retryable).toBe(false);
    }
  });

  it("treats socket failures as transient", () => {
    for (const syscall of ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]) {
      const error = classifyGa4Error(
        Object.assign(new Error("network"), { code: syscall }),
      );
      expect(error.code).toBe("GA4_API_UNAVAILABLE");
      expect(error.retryable).toBe(true);
    }
  });

  it("recognises credential failures that arrive without a gRPC status", () => {
    const messages = [
      "invalid_grant: Invalid JWT Signature.",
      "error:1E08010C:DECODER routines::unsupported",
      "Could not load the default credentials",
      "Unexpected token } in JSON at position 42",
    ];

    for (const message of messages) {
      expect(classifyGa4Error(new Error(message)).code).toBe(
        "GA4_INVALID_CREDENTIALS",
      );
    }
  });

  it("falls back to transient rather than blaming the credential", () => {
    // Guessing "bad key" sends an operator to rotate a credential for nothing.
    const error = classifyGa4Error(new Error("something entirely unexpected"));

    expect(error.code).toBe("GA4_API_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("passes an existing Ga4Error through unchanged", () => {
    const original = notConfigured();
    expect(classifyGa4Error(original)).toBe(original);
  });

  it("classifies values that are not Errors at all", () => {
    for (const thrown of [undefined, null, "string", 42, {}]) {
      expect(classifyGa4Error(thrown)).toBeInstanceOf(Ga4Error);
    }
  });
});

describe("safe surface", () => {
  /**
   * The point of the whole taxonomy: Google's message names the service
   * account, the project, and — for a missing key file — the full path to the
   * private key. None of it may survive classification.
   */
  it("drops every identifying detail from the original error", () => {
    const secrets = [
      "peptides-ga4@my-project-123456.iam.gserviceaccount.com",
      "/Users/someone/secrets/service-account.json",
      "my-project-123456",
      "-----BEGIN PRIVATE KEY-----",
      "ya29.a0AfB_byC_fake_access_token",
    ];

    for (const secret of secrets) {
      const error = classifyGa4Error(grpcError(7, `Denied. ${secret}`));
      const serialized = JSON.stringify(error.toResponse());

      expect(serialized).not.toContain(secret);
      expect(error.message).not.toContain(secret);
    }
  });

  it("serializes to nothing but a code and a fixed message", () => {
    const error = classifyGa4Error(grpcError(7, "raw google detail"));

    // The nested object is the documented shape; the top-level pair exists
    // because `@medusajs/js-sdk` discards everything else on a non-2xx.
    expect(Object.keys(error.toResponse()).sort()).toEqual([
      "code",
      "error",
      "message",
    ]);
    expect(Object.keys(error.toResponse().error).sort()).toEqual([
      "code",
      "message",
    ]);
    expect(error.toResponse().code).toBe(error.toResponse().error.code);
    expect(error.toResponse().message).toBe(error.toResponse().error.message);
    expect(JSON.stringify(error.toResponse())).not.toContain("raw google detail");
  });

/**
 * The top-level `code`/`message` pair was added so `@medusajs/js-sdk` — which
 * keeps only a body's top-level `message` when it converts a non-2xx into a
 * `FetchError` — can surface the real message in the admin. It is **additive**.
 * The nested `error` object is the shape `docs/analytics-ga4-api.md` documents
 * and the shape any existing client reads, so it must never be replaced by the
 * flattened one.
 */
  it("does not retain the original error as a cause", () => {
    // An error carrying a `cause` eventually gets spread into a log by someone
    // who did not read the comment explaining why it must not be.
    const original = grpcError(7, "sensitive detail");
    const error = classifyGa4Error(original);

    expect((error as { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("sensitive detail");
  });

  it("never exposes a stack trace through the response body", () => {
    const error = classifyGa4Error(grpcError(14, "boom"));
    expect(JSON.stringify(error.toResponse())).not.toContain("at ");
  });
});


describe("error-body backward compatibility", () => {
  it.each(GA4_ERROR_CODES)("%s keeps the nested error object", (code) => {
    const body = new Ga4Error(code).toResponse();

    expect(body).toHaveProperty("error");
    expect(body.error).toEqual({
      code,
      message: expect.any(String),
    });
  });

  it.each(GA4_ERROR_CODES)("%s also exposes the SDK-readable fields", (code) => {
    const body = new Ga4Error(code).toResponse();

    expect(body.code).toBe(code);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("keeps the two representations in agreement", () => {
    for (const code of GA4_ERROR_CODES) {
      const body = new Ga4Error(code).toResponse();

      expect(body.code).toBe(body.error.code);
      expect(body.message).toBe(body.error.message);
    }
  });

  /**
   * A client written against the original shape reads `body.error.code`.
   * This is that client.
   */
  it("still satisfies a consumer written before the flattening", () => {
    const raw = JSON.parse(
      JSON.stringify(new Ga4Error("GA4_PERMISSION_DENIED").toResponse()),
    );

    const legacyRead = (payload: { error: { code: string; message: string } }) =>
      `${payload.error.code}: ${payload.error.message}`;

    expect(legacyRead(raw)).toBe(
      "GA4_PERMISSION_DENIED: The service account does not have access to this Google Analytics property.",
    );
  });

  it("adds nothing beyond the two representations", () => {
    for (const code of GA4_ERROR_CODES) {
      const body = new Ga4Error(code).toResponse();
      expect(Object.keys(body).sort()).toEqual(["code", "error", "message"]);
    }
  });
});
