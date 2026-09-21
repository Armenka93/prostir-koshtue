insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

create policy "public read chat-images" on storage.objects
for select using (bucket_id = 'chat-images');

create policy "public upload chat-images" on storage.objects
for insert with check (bucket_id = 'chat-images');;
