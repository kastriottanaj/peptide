/**
 * The stylesheet and the sources, read as text.
 *
 * Two jobs. The first mirrors `analytics/__tests__/styles.admin.spec.tsx`:
 * **everything is scoped**, so the Inbox page cannot restyle the orders page,
 * and **the tokens are declared on `.pi`, not `:root`**, so removing the route
 * removes the styling with it.
 *
 * The second is specific to this feature and is the more important of the two:
 * a grep over the shipped admin sources proving that **no email content is ever
 * rendered as markup, and no remote resource is ever requested**. React escapes
 * by default, so the only ways to break that are `dangerouslySetInnerHTML` and
 * a URL from a message reaching an `src`/`href`. A grep is a blunt instrument;
 * it is also the one that catches either being reintroduced by someone who has
 * not read `lib/inbox/sanitize.ts`.
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const source = readFileSync(join(__dirname, "..", "inbox.css"), "utf8");

/** Comments stripped: the file documents the rules it must not break. */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");

function selectors(): string[] {
  return [...css.matchAll(/([^{}]*)\{/g)]
    .map((match) => match[1].trim().split("\n").pop()?.trim() ?? "")
    .filter(Boolean)
    .filter((group) => !group.startsWith("@"))
    .flatMap((group) => group.split(",").map((one) => one.trim()))
    .filter(Boolean)
    .filter((selector) => !["from", "to"].includes(selector))
    .filter((selector) => !/^\d+%$/.test(selector));
}

describe("scoping", () => {
  it("scopes every rule under .pi", () => {
    const unscoped = selectors().filter(
      (selector) => !/\.pi(?![a-z0-9])/i.test(selector),
    );

    expect(unscoped).toEqual([]);
    expect(selectors().length).toBeGreaterThan(40);
  });

  it("declares no bare element selectors", () => {
    const bare = selectors().filter((selector) =>
      /^(html|body|a|p|div|pre|table|th|td|button|input|h[1-6])\b/.test(selector),
    );

    expect(bare).toEqual([]);
  });

  it("declares its custom properties on .pi, never on :root", () => {
    expect(css).not.toContain(":root");
    expect(css).toMatch(/^\.pi\s*\{/m);
  });

  it("prefixes every custom property so it cannot collide", () => {
    const properties = [...css.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map(
      (match) => match[1],
    );

    expect(properties.length).toBeGreaterThan(20);
    expect(properties.every((property) => property.startsWith("--pi-"))).toBe(
      true,
    );
  });

  /** The analytics page and the inbox must look like one product. */
  it("uses the same palette and shape tokens as the analytics dashboard", () => {
    const analytics = readFileSync(
      join(__dirname, "..", "..", "analytics", "analytics.css"),
      "utf8",
    );

    for (const token of ["bg", "surface", "border", "accent", "success", "warning", "danger"]) {
      const mine = css.match(new RegExp(`--pi-${token}:\\s*([^;]+);`))?.[1];
      const theirs = analytics.match(new RegExp(`--pa-${token}:\\s*([^;]+);`))?.[1];
      expect(mine).toBe(theirs);
    }

    expect(css).toMatch(/--pi-radius:\s*8px/);
    expect(css).toMatch(/--pi-shadow:\s*0 1px 2px/);
  });

  it("redefines the palette for dark mode", () => {
    expect(css).toContain(".dark .pi {");
    expect(css).toMatch(/\.dark \.pi \{[\s\S]*?--pi-bg:/);
  });
});

describe("layout", () => {
  it("collapses the two-column layout on narrow screens", () => {
    expect(css).toContain("@media (max-width: 1100px)");
  });

  /**
   * A subject or address with no spaces in it is a normal thing to receive.
   * Wrapping is how it stays inside the card instead of pushing the page
   * sideways.
   */
  it("wraps unbroken sender and subject strings", () => {
    for (const rule of [
      "\\.pi-card__title",
      "\\.pi-row__subject",
      "\\.pi-message__address",
      "\\.pi-body",
    ]) {
      expect(css).toMatch(
        new RegExp(`${rule} \\{[\\s\\S]*?overflow-wrap:\\s*anywhere`),
      );
    }
  });

  /** Plain text with the sender's own line breaks, and no other formatting. */
  it("renders message bodies as pre-wrapped plain text", () => {
    expect(css).toMatch(/\.pi-body \{[\s\S]*?white-space:\s*pre-wrap/);
  });

  it("gives interactive controls a visible focus ring", () => {
    expect(css).toContain(".pi-button:focus-visible");
    expect(css).toContain(".pi-segment__button:focus-visible");
    expect(css).toMatch(/focus-visible \{\s*outline:\s*2px solid/);
  });

  it("stops animating for readers who asked for less motion", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

/* ------------------------------------------------------------- the grep -- */

const inboxSources = (() => {
  const roots = [
    join(__dirname, "..", ".."), // components/inbox → components
    join(__dirname, "..", "..", "..", "routes", "inbox"),
    join(__dirname, "..", "..", "..", "lib"),
  ];

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : files(full);
      }
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  return [...new Set(roots.flatMap(files))]
    .filter((file) => /inbox/i.test(file))
    .map((file) => ({
      file,
      text: readFileSync(file, "utf8"),
      code: readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/\/\/.*$/gm, ""),
    }));
})();

describe("email content is never rendered as markup", () => {
  it("finds the inbox sources it is meant to be checking", () => {
    expect(inboxSources.length).toBeGreaterThanOrEqual(6);
  });

  /** The single escape hatch out of React's escaping. It is not used. */
  it("never uses dangerouslySetInnerHTML", () => {
    const offenders = inboxSources
      .filter(({ code }) => code.includes("dangerouslySetInnerHTML"))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("never touches innerHTML, outerHTML or document.write", () => {
    const offenders = inboxSources
      .filter(({ code }) => /innerHTML|outerHTML|document\.write|insertAdjacentHTML/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /**
   * No `<img>`, `<iframe>` or `<object>` anywhere in the feature: an image tag
   * fed from message content is exactly how a tracking pixel gets loaded, and
   * the inbox has no legitimate need for one.
   */
  it("renders no image, iframe or object element", () => {
    const offenders = inboxSources
      .filter(({ code }) => /<(img|iframe|object|embed|video|audio)[\s/>]/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /** Nothing from a message becomes a live link. */
  it("renders no anchor element", () => {
    const offenders = inboxSources
      .filter(({ code }) => /<a[\s>]/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("requests nothing from an external origin", () => {
    const offenders = inboxSources
      .filter(({ code }) => /https?:\/\//.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("the feature ships no way to forward or download", () => {
  /**
   * Replying to a thread is supported as of the reply release; everything else
   * that puts mail out of this server, or files into it, still is not. These
   * are the endpoints a forward button, an attachment download or a bulk
   * sender would need, and none of them exists.
   *
   * The one permitted send path is `POST /admin/inbox/threads/:id/reply`, whose
   * request body is a text body and an idempotency key — no address, no
   * subject, no attachment. It is asserted positively below rather than
   * excluded here.
   */
  it("calls no forward, attachment or bulk-send endpoint", () => {
    const offenders = inboxSources
      .filter(({ code }) =>
        /\/admin\/inbox\/(send|forward|broadcast|templates|attachments|messages\/[^"'`]*\/(attachment|download))/.test(
          code,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /** The reply request carries a body and a key. Nothing else may be sent. */
  it("sends no address, subject or attachment field with a reply", () => {
    const api = inboxSources.find(({ file }) => file.endsWith("inbox-api.ts"));
    expect(api).toBeDefined();

    const reply = api!.code.slice(api!.code.indexOf("postReply"));
    for (const forbidden of ["cc:", "bcc:", "to:", "from:", "subject:", "html:", "attachments:"]) {
      expect(reply.includes(forbidden)).toBe(false);
    }
    expect(reply).toMatch(/idempotency_key/);
  });

  it("triggers no file download", () => {
    const offenders = inboxSources
      .filter(({ code }) => /createObjectURL|download=|\.click\(\)/.test(code))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("no credential reaches the browser bundle", () => {
  /**
   * The admin is a browser bundle. Nothing under `src/admin` may so much as
   * name a mailbox setting — the sidebar badge and the page get counts and a
   * boolean, and that is the whole of what they are told.
   */
  it("names no inbox environment variable", () => {
    const offenders = inboxSources
      .filter(({ text }) =>
        /INBOX_IMAP|INBOX_ENABLED|imapPassword|INBOX_RETENTION|process\.env\.INBOX/.test(
          text,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /**
   * Hostnames and mailbox addresses, not the words. `imap.` on its own matches
   * a sentence ending in "…writes to IMAP.", which is prose explaining a
   * safeguard rather than a leak — the pattern requires an actual host.
   */
  it("mentions no mail host or mailbox user", () => {
    const offenders = inboxSources
      .filter(({ text }) =>
        /(imap|smtp)\.[a-z0-9-]+\.[a-z]{2,}|hostinger|info@peptideeinkaufen/i.test(
          text,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
