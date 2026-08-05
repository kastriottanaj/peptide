import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
	buildCoaLookupModel,
	findProduct,
	findVariant,
	hasLinkedDocuments,
	isAllowedDocumentUrl,
	listedDocuments,
	readVariantDocument,
	resolveVariantStatus,
} from "./coa-documents.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const source = (relative: string) => readFileSync(`${ROOT}${relative}`, "utf8");

/** Source with comments removed, so assertions read code rather than prose. */
const codeOf = (relative: string) =>
	source(relative)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");

const fixture = (name: string) =>
	JSON.parse(source(`lib/fixtures/${name}.json`)).products as never[];

const EMPTY = fixture("coa-catalog-empty");
const DOCUMENTS = fixture("coa-catalog-documents");

/** The production allowlist, stated explicitly so the tests do not read env. */
const ORIGINS = ["https://api.peptideeinkaufen.de", "https://peptideeinkaufen.de"];

const emptyModel = () => buildCoaLookupModel(EMPTY, ORIGINS);
const documentModel = () => buildCoaLookupModel(DOCUMENTS, ORIGINS);

const variantOf = (products: never[], handle: string, packSize: string) => {
	const product = (products as Array<Record<string, never>>).find(
		(entry) => entry.handle === (handle as never),
	);
	assert.ok(product, `fixture is missing ${handle}`);
	const variant = (product.variants as unknown as Array<{ title: string }>).find(
		(entry) => entry.title === packSize,
	);
	assert.ok(variant, `fixture is missing ${handle} / ${packSize}`);
	return variant as never;
};

// --- current production reality ------------------------------------------

test("today's catalog links no document, on any product or pack size", () => {
	const model = emptyModel();
	assert.equal(model.catalogAvailable, true);
	assert.equal(model.products.length, 6);
	// 11 variants: BPC-157 2, Retatrutide 3, GHK-Cu 2, MOTS-c 1, Semax 1, TB-500 2.
	assert.equal(
		model.products.reduce((total, product) => total + product.variants.length, 0),
		11,
	);
	assert.equal(model.documentCount, 0);
	assert.equal(hasLinkedDocuments(model), false);
	for (const product of model.products) {
		for (const status of product.variants) {
			assert.equal(status.state, "none");
		}
	}
});

test("the placeholder coa_status and purity are not treated as document evidence", () => {
	const model = emptyModel();
	// Every fixture product carries coa_status "verfügbar" and purity ">99%".
	assert.equal(model.documentCount, 0);
	assert.equal(hasLinkedDocuments(model), false);

	// Comments are stripped first: this asserts on executable code, not on the
	// prose that explains why these fields are ignored.
	for (const forbidden of ["coa_status", "purity", "data_status", "demo"]) {
		assert.ok(
			!codeOf("lib/coa-documents.ts").includes(forbidden),
			`the resolver must not read ${forbidden}`,
		);
	}
});

test("an empty catalog is reported as unavailable rather than as an empty result", () => {
	const model = buildCoaLookupModel([], ORIGINS);
	assert.equal(model.catalogAvailable, false);
	assert.equal(model.products.length, 0);
	assert.equal(hasLinkedDocuments(model), false);
});

// --- document resolution ---------------------------------------------------

test("a valid allowlisted document resolves with all stored fields", () => {
	const status = resolveVariantStatus(
		variantOf(DOCUMENTS, "dokument-produkt", "5 mg"),
		ORIGINS,
	);
	assert.equal(status.state, "document");
	assert.equal(status.variant.packSize, "5 mg");
	assert.equal(status.variant.sku, "PEK-DOC-5mg");
	if (status.state !== "document") return;
	assert.equal(
		status.document.url,
		"https://api.peptideeinkaufen.de/static/coa-doc-5mg.pdf",
	);
	assert.equal(status.document.type, "COA");
	assert.equal(status.document.analysisDate, "2026-05-14");
	assert.equal(status.document.batch, "CHARGE-5MG-01");
});

test("invalid optional fields clear themselves without withholding the document", () => {
	const status = resolveVariantStatus(
		variantOf(DOCUMENTS, "dokument-produkt", "15 mg"),
		ORIGINS,
	);
	assert.equal(status.state, "document");
	if (status.state !== "document") return;
	// Whitespace-only type, impossible date (2026-02-30), non-string batch.
	assert.equal(status.document.type, null);
	assert.equal(status.document.analysisDate, null);
	assert.equal(status.document.batch, null);
	assert.equal(status.document.url, "https://peptideeinkaufen.de/dokumente/coa-doc-15mg.pdf");
});

test("a document never crosses to a sibling variant, another product or the product level", () => {
	const model = documentModel();
	const documented = findProduct(model, "dokument-produkt");
	assert.ok(documented);

	// The sibling pack sizes of the documented product.
	const sibling = findVariant(documented, "10 mg");
	assert.equal(sibling?.state, "none");

	// A different product entirely, whose own metadata carries no document.
	const other = findProduct(model, "kein-dokument");
	assert.ok(other);
	assert.equal(other.variants.every((status) => status.state === "none"), true);

	// The documented product's *product-level* coa_document_url must be ignored:
	// exactly two variants resolve to a document (5 mg and 15 mg), not three.
	assert.equal(
		documented.variants.filter((status) => status.state === "document").length,
		2,
	);
	assert.equal(model.documentCount, 2);
});

test("exact matching only: no fuzzy handle and no numeric pack-size proximity", () => {
	const model = documentModel();
	assert.equal(findProduct(model, "dokument"), null);
	assert.equal(findProduct(model, "Dokument-Produkt"), null);
	assert.equal(findProduct(model, " dokument-produkt "), findProduct(model, "dokument-produkt"));

	const documented = findProduct(model, "dokument-produkt");
	assert.ok(documented);
	assert.equal(findVariant(documented, "6 mg"), null);
	assert.equal(findVariant(documented, "5"), null);
	assert.equal(findVariant(documented, "5 mg")?.state, "document");
});

// --- URL validation --------------------------------------------------------

test("only https URLs on an exactly matching allowlisted origin are accepted", () => {
	assert.equal(
		isAllowedDocumentUrl("https://api.peptideeinkaufen.de/static/coa.pdf", ORIGINS),
		true,
	);
	assert.equal(
		isAllowedDocumentUrl("https://peptideeinkaufen.de/dokumente/coa.pdf", ORIGINS),
		true,
	);
	// A host that merely ends with the allowed name must not pass.
	assert.equal(
		isAllowedDocumentUrl("https://api.peptideeinkaufen.de.evil.test/coa.pdf", ORIGINS),
		false,
	);
	assert.equal(
		isAllowedDocumentUrl("https://evil.test/api.peptideeinkaufen.de/coa.pdf", ORIGINS),
		false,
	);
	// A port makes it a different origin.
	assert.equal(
		isAllowedDocumentUrl("https://api.peptideeinkaufen.de:8443/coa.pdf", ORIGINS),
		false,
	);
});

test("every rejected scheme and malformed form degrades to no document", () => {
	const model = documentModel();
	const bad = findProduct(model, "ungueltige-urls");
	assert.ok(bad);
	assert.equal(bad.variants.length, 12);
	for (const status of bad.variants) {
		assert.equal(
			status.state,
			"none",
			`${status.variant.sku ?? status.variant.packSize} must resolve to no document`,
		);
	}
});

test("each rejection case is rejected for its own reason", () => {
	const cases: Array<[string, string]> = [
		["1 mg", "http"],
		["2 mg", "file"],
		["3 mg", "data"],
		["4 mg", "javascript"],
		["5 mg", "blob"],
		["6 mg", "protocol-relative"],
		["7 mg", "malformed"],
		["8 mg", "relative path"],
		["9 mg", "disallowed origin"],
		["10 mg", "embedded credentials"],
		["11 mg", "empty string"],
		["12 mg", "non-string"],
	];
	for (const [packSize, reason] of cases) {
		const document = readVariantDocument(
			variantOf(DOCUMENTS, "ungueltige-urls", packSize),
			ORIGINS,
		);
		assert.equal(document, null, `${reason} must not produce a document`);
	}
});

test("an empty allowlist accepts nothing", () => {
	assert.equal(
		isAllowedDocumentUrl("https://api.peptideeinkaufen.de/static/coa.pdf", []),
		false,
	);
	assert.equal(buildCoaLookupModel(DOCUMENTS, []).documentCount, 0);
});

// --- discovery predicate ---------------------------------------------------

test("one predicate answers for robots, sitemap and llms.txt", () => {
	assert.equal(hasLinkedDocuments(emptyModel()), false);
	assert.equal(hasLinkedDocuments(documentModel()), true);
});

test("listedDocuments enumerates exactly the documents the page shows", () => {
	assert.deepEqual(listedDocuments(emptyModel()), []);
	const listed = listedDocuments(documentModel());
	assert.equal(listed.length, 2);
	assert.deepEqual(
		listed.map((entry) => `${entry.product.handle}/${entry.status.variant.packSize}`),
		["dokument-produkt/5 mg", "dokument-produkt/15 mg"],
	);
});

// --- what the model must never carry ---------------------------------------

test("no Medusa identifier travels in the public model", () => {
	const serialised = JSON.stringify(documentModel());
	assert.doesNotMatch(serialised, /prod_/);
	assert.doesNotMatch(serialised, /variant_/);
	assert.doesNotMatch(serialised, /"id"/);
});
