# pi-websearch-crawl4ai

A [pi](https://github.com/badlogic/pi-mono) extension that lets the agent fetch
content from the web via a running [Crawl4AI](https://docs.crawl4ai.com/) server.

**Intended use:** running pi with the `bash` tool disabled (so `curl` / `wget`
are unavailable) while still letting the model read and crawl web pages.

## What it gives the LLM

Six tools, all talking to a Crawl4AI server:

| Tool              | Endpoint           | Purpose                                                   |
| ----------------- | ------------------ | --------------------------------------------------------- |
| `web_fetch`       | `POST /md`         | Fetch a URL → clean Markdown (filters: fit/raw/bm25/llm)  |
| `web_fetch_html`  | `POST /html`       | Sanitized HTML for DOM-aware tasks                        |
| `web_crawl`       | `POST /crawl`      | Multi-URL crawl with typed `BrowserConfig`/`CrawlerRunConfig` |
| `web_execute_js`  | `POST /execute_js` | Run JS snippets on a page and read back JSON              |
| `web_screenshot`  | `POST /screenshot` | Full-page PNG screenshot (returned inline)                |
| `web_ask`         | `GET  /ask`        | Query the Crawl4AI library's own docs (for configuring it) |

Plus commands: `/crawl4ai-status`, `/crawl4ai-url <url>`, `/crawl4ai-token <tok>`.

## Prerequisites

You need a Crawl4AI server reachable from where pi runs. The fastest path:

```bash
docker run -d \
  -p 11235:11235 \
  --name crawl4ai \
  --shm-size=1g \
  unclecode/crawl4ai:latest

# Sanity check
curl http://localhost:11235/health
```

See the [Crawl4AI Docker guide](https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/README.md)
for GPU, LLM keys, `config.yml`, JWT auth, etc.

## Install as a pi extension

```bash
# project-local
mkdir -p .pi/extensions
ln -s "$(pwd)/pi-websearch-crawl4ai" .pi/extensions/crawl4ai

# or global
mkdir -p ~/.pi/agent/extensions
ln -s "$(pwd)/pi-websearch-crawl4ai" ~/.pi/agent/extensions/crawl4ai
```

pi auto-discovers `index.ts` via the `"pi".extensions` field in `package.json`.

Alternatively, for a one-off test:

```bash
pi -e ./pi-websearch-crawl4ai/index.ts
```

## Configuration

Precedence: CLI flag > env var > default.

| Setting   | Env                   | Flag                       | Default                   |
| --------- | --------------------- | -------------------------- | ------------------------- |
| Base URL  | `CRAWL4AI_BASE_URL`   | `--crawl4ai-url <url>`     | `http://localhost:11235`  |
| Auth token| `CRAWL4AI_TOKEN`      | `--crawl4ai-token <tok>`   | (none)                    |

At runtime you can also:

- `/crawl4ai-status` — show current config + `/health`
- `/crawl4ai-url http://host:11235` — change base URL for this session
- `/crawl4ai-token <jwt>` — set bearer token (empty clears it)

## Example use

Running pi with only read-only tools and this extension:

```bash
pi --tools read,write,edit,web_fetch,web_crawl
> "Read https://example.com and summarize it."
```

The model will call `web_fetch` instead of reaching for `bash`/`curl`.

## How `web_crawl` typed configs work

Crawl4AI accepts configuration objects shaped as
`{"type":"ClassName","params":{...}}`. Example you (or the model) can pass:

```json
{
  "urls": ["https://example.com", "https://httpbin.org/html"],
  "browser_config": { "type": "BrowserConfig", "params": { "headless": true } },
  "crawler_config": {
    "type": "CrawlerRunConfig",
    "params": { "cache_mode": "bypass", "stream": false }
  }
}
```

If you need to remind the model what's available, it can call `web_ask` with a
query like `"CrawlerRunConfig parameters"` to pull the Crawl4AI library docs.

## Security note

Extensions run with your user's full permissions. The tools here can fetch
arbitrary URLs via your Crawl4AI server. If that's a problem, run Crawl4AI with
rate limiting / allowlists configured in its `config.yml`, and/or restrict
which tools pi activates via `--tools`.
