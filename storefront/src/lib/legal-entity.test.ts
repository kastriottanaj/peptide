/**
 * The rules that decide how the operating company is named on the legal pages.
 *
 * Run with `npm test` (Node's built-in runner — `legal-entity.ts` is
 * deliberately free of Astro/Vite imports so it needs none; `company.ts` is the
 * adapter that reads the environment).
 *
 * Two failures these guard against, pulling in opposite directions:
 *
 * 1. **An invented or half-filled identifier.** `[Firmierung]` reaching the
 *    Impressum as literal text, or an address with no city, is a provider
 *    nobody can serve — which is the one thing § 5 DDG is about.
 * 2. **A field silently disappearing.** On a contact page an unconfigured
 *    channel should vanish; on an Impressum a missing mandatory field must
 *    stay visible as a placeholder, or the page reads as complete when it is
 *    not. So resolution returns `null` and the *page* is responsible for
 *    rendering the marker — these tests pin the `null`, and
 *    `trust-pages.test.ts` pins that nothing is hard-coded instead.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { postalAddress, resolveLegalEntity } from "./legal-entity.ts";

/** A fully configured company, for tests that vary one field at a time. */
const COMPLETE = {
	name: "Muster Handels GmbH",
	street: "Musterstraße 1",
	locality: "12345 Musterstadt",
	country: "Deutschland",
	representative: "Erika Mustermann",
	registerAuthority: "Amtsgericht Musterstadt",
	registerNumber: "HRB 12345",
	vatId: "DE123456789",
};

// ---------------------------------------------------------------------------
// Unfilled values resolve to null
// ---------------------------------------------------------------------------

const UNFILLED: Array<[label: string, value: string | undefined]> = [
	["undefined", undefined],
	["empty", ""],
	["whitespace", "   "],
	["a bracketed marker", "[Firmierung inkl. Rechtsform]"],
	["an angle-bracket template", "<company name>"],
	["the placeholder word", "PLATZHALTER"],
	["a TODO note", "TODO: aus dem Registerauszug übernehmen"],
	["an example value", "Example Ltd."],
	["a German example value", "Beispiel GmbH"],
];

for (const [label, value] of UNFILLED) {
	test(`a name that is ${label} resolves to null`, () => {
		assert.equal(resolveLegalEntity({ ...COMPLETE, name: value }).name, null);
	});
}

test("configured values are trimmed and otherwise printed verbatim", () => {
	const entity = resolveLegalEntity({ ...COMPLETE, name: "  Muster GmbH  " });
	assert.equal(entity.name, "Muster GmbH");
	// Not normalised, reformatted or title-cased: the register decides how the
	// firm is written, not this module.
	assert.equal(entity.registerNumber, "HRB 12345");
});

// ---------------------------------------------------------------------------
// identifiable — can this provider actually be served?
// ---------------------------------------------------------------------------

test("a fully configured company is identifiable and complete", () => {
	const entity = resolveLegalEntity(COMPLETE);
	assert.equal(entity.identifiable, true);
	assert.equal(entity.complete, true);
});

test("a name without an address is NOT identifiable", () => {
	// The failure mode this exists for: an Impressum naming a company that
	// cannot be written to reads as compliant and is not.
	const entity = resolveLegalEntity({ name: COMPLETE.name });
	assert.equal(entity.name, "Muster Handels GmbH");
	assert.equal(entity.identifiable, false);
});

test("half an address is not an address", () => {
	const entity = resolveLegalEntity({
		...COMPLETE,
		locality: undefined,
	});
	assert.equal(entity.identifiable, false);
});

// ---------------------------------------------------------------------------
// complete — is anything still outstanding?
// ---------------------------------------------------------------------------

const MANDATORY = [
	"country",
	"representative",
	"registerAuthority",
	"registerNumber",
	"vatId",
] as const;

for (const field of MANDATORY) {
	test(`a company missing ${field} is identifiable but not complete`, () => {
		const entity = resolveLegalEntity({ ...COMPLETE, [field]: undefined });
		assert.equal(entity.identifiable, true, "address is still there");
		assert.equal(entity.complete, false);
	});
}

// ---------------------------------------------------------------------------
// postalAddress
// ---------------------------------------------------------------------------

test("postalAddress joins the configured lines in reading order", () => {
	assert.equal(
		postalAddress(resolveLegalEntity(COMPLETE)),
		"Musterstraße 1, 12345 Musterstadt, Deutschland",
	);
});

test("postalAddress omits a country that is not configured", () => {
	assert.equal(
		postalAddress(resolveLegalEntity({ ...COMPLETE, country: undefined })),
		"Musterstraße 1, 12345 Musterstadt",
	);
});

test("postalAddress is null when the address is incomplete", () => {
	// Callers render `[Anschrift wie im Impressum]` on null. Returning
	// "Musterstraße 1" alone would print a fragment that looks like an address.
	assert.equal(
		postalAddress(resolveLegalEntity({ ...COMPLETE, locality: undefined })),
		null,
	);
});
