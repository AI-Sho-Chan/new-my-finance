#!/usr/bin/env python3
"""Utilities for maintaining TOPIX-33 sector datasets.

Usage examples:
  # Append the latest daily snapshot from JPX real-time JSON
  python tools/topix33/update_dataset.py daily --history data/topix33/history.json \
      --public web/public/data/topix33-history.json

  # (Requires J-Quants credentials) Download historical data once
  # python tools/topix33/update_dataset.py jquants --history data/topix33/history.json \
  #     --from 2020-01-01 --to 2025-09-19

The J-Quants mode expects the following environment variables to be set:
- JQUANTS_EMAIL
- JQUANTS_PASSWORD
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time
import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import requests

HERE = Path(__file__).resolve().parent
DEFAULT_SECTOR_FILE = HERE / "sectors.json"
DEFAULT_HISTORY = Path("data/topix33/history.json")
DEFAULT_PUBLIC = Path("web/public/data/topix33-history.json")

JPX_BASE = "https://www.jpx.co.jp/market/indices"
JPX_JSON = JPX_BASE + "/indices_stock_price3.txt"
JPX_TIME = JPX_BASE + "/indices_stock_price3.time.txt"

JQUANTS_BASE = os.environ.get("JQUANTS_BASE_URL", "https://api.jpx-jquants.com/v1")

USER_AGENT = "topix33-updater/1.0"

class TokenExpiredError(RuntimeError):
    """Raised when the J-Quants API indicates the token is invalid or expired."""







def normalize_text(value: str) -> str:
    if not value:
        return ''
    return re.sub(r"[\s　・･‐‑‒–—―−－／/\-]", '', value)


def parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s == '--':
        return None
    s = s.replace(',', '')
    try:
        return float(s)
    except ValueError:
        return None


def import_topix_csv(history: Dict[str, SectorSeries], sectors: Dict[str, SectorConfig], directory: Path) -> None:
    if not directory.exists():
        raise SystemExit(f"CSV directory not found: {directory}")
    name_map = {normalize_text(cfg.name_ja): cfg.id for cfg in sectors.values()}
    processed = 0
    for csv_path in sorted(directory.glob('*.csv')):
        stem = csv_path.stem
        parts = stem.split(' - ', 1)
        name_part = parts[1] if len(parts) > 1 else stem
        name_part = re.sub(r"\s*過去データ.*$", '', name_part)
        key = normalize_text(name_part)
        sector_id = name_map.get(key)
        if not sector_id:
            print(f"[WARN] Unknown sector for file {csv_path.name}")
            continue
        record = history[sector_id]
        count = 0
        with csv_path.open(encoding='utf-8-sig', newline='') as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                continue
            header_map = {normalize_text(h): h for h in reader.fieldnames}
            def pick_header(*names: str) -> str | None:
                for name in names:
                    key = header_map.get(normalize_text(name))
                    if key:
                        return key
                return None
            date_key = pick_header('日付', '日付け', 'DATE', 'Date', 'date')
            close_key = pick_header('終値', '終値（円）', '終値 (円)', 'CLOSE', 'Close', 'close')
            if not date_key or not close_key:
                print(f"[WARN] Missing columns in {csv_path.name}")
                continue
            for row in reader:
                date = (row.get(date_key) or '').strip()
                close = parse_float(row.get(close_key))
                if not date or close is None:
                    continue
                record.upsert(date, close, 'csv')
                count += 1
        print(f"[CSV] {csv_path.name}: imported {count} rows into {sector_id}")
        processed += 1
    if processed == 0:
        print(f"[WARN] No CSV files processed in {directory}")


@dataclass
class SectorConfig:
    id: str
    name_ja: str
    name_en: str
    qcode: str
    jquants_code: Optional[str] = None

    @staticmethod
    def from_dict(data: Dict[str, str]) -> "SectorConfig":
        return SectorConfig(
            id=data["id"],
            name_ja=data["nameJa"],
            name_en=data.get("nameEn", data["id"]),
            qcode=str(data["qcode"]),
            jquants_code=str(data.get("jquants_code") or data.get("jquantsCode") or data["qcode"]),
        )


@dataclass
class SectorSeries:
    metadata: SectorConfig
    series: List[Dict[str, float]] = field(default_factory=list)

    def upsert(self, date: str, value: float, source: str) -> None:
        existing = next((item for item in self.series if item["date"] == date), None)
        if existing:
            existing["close"] = value
            existing["source"] = source
        else:
            self.series.append({"date": date, "close": value, "source": source})
            self.series.sort(key=lambda x: x["date"])

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.metadata.id,
            "nameJa": self.metadata.name_ja,
            "nameEn": self.metadata.name_en,
            "qcode": self.metadata.qcode,
            "jquantsCode": self.metadata.jquants_code,
            "series": self.series,
        }


def load_sectors(path: Path) -> Dict[str, SectorConfig]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    sectors = {}
    for entry in data:
        cfg = SectorConfig.from_dict(entry)
        sectors[cfg.id] = cfg
    return sectors


def load_history(path: Path, sectors: Dict[str, SectorConfig]) -> Dict[str, SectorSeries]:
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8-sig"))
        items = raw.get("sectors")
        if isinstance(items, dict):
            iterable = items.values()
        else:
            iterable = items or []
    else:
        iterable = []

    history: Dict[str, SectorSeries] = {}
    for cfg in sectors.values():
        history[cfg.id] = SectorSeries(metadata=cfg)

    for entry in iterable:
        sid = entry.get("id")
        cfg = sectors.get(sid)
        if not cfg:
            continue
        series = entry.get("series", [])
        record = history[sid]
        for item in series:
            try:
                date = item["date"]
                close = float(item["close"])
            except (KeyError, TypeError, ValueError):
                continue
            record.upsert(date, close, item.get("source", "import"))
    return history


def save_history(path: Path, history: Dict[str, SectorSeries]) -> None:
    data = {"sectors": [value.to_dict() for value in history.values()]}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_to_public(history_path: Path, public_path: Path) -> None:
    if not public_path:
        return
    public_path.parent.mkdir(parents=True, exist_ok=True)
    public_path.write_text(history_path.read_text(encoding="utf-8-sig"), encoding="utf-8")


# ---------------------------------------------------------------------------
# JPX daily updater
# ---------------------------------------------------------------------------


def fetch_jpx_daily() -> tuple[dt.date, Dict[str, Dict[str, str]]]:
    """Return date and IndustryType payload from JPX real-time JSON."""
    session = requests.Session()
    time_resp = session.get(JPX_TIME, timeout=30)
    time_resp.raise_for_status()
    stamp = time_resp.text.strip()
    try:
        as_date = dt.datetime.strptime(stamp, "%Y%m%d%H%M")
    except ValueError:
        # fallback: treat as date only
        as_date = dt.datetime.strptime(stamp[:8], "%Y%m%d")
    json_resp = session.get(JPX_JSON, timeout=30)
    json_resp.raise_for_status()
    payload = json_resp.json()
    return as_date.date(), payload["IndustryType"]


def update_from_jpx(history: Dict[str, SectorSeries]) -> None:
    date, industry_payload = fetch_jpx_daily()
    for sector_id, record in history.items():
        node = industry_payload.get(sector_id)
        if not node:
            continue
        price = node.get("currentPrice")
        if price in (None, "--", ""):
            continue
        value = float(str(price).replace(",", ""))
        record.upsert(date.isoformat(), value, "jpx")


# ---------------------------------------------------------------------------
# J-Quants historical fetcher
# ---------------------------------------------------------------------------


def make_jquants_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    return session


def call_jquants(
    session: requests.Session,
    method: str,
    path: str,
    *,
    token: Optional[str] = None,
    retries: int = 5,
    backoff: float = 1.5,
    **kwargs,
) -> requests.Response:
    url = f"{JQUANTS_BASE.rstrip('/')}/{path.lstrip('/')}"
    headers = kwargs.pop('headers', {}) or {}
    if token:
        headers = {**headers, 'Authorization': f'Bearer {token}'}
    headers.setdefault('User-Agent', USER_AGENT)

    last_error: Optional[Exception] = None
    for attempt in range(retries):
        resp = session.request(method, url, headers=headers, timeout=30, **kwargs)
        if resp.status_code in (401, 403):
            resp.close()
            raise TokenExpiredError(f"{resp.status_code} {resp.text[:200]}")
        if resp.status_code == 429:
            wait = min(backoff * (2 ** attempt), 60.0)
            time.sleep(wait)
            last_error = None
            continue
        if 500 <= resp.status_code < 600:
            last_error = requests.HTTPError(f"{resp.status_code} {resp.text[:200]}", response=resp)
            resp.close()
            time.sleep(min(backoff * (2 ** attempt), 60.0))
            continue
        resp.raise_for_status()
        limit = resp.headers.get('X-RateLimit-Limit')
        remaining = resp.headers.get('X-RateLimit-Remaining')
        if remaining is not None:
            print(f"[J-Quants] rate-limit remaining {remaining}/{limit or '?'} for {path}")
        return resp

    if last_error:
        raise last_error
    raise RuntimeError(f"Failed to call {url} after {retries} attempts")


def request_refresh_token(session: requests.Session, email: str, password: str) -> str:
    resp = call_jquants(
        session,
        'POST',
        '/token/auth_user',
        json={'mailaddress': email, 'password': password},
        retries=3,
    )
    data = resp.json()
    token = data.get('refreshToken') or data.get('refresh_token')
    if not token:
        raise RuntimeError(f"refreshToken was not returned. Response: {data}")
    return token


def request_id_token(session: requests.Session, refresh_token: str) -> str:
    attempts = [
        {'json': {'refreshToken': refresh_token}},
        {'params': {'refresh_token': refresh_token}},
        {'params': {'refreshtoken': refresh_token}},
    ]
    for payload in attempts:
        try:
            resp = call_jquants(session, 'POST', '/token/auth_refresh', retries=3, **payload)
        except (requests.HTTPError, TokenExpiredError):
            continue
        data = resp.json()
        token = data.get('idToken') or data.get('id_token')
        if token:
            return token
    raise RuntimeError('Unable to obtain idToken. Please verify credentials and J-Quants API status.')


def fetch_jquants_history(
    session: requests.Session,
    token: str,
    code: str,
    date_from: str,
    date_to: str,
) -> List[Dict[str, str]]:
    params = {'code': code, 'from': date_from, 'to': date_to}
    resp = call_jquants(session, 'GET', '/indices/daily_quotes', token=token, params=params, retries=5)
    data = resp.json()
    quotes = data.get('daily_quotes') or data.get('index_daily_quotes') or []
    if not isinstance(quotes, list):
        raise RuntimeError(f"Unexpected response for code {code}: {data}")
    return quotes


def update_from_jquants(
    history: Dict[str, SectorSeries],
    sectors: Dict[str, SectorConfig],
    args: argparse.Namespace,
) -> None:
    email = os.environ.get('JQUANTS_EMAIL')
    password = os.environ.get('JQUANTS_PASSWORD')
    if not email or not password:
        raise SystemExit('JQUANTS_EMAIL and JQUANTS_PASSWORD must be set in the environment.')

    session = make_jquants_session()
    refresh_token = request_refresh_token(session, email, password)
    id_token = request_id_token(session, refresh_token)

    date_from = args.date_from.replace('-', '')
    date_to = args.date_to.replace('-', '') if args.date_to else dt.date.today().strftime('%Y%m%d')

    for sector_id, record in history.items():
        cfg = sectors[sector_id]
        code = cfg.jquants_code or cfg.qcode
        attempts = 0
        while True:
            try:
                quotes = fetch_jquants_history(session, id_token, code, date_from, date_to)
                break
            except TokenExpiredError:
                attempts += 1
                if attempts > 2:
                    print(f"[WARN] Token refresh failed repeatedly for {sector_id} ({code})", file=sys.stderr)
                    quotes = []
                    break
                id_token = request_id_token(session, refresh_token)
                continue
            except Exception as exc:  # pragma: no cover - network interaction
                print(f"[WARN] Failed to fetch {sector_id} ({code}): {exc}", file=sys.stderr)
                quotes = []
                break
        for quote in quotes:
            date = quote.get('Date') or quote.get('date')
            close = quote.get('Close') or quote.get('end_price') or quote.get('ClosePrice')
            if not date or close in (None, '--', ''):
                continue
            try:
                value = float(str(close))
            except ValueError:
                continue
            record.upsert(date, value, 'jquants')


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TOPIX-33 dataset updater")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--history", type=Path, default=DEFAULT_HISTORY, help="Path to history dataset JSON")
    common.add_argument("--public", type=Path, default=DEFAULT_PUBLIC, help="Optional path copied for front-end consumption")
    common.add_argument("--sectors", type=Path, default=DEFAULT_SECTOR_FILE, help="Sector configuration JSON")

    daily = sub.add_parser("daily", parents=[common], help="Append the latest values from JPX real-time JSON")

    hist = sub.add_parser("jquants", parents=[common], help="Bootstrap or refresh history via J-Quants API")
    hist.add_argument("--date-from", required=True, help="Start date YYYY-MM-DD")
    hist.add_argument("--date-to", help="End date YYYY-MM-DD (defaults to today)")

    csv_cmd = sub.add_parser("csv", parents=[common], help="Import history from CSV files")
    csv_cmd.add_argument("--csv-dir", type=Path, default=Path('data/Topix'), help="Directory containing sector CSV files")

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    sectors = load_sectors(args.sectors)
    history = load_history(args.history, sectors)

    if args.command == "daily":
        update_from_jpx(history)
    elif args.command == "jquants":
        update_from_jquants(history, sectors, args)
    elif args.command == "csv":
        import_topix_csv(history, sectors, args.csv_dir)
    else:  # pragma: no cover
        parser.error("Unknown command")

    save_history(args.history, history)
    if args.public:
        copy_to_public(args.history, args.public)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())




