-- Voice assistant: "what kind of command was that?" learning. When a
-- phrase falls through every domain's own trigger word (no match at all --
-- see quickCapture.js's parseCommand returning {kind:"none"}), QuickCapture
-- asks by voice which of the eight command types it was, then re-parses
-- the original phrase as that type without needing its usual trigger word
-- (see forceParseByType). This table remembers that answer so the exact
-- same phrase skips both the question AND the round trip to Ollama next
-- time -- see QuickCapture.jsx's runVoiceTranscript, which checks this
-- (mirrored into data.commandTypeAliases, same "separate table, mirrored
-- in for synchronous lookups" shape as voice_aliases/0008) before ever
-- calling the voice-command Edge Function.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

create table if not exists command_type_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phrase text not null, -- normalized (lowercase, trimmed) original failed phrase
  command_type text not null, -- one of: weight, habit, expense, income, task, bill, account, meal, workout, question -- "bill" itself further splits into "billPay"/"billAdd" once the add-or-pay disambiguation (QuickCapture.jsx) has been answered for that phrase
  created_at timestamptz not null default now(),
  unique(user_id, phrase)
);
alter table command_type_aliases enable row level security;
create policy "own command type aliases only" on command_type_aliases for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
