-- ─────────────────────────────────────────────────────────────────────
-- SN Desk — page_visits table + RLS policies
-- Run this ONCE in your Supabase dashboard (SQL Editor → paste → Run).
-- It's safe to re-run (CREATE IF NOT EXISTS everywhere).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS page_visits (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id   TEXT,           -- stable per-browser UUID stored in localStorage
  session_id   TEXT,           -- new each browser session (sessionStorage)
  chat_name    TEXT,           -- if the visitor has set a chat name
  ip           TEXT,           -- from x-forwarded-for
  country      TEXT,           -- 2-letter code from Vercel edge headers
  city         TEXT,
  region       TEXT,
  user_agent   TEXT,
  device_type  TEXT,           -- mobile / tablet / desktop
  browser      TEXT,           -- Safari / Chrome / Edge / Firefox / Opera
  os           TEXT,           -- iOS 17.4 / Android 14 / macOS 14 / Windows / Linux
  path         TEXT,           -- e.g. /chat, /pocket
  referrer     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_visits_created_at ON page_visits (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_visitor_id ON page_visits (visitor_id);

-- Row-Level Security: anon key can ONLY insert (via /api/track). Reads are
-- server-side only via the service-role key (admin dashboard). No public read.
ALTER TABLE page_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon insert visits" ON page_visits;
CREATE POLICY "anon insert visits" ON page_visits
  FOR INSERT WITH CHECK (true);
-- No SELECT / UPDATE / DELETE policy — those are blocked by default.
