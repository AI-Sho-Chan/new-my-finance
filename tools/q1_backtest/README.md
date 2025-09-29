# Q1 Backtest Toolkit

This directory contains helpers for analysing the Q1 signal both in real time (current monitor events) and historically (reconstructed signals from raw price data).

## 1. Reconstruct historical Q1 signals

```powershell
python tools/q1_backtest/historical_pipeline.py --start 2014-01-01 --end 2024-12-31 --preset indices_etf --output data/q1-monitor/historical_indices.json
```

- Fetches Yahoo Finance daily prices for the selected universe (preset `indices_etf` ships with major JP/US indices and large/mid/small-cap ETFs).
- Recomputes the F/V scores (same parameters as the live monitor) for every trading day, derives Q1 percentile thresholds, and records Q1 enter events.
- Stores the raw price history and detected events in JSON so that downstream backtests can reuse the same data.
- Tunables: `--preset` (or point the script at a custom symbol list), timeframe (`--start/--end`), and benchmark symbol (`--bench`, defaults to `^GSPC`).

## 2. Run historical strategy backtests

```powershell
python tools/q1_backtest/historical_backtest.py \
  --events data/q1-monitor/historical_indices.json \
  --max-hold 60 \
  --stops 0.05,0.08 \
  --summary-csv data/q1-monitor/historical_backtest_summary.csv
```

- Walks through every reconstructed Q1 enter event and simulates “buy next-day open, sell after *n* trading days” across horizons (default 1–120) with configurable trading costs and slippage.
- Evaluates fixed stop-loss thresholds (e.g., `0.05` = -5%) in addition to the baseline “no stop” path.
- Benchmarks each trade against the S&P 500 on the same holding period and reports per-trade alpha as well as aggregated statistics (mean/median return, win rate, Sharpe-like and Information-like ratios).
- Outputs two artefacts:
  - `historical_backtest.json`: full trade records (per symbol/horizon/stop) plus the nested summary.
  - `historical_backtest_summary.csv`: flattened summary table for quick inspection or spreadsheet work.
  - Flags default costs of 0.10% commission + 0.05% slippage per side; tweak via `--entry-cost`, `--exit-cost`, and `--slippage`.

## 3. Current-state event backtest (existing workflow)

```powershell
python tools/q1_backtest/run_backtest.py --horizons 1,5,20,60
```

- Reuses the live monitor’s `state.json`, buys on the next available bar, and reports the short-term performance snapshots displayed on the dashboard.

## Scaling to full universes

1. **Expand symbol coverage**: create additional presets (e.g., `jp_large`, `us_mid`, etc.) or supply a JSON file with symbol metadata, then run `historical_pipeline.py` per bucket to keep the cross-sectional statistics meaningful.
2. **Batch processing**: the reconstruction step is CPU-light but IO-heavy; for thousands of symbols schedule multiple runs with disjoint symbol lists and merge the resulting event files before running the backtest.
3. **Cost/stop parameter sweeps**: the backtest script accepts arbitrary horizon lists (`--horizons 5,10,20,40,80`) and stop grids (`--stops 0.03,0.05,0.08,0.12`) so you can iterate quickly without rewriting code.
4. **Benchmark flexibility**: swap `--bench` to compare against alternative indices (e.g., TOPIX for JP-only analyses) while leaving backtests otherwise untouched.
5. **Downstream integrations**: the JSON/CSV outputs were designed to be machine-readable; ingest them into notebooks or BI dashboards to visualise heatmaps, cumulative PnL, max drawdowns, etc.

## Notes

- All scripts rely on `yfinance`, which is already part of the backend environment; make sure outbound network access is available.
- Yahoo data can have gaps on illiquid tickers—check the `events` array for skipped signals before drawing conclusions.
- For JP → USD conversions the historical pipeline currently works in USD terms (per the live monitor); extend the script if you need currency adjustments.
