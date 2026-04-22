# website/

Marketing site for **pi-websearch-crawl4ai**, served at
<https://pi-websearch-crawl4ai.codingcoffee.me/>.

This directory is **not** shipped with the npm package. The root
`package.json` `files` array only allows `index.ts`, `README.md`, and
`LICENSE`, so anything here is automatically excluded from `npm publish`.
`.npmignore` at the repo root also lists it as belt-and-suspenders.

## Files

- `index.html`  – single-page landing site (inline CSS, tiny vanilla JS to fetch the npm version)
- `robots.txt`  – allow all, points at sitemap
- `sitemap.xml` – single URL
- `og.svg`      – Open Graph / Twitter card source (rasterized at build time)
- `nginx.conf`  – tiny static-file server config with sensible cache / security headers
- `Dockerfile`  – multi-stage build: rsvg-convert → PNG, then nginx:alpine

## Local preview

Any static server works:

```bash
cd website
python3 -m http.server 8080
# → http://localhost:8080
```

The OG image `og.png` is only produced inside the Docker build; when serving
locally, crawlers will fall back to the `og.svg` source referenced in the meta
tags (most social unfurl clients prefer PNG, so prefer testing via the container).

## Build & run the container

```bash
cd website
docker build -t pi-websearch-crawl4ai-site .
docker run --rm -p 8080:80 pi-websearch-crawl4ai-site
# → http://localhost:8080
```

## Deploy

Point `pi-websearch-crawl4ai.codingcoffee.me` at whatever runs the container
(Fly, Railway, a VPS behind Caddy/Traefik, etc.). TLS is assumed to be
terminated upstream — the container only speaks plain HTTP on `:80`.
