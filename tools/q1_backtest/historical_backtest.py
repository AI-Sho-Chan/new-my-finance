#!/usr/bin/env python3
"""Backtest Q1 strategy using historical event reconstruction."""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yfinance as yf

DEFAULT_HORIZON_MAX = 120
DEFAULT_STOP_GRID = [0.05, 0.08, 0.1]
DEFAULT_ENTRY_COST = 0.001  # 0.10%
DEFAULT_EXIT_COST = 0.001
DEFAULT_SLIPPAGE = 0.0005   # 0.05%


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run historical backtest for Q1 signals")
    parser.add_argument("--events", type=Path, default=Path("data/q1-monitor/historical_indices.json"))
    parser.add_argument("--max-hold", type=int, default=DEFAULT_HORIZON_MAX)
    parser.add_argument("--horizons", type=str, default="", help="Comma separated explicit horizons (overrides max-hold if set)")
    parser.add_argument("--stops", type=str, default=",".join(str(x) for x in DEFAULT_STOP_GRID), help="Comma separated stop-loss thresholds as decimal drops e.g. 0.05")
    parser.add_argument("--entry-cost", type=float, default=DEFAULT_ENTRY_COST, help="Entry cost fraction per trade")
    parser.add_argument("--exit-cost", type=float, default=DEFAULT_EXIT_COST, help="Exit cost fraction per trade")
    parser.add_argument("--slippage", type=float, default=DEFAULT_SLIPPAGE, help="Slippage fraction per trade")
    parser.add_argument("--output", type=Path, default=Path("data/q1-monitor/historical_backtest.json"))
    parser.add_argument("--summary-csv", type=Path, default=Path("data/q1-monitor/historical_backtest_summary.csv"))
    parser.add_argument("--bench-map", type=str, default="", help="Market-to-benchmark mapping, e.g., JP:^TOPX,US:^GSPC")
    parser.add_argument(
        "--entry",
        type=str,
        default="open",
        choices=["open", "close"],
        help="Entry basis: next-day open (open) or signal-day close (close)",
    )
    return parser.parse_args()


def load_json(path: Path) -> Dict:
    return json.loads(path.read_text(encoding="utf-8"))


def frame_from_price_blob(blob: Dict[str, List]) -> pd.DataFrame:
    dates = pd.to_datetime(blob["date"])
    df = pd.DataFrame({
        "Open": blob.get("open", []),
        "High": blob.get("high", []),
        "Low": blob.get("low", []),
        "Close": blob.get("close", []),
        "Adj Close": blob.get("adjclose", []),
        "Volume": blob.get("volume", []),
    }, index=dates)
    df = df.apply(pd.to_numeric, errors="coerce")
    df = df.sort_index()
    return df


def prepare_prices(payload: Dict) -> Dict[str, pd.DataFrame]:
    price_map: Dict[str, pd.DataFrame] = {}
    for sym, blob in payload.get("prices", {}).items():
        price_map[sym] = frame_from_price_blob(blob)
    return price_map


def compute_trade_return(buy_price: float, sell_price: float, entry_fee: float, exit_fee: float) -> float:
    if buy_price <= 0 or sell_price <= 0:
        return np.nan
    buy_eff = buy_price * (1 + entry_fee)
    sell_eff = sell_price * (1 - exit_fee)
    return (sell_eff / buy_eff) - 1.0


def locate_index(df: pd.DataFrame, date: pd.Timestamp) -> Optional[int]:
    try:
        return df.index.get_loc(date)
    except KeyError:
        return None


def locate_on_or_after(df: pd.DataFrame, date: pd.Timestamp) -> Optional[int]:
    pos = df.index.searchsorted(date)
    if pos >= len(df):
        return None
    return int(pos)


def trading_dates(df: pd.DataFrame) -> List[pd.Timestamp]:
    return list(df.index)


def evaluate_event(
    event: Dict,
    price_df: pd.DataFrame,
    bench_df: pd.DataFrame,
    horizons: List[int],
    stop_levels: List[Optional[float]],
    entry_fee: float,
    exit_fee: float,
    entry_mode: str = "open",
) -> List[Dict]:
    results: List[Dict] = []
    # Determine entry date and price
    if entry_mode == "close":
        signal_date_str = event.get("signal_date")
        if not signal_date_str:
            return results
        entry_date = pd.to_datetime(signal_date_str)
        if entry_date not in price_df.index:
            return results
        buy_idx = locate_index(price_df, entry_date)
        if buy_idx is None:
            return results
        buy_row = price_df.iloc[buy_idx]
        buy_price = float(buy_row.get("Close", np.nan))
        if not np.isfinite(buy_price):
            return results
        bench_idx = locate_on_or_after(bench_df, entry_date)
        if bench_idx is None:
            return results
        exec_date = entry_date
    else:
        exec_date_str = event.get("exec_date")
        if not exec_date_str:
            return results
        exec_date = pd.to_datetime(exec_date_str)
        if exec_date not in price_df.index:
            return results
        buy_idx = locate_index(price_df, exec_date)
        if buy_idx is None:
            return results
        buy_row = price_df.iloc[buy_idx]
        # Prefer Open; fallback to Close if Open missing
        bp_open = float(buy_row.get("Open", np.nan))
        bp_close = float(buy_row.get("Close", np.nan))
        buy_price = bp_open if np.isfinite(bp_open) else bp_close
        if not np.isfinite(buy_price):
            return results
        bench_idx = locate_on_or_after(bench_df, exec_date)
        if bench_idx is None:
            return results

    for horizon in horizons:
        exit_idx = buy_idx + horizon - 1
        if exit_idx >= len(price_df):
            continue
        exit_row = price_df.iloc[exit_idx]
        exit_date = price_df.index[exit_idx]
        sell_price = exit_row["Close"]
        if not np.isfinite(sell_price):
            continue
        slice_df = price_df.iloc[buy_idx: exit_idx + 1]
        min_low = (slice_df["Low"].min() / buy_price) - 1 if np.isfinite(slice_df["Low"].min()) else np.nan

        bench_exit_idx = bench_idx + horizon - 1
        if bench_exit_idx >= len(bench_df):
            continue
        bench_buy = bench_df.iloc[bench_idx]["Close"]
        bench_sell = bench_df.iloc[bench_exit_idx]["Close"]
        if not (np.isfinite(bench_buy) and np.isfinite(bench_sell) and bench_buy > 0):
            continue
        bench_return = (bench_sell / bench_buy) - 1.0

        base_return = compute_trade_return(buy_price, sell_price, entry_fee, exit_fee)
        base_record = {
            "symbol": event.get("symbol"),
            "market": event.get("market"),
            "name": event.get("name"),
            "signalDate": event.get("signal_date"),
            "execDate": exec_date.strftime("%Y-%m-%d"),
            "exitDate": exit_date.strftime("%Y-%m-%d"),
            "horizon": horizon,
            "stop": None,
            "return": base_return,
            "benchReturn": bench_return,
            "alpha": base_return - bench_return if np.isfinite(base_return) else np.nan,
            "maxDrawdown": min_low,
            "stopTriggered": False,
        }
        results.append(base_record)

        # Evaluate stop-loss variants
        for stop in stop_levels:
            if stop is None:
                continue
            threshold = buy_price * (1 - stop)
            stop_exit_date = None
            for date, low in slice_df["Low"].items():
                if np.isfinite(low) and low <= threshold:
                    stop_exit_date = date
                    break
            if stop_exit_date is None:
                # no trigger; reuse base outcome
                rec = base_record.copy()
                rec["stop"] = stop
                results.append(rec)
                continue
            stop_exit_idx = locate_index(price_df, stop_exit_date)
            if stop_exit_idx is None:
                continue
            stop_exit_price = threshold
            stop_return = compute_trade_return(buy_price, stop_exit_price, entry_fee, exit_fee)
            bench_stop_idx = bench_idx + min(stop_exit_idx - buy_idx, horizon - 1)
            bench_stop_exit = bench_df.iloc[bench_stop_idx]["Close"]
            bench_stop_return = (bench_stop_exit / bench_buy) - 1.0 if np.isfinite(bench_stop_exit) else np.nan
            rec = base_record.copy()
            rec.update({
                "stop": stop,
                "exitDate": stop_exit_date.strftime("%Y-%m-%d"),
                "return": stop_return,
                "benchReturn": bench_stop_return,
                "alpha": stop_return - bench_stop_return if np.isfinite(stop_return) and np.isfinite(bench_stop_return) else np.nan,
                "stopTriggered": True,
            })
            results.append(rec)
    return results


def aggregate(records: List[Dict]) -> Dict:
    grouped: Dict[Tuple[str, Optional[float], Optional[str]], List[Dict]] = {}
    for rec in records:
        market = rec.get("market") or "UNKNOWN"
        stop = rec.get("stop")
        horizon = rec.get("horizon")
        key = (market, stop, horizon)
        grouped.setdefault(key, []).append(rec)
    summary: Dict[str, Dict[str, Dict[str, float]]] = {}
    for (market, stop, horizon), recs in grouped.items():
        returns = np.array([r["return"] for r in recs if np.isfinite(r["return"])])
        bench = np.array([r["benchReturn"] for r in recs if np.isfinite(r["benchReturn"])])
        alpha = np.array([r["alpha"] for r in recs if np.isfinite(r["alpha"])])
        log_daily = np.array([np.log1p(r["return"]) / r["horizon"] for r in recs if np.isfinite(r["return"]) and r["horizon"] > 0])
        log_daily_alpha = np.array([np.log1p(r["return"]) / r["horizon"] - np.log1p(r["benchReturn"]) / r["horizon"] for r in recs if np.isfinite(r["return"]) and np.isfinite(r["benchReturn"]) and r["horizon"] > 0])
        entry = summary.setdefault(market, {}).setdefault(str(stop), {}).setdefault(str(horizon), {})
        entry["tradeCount"] = len(recs)
        if returns.size:
            entry["avgReturn"] = float(np.mean(returns))
            entry["medianReturn"] = float(np.median(returns))
            entry["winRate"] = float(np.mean(returns > 0))
            entry["bestReturn"] = float(np.max(returns))
            entry["worstReturn"] = float(np.min(returns))
            entry["stdReturn"] = float(np.std(returns))
            entry["avgAlpha"] = float(np.mean(alpha)) if alpha.size else None
            entry["benchAvg"] = float(np.mean(bench)) if bench.size else None
            if log_daily.size > 1:
                avg_daily = np.mean(log_daily)
                std_daily = np.std(log_daily)
                entry["sharpeLike"] = float((avg_daily / std_daily) * np.sqrt(252)) if std_daily > 0 else None
            else:
                entry["sharpeLike"] = None
            if log_daily_alpha.size > 1:
                avg_alpha_daily = np.mean(log_daily_alpha)
                std_alpha_daily = np.std(log_daily_alpha)
                entry["informationLike"] = float((avg_alpha_daily / std_alpha_daily) * np.sqrt(252)) if std_alpha_daily > 0 else None
            else:
                entry["informationLike"] = None
        else:
            entry["avgReturn"] = None
            entry["medianReturn"] = None
            entry["winRate"] = None
            entry["bestReturn"] = None
            entry["worstReturn"] = None
            entry["stdReturn"] = None
            entry["avgAlpha"] = None
            entry["benchAvg"] = None
            entry["sharpeLike"] = None
            entry["informationLike"] = None
    return summary


def main() -> None:
    args = parse_args()
    payload = load_json(args.events)
    price_map = prepare_prices(payload)
    bench_symbol = payload.get("bench")
    # build per-market bench mapping if provided
    bench_map = {}
    if args.bench_map:
        for pair in args.bench_map.split(","):
            if not pair.strip():
                continue
            m, s = pair.split(":", 1)
            bench_map[m.strip()] = s.strip()
    # gather all bench symbols we need
    needed_benches = set(bench_map.values()) if bench_map else set()
    if bench_symbol: needed_benches.add(bench_symbol)
    # compute global date span from payload prices
    all_idx = [df.index for df in price_map.values() if isinstance(df, pd.DataFrame) and not df.empty]
    if not all_idx:
        raise ValueError("No price data found in events payload")
    start_ts = min(idx.min() for idx in all_idx)
    end_ts = max(idx.max() for idx in all_idx)
    # materialize bench frames
    bench_frames: Dict[str, pd.DataFrame] = {}
    for sym in needed_benches:
        if sym in price_map:
            bench_frames[sym] = price_map[sym]
        else:
            bench_frames[sym] = fetch_ohlc_for(sym, start_ts, end_ts)
    # fallback single bench if no map provided
    if not bench_map:
        if not bench_symbol or bench_symbol not in bench_frames:
            raise ValueError("Benchmark symbol not found in price data")
        bench_frames[bench_symbol] = bench_frames.get(bench_symbol, price_map.get(bench_symbol))

    if args.horizons:
        horizons = sorted({int(x.strip()) for x in args.horizons.split(",") if x.strip()})
    else:
        horizons = list(range(1, args.max_hold + 1))
    stop_levels: List[Optional[float]] = [float(x.strip()) for x in args.stops.split(",") if x.strip()]

    entry_fee = args.entry_cost + args.slippage
    exit_fee = args.exit_cost + args.slippage

    records: List[Dict] = []
    for event in payload.get("events", []):
        sym = event.get("symbol")
        if sym not in price_map:
            continue
        sym_df = price_map[sym]
        mkt = (event.get("market") or "").strip()
        this_bench_sym = bench_map.get(mkt, bench_symbol) if (locals().get("bench_map") is not None) else bench_symbol
        bench_df = bench_frames.get(this_bench_sym)
        if bench_df is None or bench_df.empty:
            continue
        event_records = evaluate_event(event, sym_df, bench_df, horizons, [None] + stop_levels, entry_fee, exit_fee, args.entry)
        records.extend(event_records)

    summary = aggregate(records)

    if records and args.summary_csv:
        rows = []
        for market, stop_map in summary.items():
            for stop_key, horizon_map in stop_map.items():
                stop_val = None if stop_key == "None" else float(stop_key) if stop_key not in ("None", "null") else None
                for horizon_key, metrics in horizon_map.items():
                    row = {"market": market, "stop": stop_val, "horizon": int(float(horizon_key))}
                    row.update(metrics)
                    rows.append(row)
        if rows:
            df_summary = pd.DataFrame(rows)
            df_summary = df_summary.sort_values(["market", "stop", "horizon"]).reset_index(drop=True)
            args.summary_csv.parent.mkdir(parents=True, exist_ok=True)
            df_summary.to_csv(args.summary_csv, index=False)

    output = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "sourceEvents": str(args.events),
        "horizons": horizons,
        "stops": stop_levels,
        "entryCost": args.entry_cost,
        "exitCost": args.exit_cost,
        "slippage": args.slippage,
        "records": records,
        "summary": summary,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Backtest complete: {len(records)} records saved to {args.output}")


if __name__ == "__main__":
    main()
