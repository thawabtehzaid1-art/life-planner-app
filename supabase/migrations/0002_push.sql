-- Push notification subscriptions.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

-- One row per device/browser a user has opted into push on (a user could
-- have more than one, e.g. phone + desktop), keyed by the subscription's
-- own unique endpoint rather than by user_id alone.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  endpoint text generated always as (subscription->>'endpoint') stored unique,
  updated_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "own subscriptions only" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- nudge-scan (a scheduled Edge Function, service role) reads every user's
-- planner_data + push_subscriptions directly — no policy needed for it
-- since the service role bypasses RLS entirely.
