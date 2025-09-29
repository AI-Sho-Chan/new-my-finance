#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
from datetime import date
from collections import defaultdict

OUT_DIR = Path('data/q1-monitor/orders')
STATE_PATH = Path('data/q1-monitor/state.json')


def load_state(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def latest_trade_dates(events: list[dict]) -> dict[str, str]:
    latest: dict[str, str] = {}
    for e in events:
        if not isinstance(e, dict):
            continue
        if e.get('type') != 'ENTER':
            continue
        mkt = e.get('market') or 'UNKNOWN'
        td = e.get('tradeDate') or e.get('trade_date')
        if not td:
            continue
        if mkt not in latest or latest[mkt] < td:
            latest[mkt] = td
    return latest


def collect_orders(state: dict) -> dict[str, list[dict]]:
    events = state.get('history') or []
    dates = latest_trade_dates(events)
    per_mkt: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        if not isinstance(e, dict) or e.get('type') != 'ENTER':
            continue
        mkt = e.get('market') or 'UNKNOWN'
        td = e.get('tradeDate') or e.get('trade_date')
        if dates.get(mkt) != td:
            continue
        per_mkt[mkt].append({
            'symbol': e.get('symbol'),
            'name': e.get('name'),
            'market': mkt,
            'tradeDate': td,
            'side': 'BUY',
            'entry': 'NEXT_OPEN',
            'horizonDays': 120,
        })
    return per_mkt


def main() -> None:
    if not STATE_PATH.exists():
        raise SystemExit(f'state not found: {STATE_PATH}')
    state = load_state(STATE_PATH)
    orders = collect_orders(state)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    for mkt, rows in orders.items():
        if not rows:
            continue
        fn = OUT_DIR / f'{today}_orders_{mkt}.csv'
        # simple CSV writer
        headers = ['symbol','name','market','tradeDate','side','entry','horizonDays']
        lines = [','.join(headers)]
        for r in rows:
            vals = [str(r.get(h,'') or '') for h in headers]
            # escape commas in name if any
            vals = [f'"{v}"' if (',' in v and h=='name') else v for v,h in zip(vals, headers)]
            lines.append(','.join(vals))
        fn.write_text('\n'.join(lines), encoding='utf-8')
        print(f'Wrote {fn} ({len(rows)} orders)')


if __name__ == '__main__':
    main()

