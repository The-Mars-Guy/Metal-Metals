# Metals Dashboard (GitHub Pages)

A static website (hosted on **GitHub Pages**) that charts daily metal prices and lets you compare:

- Copper (XCU)
- Gold (XAU)
- Silver (XAG)
- Aluminum (ALU)
- Palladium (XPD)
- Platinum (XPT)

It supports these ranges: **5y, 1y, YTD, 6m, 3m, 1m, 1w, 3d, 1d**, plus toggles for **log scale** and **normalize (start=100)**.

Data is fetched once per day from **MetalpriceAPI** using GitHub Actions and committed into `data/series.json`.

## Setup

1. Create a GitHub repo and upload this folder contents.
2. Add a repo secret:
   - **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `METALPRICE_API_KEY`
   - Value: your MetalpriceAPI key
3. Enable GitHub Pages:
   - **Settings → Pages → Deploy from a branch**
   - Branch: `main`, Folder: `/ (root)`

The workflow will run daily at 03:15 UTC (and you can also run it manually via *Actions*).

## Optional: Backfill up to 5 years

MetalpriceAPI timeframe requests are typically limited to about 365 days per request, so the backfill script fetches history in chunks.

Run locally (recommended):

```bash
npm i # not required, but ok
METALPRICE_API_KEY=... node scripts/backfill_5y.js
```

Commit and push the updated `data/series.json`.

## Files

- `index.html`, `styles.css`, `app.js`: static site
- `data/series.json`: time series used by the chart (updated daily)
- `.github/workflows/update-data.yml`: daily GitHub Actions updater
- `scripts/update_daily.js`: fetches latest prices and appends a new row
- `scripts/backfill_5y.js`: optional history backfill

## Notes

- Different metals have different units/quoting conventions. For visual comparison, keep **Normalize** on.
- If you want to change metals, edit:
  - `METALPRICE_METALS` in the workflow
  - `METALS` list in `app.js`
