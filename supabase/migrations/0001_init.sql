create table if not exists posts (
  id text primary key,
  caption text not null default '',
  created_at timestamptz not null default now(),
  status text not null default 'pending_style',
  style_json text
);

create table if not exists post_media (
  id text primary key,
  post_id text not null references posts(id),
  object_key text not null,
  mime_type text not null,
  width integer,
  height integer,
  sort_order integer not null default 0
);

insert into storage.buckets (id, name, public)
values ('moments', 'moments', false)
on conflict (id) do nothing;
