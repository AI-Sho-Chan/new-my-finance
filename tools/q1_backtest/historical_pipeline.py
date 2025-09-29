#!/usr/bin/env python3
"""Historical Q1 signal reconstruction for selected universes."""
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

WINSOR_SIGMA = 3.0
WINDOWS = {"short": 20, "mid": 63, "long": 252}
WEIGHTS = {"short": 0.5, "mid": 0.35, "long": 0.15}
EWMA_HALFLIFE = 10
MIN_WEEKLY_POINTS = 40


@dataclasses.dataclass
class SymbolSpec:
    symbol: str
    market: str
    name: str
    currency: str = "USD"
    price_to_usd: Optional[str] = None


PRESET_UNIVERSES: Dict[str, List[SymbolSpec]] = {
    "indices_etf": [
        SymbolSpec("^N225", market="JP", name="Nikkei 225"),
        SymbolSpec("^TOPX", market="JP", name="TOPIX"),
        SymbolSpec("^GSPC", market="US", name="S&P 500"),
        SymbolSpec("^IXIC", market="US", name="NASDAQ Composite"),
        SymbolSpec("EWJ", market="JP", name="iShares MSCI Japan ETF"),
        SymbolSpec("SCJ", market="JP", name="iShares MSCI Japan Small-Cap ETF"),
        SymbolSpec("SPY", market="US", name="SPDR S&P 500 ETF Trust"),
        SymbolSpec("MDY", market="US", name="SPDR S&P MidCap 400 ETF Trust"),
        SymbolSpec("IWM", market="US", name="iShares Russell 2000 ETF"),
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recompute historical Q1 signals for selected symbols")
    parser.add_argument("--preset", choices=PRESET_UNIVERSES.keys(), default="indices_etf")
    parser.add_argument("--symbols-file", type=Path, default=None, help="Optional text file of symbols (one per line)")
    parser.add_argument("--start", type=str, default="2015-01-01", help="Start date YYYY-MM-DD")
    parser.add_argument("--end", type=str, default=dt.date.today().isoformat(), help="End date YYYY-MM-DD")
    parser.add_argument("--output", type=Path, default=Path("data/q1-monitor/historical_events.json"))
    parser.add_argument("--bench", type=str, default="^GSPC", help="Benchmark symbol for reference prices")
    parser.add_argument("--quad", type=str, choices=["Q1","Q2","Q3","Q4"], default="Q1", help="Which quadrant to emit events for")
    parser.add_argument("--f-pct-min", type=float, default=80.0, help="F percentile threshold for Q1")
    parser.add_argument("--v-pct-min", type=float, default=60.0, help="V percentile threshold for Q1")
    parser.add_argument("--no-cache", action="store_true", help="Disable yfinance cache")
    return parser.parse_args()


def fetch_prices(symbols: Iterable[str], start: str, end: str, use_cache: bool = True) -> Dict[str, pd.DataFrame]:
    data = yf.download(
        tickers=list(symbols),
        start=start,
        end=end,
        interval="1d",
        progress=False,
        group_by="ticker",
        auto_adjust=False,
        threads=True,
    )
    result: Dict[str, pd.DataFrame] = {}
    if isinstance(data, pd.DataFrame) and data.columns.nlevels == 1:
        # single symbol case (yfinance collapses)
        sym = list(symbols)[0]
        df = data.copy()
        df.index = pd.to_datetime(df.index)
        df = df.sort_index()
        result[sym] = df
        return result
    for sym in symbols:
        raw = data[sym] if sym in data else None
        if raw is None or raw.empty:
            result[sym] = pd.DataFrame()
            continue
        df = raw.copy()
        df.index = pd.to_datetime(df.index)
        df = df.sort_index()
        result[sym] = df
    return result


def align_close(prices: Dict[str, pd.DataFrame]) -> Tuple[pd.DatetimeIndex, pd.DataFrame]:
    all_dates = sorted({ts for df in prices.values() for ts in df.index})
    idx = pd.DatetimeIndex(all_dates)
    closes = pd.DataFrame(index=idx, columns=sorted(prices.keys()), dtype=float)
    for sym, df in prices.items():
        if df.empty:
            continue
        series = df["Close"].astype(float)
        aligned = series.reindex(idx)
        aligned = aligned.ffill()
        first_valid = aligned.first_valid_index()
        if first_valid is not None:
            aligned.loc[:first_valid] = aligned.loc[first_valid]
        closes[sym] = aligned
    return idx, closes


def ewma(series: pd.Series, halflife: float) -> pd.Series:
    return series.ewm(halflife=halflife, min_periods=1, adjust=False).mean()


def compute_relative_performance(closes: pd.DataFrame) -> pd.DataFrame:
    log_price = np.log(closes.clip(lower=1e-12))
    cross_mean = log_price.mean(axis=1)
    rp = log_price.sub(cross_mean, axis=0)
    rp_smoothed = pd.DataFrame(index=rp.index, columns=rp.columns)
    for sym in rp.columns:
        rp_smoothed[sym] = ewma(rp[sym], EWMA_HALFLIFE)
    return rp_smoothed


def compute_f_scores(rp_smoothed: pd.DataFrame) -> pd.DataFrame:
    z_scores = {}
    for label, window in WINDOWS.items():
        delta = rp_smoothed - rp_smoothed.shift(window)
        sigma = rp_smoothed.diff().rolling(window=window, min_periods=window).std(ddof=0)
        ratio = delta / sigma
        mu = ratio.mean(axis=1)
        var = ratio.var(axis=1, ddof=0)
        std = np.sqrt(var)
        z = ratio.sub(mu, axis=0).div(std.replace(0, np.nan), axis=0)
        z = z.clip(lower=-WINSOR_SIGMA, upper=WINSOR_SIGMA)
        z_scores[label] = z
    f = (
        z_scores["short"].fillna(0.0) * WEIGHTS["short"]
        + z_scores["mid"].fillna(0.0) * WEIGHTS["mid"]
        + z_scores["long"].fillna(0.0) * WEIGHTS["long"]
    )
    return f


def compute_v_scores(closes: pd.DataFrame) -> pd.Series:
    weekly = closes.resample("W-FRI").last()
    log_price = np.log(weekly.clip(lower=1e-12))
    cross_mean = log_price.mean(axis=1)
    rp = log_price.sub(cross_mean, axis=0)

    v_weekly = pd.DataFrame(index=weekly.index, columns=weekly.columns, dtype=float)
    for sym in rp.columns:
        series = rp[sym].dropna()
        vals = []
        for t in series.index:
            hist = series.loc[:t].dropna().values
            if hist.size < MIN_WEEKLY_POINTS:
                vals.append(np.nan)
                continue
            x = np.arange(hist.size)
            mx = x.mean()
            my = hist.mean()
            num = np.sum((x - mx) * (hist - my))
            den = np.sum((x - mx) ** 2)
            b1 = num / den if den != 0 else 0.0
            b0 = my - b1 * mx
            fit = b0 + b1 * x
            residuals = hist - fit
            mu = residuals.mean()
            sd = residuals.std(ddof=0)
            if sd == 0 or not np.isfinite(sd):
                vals.append(np.nan)
                continue
            z = (residuals[-1] - mu) / sd
            vals.append(-z)
        sym_series = pd.Series(vals, index=series.index)
        v_weekly[sym] = sym_series.reindex(weekly.index)
    v_weekly = v_weekly.ffill()
    v_daily = v_weekly.reindex(closes.index, method="ffill")
    return v_daily


def percentile_rank_row(row: pd.Series) -> pd.Series:
    values = row.dropna().values
    if values.size == 0:
        return pd.Series(np.nan, index=row.index)
    sorted_vals = np.sort(values)
    denom = max(len(sorted_vals) - 1, 1)
    result = {}
    for sym, val in row.items():
        if pd.isna(val):
            result[sym] = np.nan
            continue
        idx = np.searchsorted(sorted_vals, val, side="left")
        if idx >= len(sorted_vals):
            idx = len(sorted_vals) - 1
        pct = (idx / denom) * 100
        result[sym] = pct
    return pd.Series(result)


def detect_events(flag_df: pd.DataFrame, metrics: Dict[str, pd.DataFrame], specs: Dict[str, SymbolSpec], quad: str) -> List[Dict]:
    events: List[Dict] = []
    for sym in flag_df.columns:
        meta = specs.get(sym)
        prev = False
        for date, is_hit in flag_df[sym].items():
            flag = bool(is_hit)
            if flag and not prev:
                next_dates = metrics["close"][sym].loc[date:].dropna().index
                exec_date = None
                if len(next_dates) >= 2:
                    exec_date = next_dates[1]
                elif len(next_dates) == 1:
                    exec_date = next_dates[0]
                event = {
                    "symbol": sym,
                    "market": meta.market if meta else None,
                    "name": meta.name if meta else sym,
                    "quad": quad,
                    "signal_date": date.strftime("%Y-%m-%d"),
                    "exec_date": exec_date.strftime("%Y-%m-%d") if exec_date else None,
                    "F": float(metrics["F"].at[date, sym]) if pd.notna(metrics["F"].at[date, sym]) else None,
                    "V": float(metrics["V"].at[date, sym]) if pd.notna(metrics["V"].at[date, sym]) else None,
                    "fPct": float(metrics["fPct"].at[date, sym]) if pd.notna(metrics["fPct"].at[date, sym]) else None,
                    "vPct": float(metrics["vPct"].at[date, sym]) if pd.notna(metrics["vPct"].at[date, sym]) else None,
                }
                events.append(event)
            prev = flag
    events.sort(key=lambda x: (x["signal_date"], x["symbol"]))
    return events


def build_metrics(closes: pd.DataFrame, f_pct_min: float, v_pct_min: float) -> Dict[str, pd.DataFrame]:
    rp = compute_relative_performance(closes)
    f_scores = compute_f_scores(rp)
    v_scores = compute_v_scores(closes)
    f_pct = f_scores.apply(percentile_rank_row, axis=1)
    v_pct = v_scores.apply(percentile_rank_row, axis=1)
    q1_flag = (f_pct >= f_pct_min) & (v_pct >= v_pct_min)
    q2_flag = (f_pct >= f_pct_min) & (v_pct < 100 - v_pct_min)
    q3_flag = (f_pct < 100 - f_pct_min) & (v_pct >= v_pct_min)
    q4_flag = (f_pct < 100 - f_pct_min) & (v_pct < 100 - v_pct_min)
    metrics = {
        "F": f_scores,
        "V": v_scores,
        "fPct": f_pct,
        "vPct": v_pct,
        "close": closes,
        "q1": q1_flag,
        "q2": q2_flag,
        "q3": q3_flag,
        "q4": q4_flag,
    }
    return metrics


def serialize_prices(prices: Dict[str, pd.DataFrame]) -> Dict[str, Dict[str, List]]:
    out: Dict[str, Dict[str, List]] = {}
    for sym, df in prices.items():
        if df.empty:
            continue
        df = df.sort_index()
        adj = df["Adj Close"] if "Adj Close" in df.columns else df["Close"]
        vol = df["Volume"] if "Volume" in df.columns else pd.Series([np.nan] * len(df), index=df.index)
        out[sym] = {
            "date": [d.strftime("%Y-%m-%d") for d in df.index],
            "open": [float(x) if pd.notna(x) else None for x in df["Open"]],
            "high": [float(x) if pd.notna(x) else None for x in df["High"]],
            "low": [float(x) if pd.notna(x) else None for x in df["Low"]],
            "close": [float(x) if pd.notna(x) else None for x in df["Close"]],
            "adjclose": [float(x) if pd.notna(x) else None for x in adj],
            "volume": [float(x) if pd.notna(x) else None for x in vol],
        }
    return out


def main() -> None:
    args = parse_args()
    if args.symbols_file and args.symbols_file.exists():
        symbols_list = [line.strip() for line in args.symbols_file.read_text(encoding='utf-8').splitlines() if line.strip()]
        universe = []
        for sym in symbols_list:
            mkt = 'JP' if sym.endswith('.T') or sym.endswith('.TO') else 'US'
            universe.append(SymbolSpec(sym, market=mkt, name=sym))
    else:
        universe = PRESET_UNIVERSES[args.preset]
    symbols = [s.symbol for s in universe]
    if args.bench not in symbols:
        symbols.append(args.bench)

    price_map = fetch_prices(symbols, args.start, args.end, use_cache=not args.no_cache)
    idx, closes = align_close(price_map)
    closes = closes.loc[:, sorted(price_map.keys())]
    metrics = build_metrics(closes, args.f_pct_min, args.v_pct_min)

    spec_map = {spec.symbol: spec for spec in universe}
    flag = metrics[args.quad.lower()]
    events = detect_events(flag, metrics, spec_map, args.quad)

    payload = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "start": args.start,
        "end": args.end,
        "preset": args.preset,
        "symbols": [dataclasses.asdict(s) for s in universe],
        "events": events,
        "prices": serialize_prices(price_map),
        "bench": args.bench,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved {len(events)} ${args.quad} events to {args.output}")


if __name__ == "__main__":
    main()









