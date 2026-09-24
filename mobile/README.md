# Asset Allocation Tracker — Mobile App

Expo (React Native) Android app — **Expo SDK 57 · React Native 0.86 · React 19.2**, New Architecture enabled. **Design language:** "Midnight Ledger" (dark `#0B1220`, teal `#2DD4BF`).

## Architecture

```
mobile/
├── app/                    # expo-router routes
│   ├── _layout.tsx         # providers: Auth → Portfolio → Dashboard
│   ├── login.tsx           # email/password (+ optional Google via CLIENT_ID)
│   ├── chat.tsx            # AI assistant (modal)
│   ├── index.tsx           # redirect → (tabs)/overview
│   └── (tabs)/
│       ├── _layout.tsx     # 5-tab bottom nav
│       ├── overview.tsx    # hero value, P&L, allocation donut
│       ├── holdings.tsx    # asset list (grouped, swipeable edit/delete), FAB → AddAssetSheet
│       ├── rebalance.tsx   # current-vs-ideal analysis tree + ideal allocation editor
│       ├── insights.tsx    # market-cap, sector, fund allocation, stacked sector-by-cap, top underlying
│       └── more.tsx        # crypto sync, AI settings, search source, backup/restore, logout
├── components/             # Card, StatCard, AllocationDonut, ScreenHeader, AddAssetSheet
├── hooks/                  # useAuth, usePortfolioData, usePrices, usePortfolioCalculations,
│                           # useCryptoSync, useDashboardData, useAssetForm, useAiChat
├── lib/                    # ported from web: types, portfolio-utils, tax-utils, constants,
│                           # allocationMigrations, ai/*, repositories/portfolioRepository
│                           # + mobile-specific: config, api, firebase, cryptoExchanges, format
└── assets/                 # generated icon / adaptive-icon / splash
```

## Data flow

- **Backend:** Next.js API on Render (`EXPO_PUBLIC_API_URL`) for prices, holdings, search, AI, Mongo sync.
- **Crypto:** Binance/CoinDCX are called **directly from the device** (`lib/cryptoExchanges.ts`)
  using keys from `expo-secure-store` (More tab) — bypasses Render's geo-blocking.
- **Sync:** Firestore as primary portfolio store + Mongo backup via `/api/sync` (same as web).

## Setup

```bash
cd mobile
npm install
cp .env.example .env   # fill Firebase config + API URL
npx expo start
```

Optional: set `EXPO_PUBLIC_GOOGLE_CLIENT_ID` for Google sign-in.

## Build APK

```bash
npx eas-cli login
npx eas build -p android --profile preview   # produces .apk (signed with local keystore)
```

The app is signed with the local keystore in `android-keystores/` (see `credentials.json` +
`eas.json: credentialsSource: "local"`). Keystore secrets are gitignored — **back up
`android-keystores/asset-tracker.keystore` somewhere safe; losing it means you can't update
the app on Play Store / re-sign later.**

### Signing fingerprints (for Google Cloud Android OAuth client)
- Package: `com.assetallocation.tracker`
- SHA-1: `16:10:88:54:17:41:61:F5:F0:7C:DE:2A:C9:92:54:D4:78:24:45:4F`
- SHA-256: `BE:AE:DF:EA:CA:56:03:04:D0:F4:C7:EC:C5:AF:15:46:03:58:8D:19:1B:F3:4C:CA:81:E6:B0:4D:5E:AA:F2:95`

### Google sign-in (optional)
1. Google Cloud Console → project `liquid-muse-491818-a9` → Credentials
2. Create **Android** OAuth client: package `com.assetallocation.tracker`, SHA-1 above
3. Create **Web** OAuth client, put it in `.env` as `EXPO_PUBLIC_GOOGLE_CLIENT_ID`

Note: Render free tier cold-starts (~30–60 s). All API calls use a 60 s timeout and the
price fetcher retries with backoff (visible "Updating prices x/y" progress in the header).
