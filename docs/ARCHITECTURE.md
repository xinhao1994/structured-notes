# Architecture

```
structured-notes/
├── app/
│   ├── layout.tsx              # Root shell, theme, header, bottom nav, SW register
│   ├── page.tsx                # Desk: parser → table → dashboard → KO → analytics
│   ├── pocket/page.tsx         # Watchlist (localStorage v1 — Supabase-ready)
│   ├── calculator/page.tsx     # Client calc: min-lot, coupons, scenarios
│   ├── globals.css             # Tailwind + design tokens
│   └── api/
│       └── prices/route.ts     # Server route: multi-provider failover, caching
├── components/
│   ├── Header.tsx              # MY clock + 6-market open/closed strip
│   ├── BottomNav.tsx           # Mobile-first bottom tab bar
│   ├── ThemeProvider.tsx       # Light/dark, persisted, system-default
│   ├── ServiceWorkerRegister.tsx
│   ├── ProductParser.tsx       # Paste → ParseResult; sample, clipboard, edit
│   ├── ProductTable.tsx        # Banking-style table, PNG/PDF/clipboard export
│   ├── Dashboard.tsx           # Tranche facts + per-underlying live cards + risk note
│   ├── KOSchedule.tsx          # Auto-call observation table with stepdown
│   └── Charts.tsx              # Recharts: gauges + distance-to-EKI bar
├── lib/
│   ├── types.ts                # Tranche, Underlying, PriceQuote, Risk, KO …
│   ├── parser.ts               # Free-form tranche text → Tranche
│   ├── calc.ts                 # KO schedule, risk band, calculator, formatters
│   ├── markets.ts              # IANA timezones, sessions, holidays, business-day math
│   ├── prices.ts               # Provider chain (Polygon → Finnhub → AV → mock) + cache
│   ├── storage.ts              # localStorage Pocket (Supabase-swappable surface)
│   ├── sample.ts               # Sample tranche text from the spec
│   └── hooks/
│       └── useQuotes.ts        # Polling hook with visibility-aware pause/resume
├── public/
│   ├── manifest.webmanifest    # PWA manifest
│   ├── sw.js                   # Service worker: app shell + price network-first + push
│   └── icons/                  # App icons (drop your assets here)
├── supabase/
│   └── schema.sql              # Cloud-sync schema for Pocket + alerts + push
├── docs/
│   ├── ARCHITECTURE.md         # this file
│   ├── DEPLOYMENT.md           # Vercel / Netlify / self-host
│   └── MOBILE.md               # Capacitor wrap → iOS + Android
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.js
├── next-env.d.ts
├── .gitignore
├── .env.local.example
└── README.md
```

## Data flow

```
 Browser ──► /api/prices ──┐                  ┌─► Polygon  (US)
                           │   fetchQuote()   ├─► Finnhub  (US/HK/MY/SG/JP/AU)
   PriceCache (per-process)│                  └─► Alpha Vantage (fallback)
                           └─► PriceQuote {price, prevClose, 52w hi/lo, asOf, source}

 page.tsx (client)
   │   useQuotes(items, 15s) — paused when tab hidden
   ▼
 ParseResult ─► trancheWithFixing
                  │  pre-trade  ──► initial = latest close (indicative)
                  │  ≥ trade    ──► initial = live at fix (actual)
                  ▼
   ProductTable · Dashboard · KOSchedule · Analytics
```

## Key design choices

**Strict server/client boundary for keys.** `lib/prices.ts` is server-only. All provider keys go in `.env.local` *without* the `NEXT_PUBLIC_` prefix and are surfaced via `/api/prices`. The browser never sees a provider key.

**Two-tier cache.** In-memory cache inside the API route (15s while open / 600s while closed) plus an HTTP `Cache-Control: s-maxage` so a fronting CDN can absorb burst load on common tranches. The service worker only network-firsts on `/api/`, so it never serves a stale price.

**Symbol mapping is centralised.** `MARKETS[m].finnhubSuffix` / `alphaVantageSuffix` keep symbol formats in one place. Polygon currently restricted to US (its non-US coverage is partial); when this changes, only `polygonSymbol()` needs updating.

**KO logic is tested through pure functions.** `koSchedule()` and `assessRisk()` are pure and unit-testable; UI consumes their output as plain data.

**Pocket is store-agnostic.** `lib/storage.ts` exposes `listPocket / upsertTranche / removePocket / togglePin`. Drop-in replacement for Supabase: re-implement those four functions against `supabase.from('tranches')` and `tranche_underlyings`.

**Indicative → actual fixing is automatic.** Computed in `app/page.tsx` from `today < tradeDate`. When the trade date arrives the page re-derives `initialFixing` from the live quote — no user action needed.
