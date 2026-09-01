-- Tracks which due-item nudges have already been sent, so nudge-scan
-- (which runs hourly and re-checks "what's due right now" from scratch
-- every time) doesn't re-notify for the same bill/task every single hour
-- until it's paid/completed.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists nudge_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  due_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, item_key)
);
alter table nudge_log enable row level security;
-- No policies: this table is only ever touched by nudge-scan using the
-- service role, which bypasses RLS entirely — regular users have no
-- reason to read or write it directly.
