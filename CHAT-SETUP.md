# Team Chat — Setup

The Chat tab needs **three** manual one-time steps:

1. Run a SQL migration to create the table + storage bucket.
2. Add the Supabase anon key to Vercel env vars.
3. Redeploy.

After that, the tab supports plain messages, **image attachments**, **voice messages** (hold-to-record), a **floating "X is typing..."** indicator, and a **Clear chat** admin button.

---

## Step 1 — Run BOTH migrations in Supabase

### 1a. Base table

Supabase → **SQL Editor** → **New query**. Paste this ONLY (no markdown, just SQL):

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
create policy "chat read" on chat_messages for select using (true);

drop policy if exists "chat insert" on chat_messages;
create policy "chat insert" on chat_messages for insert with check (
  length(sender_name) between 1 and 32
  and length(body) between 0 and 2000
);

alter publication supabase_realtime add table chat_messages;
```

Click **Run** → "Run and enable RLS" if prompted. Should see "Success. No rows returned."

### 1b. Attachment fields + storage bucket (v2)

In the same SQL editor, click **New query** again. Paste this:

```sql
-- Add attachment fields to messages
alter table chat_messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_type text;

-- Create a public storage bucket for chat attachments (10MB max per file)
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;

-- Allow anon role to upload + read from the bucket
drop policy if exists "chat upload" on storage.objects;
create policy "chat upload" on storage.objects for insert to anon
  with check (bucket_id = 'chat-attachments');

drop policy if exists "chat read" on storage.objects;
create policy "chat read" on storage.objects for select to anon
  using (bucket_id = 'chat-attachments');
```

Click **Run**. Same "Success. No rows returned."

---

## Step 2 — Add the anon key to Vercel

You already have `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set. The chat additionally needs:

1. In Supabase, **Settings → API → Project API keys**.
2. Copy the row labelled **`anon` `public`** (NOT service_role).
3. In Vercel → your project → **Settings → Environment Variables → Add New**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (paste the anon public key) |

Tick **Production + Preview**, save.

4. **Redeploy without build cache:** Deployments → ⋯ → Redeploy → uncheck "Use existing Build Cache" → Redeploy.

---

## Step 3 — Use it

Open the PWA on your phone (installed via Safari → Add to Home Screen). Tap the **Chat** tab.

### What each button does

| Button | Behaviour |
| --- | --- |
| **🖼️ Image** | File picker → pick photo/screenshot → uploaded to Supabase Storage → message sends instantly with the image inline. |
| **🎤 Mic** | **Hold** to record. Release to send. Captures via your device microphone (iOS will ask permission once). Voice plays inline with a player. |
| **Text input** | Type message + tap **Send** (or Enter). Shift+Enter for new line. |
| **Edit** (top right) | Change your display name. |
| **Clear chat** (top right, red) | Wipes ALL messages for everyone. Confirms first. |

### Typing indicator

When anyone else types in the input box, a floating **"X is typing..."** appears at the bottom of the message list with three pulsing dots. Auto-disappears 3.5 seconds after they stop. Rate-limited to ≤1 broadcast per 1.5s so typing doesn't spam the channel.

---

## Permissions on iOS

The first time you tap the mic button, iOS will ask for microphone permission. Tap **Allow**. If you accidentally denied it, go to:

- **iOS Settings → [your installed app name] → Microphone → Allow**, OR
- **Settings → Safari → Camera & Microphone → Allow for this site** (if PWA), OR
- Uninstall the PWA from home screen and re-install (then permit when prompted)

---

## Security notes

- The anon key + the deployed URL together grant read+post access to anyone. Keep both private to your team.
- Voice notes + images go to a **public Supabase storage bucket** — anyone with a direct URL can view them. The URLs are unguessable random strings, but treat the bucket as semi-public.
- Messages are append-only via RLS. Only `/api/chat/clear` (server-side, service_role) can delete — and any client can call it. If you want to lock that down, add an env-var-based admin password check inside the route.

---

## Limits (Supabase free tier)

- 200 concurrent realtime connections (your team won't hit this)
- 2M realtime messages / month
- 1GB storage for attachments (voice notes are tiny — a 10-second clip is ~50KB)
- 500MB database — chat metadata is text, will last years

Upgrade to Supabase Pro ($25/month) if you outgrow these.
