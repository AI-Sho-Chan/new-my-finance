#!/usr/bin/env python3
"""Simple backtest for Q1 entry signals."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf


@dataclass
class Q1Event:
    symbol: str
    market: str
    trade_date: dt.date
    name: str
    metrics: Dict[str, float]


@dataclass
class TradeResult:
    symbol: str
    market: str
    name: str
    horizon_days: int
    signal_trade_date: dt.date
    buy_date: dt.date
    sell_date: dt.date
    buy_open: float
    sell_close: float
    gross_return: float
    max_drawdown: Optional[float]


def load_events(state_path: Path, limit: int = 0) -> List[Q1Event]:
    raw = json.loads(state_path.read_text(encoding="utf-8"))
    history = raw.get("history", [])
    events: List[Q1Event] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "ENTER":
            continue
        trade_date = item.get("tradeDate")
        symbol = item.get("symbol")
        market = item.get("market")
        name = item.get("name") or ""
        metrics = item.get("metrics") or {}
        if not trade_date or not symbol or not market:
            continue
        try:
            trade_dt = dt.date.fromisoformat(trade_date)
        except ValueError:
            continue
        events.append(Q1Event(symbol=symbol, market=market, trade_date=trade_dt, name=name, metrics=metrics))
    events.sort(key=lambda e: (e.trade_date, e.symbol))
    if limit > 0:
        events = events[-limit:]
    return events


def fetch_price_history(symbol: str, start: dt.date, end: dt.date) -> pd.DataFrame:
    data = yf.download(
        tickers=symbol,
        start=start.isoformat(),
        end=end.isoformat(),
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=False,
    )
    if isinstance(data, pd.Series):
        data = data.to_frame(name="Close")
    if data.empty:
        return pd.DataFrame()
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]
    if not isinstance(data.index, pd.DatetimeIndex):
        data.index = pd.to_datetime(data.index)
    data = data.sort_index()
    required = {"Open", "Close"}
    if not required.issubset(set(data.columns)):
        return pd.DataFrame()
    keep_cols = [c for c in ("Open", "High", "Low", "Close") if c in data.columns]
    data = data.loc[:, keep_cols]
    data = data.dropna(subset=["Open", "Close"])
    data = data[~data.index.duplicated(keep="last")]
    if getattr(data.index, "tz", None) is not None:
        data = data.tz_convert(None)
    df = data.reset_index().rename(columns={"index": "Date"})
    df["Date"] = pd.to_datetime(df["Date"])
    return df.reset_index(drop=True)


def pick_buy_row(df: pd.DataFrame, trade_date: dt.date) -> Optional[int]:
    if df.empty:
        return None
    mask = df["Date"] > pd.Timestamp(trade_date)
    rows = df.loc[mask]
    if rows.empty:
        return None
    return int(rows.index[0])


def compute_trade(df: pd.DataFrame, buy_idx: int, horizon_days: int) -> Optional[TradeResult]:
    sell_idx = buy_idx + horizon_days - 1
    if sell_idx >= len(df):
        return None
    buy_row = df.loc[buy_idx]
    sell_row = df.loc[sell_idx]
    buy_open = float(buy_row["Open"])
    sell_close = float(sell_row["Close"])
    if not math.isfinite(buy_open) or not math.isfinite(sell_close) or buy_open <= 0:
        return None
    window = df.loc[buy_idx : sell_idx]
    min_low = None
    if "Low" in window.columns:
        lows = pd.to_numeric(window["Low"], errors="coerce").dropna()
        if not lows.empty:
            min_low = float(lows.min())
    gross_return = (sell_close / buy_open) - 1.0
    max_drawdown = None
    if min_low is not None and buy_open > 0:
        max_drawdown = (min_low / buy_open) - 1.0
    return TradeResult(
        symbol="",
        market="",
        name="",
        horizon_days=horizon_days,
        signal_trade_date=pd.Timestamp(0).date(),
        buy_date=pd.Timestamp(buy_row["Date"]).date(),
        sell_date=pd.Timestamp(sell_row["Date"]).date(),
        buy_open=buy_open,
        sell_close=sell_close,
        gross_return=gross_return,
        max_drawdown=max_drawdown,
    )


def summarize(trades: Iterable[TradeResult]) -> Dict[str, Dict[str, float]]:
    by_horizon: Dict[int, List[TradeResult]] = {}
    for trade in trades:
        by_horizon.setdefault(trade.horizon_days, []).append(trade)
    summary: Dict[str, Dict[str, float]] = {}
    for horizon, items in sorted(by_horizon.items()):
        returns = np.array([t.gross_return for t in items], dtype=float)
        drawdowns = np.array([t.max_drawdown for t in items if t.max_drawdown is not None], dtype=float)
        if returns.size == 0:
            continue
        wins = float(np.sum(returns > 0))
        summary[str(horizon)] = {
            "tradeCount": int(len(items)),
            "avgReturn": float(np.mean(returns)),
            "medianReturn": float(np.median(returns)),
            "winRate": float(wins / returns.size),
            "bestReturn": float(np.max(returns)),
            "worstReturn": float(np.min(returns)),
            "stdReturn": float(np.std(returns)),
            "avgDrawdown": float(np.mean(drawdowns)) if drawdowns.size else None,
            "worstDrawdown": float(np.min(drawdowns)) if drawdowns.size else None,
        }
    return summary


def run_backtest(
    state_path: Path,
    output_path: Path,
    horizons: List[int],
    limit: int = 0,
) -> Dict:
    events = load_events(state_path, limit=limit)
    if not events:
        raise RuntimeError("No Q1 ENTER events found in history")
    unique_symbols = sorted({e.symbol for e in events})
    min_trade_date = min(e.trade_date for e in events)
    max_trade_date = max(e.trade_date for e in events)
    start = min_trade_date - dt.timedelta(days=10)
    end = dt.date.today() + dt.timedelta(days=max(horizons) + 10)
    price_cache: Dict[str, pd.DataFrame] = {}
    for symbol in unique_symbols:
        price_cache[symbol] = fetch_price_history(symbol, start=start, end=end)
    trades: List[TradeResult] = []
    skipped_no_price: List[str] = []
    skipped_no_future: List[str] = []
    for event in events:
        df = price_cache.get(event.symbol)
        if df is None or df.empty:
            skipped_no_price.append(event.symbol)
            continue
        buy_idx = pick_buy_row(df, event.trade_date)
        if buy_idx is None:
            skipped_no_future.append(event.symbol)
            continue
        for horizon in horizons:
            base_trade = compute_trade(df, buy_idx, horizon)
            if base_trade is None:
                continue
            trade = TradeResult(
                symbol=event.symbol,
                market=event.market,
                name=event.name,
                horizon_days=base_trade.horizon_days,
                signal_trade_date=event.trade_date,
                buy_date=base_trade.buy_date,
                sell_date=base_trade.sell_date,
                buy_open=base_trade.buy_open,
                sell_close=base_trade.sell_close,
                gross_return=base_trade.gross_return,
                max_drawdown=base_trade.max_drawdown,
            )
            trades.append(trade)
    markets = sorted({t.market for t in trades})
    market_trades: Dict[str, List[TradeResult]] = {m: [] for m in markets}
    for trade in trades:
        market_trades.setdefault(trade.market, []).append(trade)
    summary_by_market = {m: summarize(ts) for m, ts in market_trades.items()}
    summary_all = summarize(trades)
    report = {
        "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        "statePath": str(state_path),
        "eventCount": len(events),
        "tradeCount": len(trades),
        "horizons": horizons,
        "tradeDateRange": {
            "min": min_trade_date.isoformat(),
            "max": max_trade_date.isoformat(),
        },
        "markets": summary_by_market,
        "all": summary_all,
        "trades": [
            {
                "symbol": t.symbol,
                "market": t.market,
                "name": t.name,
                "horizonDays": t.horizon_days,
                "signalTradeDate": t.signal_trade_date.isoformat(),
                "buyDate": t.buy_date.isoformat(),
                "sellDate": t.sell_date.isoformat(),
                "buyOpen": t.buy_open,
                "sellClose": t.sell_close,
                "grossReturn": t.gross_return,
                "maxDrawdown": t.max_drawdown,
            }
            for t in trades
        ],
        "skipped": {
            "noPrice": sorted(set(skipped_no_price)),
            "noFutureData": sorted(set(skipped_no_future)),
        },
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backtest Q1 entry signals")
    parser.add_argument("--state", type=Path, default=Path("data/q1-monitor/state.json"))
    parser.add_argument("--output", type=Path, default=Path("data/q1-monitor/backtest_summary.json"))
    parser.add_argument(
        "--horizons",
        type=str,
        default="1,5,20,60",
        help="Comma separated holding periods in trading days",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of most recent Q1 events (0 means all)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    horizons = sorted({int(x) for x in args.horizons.split(",") if x.strip()})
    report = run_backtest(args.state, args.output, horizons=horizons, limit=args.limit)
    print(f"Generated backtest for {report['tradeCount']} trades across {len(report['markets'])} markets")
    for market, summary in report["markets"].items():
        total = sum(item.get("tradeCount", 0) for item in summary.values())
        print(f"  {market}: {total} trades")
        for horizon, stats in summary.items():
            avg_ret = stats.get("avgReturn")
            win_rate = stats.get("winRate")
            if avg_ret is None or win_rate is None:
                continue
            print(f"    {horizon}d -> avg {avg_ret:.3%}, win {win_rate:.1%}")


if __name__ == "__main__":
    main()
