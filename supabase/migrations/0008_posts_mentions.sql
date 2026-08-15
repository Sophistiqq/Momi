alter table posts add column if not exists mentions text[] not null default '{}';
