# Production (Cloudflare Pages) – new-my-finance

This document summarizes how the production site is built and kept stable.

- Base URL: https://new-my-finance.pages.dev/
- Root UI: NMY (FGI enabled). We always serve `NMY.html` at `/`.
- Analysis: React app is served under `/react` and embedded by NMY.
- API: Same-origin Cloudflare Pages Functions under `/api/*`.

## Build on Pages

- Root directory: `web`
- Build command: `npm ci && npm run build && node ../tools/copy-nmy.mjs`
- Output directory: `dist`
- Files added at build time:
  - `tools/copy-nmy.mjs` copies `NMY.html` into `web/dist/NMY.html`, moves React index to `/react/index.html`, and sets NMY as root `index.html`. It also copies `data/jp-stocks.json` into `web/dist/data/`.

## Routing and caching

- `_redirects`: `/:` rewrite to `/NMY.html 200` – ensures root is always NMY even if an old index is cached.
- `_headers`: `index.html` and `NMY.html` are `Cache-Control: no-store` – avoids CDN/browser stale caches after deploys.

## APIs (Pages Functions)

Implemented in `web/functions`:

- `/api/quote`, `/api/history`, `/api/fund` (aliases for React compatibility)
- `/api/yf/quote`, `/api/yf/history`, `/api/yf/fund`, `/api/yf/search`
- `/api/fgi`, `/api/signals`

Stability:
- Adds UA/Accept-Language/Referer headers to reduce 403/429.
- Simple backoff on 429 in `_utils.mjs`.

## Local development

- UI server: `node tools/ui-server.mjs` (serves `NMY.html` at http://127.0.0.1:8080/ and proxies `/api/*` locally if needed).
- Optional: `tools/start-tunnel.ps1` to expose http://127.0.0.1:8080 via trycloudflare (ephemeral).

## Recovery

- Checkpoint tags are created before audits, e.g. `checkpoint-YYYYMMDD-HHMMSS-pages-prod-stable`.
- To roll back:
  - `git checkout tags/<checkpoint>` and redeploy, or
  - `git revert` a problematic commit in `main` and push.

