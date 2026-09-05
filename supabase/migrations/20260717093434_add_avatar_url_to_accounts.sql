alter table public.accounts add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "public read avatars" on storage.objects
for select using (bucket_id = 'avatars');

create policy "public upload avatars" on storage.objects
for insert with check (bucket_id = 'avatars');

create policy "public update avatars" on storage.objects
for update using (bucket_id = 'avatars');

create policy "public delete avatars" on storage.objects
for delete using (bucket_id = 'avatars');;
