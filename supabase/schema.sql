-- ─────────────────────────────────────────────────────────────────────────────
-- Structured Notes Desk — Supabase schema
--
-- This is the cloud-sync schema for the Pocket/watchlist feature. It is
-- 1:1 with the localStorage shape used by the web app today, so you can
-- swap `lib/storage.ts` to a Supabase client without touching UI code.
--
-- Setup (in your Supabase project):
--   1. Open the SQL editor.
--   2. Paste this entire file and run.
--   3. Enable email/OAuth auth (Auth → Providers).
--   4. Replace lib/storage.ts read/write helpers to call supabase-js.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- Master tranche record
create table if not exists public.tranches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  tranche_code    text not null,
  issuer          text,
  currency        text not null check (currency in ('USD','HKD','MYR','SGD','JPY','AUD')),
  offering_start  date,
  offering_end    date,
  trade_date      date not null,
  trade_cutoff    text,
  settlement_offset int  not null default 7,
  settlement_date date,
  coupon_pa       numeric(8,6) not null default 0,
  tenor_months    int not null,
  strike_pct      numeric(8,6) not null default 1.0,
  ko_start_pct    numeric(8,6) not null default 1.0,
  ko_stepdown_pct numeric(8,6) not null default 0,
  eki_pct         numeric(8,6) not null default 0.6,
  ko_obs_freq_months int not null default 1,
  is_indicative_fixing boolean not null default true,
  initial_fixing  jsonb,
  notes           text,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, tranche_code)
);

create index if not exists tranches_user_idx on public.tranches (user_id, pinned desc, created_at desc);

create table if not exists public.tranche_underlyings (
  tranche_id uuid references public.tranches(id) on delete cascade,
  ord        int not null,                       -- ordering inside the basket
  raw_name   text not null,
  symbol     text not null,
  market     text not null check (market in ('US','HK','MY','SG','JP','AU')),
  primary key (tranche_id, ord)
);

-- Pre-computed KO observation schedule. Optional — derivable from the tranche,
-- but persisted for fast reads and historical audit.
create table if not exists public.ko_observations (
  tranche_id uuid references public.tranches(id) on delete cascade,
  n          int not null,
  obs_date   date not null,
  ko_pct     numeric(8,6) not null,
  primary key (tranche_id, n)
);

-- Push subscriptions for web-push / FCM tokens
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null,
  p256dh      text,
  auth        text,
  platform    text not null default 'web' check (platform in ('web','ios','android')),
  created_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- Alert log (KI / KO / coupon / maturity / trade-date)
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  tranche_id   uuid references public.tranches(id) on delete cascade,
  kind         text not null check (kind in ('knock_in','knock_out','trade_date','coupon','maturity')),
  payload      jsonb,
  triggered_at timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists alerts_user_idx on public.alerts (user_id, triggered_at desc);

-- Optional: cache the latest snapshot of each (symbol, market) pulled by the
-- /api/prices route. Useful so historical analytics doesn't hammer providers.
create table if not exists public.price_snapshots (
  symbol      text not null,
  market      text not null,
  price       numeric(18,6) not null,
  prev_close  numeric(18,6),
  high_52w    numeric(18,6),
  low_52w     numeric(18,6),
  source      text not null,
  as_of       timestamptz not null,
  primary key (symbol, market)
);

-- ─── Row-level security ─────────────────────────────────────────────────────
alter table public.tranches             enable row level security;
alter table public.tranche_underlyings  enable row level security;
alter table public.ko_observations      enable row level security;
alter table public.push_subscriptions   enable row level security;
alter table public.alerts               enable row level security;

create policy "tranches: owner only" on public.tranches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "underlyings: via tranche owner" on public.tranche_underlyings
  for all using (
    exists (select 1 from public.tranches t where t.id = tranche_id and t.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.tranches t where t.id = tranche_id and t.user_id = auth.uid())
  );

create policy "ko: via tranche owner" on public.ko_observations
  for all using (
    exists (select 1 from public.tranches t where t.id = tranche_id and t.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.tranches t where t.id = tranche_id and t.user_id = auth.uid())
  );

create policy "push: owner only" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "alerts: owner only" on public.alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
