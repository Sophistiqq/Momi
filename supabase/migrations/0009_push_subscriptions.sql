-- Web push subscriptions: one row per device per person. endpoint is the
-- natural primary key (browsers hand out one unique URL per subscription).
create table if not exists push_subscriptions (
  user_id text not null,
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "push subscriptions are read-only to authenticated users" on push_subscriptions
  for select to authenticated using (true);
