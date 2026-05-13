-- Supabase schema for daily-observation push notifications.
--
-- Run once in your Supabase project's SQL editor.
--
-- The design is intentionally simple and stateless from the user-account
-- side: every push endpoint is its own row, carrying the pocket snapshot
-- that the cron job needs to evaluate which observations land today.
-- No user accounts, no logins — the push endpoint URL itself is the
-- de-facto identifier (it's already unguessable, server-issued, and
-- unique per device).

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys_p256dh text not null,
  keys_auth text not null,
  -- The user's Pocket — a JSON array of tranches (same shape as PocketEntry
  -- in lib/storage.ts: { id, tranche, pinned?, savedAt }). The cron reads
  -- this to compute today's observations.
  pocket_tranches jsonb not null default '[]'::jsonb,
  -- Timezone IANA name. Defaults to Malaysia. We compute "today" in this
  -- TZ when checking for observations falling on the current date.
  timezone text not null default 'Asia/Kuala_Lumpur',
  -- A short label so the user can tell devices apart if they uninstall.
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_updated_at_idx on push_subscriptions(updated_at);

-- RLS off — the API routes use the service_role key. If you later add
-- per-user auth, turn RLS on and constrain by user_id.
alter table push_subscriptions disable row level security;

-- Trigger to bump updated_at on every UPDATE.
create or replace function push_subscriptions_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists push_subscriptions_touch on push_subscriptions;
create trigger push_subscriptions_touch
  before update on push_subscriptions
  for each row execute function push_subscriptions_touch_updated_at();
