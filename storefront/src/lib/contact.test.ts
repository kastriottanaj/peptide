/**
 * The rules that decide whether a contact channel is real enough to publish.
 *
 * Run with `npm test` (Node's built-in runner — `contact.ts` is deliberately
 * free of Astro/Vite imports so it needs none; `company.ts` is the adapter that
 * reads the environment).
 *
 * The failure these guard against: `/contact/` is indexable and public, so a
 * half-filled `.env` would put `mailto:PLATZHALTER` on a crawled page — a
 * contact route that looks real and fails only after a customer has written the
 * message. Anything unfilled has to resolve to `null` and disappear.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
	configuredValue,
	mailtoHref,
	normalizeEmail,
	normalizePhone,
	resolveContactChannels,
	telHref,
} from "./contact.ts";

// ---------------------------------------------------------------------------
// Unfilled values
// ---------------------------------------------------------------------------

const UNFILLED: Array<[label: string, value: string | undefined]> = [
	["undefined", undefined],
	["empty", ""],
	["whitespace", "   "],
	["bracketed marker", "[E-Mail-Adresse]"],
	["angle-bracket template", "<your-email@here>"],
	["the bank placeholder word", "PLATZHALTER"],
	["a lowercase placeholder", "platzhalter@irgendwo.de"],
	["a TODO note", "TODO: Postfach einrichten"],
	["the reserved example domain", "info@example.com"],
	["a German example address", "kontakt@beispiel.de"],
	["an unfilled template", "changeme@peptideeinkaufen.de"],
];

for (const [label, value] of UNFILLED) {
	test(`configuredValue rejects ${label}`, () => {
		assert.equal(configuredValue(value), null);
	});
}

test("configuredValue keeps a real value and trims it", () => {
	assert.equal(configuredValue("  kontakt@peptideeinkaufen.de  "), "kontakt@peptideeinkaufen.de");
});

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

test("normalizeEmail accepts a plausible address", () => {
	assert.equal(
		normalizeEmail("kontakt@peptideeinkaufen.de"),
		"kontakt@peptideeinkaufen.de",
	);
	assert.equal(normalizeEmail("support+shop@sub.peptideeinkaufen.de"), "support+shop@sub.peptideeinkaufen.de");
});

const MALFORMED_EMAILS = [
	"kontakt",
	"kontakt@",
	"@peptideeinkaufen.de",
	"kontakt@localhost",
	"kontakt @peptideeinkaufen.de",
	"zwei@adressen@hier.de",
];

for (const value of MALFORMED_EMAILS) {
	test(`normalizeEmail rejects ${JSON.stringify(value)}`, () => {
		assert.equal(normalizeEmail(value), null);
	});
}

test("REGRESSION: a placeholder never becomes a mailto target", () => {
	// The whole point of the module. If this ever returns a string, an
	// indexable page ships a dead contact route.
	for (const [, value] of UNFILLED) assert.equal(normalizeEmail(value), null);
});

// ---------------------------------------------------------------------------
// Telephone
// ---------------------------------------------------------------------------

test("normalizePhone keeps the business's own formatting", () => {
	assert.equal(normalizePhone("+49 30 1234567"), "+49 30 1234567");
	assert.equal(normalizePhone("030 / 123 45 67"), "030 / 123 45 67");
});

test("normalizePhone rejects a value with no digits", () => {
	assert.equal(normalizePhone("bitte anrufen"), null);
	assert.equal(normalizePhone("---"), null);
});

test("telHref reduces a printed number to something dialable", () => {
	assert.equal(telHref("+49 30 1234567"), "tel:+49301234567");
	assert.equal(telHref("030 / 123 45 67"), "tel:0301234567");
	// A stray inner `+` must not survive: `tel:+49+30…` is not a number.
	assert.equal(telHref("+49 (0) 30+1234"), "tel:+490301234");
});

test("mailtoHref builds the scheme and nothing else", () => {
	assert.equal(
		mailtoHref("kontakt@peptideeinkaufen.de"),
		"mailto:kontakt@peptideeinkaufen.de",
	);
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

test("no configuration means no channel, and the page says so", () => {
	const channels = resolveContactChannels({});
	assert.deepEqual(channels, { email: null, phone: null, hours: null, any: false });
});

test("an email alone is a usable channel", () => {
	const channels = resolveContactChannels({ email: "kontakt@peptideeinkaufen.de" });
	assert.equal(channels.email, "kontakt@peptideeinkaufen.de");
	assert.equal(channels.phone, null);
	assert.equal(channels.any, true);
});

test("opening hours are dropped without a telephone number", () => {
	// Hours for a line nobody publishes promise availability on a channel that
	// cannot be reached.
	const channels = resolveContactChannels({
		email: "kontakt@peptideeinkaufen.de",
		hours: "Mo–Fr 9–16 Uhr",
	});
	assert.equal(channels.hours, null);
});

test("opening hours survive alongside a number", () => {
	const channels = resolveContactChannels({
		phone: "+49 30 1234567",
		hours: "Mo–Fr 9–16 Uhr",
	});
	assert.equal(channels.hours, "Mo–Fr 9–16 Uhr");
	assert.equal(channels.any, true);
});

test("a half-filled configuration resolves to the half that is real", () => {
	const channels = resolveContactChannels({
		email: "kontakt@peptideeinkaufen.de",
		phone: "[Telefonnummer]",
	});
	assert.equal(channels.email, "kontakt@peptideeinkaufen.de");
	assert.equal(channels.phone, null);
	assert.equal(channels.any, true);
});
