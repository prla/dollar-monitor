# Dollar Monitor

A single-page dashboard that answers one question in five seconds:
**"Is the dollar strong or weak, and why?"**

## Architecture

- **Frontend:** Static HTML + Tailwind CDN + vanilla JS (`frontend/`)
- **Backend:** Cloudflare Worker (`worker/`) that fetches FRED data, computes the USD score, and calls Claude for interpretation

## Setup

### Worker (Backend)

```bash
cd worker
npm install

# Set secrets
wrangler secret put FRED_API_KEY
wrangler secret put ANTHROPIC_API_KEY

# Local dev
npm run dev

# Deploy
npm run deploy
```

### Frontend

Update `API_URL` in `app.js` to point to your deployed worker, then serve `frontend/` from any static host (Cloudflare Pages, Netlify, etc.).

For local development:
```bash
cd frontend
npx serve .
```

### Secrets Required

| Secret | Source |
|--------|--------|
| `FRED_API_KEY` | [FRED API Keys](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `ANTHROPIC_API_KEY` | [Anthropic Console](https://console.anthropic.com/) |

## Data Sources

All data from FRED (Federal Reserve Bank of St. Louis):

- **DTWEXBGS** — Trade-Weighted U.S. Dollar Index
- **DGS10** — 10-Year Treasury Yield
- **T10YIE** — 10-Year Breakeven Inflation
- **SP500** — S&P 500 Index

## Score Methodology

USD Score = 40% real yield (z-scored) + 30% DXY trend + 30% inverted SPX trend

Regimes: RISK-OFF DOLLAR RALLY, YIELD-DRIVEN STRENGTH, STAGFLATION WATCH, RISK-ON WEAKNESS, NEUTRAL / MIXED
