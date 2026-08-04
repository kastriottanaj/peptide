/**
 * The shipped configuration and documentation, read as text.
 *
 * Three claims that are easy to make in a review and easy to break in an edit,
 * so they are pinned here instead:
 *
 *  1. **The template ships the feature off and passwordless.** A committed
 *     mailbox password is a leaked credential no matter who can read the repo,
 *     and this one opens the company's mail.
 *  2. **There is one mailbox.** The integration signs in to the existing
 *     `info@` mailbox directly — an earlier draft of this feature assumed a
 *     second `medusa-inbox@` account fed by a forwarding rule, and no
 *     instruction to create one may survive anywhere.
 *  3. **The first run imports nothing.** `INBOX_IMPORT_EXISTING=false` is the
 *     shipped default, because the mailbox has real history that must not be
 *     copied into a second system as a side effect of flipping a switch.
 */

import { readFileSync } from "fs";
import { join } from "path";

/** …/backend/apps/backend */
const APP_ROOT = join(__dirname, "..", "..", "..", "..");
/** the repository root */
const REPO_ROOT = join(APP_ROOT, "..", "..", "..");

const template = readFileSync(join(APP_ROOT, ".env.template"), "utf8");

const docs = [
  join(REPO_ROOT, "README.md"),
  join(REPO_ROOT, "docs", "inbox.md"),
  join(REPO_ROOT, "docs", "specs", "2026-08-04-admin-email-inbox.md"),
  join(REPO_ROOT, "docs", "plans", "2026-08-04-admin-email-inbox.md"),
].map((file) => ({ file, text: readFileSync(file, "utf8") }));

/** Every `KEY=value` in the template, values included. */
function templateValue(key: string): string | undefined {
  const match = template.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match?.[1];
}

describe(".env.template", () => {
  it("ships the inbox switched off", () => {
    expect(templateValue("INBOX_ENABLED")).toBe("false");
  });

  it("ships no mailbox password", () => {
    expect(templateValue("INBOX_IMAP_PASSWORD")).toBe("");
  });

  /**
   * The address is on the website; it is documentation, not a secret. Filling
   * it in removes a step that could otherwise be got wrong, and there is only
   * ever one correct value.
   */
  it("documents the one mailbox it connects to", () => {
    expect(templateValue("INBOX_IMAP_USER")).toBe("info@peptideeinkaufen.de");
  });

  it("ships the no-backfill default", () => {
    expect(templateValue("INBOX_IMPORT_EXISTING")).toBe("false");
  });

  it("ships retention disabled", () => {
    expect(templateValue("INBOX_RETENTION_DAYS")).toBe("");
  });
});

describe("documentation", () => {
  it("nowhere names a second mailbox", () => {
    const offenders = docs
      .filter(({ text }) => /medusa-inbox/i.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
    expect(template).not.toMatch(/medusa-inbox/i);
  });

  /**
   * "No forwarding rule" is a fine sentence; "add a forwarding rule" is not.
   * The check is on the instruction, not on the word.
   */
  it("instructs nobody to set up forwarding", () => {
    const instruction =
      /(add|create|configure|set up|enable|turn on)[^.\n]{0,40}(forward|weiterleit)/i;

    const offenders = docs
      .filter(({ text }) => instruction.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
    expect(template).not.toMatch(instruction);
  });

  it("tells nobody to keep a forwarded copy", () => {
    const offenders = docs
      .filter(({ text }) => /keep a copy|keeps the original/i.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /**
   * A password in a document is a leaked password, whether or not the document
   * is committed. Only the empty assignment may appear.
   */
  it("contains no mailbox password", () => {
    // Anchored per line: `=\s*` would swallow the newline and read the *next*
    // key's value as this one's.
    const assignment = /^INBOX_IMAP_PASSWORD=([^\n]*)$/gm;
    const offenders: string[] = [];

    for (const { file, text } of [
      ...docs,
      { file: ".env.template", text: template },
    ]) {
      for (const match of text.matchAll(assignment)) {
        // Trailing prose after `#` is a comment, not a value.
        const value = (match[1] ?? "").replace(/#.*$/, "").trim();
        // Empty is correct. `…` is the runbook's placeholder for "type it here".
        if (value && value !== "…") offenders.push(`${file}: ${value}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("states that the first run imports nothing", () => {
    const runbook = docs.find(({ file }) => file.endsWith("inbox.md"));

    expect(runbook?.text).toContain("INBOX_IMPORT_EXISTING=false");
    expect(runbook?.text).toMatch(/only[\s\S]{0,40}arrive after it/i);
  });
});
