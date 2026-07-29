import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
	findChromeExecutable,
	verifyCspInBrowser,
} from "../verify-csp-browser.mjs";

const temporaryDirectories = [];

async function fixture(files) {
	const root = await mkdtemp(join(tmpdir(), "peptides-csp-browser-test-"));
	temporaryDirectories.push(root);
	for (const [relativePath, contents] of Object.entries(files)) {
		const path = join(root, relativePath);
		await mkdir(join(path, ".."), { recursive: true });
		await writeFile(path, contents, "utf8");
	}
	return root;
}

after(async () => {
	await Promise.all(
		temporaryDirectories.map((directory) =>
			rm(directory, { force: true, recursive: true }),
		),
	);
});

const chromePath = await findChromeExecutable();

test(
	"Chrome receives the report-only policy, exercises controls, and reports no violations for a complete inventory",
	{ skip: chromePath ? false : "Chrome/Chromium is not installed", timeout: 60_000 },
	async () => {
		const root = await fixture({
			"assets/app.js": [
				"globalThis.fixtureExternal = true;",
				"document.querySelector('button').addEventListener('click', () => {",
				"  document.querySelector('output').textContent = 'clicked';",
				"});",
			].join("\n"),
			"index.html": [
				"<!doctype html>",
				'<html><head><meta charset="utf-8">',
				"<style>button { color: green; }</style>",
				'<script src="/assets/app.js" defer></script>',
				"<script>globalThis.fixtureInline = true;</script>",
				"</head><body>",
				'<button type="button" style="border: 0">Exercise me</button>',
				"<output></output>",
				"</body></html>",
			].join(""),
			"nested/index.html":
				"<!doctype html><html><body><details><summary>Open</summary>Safe</details></body></html>",
		});

		const result = await verifyCspInBrowser(root, {
			chromePath,
			settleMilliseconds: 100,
		});

		assert.equal(result.htmlFileCount, 2);
		assert.equal(result.pageCount, 2);
		assert.equal(result.reportOnlyHeaderValidated, true);
		assert.equal(result.violations.length, 0);
		assert.ok(result.controlsExercised >= 2);
	},
);

test(
	"Chrome turns a dynamically introduced, uninventoried inline script into a failing report-only gate",
	{ skip: chromePath ? false : "Chrome/Chromium is not installed", timeout: 60_000 },
	async () => {
		const root = await fixture({
			"assets/inject.js": [
				'const script = document.createElement("script");',
				'script.textContent = "globalThis.dynamicInlineExecuted = true;";',
				"document.head.append(script);",
			].join("\n"),
			"index.html":
				'<!doctype html><html><head><script src="/assets/inject.js"></script></head><body>Violation fixture</body></html>',
		});

		await assert.rejects(
			verifyCspInBrowser(root, {
				chromePath,
				settleMilliseconds: 100,
			}),
			(error) => {
				assert.match(error.message, /report-only browser audit found/);
				assert.ok(error.result.violations.length >= 1);
				assert.ok(
					error.result.violations.some(
						(violation) =>
							violation.effectiveDirective === "script-src-elem" ||
							violation.effectiveDirective === "script-src",
					),
				);
				return true;
			},
		);
	},
);
