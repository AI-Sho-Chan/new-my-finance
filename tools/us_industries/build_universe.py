#!/usr/bin/env python3
"""Build US industry universe metadata using FinanceDatabase."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Tuple

import financedatabase as fd
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / 'data' / 'us-industries'
OUTPUT_PATH = DATA_DIR / 'universe.json'
MAX_COMPONENTS = 5

MARKET_CAP_ORDER = {
    'mega cap': 0,
    'large cap': 1,
    'mid cap': 2,
    'small cap': 3,
    'micro cap': 4,
}

PREFERRED_EXCHANGES = {
    'nyse', 'nasdaq', 'nasdaqgs', 'nasdaqgm', 'nasdaqcm', 'nysearca', 'nyse arca',
    'amex', 'nyse american'
}


def normalize_exchange(value: str | float | None) -> str:
    if not isinstance(value, str):
        return ''
    return value.strip().lower()


def component_sort_key(item: Tuple[str, pd.Series]) -> tuple[int, int, str]:
    symbol, row = item
    cap_rank = MARKET_CAP_ORDER.get(str(row.get('market_cap') or '').strip().lower(), 5)
    exch = normalize_exchange(row.get('exchange'))
    exch_rank = 0 if exch in PREFERRED_EXCHANGES else 1
    return (cap_rank, exch_rank, symbol)


def slugify(label: str) -> str:
    cleaned = re.sub(r'[^A-Za-z0-9]+', ' ', label).title().replace(' ', '')
    return cleaned or 'Industry'


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    equities = fd.Equities()
    df = equities.select(country='United States', only_primary_listing=True)
    df = df[df['currency'].str.upper() == 'USD']
    df = df.dropna(subset=['sector', 'industry_group', 'industry'])
    df = df[df['market_cap'].notna()]

    grouped = df.groupby('industry')
    collisions: defaultdict[str, int] = defaultdict(int)
    entries: list[dict] = []

    for industry, group in sorted(grouped, key=lambda kv: kv[0] or ''):
        if not industry:
            continue
        sector = group['sector'].iloc[0]
        industry_group = group['industry_group'].iloc[0]

        rows: Iterable[Tuple[str, pd.Series]] = group.iterrows()
        sorted_rows = sorted(rows, key=component_sort_key)

        components: list[dict] = []
        seen_companies: set[str] = set()
        for symbol, row in sorted_rows:
            if not isinstance(symbol, str):
                continue
            symbol = symbol.strip()
            if not symbol:
                continue
            company_name = (str(row.get('name') or '').strip().lower()) or symbol.lower()
            if company_name in seen_companies:
                continue
            seen_companies.add(company_name)
            components.append({
                'symbol': symbol,
                'name': str(row.get('name') or symbol),
                'marketCap': str(row.get('market_cap') or ''),
                'exchange': str(row.get('exchange') or ''),
            })
            if len(components) >= MAX_COMPONENTS:
                break

        if not components:
            continue

        base_id = slugify(industry)
        collisions[base_id] += 1
        final_id = base_id if collisions[base_id] == 1 else f"{base_id}{collisions[base_id]}"

        entries.append({
            'id': final_id,
            'sector': sector,
            'industryGroup': industry_group,
            'industry': industry,
            'components': components,
        })

    entries.sort(key=lambda item: (item['sector'], item['industry']))

    payload = {
        'generatedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'FinanceDatabase 2.3.1',
        'maxComponents': MAX_COMPONENTS,
        'industries': entries,
        'notes': (
            'Components selected from FinanceDatabase US equities universe (primary listings, USD currency). '
            'Prioritized by market cap classification and exchange preference.'
        ),
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f"Wrote {len(entries)} industries to {OUTPUT_PATH}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
