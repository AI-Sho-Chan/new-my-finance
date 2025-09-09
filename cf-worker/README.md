Cloudflare Worker (Yahoo Finance proxy)

Usage (local dev, no login required)

1) Install Wrangler once
   npm i -g wrangler

2) Run dev in this folder
   cd cf-worker
   wrangler dev

3) Test endpoints
   http://127.0.0.1:8787/api/yf/ping
   http://127.0.0.1:8787/api/yf/quote?symbols=AAPL,7203.T
   http://127.0.0.1:8787/api/yf/history?symbol=AAPL&interval=1d&range=1y

4) Point the frontend (NMY.html)
   Add in <head> (already set by patch):
   <script>window.__YF_PROXY__='http://127.0.0.1:8787/api/yf';</script>

Deploy (optional)

- wrangler login
- wrangler deploy
- Use: https://yf-proxy.<account>.workers.dev/api/yf as window.__YF_PROXY__

