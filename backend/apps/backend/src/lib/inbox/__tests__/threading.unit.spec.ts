/**
 * Threading rules.
 *
 * The subject fallback is the dangerous one, so most of this file is about what
 * it refuses to do. Grouping two customers' unrelated "Anfrage" into one
 * conversation is a privacy failure, not a display bug.
 */

import { FakeInboxStore } from "./fixtures";
import { ingestMessage } from "../ingest";
import {
  SUBJECT_THREAD_WINDOW_DAYS,
  buildReferences,
  generateMessageId,
  normalizeSubject,
  parseReferences,
  replySubject,
  resolveThread,
  subjectIsThreadable,
  threadLookupIds,
} from "../threading";
import type { NormalizedMessage } from "../types";

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  const subject = overrides.subject ?? "Anfrage Peptid";

  return {
    mailbox: "INBOX",
    uid: 1,
    message_id: null,
    in_reply_to: null,
    references: [],
    from_name: "A Sender",
    from_email: "sender@example.org",
    reply_to: null,
    recipients: [],
    subject,
    normalized_subject: normalizeSubject(subject),
    received_at: new Date("2026-08-01T10:00:00.000Z"),
    body_text: "text",
    body_truncated: false,
    size_bytes: 100,
    attachments: [],
    ...overrides,
  };
}

describe("subject normalisation", () => {
  it.each([
    ["Anfrage", "anfrage"],
    ["Re: Anfrage", "anfrage"],
    ["RE: Anfrage", "anfrage"],
    ["Fwd: Anfrage", "anfrage"],
    ["Fw: Anfrage", "anfrage"],
    // German mail clients, which is what most of this shop's mail will be.
    ["AW: Anfrage", "anfrage"],
    ["Aw: Anfrage", "anfrage"],
    ["WG: Anfrage", "anfrage"],
    ["Antw: Anfrage", "anfrage"],
    ["Re[2]: Anfrage", "anfrage"],
    ["AW: Re: Fwd: Anfrage", "anfrage"],
    ["  Anfrage   zu   BPC-157  ", "anfrage zu bpc-157"],
  ])("normalises %p to %p", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });

  it("does not eat a subject that merely starts with those letters", () => {
    expect(normalizeSubject("Rechnung 42")).toBe("rechnung 42");
    expect(normalizeSubject("Awesome Produkt")).toBe("awesome produkt");
  });

  it("survives a subject made of nothing but prefixes", () => {
    expect(normalizeSubject("Re: ".repeat(50))).toBe("");
  });

  it("refuses to thread on a subject too short to mean anything", () => {
    expect(subjectIsThreadable("")).toBe(false);
    expect(subjectIsThreadable("hi")).toBe(false);
    expect(subjectIsThreadable("anfrage")).toBe(true);
  });
});

describe("reference parsing", () => {
  it("reads bracketed ids in order and strips the brackets", () => {
    expect(parseReferences("<a@x> <b@x>\r\n <c@x>")).toEqual([
      "a@x",
      "b@x",
      "c@x",
    ]);
  });

  it("accepts unbracketed ids some mailers emit", () => {
    expect(parseReferences("a@x b@x")).toEqual(["a@x", "b@x"]);
  });

  it("deduplicates and caps a long chain, keeping the newest", () => {
    const long = Array.from({ length: 60 }, (_, index) => `<m${index}@x>`).join(" ");
    const parsed = parseReferences(long);

    expect(parsed).toHaveLength(20);
    expect(parsed[parsed.length - 1]).toBe("m59@x");
  });

  it("returns nothing for junk", () => {
    expect(parseReferences(null)).toEqual([]);
    expect(parseReferences("")).toEqual([]);
  });

  it("looks up In-Reply-To first, then references newest first", () => {
    expect(
      threadLookupIds({ in_reply_to: "direct@x", references: ["old@x", "new@x"] }),
    ).toEqual(["direct@x", "new@x", "old@x"]);
  });
});

describe("resolving a thread", () => {
  it("follows In-Reply-To", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, message_id: "root@x" }));

    const reply = message({
      uid: 2,
      message_id: "reply@x",
      in_reply_to: "root@x",
      subject: "AW: something completely different",
      from_email: "someone-else@example.org",
    });

    const resolution = await resolveThread(store, reply);
    expect(resolution.by).toBe("references");
    expect(resolution.thread).not.toBeNull();
  });

  it("follows References when In-Reply-To is missing", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, message_id: "root@x" }));

    const resolution = await resolveThread(
      store,
      message({ uid: 2, message_id: "later@x", references: ["root@x"] }),
    );

    expect(resolution.by).toBe("references");
  });

  it("falls back to the subject for the same sender within the window", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1 }));

    const resolution = await resolveThread(
      store,
      message({ uid: 2, received_at: new Date("2026-08-05T10:00:00.000Z") }),
      new Date("2026-08-05T10:00:00.000Z"),
    );

    expect(resolution.by).toBe("subject");
  });

  /** The rule this whole fallback is hedged for. */
  it("refuses to merge a different sender with the same subject", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1 }));

    const resolution = await resolveThread(
      store,
      message({ uid: 2, from_email: "stranger@example.com" }),
    );

    expect(resolution.by).toBe("new");
    expect(resolution.thread).toBeNull();
  });

  it("refuses to merge the same sender after the window has passed", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1 }));

    const later = new Date(
      Date.parse("2026-08-01T10:00:00.000Z") +
        (SUBJECT_THREAD_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );

    const resolution = await resolveThread(
      store,
      message({ uid: 2, received_at: later }),
      later,
    );

    expect(resolution.by).toBe("new");
  });

  it("refuses to merge on a subject nobody could call distinctive", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, subject: "Hi" }));

    const resolution = await resolveThread(
      store,
      message({ uid: 2, subject: "Hi" }),
    );

    expect(resolution.by).toBe("new");
  });

  it("refuses to merge when the sender address is unusable", async () => {
    const store = new FakeInboxStore();
    await ingestMessage(store, message({ uid: 1, from_email: null }));

    const resolution = await resolveThread(
      store,
      message({ uid: 2, from_email: null }),
    );

    expect(resolution.by).toBe("new");
  });
});

describe("reply headers", () => {
  it.each([
    ["Anfrage", "Re: Anfrage"],
    ["  Anfrage  ", "Re: Anfrage"],
    ["", "Re:"],
  ])("prefixes %p as %p", (subject, expected) => {
    expect(replySubject(subject)).toBe(expected);
  });

  /** One prefix is enough. `Re: AW: Re: …` is how subject lines rot. */
  it.each(["Re: Anfrage", "AW: Anfrage", "WG: Anfrage", "Fwd: Anfrage", "Re[2]: Anfrage"])(
    "leaves %p alone",
    (subject) => {
      expect(replySubject(subject)).toBe(subject);
    },
  );

  it("builds the References chain as parent chain plus parent", () => {
    expect(buildReferences(["a@x", "b@x"], "c@x")).toEqual(["a@x", "b@x", "c@x"]);
  });

  it("does not repeat a parent already in the chain", () => {
    expect(buildReferences(["a@x", "c@x"], "c@x")).toEqual(["a@x", "c@x"]);
  });

  it("keeps a long chain bounded, newest last", () => {
    const long = Array.from({ length: 40 }, (_, index) => `m${index}@x`);
    const built = buildReferences(long, "newest@x");

    expect(built).toHaveLength(20);
    expect(built[built.length - 1]).toBe("newest@x");
  });

  it("copes with a parent that had no Message-ID", () => {
    expect(buildReferences(["a@x"], null)).toEqual(["a@x"]);
  });

  it("generates a Message-ID on the sender's own domain, without brackets", () => {
    const at = new Date("2026-08-05T09:00:00.000Z");
    const id = generateMessageId("info@peptideeinkaufen.de", at, "abc123");

    // Computed rather than hardcoded: the point is the shape and the domain,
    // not a particular millisecond.
    expect(id).toBe(`${at.getTime()}.abc123@peptideeinkaufen.de`);
    expect(id.startsWith("<")).toBe(false);
    expect(id.endsWith(">")).toBe(false);
  });

  it("generates a different id every time by default", () => {
    const first = generateMessageId("info@example.test");
    const second = generateMessageId("info@example.test");
    expect(first).not.toBe(second);
  });

  it("refuses to put anything odd in the domain part", () => {
    const id = generateMessageId("info@exa mple<>.test");
    expect(id).toMatch(/@[A-Za-z0-9.-]+$/);
  });
});
