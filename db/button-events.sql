-- SN Desk — button_events table + RLS policies
-- Run this ONCE in your Supabase dashboard (SQL Editor → paste → Run).
-- Tracks every meaningful button click across all tabs.

CREATE TABLE IF NOT EXISTS button_events (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_id   TEXT,           -- same stable UUID as page_visits
  session_id   TEXT,
  chat_name    TEXT,           -- if the visitor has set a chat name
  button_name  TEXT NOT NULL,  -- e.g. "desk:paste", "pocket:pin", "calc:copy-msg"
  page         TEXT,           -- tab path e.g. "/", "/pocket", "/calculator"
  meta         JSONB,          -- optional extra context (tranche code, symbol, etc.)
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_button_events_created_at  ON button_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_button_events_button_name ON button_events (button_name);
CREATE INDEX IF NOT EXISTS idx_button_events_visitor_id  ON button_events (visitor_id);

ALTER TABLE button_events ENABLE ROW LEVEL SECURITY;

-- Anon key can only insert (client-side tracking).
DROP POLICY IF EXISTS "anon insert button events" ON button_events;
CREATE POLICY "anon insert button events" ON button_events
  FOR INSERT WITH CHECK (true);
-- Reads are service-role only (admin dashboard).
