-- Team-chat schema. Run once in the Supabase SQL Editor.
--
-- Design: deliberately stateless from an account perspective. The sender's
-- name is provided by the client (stored in localStorage), no logins. RLS
-- policies allow the anon key to read all messages and insert new ones
-- with simple length sanity-checks. Anyone with the deployed app URL can
-- read + post — fine for a small private team. For wider distribution,
-- swap RLS for an auth check.

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_created_at_idx
  on chat_messages(created_at desc);

-- RLS on — both the anon and authenticated roles need explicit policies.
alter table chat_messages enable row level security;

-- Anyone with the anon key can read every message.
drop policy if exists "chat read" on chat_messages;
create policy "chat read"
  on chat_messages for select
  using (true);

-- Anyone with the anon key can post a message, as long as length checks pass.
drop policy if exists "chat insert" on chat_messages;
create policy "chat insert"
  on chat_messages for insert
  with check (
    length(sender_name) between 1 and 32
    and length(body) between 1 and 2000
  );

-- ─── Enable Realtime for this table ────────────────────────────────────
-- Tells Supabase to broadcast INSERT events on this table over WebSocket
-- to anyone who's subscribed. The client subscribes on the /chat page and
-- pushes new messages into the UI as they arrive — no polling needed.
alter publication supabase_realtime add table chat_messages;
