-- Persistent per-user favorites, tied to the account id (accounts.id is text,
-- e.g. 'u_1779302863543'). One row per (user, listing) guarantees a listing
-- can be favorited only once per user and makes unfavoriting a simple delete.
create table if not exists public.favorites (
  user_id    text   not null,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Fast lookup of "all listings this user favorited" (used on login/page load).
create index if not exists favorites_user_id_idx on public.favorites(user_id);
create index if not exists favorites_listing_id_idx on public.favorites(listing_id);

-- Keep listings.likes (the shown counter) automatically in sync with the
-- favorites table. This makes the count impossible to drift: it is derived
-- from real rows, not from separate frontend +1/-1 calls that could double up.
create or replace function public.sync_listing_likes()
returns trigger
language plpgsql
security definer
as $$
begin
  if (TG_OP = 'INSERT') then
    update public.listings
      set likes = coalesce(likes, 0) + 1
      where id = NEW.listing_id;
    return NEW;
  elsif (TG_OP = 'DELETE') then
    update public.listings
      set likes = greatest(0, coalesce(likes, 0) - 1)
      where id = OLD.listing_id;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists favorites_sync_likes on public.favorites;
create trigger favorites_sync_likes
  after insert or delete on public.favorites
  for each row execute function public.sync_listing_likes();

-- Follow the same access pattern the rest of this project uses (accounts,
-- chats, messages all have RLS enabled with permissive policies, since the
-- app uses its own account system, not Supabase Auth).
alter table public.favorites enable row level security;

drop policy if exists "public all favorites" on public.favorites;
create policy "public all favorites" on public.favorites
  for all using (true) with check (true);

grant all on public.favorites to anon, authenticated, service_role;;
