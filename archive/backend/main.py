from __future__ import annotations

import math
from typing import Dict, List, Optional
import json
import urllib.request
import urllib.parse

import yfinance as yf
import pandas as pd
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


app = FastAPI(default_response_class=JSONResponse)

# 開発中はワイルドカード。必要に応じてフロントのオリジンだけ許可してください。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_float(v) -> Optional[float]:
    try:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return float(v)
    except Exception:
        return None


def _get_quote_for_symbol(sym: str) -> Dict:
    tk = yf.Ticker(sym)

    last_price = None
    prev_close = None
    currency = None
    market_cap = None
    try:
        fi = getattr(tk, "fast_info", None)
        if fi is not None:
            last_price = _safe_float(getattr(fi, "last_price", None))
            prev_close = _safe_float(getattr(fi, "previous_close", None))
            market_cap = getattr(fi, "market_cap", None)
            currency = getattr(fi, "currency", None)
    except Exception:
        pass

    long_name = None
    short_name = None
    trailing_pe = None
    price_to_book = None
    trailing_div_yield = None
    try:
        info = None
        try:
            info = tk.get_info()
        except Exception:
            info = getattr(tk, "info", {})

        if isinstance(info, dict):
            long_name = info.get("longName")
            short_name = info.get("shortName")
            if trailing_pe is None:
                trailing_pe = _safe_float(info.get("trailingPE"))
            if price_to_book is None:
                price_to_book = _safe_float(info.get("priceToBook"))
            if trailing_div_yield is None:
                trailing_div_yield = _safe_float(info.get("trailingAnnualDividendYield"))
            if currency is None:
                currency = info.get("currency")
            if market_cap is None:
                market_cap = info.get("marketCap")
            if last_price is None:
                last_price = _safe_float(info.get("currentPrice") or info.get("regularMarketPrice"))
            if prev_close is None:
                prev_close = _safe_float(info.get("previousClose") or info.get("regularMarketPreviousClose"))
    except Exception:
        pass

    change = None
    change_pct = None
    if last_price is not None and prev_close not in (None, 0):
        change = round(last_price - prev_close, 6)
        change_pct = round((change / prev_close) * 100.0, 6)

    return {
        "symbol": sym,
        "longName": long_name,
        "shortName": short_name,
        "currency": currency or "USD",
        "regularMarketPrice": last_price,
        "regularMarketPreviousClose": prev_close,
        "regularMarketChange": change,
        "regularMarketChangePercent": change_pct,
        "trailingPE": trailing_pe,
        "priceToBook": price_to_book,
        "trailingAnnualDividendYield": trailing_div_yield,
        "marketCap": market_cap,
    }


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = resp.read()
        return json.loads(data.decode("utf-8"))


def _yahoo_quote_fill(symbols: List[str]) -> Dict[str, dict]:
    base = "https://query1.finance.yahoo.com/v7/finance/quote?symbols="
    url = base + urllib.parse.quote(",".join(symbols))
    data = _fetch_json(url)
    out: Dict[str, dict] = {}
    for q in (data.get("quoteResponse", {}).get("result", []) or []):
        price = q.get("regularMarketPrice")
        prev = q.get("regularMarketPreviousClose") or q.get("previousClose")
        change = q.get("regularMarketChange")
        chg_pct = q.get("regularMarketChangePercent")
        out[q.get("symbol")] = {
            "symbol": q.get("symbol"),
            "longName": q.get("longName"),
            "shortName": q.get("shortName"),
            "currency": q.get("currency") or "USD",
            "regularMarketPrice": price,
            "regularMarketPreviousClose": prev,
            "regularMarketChange": change if change is not None and not isinstance(change, str) else None,
            "regularMarketChangePercent": chg_pct if chg_pct is not None and not isinstance(chg_pct, str) else None,
            "trailingPE": q.get("trailingPE"),
            "priceToBook": q.get("priceToBook"),
            "trailingAnnualDividendYield": q.get("trailingAnnualDividendYield"),
            "marketCap": q.get("marketCap"),
        }
    return out


@app.get("/api/yf/quote")
def quote(symbols: str = Query(..., description="Comma separated symbols")):
    syms: List[str] = [s.strip() for s in symbols.split(",") if s.strip()]
    result: List[Dict] = []
    for s in syms:
        try:
            result.append(_get_quote_for_symbol(s))
        except Exception:
            result.append({"symbol": s})
    # yfinance欠損時はYahooで補完
    need_fill = [r["symbol"] for r in result if not r.get("regularMarketPrice") or r.get("trailingPE") is None]
    if need_fill:
        try:
            filled = _yahoo_quote_fill(syms)
            for r in result:
                f = filled.get(r["symbol"]) if isinstance(filled, dict) else None
                if not f:
                    continue
                for k, v in f.items():
                    if r.get(k) in (None, "") and v is not None:
                        r[k] = v
        except Exception:
            pass
    return {"quoteResponse": {"result": result, "error": None}}


_ALLOWED_INTERVALS = {"1d": "1d", "1wk": "1wk", "1mo": "1mo"}


@app.get("/api/yf/history")
def history(
    symbol: str = Query(...),
    interval: str = Query("1d"),
    range: str = Query("1y"),
):
    iv = _ALLOWED_INTERVALS.get(interval, "1d")
    period = range
    # まず yfinance、失敗ならYahoo chart
    try:
        df: pd.DataFrame = yf.Ticker(symbol).history(period=period, interval=iv, auto_adjust=False)
        df = df.dropna(subset=["Open", "High", "Low", "Close"])  # Volume は欠損許容
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index)
        ts = [int(ts.value // 10**9) for ts in df.index.to_list()]
        open_ = [None if pd.isna(v) else float(v) for v in df["Open"].tolist()]
        high_ = [None if pd.isna(v) else float(v) for v in df["High"].tolist()]
        low_ = [None if pd.isna(v) else float(v) for v in df["Low"].tolist()]
        close_ = [None if pd.isna(v) else float(v) for v in df["Close"].tolist()]
        volume_ = [0 if pd.isna(v) else int(v) for v in df.get("Volume", pd.Series([0]*len(df))).tolist()]
    except Exception:
        base = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}"
        url = f"{base}?range={urllib.parse.quote(period)}&interval={urllib.parse.quote(iv)}&includePrePost=false&events=div%2Csplits"
        data = _fetch_json(url)
        r = (data.get("chart", {}).get("result") or [None])[0] or {}
        ts = r.get("timestamp") or []
        q = (r.get("indicators", {}).get("quote") or [None])[0] or {}
        open_ = q.get("open") or []
        high_ = q.get("high") or []
        low_ = q.get("low") or []
        close_ = q.get("close") or []
        volume_ = q.get("volume") or []

    result = [{
        "timestamp": ts,
        "indicators": {
            "quote": [{
                "open": open_,
                "high": high_,
                "low": low_,
                "close": close_,
                "volume": volume_,
            }]
        },
    }]
    return {"chart": {"result": result, "error": None}}


@app.get("/")
def root():
    return {"ok": True, "service": "yfinance-proxy"}
