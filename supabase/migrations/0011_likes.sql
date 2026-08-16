create table if not exists post_likes (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null,
  author text not null default '',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table post_likes enable row level security;

create policy "signed-in users can read post_likes"
  on post_likes for select to authenticated using (true);
