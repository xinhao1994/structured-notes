# Deployment

## Option 1 — Vercel (recommended)

1. Push the repo to GitHub/GitLab.
2. In Vercel, **Import Project** → select the repo.
3. **Environment Variables**, add (server-side only):
   - `POLYGON_API_KEY`
   - `FINNHUB_API_KEY`
   - `ALPHA_VANTAGE_API_KEY`
   - `PRICE_LIVE_TTL_SECONDS=15`
   - `PRICE_CLOSED_TTL_SECONDS=600`
   - (optional) `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - (optional) `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
4. Deploy. The PWA `manifest.webmanifest` and `sw.js` are served from `/`.
5. **Custom domain** under Settings → Domains. Add HSTS at the DNS layer once verified.

## Option 2 — Netlify / Cloudflare Pages / Render

Identical env vars. For Cloudflare Pages, set **Compatibility flag**: `nodejs_compat` so the Node runtime in `app/api/prices/route.ts` works.

## Option 3 — Self-host (Docker)

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["npm","start"]
```

```bash
docker build -t snd .
docker run -p 3000:3000 --env-file .env.local snd
```

## Caching strategy

| Layer | What | TTL |
| --- | --- | --- |
| In-process Map (per server instance) | Provider quotes | 15s open / 600s closed |
| HTTP `s-maxage` from `/api/prices` | Edge cache at CDN | 10s open / 60s closed |
| Service worker (`public/sw.js`) | App shell stale-while-revalidate; **network-first** for `/api/*` | until SW updates |

## Provider failover

Order: **Polygon → Finnhub → Alpha Vantage → mock**. The first provider that returns a finite, non-zero price wins. Failures are silent — UI never errors out, only quote `source` and `delayed` flags change.

## Market-aware behaviour

| Condition | Result |
| --- | --- |
| Weekend in market tz | header strip shows "Weekend"; longer cache TTL |
| Listed holiday | "Holiday"; longer cache TTL |
| Local lunch break (HK/SG/JP/MY) | "Lunch"; price still shown but `marketOpen=false` |
| Pre-open / post-close | "Pre-mkt" / "Closed"; `delayed=true` |

## Push notifications (optional)

1. `npx web-push generate-vapid-keys` → fill `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.
2. In your event service (cron / Supabase function), select tranches whose worst-of crossed KI or KO and POST to `/api/notify` (you implement this endpoint), then call web-push for each `push_subscriptions` row.
3. The shipped service worker (`public/sw.js`) already handles `push` and `notificationclick`.

## Health check

`GET /api/prices?items=US:AAPL` should return `{ "quotes": [...] }` in <1s. Wire that into uptime monitoring (StatusCake, BetterStack, etc.).
