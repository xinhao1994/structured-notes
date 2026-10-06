-- ─────────────────────────────────────────────────────────────────────
-- SN Desk — Parsed-Tranche Learning Layer
-- Run this ONCE in your Supabase dashboard (SQL Editor → paste → Run).
-- Safe to re-run (CREATE IF NOT EXISTS everywhere).
--
-- What this does:
--   1. parsed_tranches  — one row per tranche-parse event (any user, any tab).
--   2. tracked_stocks_v — materialised-ish view that aggregates which stocks
--                         show up most often across every parse. The Wayne tab
--                         uses this to display "trending underlyings" and the
--                         Analyze tab uses it for "also parsed in N tranches".
--   3. tracked_stocks_cache — optional Wayne-snapshot cache keyed by symbol.
--                             Weekly cron refreshes this so popular stocks
--                             always have a hot pre-computed verdict.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parsed_tranches (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tranche_code    TEXT,
  visitor_id      TEXT,           -- from snd_vid cookie
  chat_name       TEXT,
  issuer          TEXT,
  currency        TEXT,
  coupon_pa       NUMERIC,
  tenor_months    INTEGER,
  strike_pct      NUMERIC,
  ko_start_pct    NUMERIC,
  ko_stepdown_pct NUMERIC,
  eki_pct         NUMERIC,
  obs_freq_months INTEGER,
  trade_date      DATE,
  settlement_date DATE,
  underlyings     JSONB,          -- [{symbol, market, rawName}]
  parse_source    TEXT,           -- "desk" | "wayne"
  raw_text        TEXT,           -- the pasted message (first 10k chars)
  parsed_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parsed_tranches_code ON parsed_tranches(tranche_code);
CREATE INDEX IF NOT EXISTS idx_parsed_tranches_at   ON parsed_tranches(parsed_at DESC);
CREATE INDEX IF NOT EXISTS idx_parsed_tranches_vid  ON parsed_tranches(visitor_id);
CREATE INDEX IF NOT EXISTS idx_parsed_tranches_underlyings ON parsed_tranches USING GIN (underlyings);

-- ─── Aggregated view: which stocks appear in the most tranches? ──────
-- Flattens the underlyings array per row so we can group by (symbol, market).
-- Querying this is cheap because it's a view over the indexed base table.
CREATE OR REPLACE VIEW tracked_stocks_v AS
SELECT
  u->>'symbol'                             AS symbol,
  u->>'market'                             AS market,
  COUNT(*)::INT                            AS parse_count,
  COUNT(DISTINCT visitor_id)::INT          AS unique_visitors,
  MIN(parsed_at)                           AS first_parsed_at,
  MAX(parsed_at)                           AS last_parsed_at,
  (array_agg(DISTINCT u->>'rawName') FILTER (WHERE u->>'rawName' IS NOT NULL))[1:3] AS raw_name_variants
FROM parsed_tranches, jsonb_array_elements(underlyings) AS u
WHERE u ? 'symbol' AND LENGTH(COALESCE(u->>'symbol','')) > 0
GROUP BY u->>'symbol', u->>'market';

-- ─── Optional: hot cache of Wayne verdicts for popular stocks ──────
-- Weekly cron refreshes this. Fast to read on page open — no Yahoo fetch
-- needed if the cache is fresh.
CREATE TABLE IF NOT EXISTS tracked_stocks_cache (
  symbol              TEXT NOT NULL,
  market              TEXT NOT NULL,
  wayne_snapshot      JSONB,            -- latest /api/wayne/analyze output
  stock_profile_snapshot JSONB,         -- latest /api/stock-profile output
  refreshed_at        TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, market)
);

CREATE INDEX IF NOT EXISTS idx_tracked_stocks_cache_refreshed
  ON tracked_stocks_cache(refreshed_at DESC);

-- ─── RLS: service-role-only (anon can't read user activity) ──────────
ALTER TABLE parsed_tranches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_stocks_cache ENABLE ROW LEVEL SECURITY;
-- No policies defined → anon is blocked; service_role bypasses RLS.
