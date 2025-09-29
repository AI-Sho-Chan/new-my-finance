from __future__ import annotations
import json, random, re
from pathlib import Path
from typing import List

OUT_DIR = Path('data/q1-monitor/symbols')
OUT_DIR.mkdir(parents=True, exist_ok=True)

US_UNIVERSE = Path('data/us-industries/universe.json')
JP_LIST = Path('data/jp-stocks.json')

# Basic filters
US_EXCH_OK = {'NMS','NAS','NYQ','NYS','PCX'}
BAD_US_PATTERN = re.compile(r"[-\s\^/\\.|]")  # drop symbols with problematic chars
ETF_PREFIX_JP = ('13','15','16','20')  # common ETF/ETN/REIT ranges

random.seed(42)

def write_list(name: str, symbols: List[str], limit: int|None=None):
    xs = list(dict.fromkeys(s for s in symbols if isinstance(s, str) and s.strip()))
    if limit and len(xs) > limit:
        random.shuffle(xs)
        xs = xs[:limit]
    path = OUT_DIR / f"{name}.txt"
    path.write_text("\n".join(xs), encoding='utf-8')
    print(f"wrote {path} ({len(xs)} symbols)")

# US buckets from FinanceDatabase export
if US_UNIVERSE.exists():
    data = json.loads(US_UNIVERSE.read_text(encoding='utf-8'))
    comps=[]
    for ind in data.get('industries',[]) or []:
        for c in ind.get('components',[]) or []:
            comps.append(c)
    def ok_us(sym: str)->bool:
        if not sym or not isinstance(sym, str):
            return False
        if BAD_US_PATTERN.search(sym):
            return False
        return True
    eq = [c for c in comps if c.get('exchange') in US_EXCH_OK and ok_us(c.get('symbol'))]
    by_cap = {}
    for cap in ('Mega Cap','Large Cap','Mid Cap','Small Cap'):
        by_cap[cap] = [c['symbol'] for c in eq if c.get('marketCap')==cap]
    us_large_all = sorted(set(by_cap.get('Mega Cap',[]) + by_cap.get('Large Cap',[])))
    us_mid_all = sorted(set(by_cap.get('Mid Cap',[])))
    us_small_all = sorted(set(by_cap.get('Small Cap',[])))
    write_list('us_large_all', us_large_all)
    write_list('us_mid_all', us_mid_all)
    write_list('us_small_all', us_small_all)
    # subset sizes for feasible runs
    write_list('us_large_600', us_large_all, 600)
    write_list('us_mid_600', us_mid_all, 600)
    write_list('us_small_600', us_small_all, 600)
else:
    print('US universe.json missing')

# JP list
if JP_LIST.exists():
    arr = json.loads(JP_LIST.read_text(encoding='utf-8'))
    codes: List[str] = []
    for o in arr:
        code = str(o.get('code') or '').strip()
        if code.isdigit() and len(code)==4 and not code.startswith(ETF_PREFIX_JP):
            codes.append(code)
    codes = sorted(set(codes))
    jp_syms = [c+'.T' for c in codes]
    write_list('jp_stock_all', jp_syms)
    write_list('jp_stock_1000', jp_syms, 1000)
else:
    print('JP stocks json missing')
