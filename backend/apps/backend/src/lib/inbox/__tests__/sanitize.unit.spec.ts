/**
 * The sanitizer.
 *
 * These are the security tests of this feature. Every case below is something
 * an actual sender can put in an actual email, so each one is written as "what
 * arrives" → "what may be stored", never as an assertion about an
 * implementation detail.
 */

import { INBOX_LIMITS } from "../config";
import {
  TRUNCATION_MARKER,
  buildSearchText,
  htmlToText,
  sanitizeAttachments,
  sanitizeBody,
  sanitizeDisplayName,
  sanitizeEmail,
  sanitizeFilename,
  sanitizeHeader,
  sanitizeMessageId,
  sanitizeRecipients,
  stripControls,
} from "../sanitize";

describe("HTML never survives", () => {
  it("drops script contents entirely, not just the tags", () => {
    const text = htmlToText(
      "<p>Hallo</p><script>alert('xss');fetch('https://evil.test')</script><p>Tschüss</p>",
    );

    expect(text).toContain("Hallo");
    expect(text).toContain("Tschüss");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("evil.test");
    expect(text).not.toContain("<script");
  });

  it("drops style contents", () => {
    const text = htmlToText("<style>body{background:url(https://evil.test)}</style><p>Hi</p>");
    expect(text).toBe("Hi");
  });

  /** `<!-- <script> -->` must not become live markup when comments go. */
  it("removes comments before anything else", () => {
    const text = htmlToText("<!-- <script>alert(1)</script> -->Hallo");
    expect(text).not.toContain("alert");
    expect(text.trim()).toBe("Hallo");
  });

  it("drops the remainder after an unclosed script", () => {
    const text = htmlToText("<p>Hallo</p><script>alert('never closed')");
    expect(text).not.toContain("alert");
    expect(text).toContain("Hallo");
  });

  /** No URL from a message is kept, so nothing can be fetched later. */
  it("keeps no image or link URL", () => {
    const text = htmlToText(
      '<img src="https://tracker.test/pixel.gif?id=42" width="1"><a href="https://phish.test">Klicken</a>',
    );

    expect(text).not.toContain("tracker.test");
    expect(text).not.toContain("phish.test");
    expect(text).not.toContain("http");
    expect(text).toContain("Klicken");
  });

  it("keeps block structure as line breaks", () => {
    expect(htmlToText("<p>eins</p><p>zwei</p>")).toBe("eins\nzwei");
    expect(htmlToText("eins<br>zwei")).toBe("eins\nzwei");
  });

  it("decodes the entities that matter and drops the ones that do not", () => {
    expect(htmlToText("<p>Gr&uuml;&szlig;e &amp; Dank &#8364;5</p>")).toBe(
      "Grüße & Dank €5",
    );
    // A control character smuggled in as an entity is not decoded into one.
    expect(htmlToText("<p>a&#0;b</p>")).toBe("a b");
  });

  it("prefers the text part and ignores HTML entirely when it exists", () => {
    const body = sanitizeBody(
      { text: "the real text", html: "<script>alert(1)</script>" },
      1_000,
    );

    expect(body.text).toBe("the real text");
  });

  it("falls back to converted HTML when there is no text part", () => {
    const body = sanitizeBody({ text: "", html: "<p>nur HTML</p>" }, 1_000);
    expect(body.text).toBe("nur HTML");
  });

  it("imports a message with neither part rather than dropping it", () => {
    expect(sanitizeBody({}, 1_000)).toEqual({ text: "", truncated: false });
  });
});

describe("invisible characters", () => {
  /**
   * A right-to-left override in a display name is a spoofing tool: it makes
   * `service@bank.de` render from a string that is not that.
   */
  it("strips bidi overrides and zero-width characters from headers", () => {
    const spoofed = `Support\u202E\u200Bservice@bank.de`;
    const cleaned = sanitizeDisplayName(spoofed);

    expect(cleaned).not.toMatch(/[\u202A-\u202E\u200B-\u200F]/);
    expect(cleaned).toBe("Supportservice@bank.de");
  });

  it("collapses newlines in a header so it cannot span lines", () => {
    expect(sanitizeHeader("Anfrage\r\nBcc: victim@example.org", 200)).toBe(
      "Anfrage Bcc: victim@example.org",
    );
  });

  it("keeps newlines and tabs in a body", () => {
    const body = sanitizeBody({ text: "eins\nzwei\tdrei" }, 1_000);
    expect(body.text).toBe("eins\nzwei\tdrei");
  });

  it("strips C0 and C1 controls from a body", () => {
    const body = sanitizeBody({ text: "a\u0000b\u0007c\u009fd" }, 1_000);
    expect(body.text).toBe("abcd");
  });

  it("exports the strip for reuse", () => {
    expect(stripControls("a\u200bb")).toBe("ab");
  });
});

describe("limits", () => {
  it("truncates an oversized body and says so", () => {
    const body = sanitizeBody({ text: "x".repeat(5_000) }, 1_000);

    expect(body.truncated).toBe(true);
    expect(body.text).toHaveLength(1_000 + TRUNCATION_MARKER.length);
    expect(body.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("leaves a body under the limit alone", () => {
    const body = sanitizeBody({ text: "kurz" }, 1_000);
    expect(body).toEqual({ text: "kurz", truncated: false });
  });

  it("truncates a header with an ellipsis rather than silently", () => {
    const subject = sanitizeHeader("y".repeat(2_000), INBOX_LIMITS.subject);

    expect(subject).toHaveLength(INBOX_LIMITS.subject);
    expect(subject.endsWith("…")).toBe(true);
  });

  it("caps the number of attachments recorded", () => {
    const attachments = Array.from({ length: 500 }, (_, index) => ({
      filename: `file-${index}.pdf`,
      contentType: "application/pdf",
      size: 10,
    }));

    expect(sanitizeAttachments(attachments)).toHaveLength(
      INBOX_LIMITS.maxAttachments,
    );
  });

  it("caps the number of recipients recorded", () => {
    const addresses = Array.from({ length: 500 }, (_, index) => ({
      address: `person-${index}@example.org`,
    }));

    expect(
      sanitizeRecipients([{ kind: "to", addresses }]),
    ).toHaveLength(INBOX_LIMITS.maxRecipients);
  });
});

describe("addresses", () => {
  it.each([
    ["Person@Example.ORG", "person@example.org"],
    ["  spaced@example.org  ", "spaced@example.org"],
  ])("normalises %p", (input, expected) => {
    expect(sanitizeEmail(input)).toBe(expected);
  });

  it.each(["", "no-at-sign", "two@at@signs.org", "@example.org", "a@", "a b@c.org"])(
    "refuses %p without losing the message",
    (input) => {
      expect(sanitizeEmail(input)).toBeNull();
    },
  );

  it("strips the brackets from a message id", () => {
    expect(sanitizeMessageId("<abc@def.example>")).toBe("abc@def.example");
    expect(sanitizeMessageId("   ")).toBeNull();
  });

  it("deduplicates recipients per kind and drops unusable ones", () => {
    const recipients = sanitizeRecipients([
      {
        kind: "to",
        addresses: [
          { name: "A", address: "a@example.org" },
          { name: "A again", address: "A@EXAMPLE.ORG" },
          { address: "broken" },
        ],
      },
      { kind: "cc", addresses: [{ address: "a@example.org" }] },
    ]);

    expect(recipients).toEqual([
      { kind: "to", name: "A", email: "a@example.org" },
      { kind: "cc", name: null, email: "a@example.org" },
    ]);
  });
});

describe("attachment metadata", () => {
  it("records name, type and size and nothing else", () => {
    const [attachment] = sanitizeAttachments([
      { filename: "Rechnung.pdf", contentType: "application/pdf", size: 4096 },
    ]);

    expect(attachment).toEqual({
      filename: "Rechnung.pdf",
      content_type: "application/pdf",
      size: 4096,
    });
    expect(Object.keys(attachment)).toHaveLength(3);
  });

  /** Nothing writes a file today. The traversal is removed for the day one does. */
  it("neutralises path traversal in a filename", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("_._etc_passwd");
    expect(sanitizeFilename("C:\\Windows\\system32.dll")).toBe(
      "C:_Windows_system32.dll",
    );
    expect(sanitizeFilename("")).toBe("unnamed");
  });

  it("reduces a content type to a token", () => {
    const [attachment] = sanitizeAttachments([
      { filename: "a", contentType: 'application/pdf"; x=<script>', size: -5 },
    ]);

    expect(attachment.content_type).not.toContain("<");
    expect(attachment.content_type).not.toContain('"');
    expect(attachment.size).toBe(0);
  });
});

describe("search text", () => {
  it("collects subject, sender and addresses, lowercased", () => {
    const text = buildSearchText({
      subject: "Anfrage Semaglutid",
      fromName: "Dr. Müller",
      fromEmail: "Mueller@Example.ORG",
      recipients: [{ kind: "to", name: null, email: "info@example.org" }],
    });

    expect(text).toContain("anfrage");
    expect(text).toContain("semaglutid");
    expect(text).toContain("mueller@example.org");
    expect(text).toContain("info@example.org");
  });

  it("stays bounded as a thread grows", () => {
    let previous = "";
    for (let index = 0; index < 200; index += 1) {
      previous = buildSearchText({
        subject: `subject-${index}`,
        fromName: `name-${index}`,
        fromEmail: `person-${index}@example.org`,
        recipients: [],
        previous,
      });
    }

    expect(previous.length).toBeLessThanOrEqual(4_000);
  });
});
