create table if not exists comments (
  id text primary key,
  post_id text not null references posts(id),
  author text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
