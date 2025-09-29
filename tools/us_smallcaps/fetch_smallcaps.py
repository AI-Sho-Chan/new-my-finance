#!/usr/bin/env python3
import re
from pathlib import Path
import requests

OUT_DIR = Path('data/q1-monitor/symbols')
OUT_DIR.mkdir(parents=True, exist_ok=True)

UA = {'User-Agent':'Mozilla/5.0'}

def extract_symbols_from_wikitable(html: str) -> list[str]:
    # naive extraction: take first wikitable, read rows, first <td> text as ticker (strip footnotes)
    m = re.search(r'<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>(.*?)</table>', html, re.S|re.I)
    if not m:
        return []
    table = m.group(1)
    rows = re.findall(r'<tr>(.*?)</tr>', table, re.S|re.I)
    syms = []
    for row in rows[1:]:  # skip header
        cells = re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row, re.S|re.I)
        if not cells:
            continue
        cell0 = cells[0]
        # find first anchor text in cell0
        am = re.search(r'>\s*([A-Z\.\-]+)\s*</a>', cell0, re.I)
        if am:
            sym = am.group(1).upper().strip()
        else:
            # fallback: strip tags
            txt = re.sub('<[^<]+?>', '', cell0)
            sym = re.sub(r'[^A-Za-z0-9\.\-]', '', txt).upper()
        if sym:
            syms.append(sym)
    # de-dup and basic sanity
    out = []
    seen = set()
    for s in syms:
        if not s or len(s) > 10: continue
        if s not in seen:
            seen.add(s); out.append(s)
    return out

# S&P 600
try:
    url_sp600 = 'https://en.wikipedia.org/wiki/List_of_S%26P_600_companies'
    r = requests.get(url_sp600, headers=UA, timeout=20)
    r.raise_for_status()
    sp600_syms = extract_symbols_from_wikitable(r.text)
    if sp600_syms:
        (OUT_DIR/'us_sp600.txt').write_text('\n'.join(sp600_syms), encoding='utf-8')
        print('S&P600 symbols:', len(sp600_syms))
    else:
        print('Failed to parse S&P600 table')
except Exception as e:
    print('SP600 fetch error:', e)

# Russell 2000 (best effort from Wikipedia)
try:
    url_r2 = 'https://en.wikipedia.org/wiki/List_of_Russell_2000_companies'
    r2 = requests.get(url_r2, headers=UA, timeout=20)
    if r2.ok:
        r2000_syms = extract_symbols_from_wikitable(r2.text)
        if r2000_syms:
            (OUT_DIR/'us_russell2000.txt').write_text('\n'.join(r2000_syms), encoding='utf-8')
            print('Russell 2000 symbols:', len(r2000_syms))
        else:
            print('Russell 2000 table not found or empty')
    else:
        print('Russell 2000 page unavailable')
except Exception as e:
    print('Russell 2000 fetch error:', e)
