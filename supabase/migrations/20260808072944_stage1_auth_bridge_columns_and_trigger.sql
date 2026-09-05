-- STAGE 1 — additive prep only, from supabase/migrations/20260806_auth_rls_hardening.sql
-- (STAGE 2 / RLS policy changes / backfill UPDATEs deliberately NOT included)

-- 1.1 accounts: bridge column to auth.users. Nullable — backfilled separately.
alter table public.accounts
  add column if not exists auth_id uuid references auth.users(id);

create unique index if not exists accounts_auth_id_key
  on public.accounts(auth_id)
  where auth_id is not null;

-- 1.2 Listing owner as Supabase Auth UUID, alongside the old text user_id.
alter table public.listings
  add column if not exists owner_id uuid references auth.users(id);

-- 1.3 Same bridge for the other user-owned tables.
alter table public.favorites
  add column if not exists user_id_uuid uuid references auth.users(id);

alter table public.chats
  add column if not exists buyer_id_uuid  uuid references auth.users(id),
  add column if not exists seller_id_uuid uuid references auth.users(id);

alter table public.messages
  add column if not exists sender_id_uuid uuid references auth.users(id);

-- 1.5 Auto-create the accounts profile row on Supabase Auth signup.
-- Sole source of truth for that insert — no client-side INSERT anymore.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (id, auth_id, name, email, phone, role, password_hash, created_at)
  values (
    'auth_' || new.id::text,
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'phone', ''),
    -- No email-based admin bootstrap — every new signup is plain 'landlord'.
    -- Admin is assigned manually afterwards.
    'landlord',
    '',  -- password no longer stored in accounts — Supabase Auth owns it
    now()
  )
  on conflict (auth_id) where auth_id is not null do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 1.6 is_admin() helper for future RLS policies (not wired into any policy yet).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.accounts
    where auth_id = auth.uid() and role = 'admin'
  );
$$;
;
