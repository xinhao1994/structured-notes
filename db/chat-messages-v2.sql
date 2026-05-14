-- Run this in your Supabase SQL Editor AFTER the original chat-messages.sql.
-- Adds attachment columns + creates the public storage bucket for images and
-- voice notes.

-- 1. Attachment fields on the message table
alter table chat_messages
  add column if not exists attachment_url   text,
  add column if not exists attachment_type  text  -- "image" | "audio"
  ;

-- 2. Storage bucket for chat attachments (images, voice notes). Public so the
--    URLs are directly viewable in <img> / <audio> tags.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', true, 10485760)  -- 10 MB cap
on conflict (id) do update set public = true, file_size_limit = 10485760;

-- 3. Storage policies — anyone with the anon key can upload + read the bucket.
--    Path scoped to "chat/" to avoid clashes with other future buckets.
drop policy if exists "chat upload"  on storage.objects;
create policy "chat upload"
  on storage.objects for insert to anon
  with check (bucket_id = 'chat-attachments');

drop policy if exists "chat read"    on storage.objects;
create policy "chat read"
  on storage.objects for select to anon
  using (bucket_id = 'chat-attachments');
