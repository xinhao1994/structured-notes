# Structured Notes Desk

Mobile-first web app for **structured investment / autocallable note** tracking and proposal generation, designed for relationship managers and private bankers. Paste a dealer tranche text → get a clean, exportable product table, a live dashboard, KO schedule, risk indicators, pocket watchlist, and a client calculator. Premium banking style, dark + light mode, PWA-installable, and ready to wrap as iOS / Android.

## Quick start

```bash
# 1. install
npm install

# 2. configure provider keys (server-side only)
cp .env.local.example .env.local
# fill in POLYGON_API_KEY / FINNHUB_API_KEY / ALPHA_VANTAGE_API_KEY

# 3. run
npm run dev      # http://localhost:3000
npm run build && npm start
```

Without API keys the UI still runs end-to-end on a deterministic mock provider so you can demo the parser, dashboard, KO schedule, pocket and calculator immediately.

## Feature checklist

| Area | Implemented |
| --- | --- |
| Paste-to-parse tranche text | `lib/parser.ts` — order-tolerant, emoji-flag aware |
| Live multi-market quotes | `lib/prices.ts` — Polygon → Finnhub → Alpha Vantage failover, in-memory cache, mock fallback |
| Markets supported | US, HK, MY, SG, JP, AU — each with its own session, lunch break, and holiday calendar |
| Timezone-aware market clock | `components/Header.tsx` — Malaysia clock + per-market open/closed strip |
| Indicative ↔ actual fixing | `app/page.tsx` — pre-trade uses latest close as indicative, swaps to actual on/after trade date |
| Product table (PNG / PDF / clipboard) | `components/ProductTable.tsx` — html-to-image + jspdf |
| Dashboard with live deltas | `components/Dashboard.tsx` — % above strike / EKI / dist to KO / daily change |
| Risk monitor | `lib/calc.ts` `assessRisk` — safe / moderate / near-KI / near-KO / high-risk / critical |
| KO schedule with stepdown | `components/KOSchedule.tsx` |
| Visual analytics | `components/Charts.tsx` — performance gauge, KO probability gauge, distance-to-EKI bar |
| Pocket (watchlist) | `app/pocket/page.tsx` — search, filter ccy/risk/maturity, pin, remove |
| Client calculator | `app/calculator/page.tsx` — min lot validation, monthly + total coupon, annualized, scenarios |
| Alerts | Browser notifications wired in `app/page.tsx`; web-push schema in `supabase/schema.sql` |
| Dark mode | `components/ThemeProvider.tsx` |
| PWA | `public/manifest.webmanifest` + `public/sw.js` |
| Caching / weekend / holiday handling | `lib/markets.ts` + `app/api/prices/route.ts` |

See `docs/ARCHITECTURE.md` for the complete file map and `docs/DEPLOYMENT.md` / `docs/MOBILE.md` for go-live and iOS/Android packaging.

## Sample paste

```
MSI
Offering: 8 - 12 May 2026   Trade: 12 May 2026, 4pm   Settlement: T+7   Tranche code: MSIT260592
MYR 🇲🇾

TSM US
Broadcom US
Google US

Strike 100%
KO 108%, stepdown 4%
Coupon 9% p.a.
Tenor 11M
EKI 60%
```

## License

Internal / proprietary. Replace with your bank's policy before distribution.
