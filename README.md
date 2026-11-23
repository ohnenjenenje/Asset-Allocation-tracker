<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/328b3c1b-fe51-473d-8aab-a5d08c941ff2

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Market data sources

Live quotes are fetched by `lib/market/quotes.ts` and attached to the price API
in `app/api/price/route.ts`:

| Asset class | Primary | Fallback |
|---|---|---|
| Indian equities | Groww public endpoint | Moneycontrol, then Yahoo/Sheets |
| US stocks & ETFs | StockAnalysis | Nasdaq, then Yahoo |
| Crypto | CoinGecko | Coinbase |
| Mutual funds | MFAPI | Yahoo |
| Gold / silver | Gold API | Yahoo futures |
| USD/INR | Frankfurter (ECB) | open.er-api, jsDelivr |
| Bonds | BSE India | cached last good quote |

Indian market-cap buckets come from the official NSE/Nifty Indices constituent
lists, with a committed snapshot in `lib/market/nseCapFallback.ts`.

### Unofficial providers

Groww and Moneycontrol are **public website endpoints, not licensed APIs**.
They require no account or API key, but they can be delayed, blocked, or
changed without notice, and their use may be subject to the providers' terms.
They are enabled by default for personal use.

Set `ALLOW_UNOFFICIAL_QUOTES=false` before sharing a deployment publicly.
Indian quotes will then use Yahoo Finance and the Google Sheets cache.

### Price API protection

`/api/price` is rate-limited per IP and caps each request at 250 symbols so the
deployment cannot be used as an open quote proxy. Tune with
`PRICE_API_RATE_LIMIT`, `PRICE_API_SYNC_RATE_LIMIT`, and
`PRICE_API_MAX_SYMBOLS` (see `.env.example`).
