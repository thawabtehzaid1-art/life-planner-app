-- Voice assistant Phase 1: logs every voice command attempt (what was said,
-- what the local model normalized it to, what quickCapture.js's existing
-- parseCommand() made of that, and whether it actually applied) even
-- though nothing reads this back yet. Nothing here changes app behavior --
-- it's the training-signal foundation a future personalization pass would
-- need, collected from day one since it costs nothing to start now and
-- can't be reconstructed retroactively later.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists voice_command_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  transcript text not null,
  normalized_text text,
  parsed_intent jsonb,
  applied boolean not null default false,
  -- Never written by anything yet -- reserved for a future "that wasn't
  -- right" affordance in the UI, so the schema doesn't need to change
  -- again once that exists.
  corrected boolean
);
alter table voice_command_log enable row level security;
create policy "own log rows only" on voice_command_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Written directly by the client via supabase-js under this policy, same
-- as every other piece of this app's own data (tasks, weights, habits...
-- all in planner_data) -- not by the voice-command Edge Function, which
-- stays a stateless transcript-in/normalized-text-out proxy to the VPS and
-- never touches the database. parseCommand()'s result (the actual parsed
-- intent) only exists client-side, so the client is what writes the full
-- row -- transcript, normalized_text, parsed_intent, and whether it
-- applied -- in one insert after running its own existing logic.
