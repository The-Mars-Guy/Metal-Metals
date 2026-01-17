"""
Optional one-time backfill of ~5 years of daily history.

Usage:
  pip install -r requirements.txt
  export METALPRICE_API_KEY="..."
  python scripts/backfill_5y.py
"""

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

OUT_DIR = Path("data")
OUT_DIR.mkdir(exist_ok=True)

SYMBOLS = ["XAU", "XAG", "XPD", "XPT", "XCU", "ALU"]
BASE = os.getenv("BASE_CURRENCY", "USD").upper()

API_KEY = os.getenv("METALPRICE_API_KEY")
if not API_KEY:
    raise SystemExit("METALPRICE_API_KEY is not set.")

def load_series(symbol: str):
    p = OUT_DIR / f"{symbol}.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception:
        pass
    return []

def save_series(symbol: str, rows):
    (OUT_DIR / f"{symbol}.json").write_text(json.dumps(rows), encoding="utf-8")

def fetch_timeframe(start_date: str, end_date: str):
    url = "https://api.metalpriceapi.com/v1/timeframe"
    params = {
        "api_key": API_KEY,
        "base": BASE,
        "currencies": ",".join(SYMBOLS),
        "start_date": start_date,
        "end_date": end_date,
    }
    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    return r.json()

def main():
    end = datetime.now(timezone.utc).date()
    start = (datetime.now(timezone.utc) - timedelta(days=365*5)).date()

    chunk = timedelta(days=365)
    cur = start

    store = {sym: {row.get("date"): row.get("value") for row in load_series(sym) if row.get("date")} for sym in SYMBOLS}

    calls = 0
    while cur < end:
        chunk_end = min(end, cur + chunk)
        s = cur.isoformat()
        e = chunk_end.isoformat()

        payload = fetch_timeframe(s, e)
        calls += 1

        rates = payload.get("rates") or payload.get("data") or {}
        if not isinstance(rates, dict):
            raise RuntimeError("Unexpected timeframe response shape.")

        for date_str, per_day in rates.items():
            if not isinstance(per_day, dict):
                continue
            for sym in SYMBOLS:
                val = per_day.get(sym)
                if val is None:
                    continue
                try:
                    store[sym][date_str] = float(val)
                except Exception:
                    continue

        print(f"Fetched {s} -> {e} (call #{calls})")
        cur = chunk_end + timedelta(days=1)

    for sym in SYMBOLS:
        rows = [{"date": d, "value": v} for d, v in store[sym].items() if d and v is not None]
        rows.sort(key=lambda x: x["date"])
        save_series(sym, rows)
        print(f"Wrote {sym}: {len(rows)} rows")

    meta = {
        "last_updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "symbols": SYMBOLS,
        "base": BASE,
        "note": f"Backfilled ~5y in {calls} timeframe API calls, then wrote series.",
    }
    (OUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print("Backfill complete.")

if __name__ == "__main__":
    main()
