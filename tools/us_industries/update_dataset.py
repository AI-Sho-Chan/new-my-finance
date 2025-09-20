#!/usr/bin/env python3
"""Build and update US industry composite dataset."""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / 'data' / 'us-industries'
PUBLIC_PATH = ROOT / 'web' / 'public' / 'data' / 'us-industries-history.json'
HISTORY_PATH = DATA_DIR / 'history.json'
UNIVERSE_PATH = DATA_DIR / 'universe.json'
DEFAULT_PERIOD = '10y'
MIN_COMPONENT_RATIO = 0.4
MAX_RETRIES = 4
SLEEP_BASE = 1.0
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; NMYFinanceBot/1.0; +https://example.local) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
}


@dataclass
class Industry:
    id: str
    sector: str
    industry_group: str
    industry: str
    components: List[Dict[str, str]] = field(default_factory=list)

    @staticmethod
    def from_dict(data: Dict[str, object]) -> 'Industry':
        return Industry(
            id=str(data['id']),
            sector=str(data['sector']),
            industry_group=str(data['industryGroup']),
            industry=str(data['industry']),
            components=[
                {
                    'symbol': str(comp['symbol']),
                    'name': str(comp.get('name', comp['symbol'])),
                    'marketCap': str(comp.get('marketCap', '')),
                    'exchange': str(comp.get('exchange', '')),
                }
                for comp in data.get('components', [])
                if comp and comp.get('symbol')
            ],
        )


@dataclass
class SeriesRecord:
    date: str
    close: float
    component_count: int

    def to_dict(self) -> Dict[str, object]:
        payload = {'date': self.date, 'close': round(self.close, 4), 'source': 'composite'}
        if self.component_count > 0:
            payload['componentCount'] = self.component_count
        return payload


class IndustryDatasetBuilder:
    def __init__(self, period: str = DEFAULT_PERIOD) -> None:
        self.period = period
        self.symbol_cache: Dict[str, pd.Series | None] = {}

    def fetch_symbol(self, symbol: str) -> pd.Series | None:
        if symbol in self.symbol_cache:
            return self.symbol_cache[symbol]

        encoded = urllib.parse.quote(symbol)
        params = {
            'range': self.period,
            'interval': '1d',
            'includePrePost': 'false',
            'events': 'div,splits',
        }
        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{encoded}"

        last_error: Exception | None = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(url, headers=HEADERS, params=params, timeout=30)
                if resp.status_code == 429:
                    wait = SLEEP_BASE * (2 ** attempt)
                    print(f"[WARN] {symbol}: rate limited (429), sleeping {wait:.1f}s", file=sys.stderr)
                    time.sleep(wait)
                    continue
                if resp.status_code == 404:
                    print(f"[WARN] {symbol}: not found (404)", file=sys.stderr)
                    self.symbol_cache[symbol] = None
                    return None
                resp.raise_for_status()
                data = resp.json()
                result = (data.get('chart', {}).get('result') or [None])[0]
                if not result:
                    raise ValueError('empty result payload')
                timestamps = result.get('timestamp') or []
                if not timestamps:
                    raise ValueError('missing timestamps')
                indicators = result.get('indicators', {})
                adjclose = ((indicators.get('adjclose') or [None])[0] or {}).get('adjclose')
                if not adjclose:
                    adjclose = ((indicators.get('quote') or [None])[0] or {}).get('close')
                if not adjclose:
                    raise ValueError('missing close data')
                series = pd.Series(adjclose, index=pd.to_datetime(timestamps, unit='s'))
                series = series.dropna()
                series.index = series.index.tz_localize(None)
                if series.empty:
                    raise ValueError('empty series after dropna')
                self.symbol_cache[symbol] = series
                # polite pause to avoid throttling
                time.sleep(0.25)
                return series
            except Exception as exc:  # pragma: no cover - network interaction
                last_error = exc
                wait = SLEEP_BASE * (2 ** attempt)
                print(f"[WARN] {symbol}: fetch attempt {attempt+1} failed: {exc} (sleep {wait:.1f}s)", file=sys.stderr)
                time.sleep(wait)
        print(f"[WARN] {symbol}: giving up after {MAX_RETRIES} attempts ({last_error})", file=sys.stderr)
        self.symbol_cache[symbol] = None
        return None

    def build_industry_series(self, industry: Industry) -> List[SeriesRecord]:
        component_series: Dict[str, pd.Series] = {}
        for comp in industry.components:
            symbol = comp['symbol']
            series = self.fetch_symbol(symbol)
            if series is None or series.empty:
                continue
            component_series[symbol] = series

        if not component_series:
            print(f"[WARN] {industry.id}: no component data", file=sys.stderr)
            return []

        normalized_frames: List[pd.Series] = []
        for symbol, series in component_series.items():
            first_valid = series.dropna().iloc[0]
            if not isinstance(first_valid, (float, int)) or first_valid <= 0:
                continue
            normalized = (series / float(first_valid)) * 100.0
            normalized_frames.append(normalized.rename(symbol))

        if not normalized_frames:
            print(f"[WARN] {industry.id}: unable to normalize components", file=sys.stderr)
            return []

        combined = pd.concat(normalized_frames, axis=1, join='outer').sort_index()
        component_counts = combined.count(axis=1)
        min_required = max(1, int(len(normalized_frames) * MIN_COMPONENT_RATIO))
        mask = component_counts >= min_required
        if not mask.any():
            print(f"[WARN] {industry.id}: insufficient overlap", file=sys.stderr)
            return []
        combined = combined[mask]
        component_counts = component_counts[mask]
        composite = combined.mean(axis=1)

        records: List[SeriesRecord] = []
        for idx, close in composite.dropna().items():
            records.append(
                SeriesRecord(
                    date=idx.strftime('%Y-%m-%d'),
                    close=float(close),
                    component_count=int(component_counts.loc[idx]),
                )
            )
        return records


def load_universe(path: Path) -> List[Industry]:
    data = json.loads(path.read_text(encoding='utf-8'))
    industries_data = data.get('industries', [])
    return [Industry.from_dict(item) for item in industries_data]


def build_history(period: str) -> Dict[str, object]:
    industries = load_universe(UNIVERSE_PATH)
    builder = IndustryDatasetBuilder(period=period)

    output_entries: List[Dict[str, object]] = []
    for industry in industries:
        records = builder.build_industry_series(industry)
        if not records:
            continue
        output_entries.append(
            {
                'id': industry.id,
                'sector': industry.sector,
                'industryGroup': industry.industry_group,
                'industry': industry.industry,
                'components': industry.components,
                'series': [rec.to_dict() for rec in records],
            }
        )
        print(f"[OK] {industry.id}: {len(records)} points")

    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'FinanceDatabase 2.3.1 + Yahoo Finance',
        'period': period,
        'industries': output_entries,
    }
    return payload


def write_history(payload: Dict[str, object]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Wrote dataset to {HISTORY_PATH} and {PUBLIC_PATH}")


def update_dataset_once(period: str = DEFAULT_PERIOD) -> Dict[str, object]:
    """Rebuild dataset and persist both history and public copies."""
    payload = build_history(period=period)
    if not payload['industries']:
        raise RuntimeError('No industries generated; dataset not updated.')
    write_history(payload)
    return payload


    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Wrote dataset to {HISTORY_PATH} and {PUBLIC_PATH}")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description='Update US industry composite dataset')
    p.add_argument('--period', default=DEFAULT_PERIOD, help='Yahoo Finance range (default: 10y)')
    return p.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not UNIVERSE_PATH.exists():
        print(f"Universe file not found: {UNIVERSE_PATH}", file=sys.stderr)
        return 1
    try:
        update_dataset_once(period=args.period)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
