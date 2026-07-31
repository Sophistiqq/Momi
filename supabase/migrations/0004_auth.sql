-- Gate every table behind authentication. The anon key is public (it ships in
-- the PWA), so without RLS anyone could read the whole journal via PostgREST.
-- Writes go through the edge function (service role), which bypasses RLS, so
-- read-only policies for signed-in users are enough.
alter table posts enable row level security;
alter table post_media enable row level security;
alter table comments enable row level security;

create policy "signed-in users can read posts"
  on posts for select to authenticated using (true);

create policy "signed-in users can read post_media"
  on post_media for select to authenticated using (true);

create policy "signed-in users can read comments"
  on comments for select to authenticated using (true);
