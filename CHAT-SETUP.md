# Team Chat — Setup

Two manual steps before the new **Chat** tab works:

## Step 1 — Run the chat table SQL

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the entire contents of `db/chat-messages.sql` (also reproduced below) → click **Run** → choose **Run and enable RLS** if prompted.

```sql
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_at_idx on chat_messages(created_at desc);

alter table chat_messages enable row level security;

drop policy if exists "chat read" on chat_messages;
create policy "chat read"   on chat_messages for select using (true);

drop policy if exists "chat insert" on chat_messages;
create policy "chat insert" on chat_messages for insert with check (
  length(sender_name) between 1 and 32
  and length(body) between 1 and 2000
);

alter publication supabase_realtime add table chat_messages;
```

You should see "Success. No rows returned." Done.

## Step 2 — Add the anon key as a Vercel env var

The Chat tab reads + writes through Supabase from the browser, so it uses the **anon (public)** key — different from the `service_role` key you already added.

1. In Supabase, go to **Project Settings → API** (same page as before).
2. Under **"Project API keys"**, copy the row labelled **`anon`** **`public`** (the SHORT one, not service_role).
3. In Vercel → your project → **Settings → Environment Variables → Add New**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (paste the anon public key) |

Tick Production + Preview, save.

4. Redeploy from **Deployments → ⋯ → Redeploy** (without build cache).

## Step 3 — Use it

1. Open the app on your phone (installed PWA from home screen).
2. Tap the new **Chat** tab in the bottom navigation.
3. First time: enter your name (e.g. "Aiden"). Stored locally — only set it once per device.
4. Type a message → tap **Send** (or hit Enter).
5. Anyone else with the app installed on their phone sees your message instantly. Messages appear in real time without refreshing.

## Sharing with colleagues

Send them the app URL — they install the PWA the same way (Safari → Share → Add to Home Screen), open the Chat tab, set their name, and they're in. No registration, no logins. Whoever has the URL has access.

## Security model

- **Open read + open write**: anyone with the `NEXT_PUBLIC_SUPABASE_ANON_KEY` (which ships in your built JS bundle) and knowledge of the app URL can read every message and post new ones. Fine for a small private RM team.
- **Length-checked**: RLS policy enforces 1–32 chars on sender name, 1–2000 chars on message body — limits abuse.
- **No deletes from client**: only the RLS policies above allow `SELECT` and `INSERT`. There's no `UPDATE` or `DELETE` policy, so messages are append-only. If you ever need to clear chat, go to Supabase Table Editor → chat_messages → select rows → delete.
- **If chat goes public** beyond your team: revoke the anon key in Supabase (Settings → API → Reset anon key), update Vercel, redeploy. Everyone's existing sessions break and you need to re-share the new key.

## Limits (Supabase free tier)

- 200 concurrent realtime connections — fine for a 10-person team
- 2M realtime messages / month — fine unless you're sending 100s of msgs/day
- Database storage 500 MB — chat is text, won't hit this

If you scale beyond a small team, upgrade to Supabase Pro ($25/month) for higher limits.
