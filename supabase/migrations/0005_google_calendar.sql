-- Google Calendar sync: OAuth tokens + a map from Align items to the
-- Google events they've been pushed as.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

-- No client-facing policy on purpose: an access/refresh token pair is a
-- lot more sensitive than, say, a push subscription's public endpoint --
-- only the Edge Functions (service role, bypasses RLS) ever read or write
-- this table. The client only ever learns a plain "connected: true/false"
-- from the calendar-status function, never the tokens themselves.
create table if not exists google_calendar_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  calendar_id text not null default 'primary',
  updated_at timestamptz not null default now()
);
alter table google_calendar_tokens enable row level security;

-- Tasks and bills live as plain array entries inside planner_data.data,
-- with no stable id of their own (see the `id` field added to new items
-- in pages.js) -- this table is what lets calendar-sync tell "update the
-- existing event for this item" apart from "this is new, create one",
-- and what to delete when an item's due date is cleared or it's removed
-- entirely. item_key is the item's `id` when it has one, falling back to
-- a name+due composite for older items saved before ids existed.
create table if not exists calendar_synced_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null,
  item_key text not null,
  google_event_id text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, item_type, item_key)
);
alter table calendar_synced_events enable row level security;
