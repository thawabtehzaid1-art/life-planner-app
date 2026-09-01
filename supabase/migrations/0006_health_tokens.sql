-- Health data ingestion: a long-lived personal token per user, since an
-- Apple Shortcut running unattended (a morning automation, say) can't do
-- a live OAuth/session login the way the app itself does. The token is
-- shown once in the app and pasted into the Shortcut's URL.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists health_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table health_tokens enable row level security;
create policy "own token only" on health_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- health-ingest (the Shortcut-facing Edge Function) looks up which user a
-- token belongs to using the service role, bypassing this policy entirely
-- -- the policy above is what lets the app itself generate/view/regenerate
-- its own token directly via supabase-js, no Edge Function needed for that.
