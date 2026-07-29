#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	access,
	lstat,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import {
	delimiter,
	extname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { constants } from "node:fs";

import { buildPolicy, inventoryBuild } from "./build-csp.mjs";

const CHROME_NAMES = ["google-chrome", "chromium", "chromium-browser"];
const CHROME_KNOWN_PATHS = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];
const REPORT_PATH = "/__peptides_csp_report";
const MAX_REPORT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

const CONTENT_TYPES = new Map([
	[".avif", "image/avif"],
	[".css", "text/css; charset=utf-8"],
	[".gif", "image/gif"],
	[".html", "text/html; charset=utf-8"],
	[".ico", "image/x-icon"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".mjs", "text/javascript; charset=utf-8"],
	[".png", "image/png"],
	[".svg", "image/svg+xml"],
	[".txt", "text/plain; charset=utf-8"],
	[".webp", "image/webp"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
	[".xml", "application/xml; charset=utf-8"],
]);

function delay(milliseconds) {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function isExecutableFile(path) {
	try {
		const file = await stat(path);
		if (!file.isFile()) return false;
		await access(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function findChromeExecutable(environment = process.env) {
	if (environment.CHROME_PATH) {
		const configured = resolve(environment.CHROME_PATH);
		if (!(await isExecutableFile(configured))) {
			throw new Error(
				`CHROME_PATH is not an executable regular file: ${configured}`,
			);
		}
		return configured;
	}

	for (const candidate of CHROME_KNOWN_PATHS) {
		if (await isExecutableFile(candidate)) return candidate;
	}

	for (const directory of (environment.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		for (const name of CHROME_NAMES) {
			const candidate = join(directory, name);
			if (await isExecutableFile(candidate)) return candidate;
		}
	}

	return undefined;
}

function routeForHtml(relativePath) {
	const portable = relativePath.split(sep).join("/");
	if (portable === "index.html") return "/";
	if (portable.endsWith("/index.html")) {
		return `/${portable.slice(0, -"index.html".length)}`;
	}
	return `/${portable}`;
}

async function discoverHtmlRoutes(buildDirectory) {
	const root = resolve(buildDirectory);
	const routes = [];

	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) {
				throw new Error(`symbolic links are not allowed in the build: ${path}`);
			}
			if (entry.isDirectory()) {
				await visit(path);
			} else if (
				entry.isFile() &&
				extname(entry.name).toLowerCase() === ".html"
			) {
				routes.push(routeForHtml(relative(root, path)));
			}
		}
	}

	await visit(root);
	return routes.sort();
}

function resolveRequestFile(root, pathname) {
	let decoded;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return undefined;
	}

	if (
		decoded.includes("\0") ||
		decoded.includes("\\") ||
		decoded.split("/").includes("..")
	) {
		return undefined;
	}

	let relativePath = decoded.replace(/^\/+/, "");
	if (relativePath === "" || relativePath.endsWith("/")) {
		relativePath += "index.html";
	}

	const candidate = resolve(root, relativePath);
	const pathFromRoot = relative(root, candidate);
	if (
		pathFromRoot === "" ||
		pathFromRoot === ".." ||
		pathFromRoot.startsWith(`..${sep}`) ||
		resolve(root, pathFromRoot) !== candidate
	) {
		return undefined;
	}
	return candidate;
}

async function collectReport(request) {
	const chunks = [];
	let size = 0;

	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_REPORT_BYTES) {
			throw new Error("CSP report exceeded the local audit size limit");
		}
		chunks.push(chunk);
	}

	const text = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(text);
	} catch {
		return { malformedReport: true };
	}
}

async function startFixtureServer(buildDirectory, policy) {
	const root = resolve(buildDirectory);
	const reports = [];
	let serverError;
	const reportOnlyPolicy = `${policy}; report-uri ${REPORT_PATH}`;

	const server = createServer((request, response) => {
		void (async () => {
			const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
			if (requestUrl.pathname === REPORT_PATH) {
				if (request.method !== "POST") {
					response.writeHead(405, { Allow: "POST" });
					response.end();
					return;
				}
				reports.push(await collectReport(request));
				response.writeHead(204, {
					"Cache-Control": "no-store",
				});
				response.end();
				return;
			}

			if (request.method !== "GET" && request.method !== "HEAD") {
				response.writeHead(405, { Allow: "GET, HEAD" });
				response.end();
				return;
			}

			const path = resolveRequestFile(root, requestUrl.pathname);
			if (!path) {
				response.writeHead(400);
				response.end();
				return;
			}

			let file;
			try {
				const fileStats = await lstat(path);
				if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
					response.writeHead(404);
					response.end();
					return;
				}
				file = await readFile(path);
			} catch (error) {
				if (error.code === "ENOENT" || error.code === "ENOTDIR") {
					response.writeHead(404);
					response.end();
					return;
				}
				throw error;
			}

			const extension = extname(path).toLowerCase();
			const headers = {
				"Cache-Control": "no-store",
				"Content-Length": String(file.length),
				"Content-Type":
					CONTENT_TYPES.get(extension) ?? "application/octet-stream",
				"X-Content-Type-Options": "nosniff",
			};
			if (extension === ".html") {
				headers["Content-Security-Policy-Report-Only"] = reportOnlyPolicy;
			}

			response.writeHead(200, headers);
			response.end(request.method === "HEAD" ? undefined : file);
		})().catch((error) => {
			serverError = error;
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});

	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("local CSP audit server did not expose a TCP address");
	}

	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: async () => {
			if (!server.listening) return;
			const closed = once(server, "close");
			server.close();
			server.closeAllConnections?.();
			await closed;
		},
		getError: () => serverError,
		reportOnlyPolicy,
		reports,
	};
}

class DevToolsClient {
	constructor(webSocket) {
		this.webSocket = webSocket;
		this.nextId = 1;
		this.pending = new Map();
		this.listeners = new Map();

		webSocket.addEventListener("message", (event) => {
			void this.#receive(event.data);
		});
		webSocket.addEventListener("close", () => {
			const error = new Error("Chrome DevTools connection closed unexpectedly");
			for (const pending of this.pending.values()) pending.reject(error);
			this.pending.clear();
		});
	}

	static async connect(url) {
		const webSocket = new WebSocket(url);
		await new Promise((resolveOpen, rejectOpen) => {
			webSocket.addEventListener("open", resolveOpen, { once: true });
			webSocket.addEventListener(
				"error",
				() => rejectOpen(new Error("could not connect to Chrome DevTools")),
				{ once: true },
			);
		});
		return new DevToolsClient(webSocket);
	}

	async #receive(data) {
		let text;
		if (typeof data === "string") {
			text = data;
		} else if (data instanceof ArrayBuffer) {
			text = Buffer.from(data).toString("utf8");
		} else if (ArrayBuffer.isView(data)) {
			text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
				"utf8",
			);
		} else {
			text = Buffer.from(await data.arrayBuffer()).toString("utf8");
		}

		const message = JSON.parse(text);
		if (message.id) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timeout);
			if (message.error) {
				pending.reject(
					new Error(
						`${pending.method}: ${message.error.message ?? "DevTools error"}`,
					),
				);
			} else {
				pending.resolve(message.result ?? {});
			}
			return;
		}

		const listeners = this.listeners.get(message.method);
		if (!listeners) return;
		for (const listener of [...listeners]) listener(message);
	}

	on(method, listener) {
		if (!this.listeners.has(method)) this.listeners.set(method, new Set());
		this.listeners.get(method).add(listener);
		return () => this.listeners.get(method)?.delete(listener);
	}

	send(method, params = {}, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS) {
		const id = this.nextId;
		this.nextId += 1;
		const message = { id, method, params };
		if (sessionId) message.sessionId = sessionId;

		return new Promise((resolveMessage, rejectMessage) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				rejectMessage(new Error(`${method}: timed out after ${timeoutMs} ms`));
			}, timeoutMs);
			this.pending.set(id, {
				method,
				reject: rejectMessage,
				resolve: resolveMessage,
				timeout,
			});
			this.webSocket.send(JSON.stringify(message));
		});
	}

	waitFor(method, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS) {
		return new Promise((resolveEvent, rejectEvent) => {
			const timeout = setTimeout(() => {
				unsubscribe();
				rejectEvent(new Error(`${method}: event timed out after ${timeoutMs} ms`));
			}, timeoutMs);
			const unsubscribe = this.on(method, (message) => {
				if (message.sessionId !== sessionId) return;
				clearTimeout(timeout);
				unsubscribe();
				resolveEvent(message.params ?? {});
			});
		});
	}

	async close() {
		if (
			this.webSocket.readyState === WebSocket.OPEN ||
			this.webSocket.readyState === WebSocket.CONNECTING
		) {
			this.webSocket.close();
			await Promise.race([
				once(this.webSocket, "close").catch(() => {}),
				delay(1_000),
			]);
		}
	}
}

async function waitForDevTools(chrome, userDataDirectory) {
	const activePortFile = join(userDataDirectory, "DevToolsActivePort");
	const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

	while (Date.now() < deadline) {
		if (chrome.exitCode !== null) {
			throw new Error(`Chrome exited before DevTools was ready (${chrome.exitCode})`);
		}
		try {
			const lines = (await readFile(activePortFile, "utf8"))
				.trim()
				.split(/\r?\n/);
			if (/^[0-9]+$/.test(lines[0] ?? "") && lines[1]?.startsWith("/")) {
				return `ws://127.0.0.1:${lines[0]}${lines[1]}`;
			}
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await delay(50);
	}

	throw new Error("Chrome DevTools endpoint did not become ready");
}

async function startChrome(chromePath) {
	if (process.getuid?.() === 0) {
		throw new Error(
			"refusing to disable Chrome's sandbox; run the CSP browser audit as an unprivileged user",
		);
	}

	const userDataDirectory = await mkdtemp(
		join(tmpdir(), "peptides-csp-chrome-"),
	);
	const chrome = spawn(
		chromePath,
		[
			"--headless=new",
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-default-apps",
			"--disable-dev-shm-usage",
			"--disable-features=Translate",
			"--disable-sync",
			"--metrics-recording-only",
			"--no-default-browser-check",
			"--no-first-run",
			"--remote-debugging-address=127.0.0.1",
			"--remote-debugging-port=0",
			`--user-data-dir=${userDataDirectory}`,
			"about:blank",
		],
		{
			stdio: ["ignore", "ignore", "pipe"],
		},
	);

	let stderr = "";
	chrome.stderr.setEncoding("utf8");
	chrome.stderr.on("data", (chunk) => {
		stderr = `${stderr}${chunk}`.slice(-16_384);
	});

	try {
		const devToolsUrl = await waitForDevTools(chrome, userDataDirectory);
		return {
			chrome,
			close: async () => {
				if (chrome.exitCode === null) {
					chrome.kill("SIGTERM");
					await Promise.race([once(chrome, "exit"), delay(2_000)]);
				}
				if (chrome.exitCode === null) {
					chrome.kill("SIGKILL");
					await once(chrome, "exit").catch(() => {});
				}
				await rm(userDataDirectory, { force: true, recursive: true });
			},
			devToolsUrl,
			stderr: () => stderr,
		};
	} catch (error) {
		if (chrome.exitCode === null) chrome.kill("SIGTERM");
		await Promise.race([once(chrome, "exit").catch(() => {}), delay(2_000)]);
		await rm(userDataDirectory, { force: true, recursive: true });
		throw new Error(`${error.message}${stderr ? `\n${stderr}` : ""}`);
	}
}

const INSTALL_VIOLATION_LISTENER = String.raw`
(() => {
	const violations = [];
	Object.defineProperty(globalThis, "__peptidesCspViolations", {
		configurable: false,
		enumerable: false,
		value: violations,
		writable: false,
	});
	document.addEventListener("securitypolicyviolation", (event) => {
		violations.push({
			blockedURI: event.blockedURI || "",
			columnNumber: event.columnNumber || 0,
			disposition: event.disposition || "",
			effectiveDirective: event.effectiveDirective || "",
			lineNumber: event.lineNumber || 0,
			sourceFile: event.sourceFile || "",
			violatedDirective: event.violatedDirective || "",
		});
	}, true);
})();
`;

const EXERCISE_PAGE = String.raw`
(async () => {
	const waitForFrame = () => new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve))
	);

	window.scrollTo(0, Math.max(document.body?.scrollHeight ?? 0, 1));
	await waitForFrame();
	window.scrollTo(0, 0);
	await waitForFrame();

	const selector = [
		"button:not([disabled])",
		"[role=button]:not([aria-disabled=true])",
		"summary",
		"input:not([disabled])",
		"select:not([disabled])",
		"textarea:not([disabled])",
	].join(",");
	const controls = [...document.querySelectorAll(selector)].slice(0, 100);
	let exercised = 0;
	const preventDefaultNavigation = (event) => event.preventDefault();
	document.addEventListener("click", preventDefaultNavigation, true);

	try {
		for (const control of controls) {
			if (!control.isConnected || control instanceof HTMLAnchorElement) continue;
			if (
				control instanceof HTMLButtonElement &&
				control.form &&
				(control.type === "submit" || control.type === "reset")
			) {
				continue;
			}

			control.focus({ preventScroll: true });
			if (
				control instanceof HTMLInputElement &&
				!["button", "checkbox", "file", "hidden", "image", "radio", "reset", "submit"].includes(control.type)
			) {
				control.value = control.value || "csp-audit";
				control.dispatchEvent(new Event("input", { bubbles: true }));
				control.dispatchEvent(new Event("change", { bubbles: true }));
			} else if (
				control instanceof HTMLTextAreaElement ||
				control instanceof HTMLSelectElement
			) {
				control.dispatchEvent(new Event("input", { bubbles: true }));
				control.dispatchEvent(new Event("change", { bubbles: true }));
			} else {
				control.click();
			}
			exercised += 1;
			await waitForFrame();
		}
	} finally {
		document.removeEventListener("click", preventDefaultNavigation, true);
	}

	return exercised;
})();
`;

function responseHeader(headers, wantedName) {
	const entry = Object.entries(headers ?? {}).find(
		([name]) => name.toLowerCase() === wantedName.toLowerCase(),
	);
	return entry?.[1];
}

function normalizeViolation(route, violation, source) {
	return {
		blockedURI: String(violation.blockedURI ?? violation["blocked-uri"] ?? ""),
		disposition: String(violation.disposition ?? "report"),
		effectiveDirective: String(
			violation.effectiveDirective ??
				violation["effective-directive"] ??
				violation.violatedDirective ??
				violation["violated-directive"] ??
				"",
		),
		route,
		source,
		sourceFile: String(violation.sourceFile ?? violation["source-file"] ?? ""),
	};
}

function uniqueViolations(violations) {
	const unique = new Map();
	for (const violation of violations) {
		const key = JSON.stringify(violation);
		if (!unique.has(key)) unique.set(key, violation);
	}
	return [...unique.values()];
}

export async function verifyCspInBrowser(
	buildDirectory,
	{
		chromePath,
		settleMilliseconds = 300,
		timeoutMilliseconds = DEFAULT_TIMEOUT_MS,
	} = {},
) {
	const root = resolve(buildDirectory);
	const inventory = await inventoryBuild(root);
	const routes = await discoverHtmlRoutes(root);
	const policy = buildPolicy(inventory);
	const resolvedChrome = chromePath ?? (await findChromeExecutable());
	if (!resolvedChrome) {
		throw new Error(
			"Chrome/Chromium was not found; install it or set CHROME_PATH to an executable path",
		);
	}
	if (!(await isExecutableFile(resolvedChrome))) {
		throw new Error(`Chrome is not executable: ${resolvedChrome}`);
	}
	if (
		!Number.isInteger(settleMilliseconds) ||
		settleMilliseconds < 0 ||
		settleMilliseconds > 5_000
	) {
		throw new Error("settleMilliseconds must be an integer from 0 to 5000");
	}
	if (
		!Number.isInteger(timeoutMilliseconds) ||
		timeoutMilliseconds < 1_000 ||
		timeoutMilliseconds > 60_000
	) {
		throw new Error("timeoutMilliseconds must be an integer from 1000 to 60000");
	}

	const fixture = await startFixtureServer(root, policy);
	let chrome;
	let client;

	try {
		chrome = await startChrome(resolvedChrome);
		client = await DevToolsClient.connect(chrome.devToolsUrl);
		const target = await client.send("Target.createTarget", {
			url: "about:blank",
		});
		const attached = await client.send("Target.attachToTarget", {
			flatten: true,
			targetId: target.targetId,
		});
		const sessionId = attached.sessionId;
		const externalRequests = [];
		const securityLog = [];
		let currentRoute = "<initializing>";

		client.on("Fetch.requestPaused", (message) => {
			if (message.sessionId !== sessionId) return;
			const requestUrl = message.params.request.url;
			let local = false;
			try {
				local = new URL(requestUrl).origin === fixture.baseUrl;
			} catch {
				local = false;
			}

			if (!local) externalRequests.push({ route: currentRoute, url: requestUrl });
			void client
				.send(
					local ? "Fetch.continueRequest" : "Fetch.failRequest",
					local
						? { requestId: message.params.requestId }
						: {
								errorReason: "BlockedByClient",
								requestId: message.params.requestId,
							},
					sessionId,
					timeoutMilliseconds,
				)
				.catch(() => {});
		});
		client.on("Log.entryAdded", (message) => {
			if (message.sessionId !== sessionId) return;
			const entry = message.params.entry;
			if (
				entry.source === "security" &&
				/Refused to|violates the following Content Security Policy directive/i.test(
					entry.text,
				)
			) {
				securityLog.push({ route: currentRoute, text: entry.text });
			}
		});

		await Promise.all([
			client.send("Page.enable", {}, sessionId, timeoutMilliseconds),
			client.send("Runtime.enable", {}, sessionId, timeoutMilliseconds),
			client.send("Network.enable", {}, sessionId, timeoutMilliseconds),
			client.send("Log.enable", {}, sessionId, timeoutMilliseconds),
			client.send(
				"Fetch.enable",
				{ patterns: [{ requestStage: "Request" }] },
				sessionId,
				timeoutMilliseconds,
			),
		]);
		await client.send(
			"Page.addScriptToEvaluateOnNewDocument",
			{ source: INSTALL_VIOLATION_LISTENER },
			sessionId,
			timeoutMilliseconds,
		);

		const pageResults = [];
		for (const route of routes) {
			currentRoute = route;
			const expectedUrl = new URL(route, fixture.baseUrl).href;
			const documentResponses = [];
			const stopResponseListener = client.on(
				"Network.responseReceived",
				(message) => {
					if (
						message.sessionId === sessionId &&
						message.params.type === "Document" &&
						message.params.response.url === expectedUrl
					) {
						documentResponses.push(message.params.response);
					}
				},
			);
			const loaded = client.waitFor(
				"Page.loadEventFired",
				sessionId,
				timeoutMilliseconds,
			);
			const navigation = await client.send(
				"Page.navigate",
				{ url: expectedUrl },
				sessionId,
				timeoutMilliseconds,
			);
			if (navigation.errorText) {
				throw new Error(`${route}: navigation failed: ${navigation.errorText}`);
			}
			await loaded;
			stopResponseListener();

			const response = documentResponses.at(-1);
			if (!response || response.status !== 200) {
				throw new Error(
					`${route}: expected an HTTP 200 document response from the local fixture`,
				);
			}
			const observedPolicy = responseHeader(
				response.headers,
				"Content-Security-Policy-Report-Only",
			);
			if (observedPolicy !== fixture.reportOnlyPolicy) {
				throw new Error(
					`${route}: Chrome did not receive the generated report-only CSP header`,
				);
			}

			await delay(settleMilliseconds);
			const interaction = await client.send(
				"Runtime.evaluate",
				{
					awaitPromise: true,
					expression: EXERCISE_PAGE,
					returnByValue: true,
				},
				sessionId,
				timeoutMilliseconds,
			);
			if (interaction.exceptionDetails) {
				throw new Error(`${route}: browser interaction exercise threw an error`);
			}
			await delay(settleMilliseconds);

			const evaluated = await client.send(
				"Runtime.evaluate",
				{
					expression:
						"Array.isArray(globalThis.__peptidesCspViolations) ? globalThis.__peptidesCspViolations : []",
					returnByValue: true,
				},
				sessionId,
				timeoutMilliseconds,
			);
			pageResults.push({
				controlsExercised: Number(interaction.result?.value ?? 0),
				route,
				violations: Array.isArray(evaluated.result?.value)
					? evaluated.result.value
					: [],
			});
		}

		await delay(settleMilliseconds);
		if (fixture.getError()) throw fixture.getError();

		const eventViolations = pageResults.flatMap((page) =>
			page.violations.map((violation) =>
				normalizeViolation(page.route, violation, "browser-event"),
			),
		);
		const reportViolations = fixture.reports.flatMap((report) => {
			const body = report?.["csp-report"] ?? report?.body ?? report;
			if (!body || body.malformedReport) return [];
			let route = "<report>";
			const documentUrl = body["document-uri"] ?? body.documentURL;
			try {
				const parsed = new URL(documentUrl);
				route = parsed.pathname;
			} catch {
				// Keep a fixed non-sensitive fallback.
			}
			return [normalizeViolation(route, body, "report-endpoint")];
		});
		const logViolations = securityLog.map((entry) => ({
			blockedURI: "",
			disposition: "report",
			effectiveDirective: "",
			route: entry.route,
			source: "security-log",
			sourceFile: "",
		}));
		const violations = uniqueViolations([
			...eventViolations,
			...reportViolations,
			...(eventViolations.length === 0 && reportViolations.length === 0
				? logViolations
				: []),
		]);

		const result = {
			controlsExercised: pageResults.reduce(
				(total, page) => total + page.controlsExercised,
				0,
			),
			externalRequestsBlocked: externalRequests.length,
			htmlFileCount: inventory.htmlFileCount,
			pageCount: routes.length,
			reportOnlyHeaderValidated: true,
			violations,
		};
		if (violations.length > 0) {
			const summary = violations
				.slice(0, 5)
				.map(
					(violation) =>
						`${violation.route}: ${violation.effectiveDirective || "CSP violation"} blocked ${violation.blockedURI || "a resource"}`,
				)
				.join("\n");
			const error = new Error(
				`CSP report-only browser audit found ${violations.length} violation(s)\n${summary}`,
			);
			error.result = result;
			throw error;
		}

		return result;
	} catch (error) {
		if (chrome?.stderr() && !error.message.includes(chrome.stderr())) {
			error.chromeStderr = chrome.stderr();
		}
		throw error;
	} finally {
		await client?.close().catch(() => {});
		await chrome?.close().catch(() => {});
		await fixture.close().catch(() => {});
	}
}

async function main() {
	const [buildDirectory, ...extra] = process.argv.slice(2);
	if (!buildDirectory || extra.length > 0) {
		throw new Error(
			"usage: node deploy/verify-csp-browser.mjs <built-storefront-dir>",
		);
	}

	const result = await verifyCspInBrowser(buildDirectory);
	process.stdout.write(
		[
			`PASS: report-only CSP exercised in Chrome across ${result.pageCount} HTML page(s).`,
			`PASS: ${result.controlsExercised} safe control interaction(s) exercised.`,
			`PASS: 0 CSP violations (${result.externalRequestsBlocked} external request(s) blocked by the isolated fixture).`,
		].join("\n") + "\n",
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	main().catch((error) => {
		process.stderr.write(`verify-csp-browser: ${error.message}\n`);
		process.exitCode = 1;
	});
}
