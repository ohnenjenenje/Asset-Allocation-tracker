# Asset Tracker — Mobile

A production-shaped Expo / React Native client for the Asset Tracker portfolio
backend. It mirrors the web app's design language (zinc surfaces, blue accent,
8-point spacing, tabular numerals) and works in Expo Go with no custom native
code.

## Stack

| Concern | Choice |
| --- | --- |
| Runtime | Expo SDK 57 · React Native 0.86 · React 19 |
| Navigation | Expo Router (typed file-based routes) |
| Server state | TanStack Query v5 (retries, caching, foreground refetch) |
| Auth | Firebase JS SDK + AsyncStorage persistence |
| Charts | `react-native-svg` donut and stacked bars |
| Validation | Zod at the form and API boundary |
| Styling | Typed design tokens + `StyleSheet` |

## Getting started

```bash
cd mobile
npm install
npx expo start --lan --go --port 8081
```

Scan the QR code with Expo Go on the same network.

### Configuration

All configuration is optional — the app defaults to the deployed Render backend
at `https://portfolio-tracker-hjvx.onrender.com`. Create `mobile/.env` to
override:

```bash
# Local Next.js backend (Termux on the same phone as Expo Go)
# EXPO_PUBLIC_API_URL=http://127.0.0.1:3000
# Optional Firebase overrides (public client config only)
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
EXPO_PUBLIC_FIREBASE_PROJECT_ID=...
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
# Force the offline demo dataset
EXPO_PUBLIC_FORCE_DEMO=1
```

Use your machine's LAN address when the backend runs elsewhere. Never put
secrets in `EXPO_PUBLIC_*` variables — they are inlined into the bundle.

### Startup performance

The last successful portfolio response is persisted in AsyncStorage, so a cold
launch renders the previous dashboard immediately and refreshes in the
background. The first launch after installing (or clearing app storage) still
needs the network; the dashboard explains the wait after six seconds.

The deployed Render service uses the free plan, which sleeps after roughly 15
minutes without traffic. Waking it can take tens of seconds. Keep the service
warm with an uptime monitor or move it to a paid instance if first-load latency
matters. The app's snapshot request allows 45 seconds for that wake-up.

### Tests

```bash
cd mobile
npm test
```

The planner suite (`src/features/portfolio/__tests__/rebalance.test.ts`) covers
contribution-first ordering, the no-action and no-targets states, optional
trims, reinvested trim proceeds, the cash reserve floor, and unmanaged value
outside policy. The SIP suite
(`src/features/portfolio/__tests__/sip.test.ts`) covers nested holding mapping,
dominant-sleeve dedupe, proportional splits, exclusions and unassigned money,
and sleeves with no holdings. The tests use the real policy evaluation so the
planner runs against the same types as the app.

## Architecture

```
app/                      routes only
  (tabs)/                 Allocation (home) · Holdings · Insights · Research · Settings
  screener.tsx            stock screener (opened from Research)
  policy.tsx              sleeve targets, bands and review cadence (modal)
  rebalance.tsx           contribution-first rebalance planner
  asset/new.tsx           add holding (modal)
  asset/[id]/             detail + edit (modal)
  assistant.tsx           read-only AI chat + model picker (modal)
  ai-keys.tsx             multi-provider key manager (modal)
  login.tsx               email/password, Google + demo entry
src/
  components/ui/          design-system primitives
  components/charts/      SVG visualisations
  components/portfolio/   composed portfolio widgets
  components/portfolio/insights/  exposure, fund, matrix and drift panels
  features/assistant/     chat loop, model picker + portfolio tool executors
  features/auth/          Firebase + session provider
  features/portfolio/     types, API, queries, aggregation, form, analytics
  lib/api/                typed fetch client with timeouts
  lib/config/             Zod-validated environment
  lib/format/             paise-safe money formatting
  lib/query/              QueryClient + AppState focus wiring
  lib/theme/              tokens + persisted light/dark/system theme
```

### Data model

The backend stores prices in rupees. The client converts to **integer paise**
at the API boundary and performs all portfolio math in paise, formatting only
at render time. This avoids floating-point drift in P&L and allocation values.

### Portfolio analytics

The **Insights** tab ports the web app's look-through engine
(`src/features/portfolio/analytics.ts`) to pure functions:

- market-cap exposure split into direct holdings and fund/ETF look-through
  (≥ $10B large, ≥ $2B mid, otherwise small);
- sector allocation and sector × market-cap matrices;
- per-scheme mutual fund / ETF allocation with disclosed asset allocation,
  sector weights and underlying holdings.

The **Allocation** tab is the app's home. It leads with allocation health,
drift and add/trim guidance, then shows portfolio value and P&L, the
current-vs-target donut and the full allocation tree, using the saved ideal
allocation or the default 60/20/5/5/10 policy.

Fund data cached on the user snapshot is used first. Missing schemes are fetched
lazily from `/api/holdings` and cached in TanStack Query for a day. The bundled
demo portfolio ships with sample scheme holdings so every chart renders offline.

### Rebalance planner

**Allocation health → Next** and **Drift & rebalance → Build rebalance plan**
open `/rebalance`. The planner is contribution-first:

1. New money is sized against the **post-contribution** portfolio and funds the
   largest underweight gap first, until the contribution runs out or every
   sleeve reaches target. Leftover money is invested by target weight.
2. Trims are off by default. When enabled, they only activate if new money alone
   leaves a sleeve outside its band. Every above-target sleeve is then sold back
   to target and the proceeds fund the remaining gaps. Cash is never trimmed
   below the policy's `minCashPct` reserve floor; any cash held above target to
   respect that floor is called out in the plan.
3. Targets and drift are measured against the **whole portfolio**, including
   holdings without a policy sleeve. That value appears as an outside-policy gap
   the plan cannot close, keeping the projection consistent with the health card.

At ₹0 contribution with trims off, the screen is a diagnosis: it shows whether
action is needed, the size of the underweight and overweight gaps, and what new
money would do. Any amount can be simulated with presets, and the projection
card shows current versus after-trade weights, drift and band status per sleeve.

#### SIP auto-fill

When a contribution is entered, **SIP auto-fill** turns the sleeve plan into a
per-holding split. Each funded sleeve gets its planned rupee amount, then
divides that amount across the sleeve's current holdings in proportion to their
value, preserving today's composition by default. Every row shows both the
rupee amount and its share of the money entered. Tap a holding to exclude it;
the sleeve amount is redistributed across the remaining selected holdings. If
no holding is selected, or a funded sleeve has no existing holding, the amount
stays visible as unassigned instead of silently moving elsewhere.

Trim proceeds are deliberately excluded from this section: they are internal
reallocations, not new money, so the percentages always add up to the
contribution the user typed. The section is guidance only and does not create
orders or change holdings.

**Mark rebalanced** writes a local audit record (date, contribution, bought,
sold, projected worst drift, policy version) scoped to the signed-in user or
demo. It never rewrites holdings, so drift remains truthful until the underlying
positions are updated. Records are stored in AsyncStorage, newest first, and are
not synced to the backend.

### AI assistant

The **Assistant** modal (opened from the Allocation header or the Research tab)
runs a tool-calling loop against the backend proxy at `/api/agent`:

1. the app sends the conversation, the selected provider/model and its Firebase
   ID token;
2. the server verifies the token, picks a key for that provider from the pool
   and adds the tool schemas;
3. the model asks for portfolio data (`get_portfolio_summary`,
   `get_exposure_summary`, `search_asset`, `get_quote`,
   `get_fund_holdings`);
4. the app executes each lookup against the portfolio already in memory and the
   existing `/api/search`, `/api/price` and `/api/holdings` endpoints;
5. the results go back to the model until it produces a final answer.

The chat header has an OpenCode-style model picker. It calls
`/api/agent/models`, which only returns providers that have a usable key and
fetches each provider's current model catalogue. The last choice is persisted on
the device. Switching providers or models applies from the next message without
resetting the conversation.

The assistant is deliberately **read-only**. It cannot add, edit or delete
assets, and it never forces a price refresh (which would write to the Google
Sheet). Write tools should be added behind an explicit confirmation sheet.

Groq, OpenRouter and Gemini keys live on the server, never in the app bundle.
There are two ways to add them:

1. **In the app** — Settings → AI assistant → **API keys**. Paste a key and the
   provider is detected from its prefix (`gsk_`, `sk-or-v1-`, `AIza`). The key is
   validated with that provider, stored in MongoDB under the signed-in user's
   uid, and shown only as a masked value. Up to 10 per account.
2. **In the server environment** — comma-separated per provider:

```bash
# web repo .env.local
GROQ_API_KEYS=gsk_key_one,gsk_key_two
OPENROUTER_API_KEYS=sk-or-v1-...
GEMINI_API_KEYS=AIza...
FIREBASE_PROJECT_ID=liquid-muse-491818-a9
```

`GROQ_API_KEY`, `OPENROUTER_API_KEY` and the existing
`NEXT_PUBLIC_GEMINI_API_KEY` are also accepted as single-key fallbacks.

`/api/agent` prefers the signed-in user's own keys for the selected provider,
then the server pool for that provider. It uses the least-recently-used key
first, rotates through the rest, and puts a key on cooldown when the provider
returns 429/401/403/5xx before trying the next one. Every chat attempt is also
counted per key in the `ai_key_usage` MongoDB collection (a hash of the key is
used as the id, never the key itself). The key screen shows the request total,
today's count, failures, and the last quota headers the provider returned, so a
key that has hit its limit is labelled **Limit reached** with the reset time.
Persisted reset times keep a limited key parked after a server restart. The
mobile key screen calls `/api/agent/keys` (GET/POST/DELETE), which is backed by
the `user_ai_keys` MongoDB collection; older documents without a provider are
treated as Groq keys.

`lib/firebase-auth.ts` verifies Firebase RS256 ID tokens against Google's
public keys, so the proxy cannot be used anonymously in production. Local
`next dev` allows tokenless requests for testing.

### Gold/silver ratio

The Research tab shows a market indicator card backed by
`GET /api/market/gold-silver`:

- Yahoo Finance `GC=F` / `SI=F` COMEX futures supply the primary ratio.
- `https://xaus.com/api/v1/spot` supplies an independent spot ratio for
  cross-checking. The response includes both quotes, the percentage gap and a
  status: `match` (within 1.5%), `mismatch`, `stale` or `unavailable`.
- The card interprets the ratio as relative value: at or above 80, silver looks
  cheap versus gold; at or below 50, gold looks cheap versus silver; anything
  between is neutral. The 50/80 bands are a common heuristic, not investment
  advice, and the ratio can stay outside them for years.
- The server caches both feeds in memory for 10 minutes, shortened to 2 minutes
  when the cross-check is unavailable. The mobile query refetches every 15
  minutes and offers a manual refresh on the card.
- If Yahoo fails, the endpoint falls back to xaus.com. If both fail, it serves
  the last cached value marked `stale`, or HTTP 503 when there is no cache.

### India index P/E

The Research tab's second market card is backed by
`GET /api/market/india-pe`:

- NSE's daily index closing file (`ind_close_all.csv`, keyless) supplies the
  latest P/E, P/B and dividend yield for Nifty 50, Nifty Bank, Nifty IT and
  Nifty Midcap 100.
- Downstox supplies the same indices' monthly history. The card compares each
  current P/E with that index's own last 60 monthly readings and labels the
  bottom quartile `cheap`, the middle half `fair` and the top quartile
  `expensive`.
- This is relative-value context, not a forecast. The five-year window sits
  after NSE's 2021 switch to consolidated earnings.
- If NSE is unavailable, Downstox's current values are used as the fallback. If
  both fail, the endpoint serves the last cached value marked `stale`, or HTTP
  503 when there is no cache. The cache lasts one hour, shortened to 15 minutes
  when a history baseline is missing; the mobile query refetches every six
  hours and offers a manual refresh.

### Auth and demo mode

Email/password authentication uses the Firebase JS SDK with AsyncStorage
persistence, so sessions survive app restarts. Demo mode is a local flag that
renders the bundled sample portfolio and disables all writes.

### Account linking

Open **Settings → Sign-in methods** to link Google to an email/password account,
or set a password on a Google account. Both methods then sign into the same
Firebase `uid`, so the portfolio, policy, and AI keys remain attached to one
account. The last remaining sign-in method cannot be unlinked. If Firebase asks
for a recent login, sign out and back in, then retry the link.

The web app exposes the same controls under **Settings → Account — Sign-in
methods**, so a link made on either platform works on both.

### Google Sign-In

Google login uses the native account picker
(`@react-native-google-signin/google-signin`) and exchanges the returned ID token
for a Firebase credential, so Google and email/password users share the same
Firebase project.

> **Expo Go cannot run Google Sign-In.** Expo Go cannot load custom native
> modules or use your app's URL scheme, so the Google button is disabled there.
> Email/password and demo mode keep working in Expo Go; use a development build
> to test Google.

1. In **Firebase Console → Authentication**, enable the **Google** provider.
2. Add an Android app with package `com.assettracker.app` and the SHA-1 of your
   signing certificate, then download `google-services.json` into `mobile/`.
   For iOS, add the bundle ID and download `GoogleService-Info.plist` into
   `mobile/`. `app.config.ts` attaches those files automatically when present.
3. Copy the **Web client ID** from **Google Cloud Console → Credentials** into
   `mobile/.env`:

   ```bash
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
   ```

   If you use Google Cloud Console for iOS instead of a Firebase plist, also set
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`; the config derives the required URL scheme.
4. Build and run the native app:

   ```bash
   npx expo prebuild --clean
   npx expo run:android   # local build; requires the Android SDK
   ```

   For a cloud build, run `npx eas-cli@latest build:configure` once and use an
   internal-distribution `preview` profile. A `development` profile also needs
   `npx expo install expo-dev-client`.

Never add an OAuth client secret to the app — native Google Sign-In only needs
public client IDs and the Firebase client files.

## Quality gates

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint-config-expo
npm run doctor      # expo-doctor
```

> **Backend note:** `/api/sync` still trusts a client-supplied `uid`. Before
> distributing this app publicly, apply the same Firebase ID-token check used by
> `/api/agent` and write the decoded `uid` instead. The mobile client already
> sends `Authorization: Bearer` headers through the shared API client.
