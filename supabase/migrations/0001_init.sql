-- Life Planner SaaS schema.
-- Run this once in the Supabase dashboard: Project -> SQL Editor -> New query -> paste -> Run.

-- One row per user, mirrors the app's existing single-blob data shape.
create table if not exists planner_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table planner_data enable row level security;
create policy "own data only" on planner_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trial/subscription status per user. Only the Stripe webhook (service role,
-- bypasses RLS) ever writes rows in this table after the initial insert.
create table if not exists subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'trialing', -- trialing | active | past_due | canceled
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  stripe_customer_id text,
  stripe_subscription_id text,
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;
create policy "read own subscription" on subscriptions
  for select using (auth.uid() = user_id);

-- Auto-create a trialing subscriptions row the moment someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.subscriptions (user_id) values (new.id);
  insert into public.planner_data (user_id, data) values (new.id, '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
