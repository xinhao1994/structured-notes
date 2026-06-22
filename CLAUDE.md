# CLAUDE.md — SN DESK / Structured Notes Desk (chains to Aiden's master brain)

> Claude: this is a **stub**. The real operating manual is Aiden's master brain at `C:\Users\PC\Desktop\Brain\`.

## MANDATORY first action — every session, no exceptions

Before responding to anything in this project, READ in order:

1. `C:\Users\PC\Desktop\Brain\CLAUDE.md` — the two laws
2. `C:\Users\PC\Desktop\Brain\00 - Index.md`
3. `C:\Users\PC\Desktop\Brain\Identity\Profile.md`
4. `C:\Users\PC\Desktop\Brain\Goals\North Star.md` + `Goals\90-Day Focus.md`
5. `C:\Users\PC\Desktop\Brain\Working with Claude\Preferences.md`
6. `C:\Users\PC\Desktop\Brain\Working with Claude\Session Protocol.md`
7. **This project's brain file:** `C:\Users\PC\Desktop\Brain\Work\Projects\SN DESK.md`
8. **Related:** `Brain\Work\Current Role.md` (private banking context), `Brain\Work\Client Approach.md`

## What this project is
- **Project name:** SN DESK — Structured Notes Desk
- **Location:** `C:\Users\PC\Documents\Claude\Projects\Signal Apps\structured-notes\`
- **What it does:** Mobile-first web app for **structured investment / autocallable note tracking** — built FOR relationship managers and private bankers (literally Aiden's day job). Paste a dealer tranche text → product table, live dashboard, KO schedule, risk indicators, watchlist, client calculator.
- **Stack:** Next.js, Polygon/Finnhub/Alpha Vantage APIs (failover), Tailwind, PWA-installable
- **Markets covered:** US, HK, MY, SG, JP, AU — each with its own session, lunch break, holiday calendar
- **Status:** Aiden's best build to date — shipped working version
- **Strategic angle:** This is a tool that Aiden could *use himself* at OCBC, or potentially commercialize for other relationship managers. Both paths are valid.

## Key files to know
- `lib/parser.ts` — paste-to-parse tranche text (order-tolerant)
- `lib/prices.ts` — multi-provider failover with cache + mock
- `lib/calc.ts` `assessRisk` — risk classification (safe / moderate / near-KI / near-KO / critical)
- `lib/markets.ts` — market sessions and calendars
- `components/ProductTable.tsx` — PNG/PDF/clipboard export
- `components/Dashboard.tsx` — live deltas
- `components/KOSchedule.tsx` — stepdown schedule
- `app/page.tsx` — main view (indicative ↔ actual fixing logic)
- `app/calculator/page.tsx` — client coupon calculator
- `docs/ARCHITECTURE.md` — read this if making structural changes

## MANDATORY end-of-session ritual
1. Update `Brain\Work\Projects\SN DESK.md` — status, what we did, next steps, any wins/issues
2. Write to `Brain\Daily\YYYY-MM-DD.md` — session entry
3. Log any lesson to `Brain\Lessons Learned\`
4. Confirm to Aiden what files got written

## Hard rules
- This is for **paste-to-parse** of public dealer offerings + watchlist tracking. **Do not** turn it into something that gives unlicensed investment advice.
- Keep secrets in `.env.local` only. Never log or echo API keys.
- Concise, direct, layman terms first
- Push back hard when wrong
- Budget cap on third-party APIs: stay within free tiers where possible

## The two laws
- **Read the brain FIRST.** No asking permission.
- **Update the brain AFTER.** No skipping.

> If anything here conflicts with the master brain, the master brain wins.
