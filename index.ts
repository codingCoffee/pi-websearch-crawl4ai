/**
 * pi-websearch-crawl4ai
 *
 * Extension that exposes tools for fetching web content via a running
 * Crawl4AI server (https://docs.crawl4ai.com/). Intended for use when
 * the built-in `bash` tool is disabled, so curl/wget are unavailable.
 *
 * It talks to a Crawl4AI Docker server over plain HTTP using the
 * global `fetch` (no extra deps).
 *
 * Configuration (env vars or CLI flags):
 *   CRAWL4AI_BASE_URL   default: http://localhost:11235
 *   CRAWL4AI_TOKEN      optional: bearer token if JWT is enabled on server
 *
 * CLI flags (override env):
 *   --crawl4ai-url <url>
 *   --crawl4ai-token <token>
 *
 * Runtime commands:
 *   /crawl4ai-status    show current config + /health
 *   /crawl4ai-url <u>   set base URL for this session
 *   /crawl4ai-token <t> set bearer token for this session ("" to clear)
 *
 * Tools registered:
 *   web_fetch        - markdown from a URL (POST /md)
 *   web_fetch_html   - preprocessed HTML (POST /html)
 *   web_crawl        - multi-URL crawl with optional browser/crawler config (POST /crawl)
 *   web_execute_js   - run JS on a page and return results (POST /execute_js)
 *   web_screenshot   - capture a PNG screenshot (POST /screenshot)
 *   web_ask          - query the Crawl4AI library docs context (GET /ask)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

const DEFAULT_BASE_URL = "http://localhost:11235";

export default function crawl4aiExtension(pi: ExtensionAPI) {
	// ---- Config ---------------------------------------------------------

	pi.registerFlag("crawl4ai-url", {
		description: "Base URL of the Crawl4AI server (default: env CRAWL4AI_BASE_URL or http://localhost:11235)",
		type: "string",
	});
	pi.registerFlag("crawl4ai-token", {
		description: "Bearer token for the Crawl4AI server (default: env CRAWL4AI_TOKEN)",
		type: "string",
	});

	let baseUrl: string =
		(pi.getFlag("--crawl4ai-url") as string | undefined) ??
		process.env.CRAWL4AI_BASE_URL ??
		DEFAULT_BASE_URL;
	let token: string | undefined =
		(pi.getFlag("--crawl4ai-token") as string | undefined) ?? process.env.CRAWL4AI_TOKEN;

	const trimBase = () => {
		baseUrl = baseUrl.replace(/\/+$/, "");
	};
	trimBase();

	function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
		if (token) h.Authorization = `Bearer ${token}`;
		return h;
	}

	async function callJson<T = any>(
		path: string,
		init: RequestInit,
		signal?: AbortSignal,
	): Promise<T> {
		const url = `${baseUrl}${path}`;
		const resp = await fetch(url, { ...init, signal });
		const text = await resp.text();
		if (!resp.ok) {
			throw new Error(
				`Crawl4AI ${init.method ?? "GET"} ${path} failed: ${resp.status} ${resp.statusText}\n${text.slice(0, 500)}`,
			);
		}
		try {
			return JSON.parse(text) as T;
		} catch {
			// Non-JSON response: return as text wrapper
			return text as unknown as T;
		}
	}

	function truncate(s: string, max: number): { text: string; truncated: boolean } {
		if (s.length <= max) return { text: s, truncated: false };
		return { text: s.slice(0, max) + `\n\n…[truncated ${s.length - max} chars]`, truncated: true };
	}

	// ---- Commands -------------------------------------------------------

	pi.registerCommand("crawl4ai-status", {
		description: "Show Crawl4AI extension config and server health",
		handler: async (_args, ctx) => {
			let health = "unreachable";
			try {
				const r = await fetch(`${baseUrl}/health`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
				});
				health = `${r.status} ${r.statusText}`;
				const body = await r.text();
				if (body) health += ` — ${body.slice(0, 200)}`;
			} catch (e) {
				health = `error: ${(e as Error).message}`;
			}
			ctx.ui.notify(
				`crawl4ai:\n  base URL: ${baseUrl}\n  token: ${token ? "set" : "none"}\n  /health: ${health}`,
				"info",
			);
		},
	});

	pi.registerCommand("crawl4ai-url", {
		description: "Set Crawl4AI base URL for this session (e.g. /crawl4ai-url http://localhost:11235)",
		handler: async (args, ctx) => {
			const v = args.trim();
			if (!v) {
				ctx.ui.notify(`crawl4ai base URL: ${baseUrl}`, "info");
				return;
			}
			baseUrl = v;
			trimBase();
			ctx.ui.notify(`crawl4ai base URL set to ${baseUrl}`, "info");
		},
	});

	pi.registerCommand("crawl4ai-token", {
		description: "Set Crawl4AI bearer token for this session (empty to clear)",
		handler: async (args, ctx) => {
			const v = args.trim();
			token = v || undefined;
			ctx.ui.notify(`crawl4ai token ${token ? "set" : "cleared"}`, "info");
		},
	});

	// ---- Tools ----------------------------------------------------------

	// 1. web_fetch — markdown
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch (Markdown)",
		description:
			"Fetch a web page and return clean, readable Markdown via a Crawl4AI server. " +
			"Use this to read URLs when the bash tool (curl/wget) is not available. " +
			"Supports content filters: 'fit' (readability, default, best for articles), " +
			"'raw' (full DOM → markdown), 'bm25' (relevance-rank chunks against `query`), " +
			"'llm' (LLM summarization guided by `query`; requires server LLM config).",
		promptSnippet:
			"web_fetch: fetch a URL as Markdown via Crawl4AI (use when bash is disabled)",
		promptGuidelines: [
			"Use web_fetch to read URLs; prefer filter='fit' for articles, 'bm25' with a query to narrow large pages, and 'raw' only when you need full page structure.",
			"Use web_fetch instead of bash+curl whenever the user asks to read or summarize a web page.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL to fetch" }),
			filter: Type.Optional(
				StringEnum(["fit", "raw", "bm25", "llm"] as const, {
					description: "Content filter strategy (default: fit)",
				}),
			),
			query: Type.Optional(
				Type.String({
					description:
						"Query used by 'bm25' / 'llm' filters to pick the most relevant chunks",
				}),
			),
			max_chars: Type.Optional(
				Type.Integer({
					minimum: 500,
					description: "Max characters of markdown to return (default 20000). Content is truncated beyond this.",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const body = {
				url: params.url,
				f: params.filter ?? "fit",
				q: params.query,
				c: "0",
			};
			const res = await callJson<{
				url: string;
				filter: string;
				markdown: string | { raw_markdown?: string; fit_markdown?: string; [k: string]: unknown };
				success: boolean;
			}>(
				"/md",
				{ method: "POST", headers: authHeaders(), body: JSON.stringify(body) },
				signal,
			);

			// markdown can sometimes be an object (raw_markdown / fit_markdown)
			let md = "";
			if (typeof res.markdown === "string") md = res.markdown;
			else if (res.markdown && typeof res.markdown === "object") {
				md =
					(res.markdown.fit_markdown as string | undefined) ??
					(res.markdown.raw_markdown as string | undefined) ??
					JSON.stringify(res.markdown);
			}

			const { text, truncated } = truncate(md, params.max_chars ?? 20000);
			const header = `# ${params.url}\nfilter=${res.filter ?? params.filter ?? "fit"}${
				params.query ? ` query=${JSON.stringify(params.query)}` : ""
			}${truncated ? " (truncated)" : ""}\n\n`;

			return {
				content: [{ type: "text", text: header + text }],
				details: {
					url: params.url,
					filter: res.filter ?? params.filter ?? "fit",
					length: md.length,
					truncated,
				},
			};
		},
	});

	// 2. web_fetch_html — preprocessed HTML
	pi.registerTool({
		name: "web_fetch_html",
		label: "Web Fetch (HTML)",
		description:
			"Fetch a web page and return sanitized/preprocessed HTML via a Crawl4AI server. " +
			"Useful when you need DOM structure (selectors, tables, forms) that markdown would lose.",
		promptSnippet: "web_fetch_html: sanitized HTML from a URL via Crawl4AI",
		promptGuidelines: [
			"Use web_fetch_html only when you specifically need HTML structure; prefer web_fetch for plain reading.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL to fetch" }),
			max_chars: Type.Optional(
				Type.Integer({
					minimum: 500,
					description: "Max characters of HTML to return (default 30000).",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const res = await callJson<{ html: string; url: string; success: boolean }>(
				"/html",
				{
					method: "POST",
					headers: authHeaders(),
					body: JSON.stringify({ url: params.url }),
				},
				signal,
			);
			const { text, truncated } = truncate(res.html ?? "", params.max_chars ?? 30000);
			return {
				content: [{ type: "text", text }],
				details: { url: res.url, length: (res.html ?? "").length, truncated },
			};
		},
	});

	// 3. web_crawl — multi-URL / full crawl
	pi.registerTool({
		name: "web_crawl",
		label: "Web Crawl (Multi-URL)",
		description:
			"Crawl one or more URLs via a Crawl4AI server (POST /crawl) and return per-URL results " +
			"(markdown, links, metadata, status). Supports Crawl4AI's typed config objects: pass " +
			"`browser_config` and `crawler_config` as JSON in the `{\"type\":\"ClassName\",\"params\":{...}}` " +
			"form documented at https://docs.crawl4ai.com/ (e.g. type='BrowserConfig', 'CrawlerRunConfig').",
		promptSnippet: "web_crawl: crawl multiple URLs with Crawl4AI",
		promptGuidelines: [
			"Use web_crawl for batch crawls or when you need links/metadata; for a single readable page, prefer web_fetch.",
		],
		parameters: Type.Object({
			urls: Type.Array(Type.String(), {
				minItems: 1,
				maxItems: 100,
				description: "List of absolute http(s) URLs to crawl (1..100).",
			}),
			browser_config: Type.Optional(
				Type.Any({
					description:
						"Optional BrowserConfig object in Crawl4AI's typed JSON form, e.g. " +
						'{"type":"BrowserConfig","params":{"headless":true}}',
				}),
			),
			crawler_config: Type.Optional(
				Type.Any({
					description:
						"Optional CrawlerRunConfig object in Crawl4AI's typed JSON form, e.g. " +
						'{"type":"CrawlerRunConfig","params":{"cache_mode":"bypass","stream":false}}',
				}),
			),
			include_html: Type.Optional(
				Type.Boolean({
					description: "Include raw HTML per result (default false — markdown + metadata only).",
				}),
			),
			max_chars_per_result: Type.Optional(
				Type.Integer({
					minimum: 500,
					description: "Max characters of markdown per result (default 8000).",
				}),
			),
		}),
		async execute(_id, params, signal) {
			const body: Record<string, unknown> = { urls: params.urls };
			if (params.browser_config) body.browser_config = params.browser_config;
			if (params.crawler_config) body.crawler_config = params.crawler_config;

			const res = await callJson<{
				success?: boolean;
				results?: Array<{
					url: string;
					success: boolean;
					status_code?: number;
					error_message?: string;
					markdown?: string | { raw_markdown?: string; fit_markdown?: string };
					html?: string;
					links?: { internal?: unknown[]; external?: unknown[] };
					metadata?: Record<string, unknown>;
				}>;
			}>(
				"/crawl",
				{ method: "POST", headers: authHeaders(), body: JSON.stringify(body) },
				signal,
			);

			const results = res.results ?? [];
			const maxChars = params.max_chars_per_result ?? 8000;
			const parts: string[] = [];
			parts.push(`# Crawl4AI results (${results.length} URL${results.length === 1 ? "" : "s"})\n`);

			for (const r of results) {
				parts.push(`## ${r.url}`);
				parts.push(
					`success=${r.success} status=${r.status_code ?? "?"}${
						r.error_message ? ` error=${r.error_message}` : ""
					}`,
				);
				let md = "";
				if (typeof r.markdown === "string") md = r.markdown;
				else if (r.markdown && typeof r.markdown === "object") {
					md =
						(r.markdown.fit_markdown as string | undefined) ??
						(r.markdown.raw_markdown as string | undefined) ??
						"";
				}
				if (md) {
					const { text, truncated } = truncate(md, maxChars);
					parts.push(`\n${text}${truncated ? "" : ""}`);
				}
				if (params.include_html && r.html) {
					const { text } = truncate(r.html, maxChars);
					parts.push(`\n<details><summary>html</summary>\n\n${text}\n\n</details>`);
				}
				const linkCounts = r.links
					? `internal=${(r.links.internal ?? []).length} external=${(r.links.external ?? []).length}`
					: "";
				if (linkCounts) parts.push(`\nlinks: ${linkCounts}`);
				parts.push("");
			}

			return {
				content: [{ type: "text", text: parts.join("\n") }],
				details: {
					count: results.length,
					successCount: results.filter((r) => r.success).length,
					urls: results.map((r) => r.url),
				},
			};
		},
	});

	// 4. web_execute_js — run JS on a page
	pi.registerTool({
		name: "web_execute_js",
		label: "Web Execute JS",
		description:
			"Load a URL and execute JavaScript snippets against it via Crawl4AI (POST /execute_js). " +
			"Each script should `return` a JSON-serializable value; results are returned alongside the crawl result.",
		promptSnippet: "web_execute_js: run JS on a page via Crawl4AI",
		promptGuidelines: [
			"Use web_execute_js sparingly, only when plain web_fetch cannot extract the data (e.g. data behind dynamic interactions).",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL" }),
			scripts: Type.Array(Type.String(), {
				minItems: 1,
				description:
					"JS snippets to run sequentially. Each should `return` a value, e.g. " +
					"`return document.title`.",
			}),
			max_chars: Type.Optional(
				Type.Integer({ minimum: 500, description: "Max chars of response to return (default 20000)" }),
			),
		}),
		async execute(_id, params, signal) {
			const res = await callJson<unknown>(
				"/execute_js",
				{
					method: "POST",
					headers: authHeaders(),
					body: JSON.stringify({ url: params.url, scripts: params.scripts }),
				},
				signal,
			);
			const pretty = JSON.stringify(res, null, 2);
			const { text, truncated } = truncate(pretty, params.max_chars ?? 20000);
			return {
				content: [{ type: "text", text }],
				details: { url: params.url, scripts: params.scripts.length, truncated },
			};
		},
	});

	// 5. web_screenshot — PNG screenshot
	pi.registerTool({
		name: "web_screenshot",
		label: "Web Screenshot",
		description:
			"Capture a full-page PNG screenshot of a URL via Crawl4AI (POST /screenshot). " +
			"Returns the image inline so the model can view it.",
		promptSnippet: "web_screenshot: capture a PNG of a URL via Crawl4AI",
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL" }),
			wait_seconds: Type.Optional(
				Type.Number({ minimum: 0, description: "Seconds to wait before capture (default 2)" }),
			),
		}),
		async execute(_id, params, signal) {
			const res = await callJson<{ screenshot?: string; success?: boolean; error?: string }>(
				"/screenshot",
				{
					method: "POST",
					headers: authHeaders(),
					body: JSON.stringify({
						url: params.url,
						screenshot_wait_for: params.wait_seconds ?? 2,
					}),
				},
				signal,
			);
			if (!res.screenshot) {
				throw new Error(
					`Screenshot failed: ${res.error ?? "no 'screenshot' base64 data in response"}`,
				);
			}
			return {
				content: [
					{ type: "text", text: `Screenshot of ${params.url}` },
					{
						type: "image",
						data: res.screenshot,
						mimeType: "image/png",
					},
				],
				details: { url: params.url, bytes: Math.floor((res.screenshot.length * 3) / 4) },
			};
		},
	});

	// 6. web_ask — query Crawl4AI library docs
	pi.registerTool({
		name: "web_ask",
		label: "Crawl4AI Library Docs",
		description:
			"Query the Crawl4AI library's own documentation context (GET /ask). " +
			"Useful only when you need to look up how to configure Crawl4AI itself (e.g. for web_crawl's typed configs).",
		promptSnippet: "web_ask: query the Crawl4AI library docs",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "BM25 search query; omit to get all context" })),
			context_type: Type.Optional(
				StringEnum(["code", "doc", "all"] as const, {
					description: "Which context to retrieve (default: all)",
				}),
			),
			max_results: Type.Optional(
				Type.Integer({ minimum: 1, description: "Max chunks to return (default 20)" }),
			),
			max_chars: Type.Optional(
				Type.Integer({ minimum: 500, description: "Max chars of response (default 15000)" }),
			),
		}),
		async execute(_id, params, signal) {
			const qs = new URLSearchParams();
			qs.set("context_type", params.context_type ?? "all");
			if (params.query) qs.set("query", params.query);
			if (params.max_results) qs.set("max_results", String(params.max_results));
			const res = await callJson<unknown>(
				`/ask?${qs.toString()}`,
				{ method: "GET", headers: authHeaders() },
				signal,
			);
			const pretty = typeof res === "string" ? res : JSON.stringify(res, null, 2);
			const { text, truncated } = truncate(pretty, params.max_chars ?? 15000);
			return {
				content: [{ type: "text", text }],
				details: { query: params.query ?? null, truncated },
			};
		},
	});

	// ---- Startup status ------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus(
			"crawl4ai",
			`crawl4ai: ${baseUrl}${token ? " (auth)" : ""}`,
		);
	});
}
