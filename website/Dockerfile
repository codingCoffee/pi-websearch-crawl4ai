# syntax=docker/dockerfile:1

# ── Stage 1: rasterize SVG → PNG for social unfurls ─────────────────────────
# Debian ships `rsvg-convert` reliably via librsvg2-bin; this stage is
# discarded so the final image stays tiny.
FROM debian:stable-slim AS ogbuild
RUN apt-get update \
 && apt-get install -y --no-install-recommends librsvg2-bin \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY og.svg .
# 1200×630 is the Open Graph / Twitter summary_large_image standard size.
RUN rsvg-convert -w 1200 -h 630 -o og.png og.svg

# ── Stage 2: static site served by nginx ────────────────────────────────────
FROM nginx:1.29.8-alpine3.23

RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html   /usr/share/nginx/html/index.html
COPY robots.txt   /usr/share/nginx/html/robots.txt
COPY sitemap.xml  /usr/share/nginx/html/sitemap.xml
COPY og.svg       /usr/share/nginx/html/og.svg
COPY --from=ogbuild /src/og.png /usr/share/nginx/html/og.png

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
