import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

OUT_DIR = Path("data")
OUT_DIR.mkdir(exist_ok=True)
META_PATH = OUT_DIR / "meta.json"

SYMBOLS = ["XAU", "XAG", "XPD", "XPT", "XCU", "ALU"]
BASE = os.getenv("BASE_CURRENCY", "USD").upper()

API_KEY = os.getenv("METALPRICE_API_KEY")
if not API_KEY:
    raise SystemExit("METALPRICE_API_KEY is not set (add it as a GitHub Actions secret).")


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


def write_meta(note: str = ""):
    meta = {
        "last_updated_utc": utc_now().strftime("%Y-%m-%d %H:%M:%S"),
        "symbols": SYMBOLS,
        "base": BASE,
        "note": note,
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


def fetch_latest():
    url = "https://api.metalpriceapi.com/v1/latest"
    params = {
        "api_key": API_KEY,
        "base": BASE,
        "currencies": ",".join(SYMBOLS),
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def pick_rate(rates: dict, sym: str):
    """
    MetalpriceAPI may return either:
      - plain symbols: XAU, XAG, ...
      - pair symbols: USDXAU, USDXAG, ... (base+symbol)
      - or occasionally symbol+base (XAUUSD)
    We try in that order.
    """
    candidates = [sym, f"{BASE}{sym}", f"{sym}{BASE}"]
    for k in candidates:
        if k in rates:
            return rates[k], k
    return None, None


def main():
    force = os.getenv("FORCE_UPDATE", "0") == "1"
    meta = read_meta()

    if not force and already_updated_today(meta):
        print("Already updated today (UTC). Skipping API call.")
        return

    payload = fetch_latest()

    # If the API returns a structured error, fail loudly so you see why in Actions logs.
    if payload.get("success") is False:
        raise RuntimeError(f"MetalpriceAPI error: {payload.get('error')}")

    ts = payload.get("timestamp")
    if isinstance(ts, (int, float)):
        date_str = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    else:
        date_str = today_utc_date()

    rates = payload.get("rates") or payload.get("data") or {}
    if not isinstance(rates, dict):
        raise RuntimeError(f"Unexpected API response shape; keys present: {list(payload.keys())}")

    for sym in SYMBOLS:
        val, used_key = pick_rate(rates, sym)
        if val is None:
            print(
                f"Warning: missing {sym} in API response. "
                f"Example keys: {list(rates.keys())[:12]}"
            )
            continue

        try:
            val = float(val)
        except Exception:
            print(f"Warning: non-numeric {sym} value from key {used_key}: {val}")
            continue

        rows = load_series(sym)

        # Upsert by date (avoid duplicates)
        if rows and rows[-1].get("date") == date_str:
            rows[-1]["value"] = val
        else:
            replaced = False
            for i in range(len(rows) - 1, -1, -1):
                if rows[i].get("date") == date_str:
                    rows[i]["value"] = val
                    replaced = True
                    break
            if not replaced:
                rows.append({"date": date_str, "value": val})

        rows.sort(key=lambda x: x.get("date", ""))
        save_series(sym, rows)
        print(f"Saved {sym} @ {date_str} (from {used_key})")

    write_meta(note="Updated via cached daily job (max 1 call per UTC day).")
    print("Done.")


if __name__ == "__main__":
    main()
