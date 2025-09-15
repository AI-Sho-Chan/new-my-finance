# Repository structure (focused on Pages production)

- `NMY.html` — Primary UI (root). Embeds React analysis under `/react`.
- `web/` — Vite + React app (analysis UI) and Pages Functions.
  - `web/functions/` — Same-origin APIs under `/api/*`.
  - `web/public/_redirects` — `/:` → `/NMY.html 200`.
  - `web/public/_headers` — `index.html` and `NMY.html` are `no-store`.
- `tools/copy-nmy.mjs` — Post-build script to:
  - copy `NMY.html` into `dist` and set it as root `index.html`,
  - keep React app under `/react/index.html`,
  - copy `data/jp-stocks.json` into `dist/data/`.
- `tools/ui-server.mjs` — Local dev server for NMY + reverse proxy.
- `data/jp-stocks.json` — Static list consumed by the UI; copied to `/data/` in `dist`.

## Legacy and development artifacts

To avoid confusion:
- We do not delete legacy files immediately. Instead, we track them here and plan to move them into `archive/` in a follow-up PR once verified unused.
- Candidates (not used by Pages production):
  - asset_manager_app.html, chart_fix.html, VAR_view, tmp_*.txt
  - backend/, cf-worker/ (replaced by Pages Functions)
  - tools/static-server.mjs (local only; ui-server.mjs preferred)

## Guardrails

- Root must always render NMY:
  - `_redirects` rewrite + post-build swap ensure stability even with stale caches.
- APIs must remain under `/api/*`:
  - Keep aliases (`/api/quote`, etc.) for compatibility and `/api/yf/*` for clarity.
- Never break production by removing files referenced by the build or by NMY.
