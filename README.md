# Metals Dashboard (GitHub Pages)

Static site that charts daily metals prices (Gold, Silver, Palladium, Platinum, Copper, Aluminum)
and updates **once per day** via GitHub Actions. Visitors never call the API.

## Setup

1) Upload this folder to a GitHub repo.
2) Add a repo secret:
   - Settings → Secrets and variables → Actions → New repository secret
   - Name: `METALPRICE_API_KEY`
   - Value: your MetalpriceAPI key
3) Enable GitHub Pages:
   - Settings → Pages → Deploy from a branch
   - Branch: `main` and Folder: `/ (root)`

## API key protection / caching

`scripts/update_latest.py` will **skip** calling the API if it already updated **today (UTC)**.
So even if you run the workflow many times, it will call the API at most **once per UTC day**,
unless you force it with `FORCE_UPDATE=1`.

## Optional: backfill 5 years of history

If you want the 5y chart filled immediately, run locally once:

```bash
pip install -r requirements.txt
export METALPRICE_API_KEY="..."
python scripts/backfill_5y.py
```

Backfill uses multiple API calls due to timeframe limits. After that, daily updates are a single API call/day total.
