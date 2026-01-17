import csv
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

OUT_DIR = Path("data")
OUT_DIR.mkdir(exist_ok=True)
META_PATH = OUT_DIR / "meta.json"

# What your website expects (files: data/XAU.json, data/XCU.json, etc.)
ALL_SERIES = ["XAU", "XAG", "XPD", "XPT", "XCU", "ALU"]

# MetalpriceAPI free-plan metals
METALPRICE_SYMBOLS = ["XAU", "XAG", "XPD", "XPT"]
BASE = os.getenv("BASE_CURRENCY", "USD").upper()
API_KEY = os.getenv("METALPRICE_API_KEY")  # required for MetalpriceAPI

# Free daily CSV source for copper/aluminum (futures proxy)
STOOQ_MAP = {
    "XCU": "HG.F",  # Copper (COMEX)
    "ALU": "AL.F",  # Aluminum
}

def utc_now():
    return datetime.now(timezone.utc)

def today_utc_date():
    return utc_now().strftime("%Y-%m-%d")

def read_meta():
    if not META_PATH.exists():
        return {}
    try:
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}

def already_updated_today(meta: dict) -> bool:
    last = meta.get("last_updated_utc", "")
    return isinstance(last, str) and last.startswith(today_utc_date())

def write_meta(note: str = "", sources: dict | None = None):
    meta = {
        "last_updated_utc": utc_now().strftime("%Y-%m-%d %H:%M:%S"),
        "symbols": ALL_SERIES,
        "base": BASE,
        "note": note,
        "sources": sources or {},
    }
    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")

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

def upsert_point(symbol: str, date_str: str, value: float):
    rows = load_series(symbol)

    # Upsert by date (avoid duplicates)
    if rows and rows[-1].get("date") == date_str:
        rows[-1]["value"] = value
    else:
        replaced = False
        for i in range(len(rows) - 1, -1, -1):
            if rows[i].get("date") == date_str:
                rows[i]["value"] = value
                replaced = True
                break
        if not replaced:
            rows.append({"date": date_str, "value": value})

    rows.sort(key=lambda x: x.get("date", ""))
    save_series(symbol, rows)

def fetch_metalprice_latest():
    if not API_KEY:
        raise SystemExit("METALPRICE_API_KEY is not set (add it as a GitHub Actions secret).")

    url = "https://api.metalpriceapi.com/v1/latest"
    params = {
        "api_key": API_KEY,
        "base": BASE,
        "currencies": ",".join(METALPRICE_SYMBOLS),
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    payload = r.json()

    if payload.get("success") is False:
        raise RuntimeError(f"MetalpriceAPI error: {payload.get('error')}")

    rates = payload.get("rates") or payload.get("data") or {}
    if not isinstance(rates, dict):
        raise RuntimeError(f"Unexpected MetalpriceAPI response shape; keys: {list(payload.keys())}")

    ts = payload.get("timestamp")
    if isinstance(ts, (int, float)):
        date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    else:
        date_str = today_utc_date()

    def pick_rate(sym: str):
        # Try plain and pair-style keys
        candidates = [sym, f"{BASE}{sym}", f"{sym}{BASE}"]
        for k in candidates:
            if k in rates:
                return float(rates[k]), k
        return None, None

    results = {}
    for sym in METALPRICE_SYMBOLS:
        val, used_key = pick_rate(sym)
        if val is None:
            print(f"Warning: missing {sym} in MetalpriceAPI response. Sample keys: {list(rates.keys())[:12]}")
            continue
        results[sym] = {"value": val, "key": used_key}

    return date_str, results

def stooq_csv_url(symbol: str) -> str:
    # Daily OHLC CSV (ascending by date)
    return f"https://stooq.com/q/d/l/?s={symbol.lower()}&i=d"

def fetch_stooq_daily_close(stooq_symbol: str):
    url = stooq_csv_url(stooq_symbol)
    r = requests.get(url, timeout=45)
    r.raise_for_status()

    text = r.text.strip()
    lines = text.splitlines()
    if not lines or not lines[0].startswith("Date,"):
        raise RuntimeError(f"Unexpected Stooq CSV header for {stooq_symbol}")

    reader = csv.DictReader(lines)
    last = None
    for row in reader:
        last = row

    if not last:
        raise RuntimeError(f"No rows returned from Stooq for {stooq_symbol}")

    date_str = last["Date"]
    close_str = last.get("Close")
    if close_str is None:
        raise RuntimeError(f"Missing Close column in Stooq for {stooq_symbol}")

    return date_str, float(close_str)

def main():
    force = os.getenv("FORCE_UPDATE", "0") == "1"
    meta = read_meta()

    if not force and already_updated_today(meta):
        print("Already updated today (UTC). Skipping API call.")
        return

    sources_used = {}

    # 1) Precious metals from MetalpriceAPI (single API call)
    mp_date, mp_vals = fetch_metalprice_latest()
    for sym, info in mp_vals.items():
        upsert_point(sym, mp_date, info["value"])
        print(f"Saved {sym} @ {mp_date} (MetalpriceAPI key={info['key']})")
    sources_used["MetalpriceAPI"] = {"symbols": METALPRICE_SYMBOLS, "date": mp_date}

    # 2) Copper + Aluminum from Stooq (two HTTP downloads)
    # Stooq date may differ by exchange calendar; we store their own date.
    for sym, stooq_sym in STOOQ_MAP.items():
        s_date, close_val = fetch_stooq_daily_close(stooq_sym)
        upsert_point(sym, s_date, close_val)
        print(f"Saved {sym} @ {s_date} (Stooq ticker={stooq_sym})")
    sources_used["Stooq"] = {"symbols": list(STOOQ_MAP.items())}

    write_meta(
        note="Daily update: MetalpriceAPI (XAU/XAG/XPD/XPT) + Stooq futures closes (XCU/ALU). Cached max 1 run/day UTC.",
        sources=sources_used,
    )
    print("Done.")

if __name__ == "__main__":
    main()
