#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import {
	lstat,
	open,
	readFile,
	readdir,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const HTML_WHITESPACE = /[\t\n\f\r ]/;
const TAG_NAME_CHARACTER = /[A-Za-z0-9:-]/;
const ATTRIBUTE_NAME_STOP = /[\t\n\f\r />="'<]/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const NAMED_ATTRIBUTE_REFERENCES = new Map([
	["amp", "&"],
	["apos", "'"],
	["gt", ">"],
	["lt", "<"],
	["quot", '"'],
]);

const CSP_SOURCES = Object.freeze({
	script: ["'self'", "https://www.googletagmanager.com"],
	connect: [
		"'self'",
		"https://api.peptideeinkaufen.de",
		"https://*.google-analytics.com",
		"https://www.google-analytics.com",
		"https://www.googletagmanager.com",
	],
	image: [
		"'self'",
		"data:",
		"https://api.peptideeinkaufen.de",
		"https://*.google-analytics.com",
		"https://www.google-analytics.com",
	],
});

export const CSP_MODES = Object.freeze({
	enforce: "Content-Security-Policy",
	reportOnly: "Content-Security-Policy-Report-Only",
});

function fail(file, message) {
	throw new Error(`${file}: ${message}`);
}

/**
 * Return the CSP SHA-256 source expression for the exact UTF-8 bytes represented
 * by `source`. Script/style element text is passed through without trimming or
 * entity decoding. Attribute values are decoded first, matching the value the
 * HTML parser exposes to CSP.
 */
export function sha256Source(source) {
	const digest = createHash("sha256").update(source, "utf8").digest("base64");
	return `'sha256-${digest}'`;
}

function decodeAttributeValue(rawValue, file, attributeName) {
	return rawValue.replace(
		/&(#(?:[xX][0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/g,
		(match, reference) => {
			if (reference[0] !== "#") {
				const decoded = NAMED_ATTRIBUTE_REFERENCES.get(
					reference.toLowerCase(),
				);
				if (decoded === undefined) {
					fail(
						file,
						`unsupported named character reference "${match}" in ${attributeName}; use a numeric reference or UTF-8 text`,
					);
				}
				return decoded;
			}

			const hexadecimal = reference[1] === "x" || reference[1] === "X";
			const digits = reference.slice(hexadecimal ? 2 : 1);
			const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);

			// Browsers repair invalid references in several context-sensitive
			// ways. Reject them instead of risking a hash that differs from the
			// browser's parsed attribute value.
			if (
				codePoint === 0 ||
				codePoint > 0x10ffff ||
				(codePoint >= 0xd800 && codePoint <= 0xdfff)
			) {
				fail(
					file,
					`invalid numeric character reference "${match}" in ${attributeName}`,
				);
			}

			return String.fromCodePoint(codePoint);
		},
	);
}

function findTagEnd(html, start, file) {
	let quote = "";

	for (let index = start; index < html.length; index += 1) {
		const character = html[index];

		if (quote) {
			if (character === quote) quote = "";
			continue;
		}

		if (character === '"' || character === "'") {
			quote = character;
		} else if (character === ">") {
			return index;
		} else if (character === "\0") {
			fail(file, "NUL byte in HTML");
		}
	}

	fail(file, quote ? "unterminated quoted attribute" : "unterminated HTML tag");
}

function parseAttributes(fragment, file, tagName) {
	const attributes = new Map();
	let index = 0;

	while (index < fragment.length) {
		while (HTML_WHITESPACE.test(fragment[index] ?? "")) index += 1;
		if (index >= fragment.length) break;

		if (fragment[index] === "/") {
			index += 1;
			while (HTML_WHITESPACE.test(fragment[index] ?? "")) index += 1;
			if (index !== fragment.length) {
				fail(file, `unexpected content after "/" in <${tagName}>`);
			}
			break;
		}

		const nameStart = index;
		while (
			index < fragment.length &&
			!ATTRIBUTE_NAME_STOP.test(fragment[index])
		) {
			index += 1;
		}

		if (index === nameStart) {
			fail(file, `malformed attribute in <${tagName}>`);
		}

		const name = fragment.slice(nameStart, index).toLowerCase();
		if (attributes.has(name)) {
			fail(file, `duplicate "${name}" attribute in <${tagName}>`);
		}

		while (HTML_WHITESPACE.test(fragment[index] ?? "")) index += 1;

		let rawValue = "";
		if (fragment[index] === "=") {
			index += 1;
			while (HTML_WHITESPACE.test(fragment[index] ?? "")) index += 1;
			if (index >= fragment.length) {
				fail(file, `missing value for "${name}" in <${tagName}>`);
			}

			const quote = fragment[index];
			if (quote === '"' || quote === "'") {
				index += 1;
				const valueStart = index;
				while (index < fragment.length && fragment[index] !== quote) {
					if (fragment[index] === "\0") fail(file, "NUL byte in HTML");
					index += 1;
				}
				if (index >= fragment.length) {
					fail(file, `unterminated "${name}" value in <${tagName}>`);
				}
				rawValue = fragment.slice(valueStart, index);
				index += 1;
			} else {
				const valueStart = index;
				while (
					index < fragment.length &&
					!HTML_WHITESPACE.test(fragment[index])
				) {
					if (
						fragment[index] === '"' ||
						fragment[index] === "'" ||
						fragment[index] === "<" ||
						fragment[index] === "=" ||
						fragment[index] === "`"
					) {
						fail(file, `malformed unquoted "${name}" value in <${tagName}>`);
					}
					index += 1;
				}
				rawValue = fragment.slice(valueStart, index);
			}
		}

		attributes.set(name, decodeAttributeValue(rawValue, file, name));
	}

	return attributes;
}

function findRawElementClose(html, start, tagName, file) {
	const lower = html.toLowerCase();
	const prefix = `</${tagName}`;
	let cursor = start;

	while (cursor < html.length) {
		const candidate = lower.indexOf(prefix, cursor);
		if (candidate === -1) {
			fail(file, `missing closing </${tagName}>`);
		}

		const afterName = html[candidate + prefix.length];
		if (afterName === ">" || HTML_WHITESPACE.test(afterName ?? "")) {
			const end = findTagEnd(html, candidate + prefix.length, file);
			const closingTail = html
				.slice(candidate + prefix.length, end)
				.trim();
			if (closingTail !== "") {
				fail(file, `malformed closing </${tagName}>`);
			}
			return { contentEnd: candidate, tagEnd: end };
		}

		cursor = candidate + prefix.length;
	}

	fail(file, `missing closing </${tagName}>`);
}

/**
 * Inventory the inline CSP-relevant content of one HTML document.
 *
 * Every inline <script> without `src` is included. This intentionally includes
 * module/import-map/data blocks such as JSON-LD so the generated policy does
 * not depend on browser-specific decisions about which script types receive an
 * inline CSP check. External scripts are governed by their source expression.
 */
export function inventoryHtml(html, file = "<html>") {
	if (html.includes("\0")) fail(file, "NUL byte in HTML");

	const scripts = [];
	const styleElements = [];
	const styleAttributes = [];
	let index = 0;

	while (index < html.length) {
		const tagStart = html.indexOf("<", index);
		if (tagStart === -1) break;

		if (html.startsWith("<!--", tagStart)) {
			const commentEnd = html.indexOf("-->", tagStart + 4);
			if (commentEnd === -1) fail(file, "unterminated HTML comment");
			index = commentEnd + 3;
			continue;
		}

		const next = html[tagStart + 1];
		if (next === "!" || next === "?") {
			index = findTagEnd(html, tagStart + 2, file) + 1;
			continue;
		}

		if (next === "/") {
			let nameEnd = tagStart + 2;
			while (TAG_NAME_CHARACTER.test(html[nameEnd] ?? "")) nameEnd += 1;
			const tagName = html.slice(tagStart + 2, nameEnd).toLowerCase();
			if (tagName === "script" || tagName === "style") {
				fail(file, `unexpected closing </${tagName}>`);
			}
			index = findTagEnd(html, nameEnd, file) + 1;
			continue;
		}

		if (!/[A-Za-z]/.test(next ?? "")) {
			index = tagStart + 1;
			continue;
		}

		let nameEnd = tagStart + 1;
		while (TAG_NAME_CHARACTER.test(html[nameEnd] ?? "")) nameEnd += 1;
		const tagName = html.slice(tagStart + 1, nameEnd).toLowerCase();
		const tagEnd = findTagEnd(html, nameEnd, file);
		const attributes = parseAttributes(
			html.slice(nameEnd, tagEnd),
			file,
			tagName,
		);

		for (const [name, value] of attributes) {
			if (/^on[a-z]/i.test(name)) {
				fail(
					file,
					`inline event handler "${name}" is forbidden; externalize it before generating CSP`,
				);
			}
			if (/^\s*javascript:/i.test(value)) {
				fail(
					file,
					`javascript: URL in "${name}" is forbidden; externalize it before generating CSP`,
				);
			}
		}

		if (attributes.has("style")) {
			styleAttributes.push(attributes.get("style"));
		}

		if (tagName === "script" || tagName === "style") {
			const close = findRawElementClose(html, tagEnd + 1, tagName, file);
			const content = html.slice(tagEnd + 1, close.contentEnd);

			if (tagName === "style") {
				styleElements.push(content);
			} else if (!attributes.has("src")) {
				scripts.push(content);
			}

			index = close.tagEnd + 1;
			continue;
		}

		index = tagEnd + 1;
	}

	return { scripts, styleElements, styleAttributes };
}

async function listHtmlFiles(root) {
	const files = [];

	async function visit(directory) {
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			throw new Error(`cannot read directory ${directory}: ${error.message}`);
		}

		entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) {
				throw new Error(`symbolic links are not allowed in the build: ${path}`);
			}
			if (entry.isDirectory()) {
				await visit(path);
			} else if (entry.isFile() && extname(entry.name).toLowerCase() === ".html") {
				files.push(path);
			} else if (!entry.isFile()) {
				throw new Error(`unsupported filesystem entry in the build: ${path}`);
			}
		}
	}

	await visit(root);
	return files;
}

function sortedUnique(values) {
	return [...new Set(values)].sort();
}

export async function inventoryBuild(buildDirectory) {
	const root = resolve(buildDirectory);
	let rootStats;
	try {
		rootStats = await lstat(root);
	} catch (error) {
		throw new Error(`cannot inspect build directory ${root}: ${error.message}`);
	}

	if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
		throw new Error(`build path is not a real directory: ${root}`);
	}

	const htmlFiles = await listHtmlFiles(root);
	if (htmlFiles.length === 0) {
		throw new Error(`build contains no HTML files: ${root}`);
	}

	const scriptHashes = new Set();
	const styleElementHashes = new Set();
	const styleAttributeHashes = new Set();

	for (const file of htmlFiles) {
		let bytes;
		try {
			bytes = await readFile(file);
		} catch (error) {
			throw new Error(`cannot read HTML file ${file}: ${error.message}`);
		}

		let html;
		try {
			html = UTF8_DECODER.decode(bytes);
		} catch (error) {
			throw new Error(`HTML file is not valid UTF-8 (${file}): ${error.message}`);
		}

		const inventory = inventoryHtml(html, file);
		for (const source of inventory.scripts) {
			scriptHashes.add(sha256Source(source));
		}
		for (const source of inventory.styleElements) {
			styleElementHashes.add(sha256Source(source));
		}
		for (const source of inventory.styleAttributes) {
			styleAttributeHashes.add(sha256Source(source));
		}
	}

	return {
		htmlFileCount: htmlFiles.length,
		scriptHashes: sortedUnique(scriptHashes),
		styleElementHashes: sortedUnique(styleElementHashes),
		styleAttributeHashes: sortedUnique(styleAttributeHashes),
	};
}

function directive(name, sources) {
	return `${name} ${sources.join(" ")}`;
}

export function buildPolicy(inventory) {
	const scriptHashes = sortedUnique(inventory.scriptHashes);
	const styleAttributeHashes = sortedUnique(inventory.styleAttributeHashes);
	const styleHashes = sortedUnique([
		...inventory.styleElementHashes,
		...styleAttributeHashes,
	]);
	const styleSources = ["'self'", ...styleHashes];

	if (styleAttributeHashes.length > 0) {
		styleSources.splice(1, 0, "'unsafe-hashes'");
	}

	const styleAttributeSources =
		styleAttributeHashes.length === 0
			? ["'none'"]
			: ["'unsafe-hashes'", ...styleAttributeHashes];

	return [
		directive("default-src", ["'self'"]),
		directive("script-src", [
			...CSP_SOURCES.script,
			...scriptHashes,
		]),
		directive("script-src-attr", ["'none'"]),
		directive("style-src", styleSources),
		directive("style-src-attr", styleAttributeSources),
		directive("connect-src", CSP_SOURCES.connect),
		directive("img-src", CSP_SOURCES.image),
		directive("font-src", ["'self'"]),
		directive("frame-ancestors", ["'none'"]),
		directive("base-uri", ["'self'"]),
		directive("form-action", ["'self'"]),
		directive("object-src", ["'none'"]),
	].join("; ");
}

export function quoteCaddy(value) {
	if (/[\0\r\n]/.test(value)) {
		throw new Error("Caddy header value contains a forbidden control character");
	}
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function cspHeaderName(mode) {
	const headerName = CSP_MODES[mode];
	if (!headerName) {
		throw new Error(
			`unsupported CSP mode "${mode}"; expected "enforce" or "reportOnly"`,
		);
	}
	return headerName;
}

export function renderCaddyImport(inventory, mode = "enforce") {
	const policy = buildPolicy(inventory);
	const headerName = cspHeaderName(mode);
	return [
		"# Generated by deploy/build-csp.mjs; do not edit.",
		`# Mode: ${mode === "enforce" ? "enforced" : "report-only"}.`,
		`# HTML files: ${inventory.htmlFileCount}; inline scripts: ${inventory.scriptHashes.length}; inline style blocks: ${inventory.styleElementHashes.length}; inline style attributes: ${inventory.styleAttributeHashes.length}.`,
		`header ${headerName} ${quoteCaddy(policy)}`,
		"",
	].join("\n");
}

async function atomicWrite(outputFile, content) {
	const output = resolve(outputFile);
	const parent = dirname(output);

	let parentStats;
	try {
		parentStats = await stat(parent);
	} catch (error) {
		throw new Error(`cannot inspect output directory ${parent}: ${error.message}`);
	}
	if (!parentStats.isDirectory()) {
		throw new Error(`output parent is not a directory: ${parent}`);
	}

	const temporary = join(
		parent,
		`.${basename(output)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
	);
	let handle;

	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.chmod(0o644);
		await handle.close();
		handle = undefined;
		await rename(temporary, output);
	} catch (error) {
		if (handle) await handle.close().catch(() => {});
		await rm(temporary, { force: true }).catch(() => {});
		throw new Error(`cannot atomically write CSP output ${output}: ${error.message}`);
	}
}

export async function buildCspFile(
	buildDirectory,
	outputFile,
	mode = "enforce",
) {
	cspHeaderName(mode);
	const inventory = await inventoryBuild(buildDirectory);
	const output = renderCaddyImport(inventory, mode);
	await atomicWrite(outputFile, output);
	return inventory;
}

async function main() {
	const arguments_ = process.argv.slice(2);
	let mode = "enforce";
	if (arguments_[0] === "--report-only") {
		mode = "reportOnly";
		arguments_.shift();
	} else if (arguments_[0] === "--enforce") {
		arguments_.shift();
	}

	const [buildDirectory, outputFile, ...extra] = arguments_;
	if (!buildDirectory || !outputFile || extra.length > 0) {
		throw new Error(
			"usage: node deploy/build-csp.mjs [--enforce|--report-only] <built-storefront-dir> <output-file>",
		);
	}

	const inventory = await buildCspFile(buildDirectory, outputFile, mode);
	process.stdout.write(
		`Wrote ${mode === "enforce" ? "enforced" : "report-only"} CSP for ${inventory.htmlFileCount} HTML file(s) to ${resolve(outputFile)}.\n`,
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	main().catch((error) => {
		process.stderr.write(`build-csp: ${error.message}\n`);
		process.exitCode = 1;
	});
}
