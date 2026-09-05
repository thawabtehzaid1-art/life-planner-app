-- Voice assistant: learned aliases for the three name-matching command
-- domains (habit, bill, networth) -- see quickCapture.js's matchByName/
-- matchAccountByName. Nothing writes or reads this table yet; this is the
-- schema only, same "collect the signal from day one, wire up the
-- behavior once it's designed" approach as voice_command_log
-- (0007_voice_command_log.sql).
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists voice_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null, -- 'habit' | 'bill' | 'networth'
  phrase text not null, -- normalized (lowercase, trimmed) spoken/typed candidate
  target_name text not null, -- the resolved item's .name at correction time
  created_at timestamptz not null default now(),
  unique(user_id, domain, phrase)
);
alter table voice_aliases enable row level security;
create policy "own aliases only" on voice_aliases for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
