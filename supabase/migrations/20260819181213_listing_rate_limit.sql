-- ============================================================================
-- Простір Коштує — rate limiting на создание объявлений
-- ============================================================================

-- 1. Служебная таблица истории публикаций
create table if not exists public.listing_publish_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.listing_publish_events is
  'Server-side append-only history of successful listing publish attempts, '
  'used only by enforce_listing_rate_limit(). Not readable/writable by '
  'anon/authenticated — see RLS + REVOKE below. Never exposed as client CRUD.';

create index if not exists idx_listing_publish_events_user_created
  on public.listing_publish_events (user_id, created_at desc);

alter table public.listing_publish_events enable row level security;

revoke all on public.listing_publish_events from anon, authenticated;
revoke all on public.listing_publish_events from public;

-- 2. Триггерная функция
create or replace function public.enforce_listing_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_lock_key bigint;
  v_count_burst integer;
  v_count_daily integer;
begin
  v_owner := auth.uid();

  if v_owner is null then
    raise exception 'LISTING_RATE_LIMIT_NO_AUTH';
  end if;

  v_lock_key := ('x' || substr(md5(v_owner::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select count(*) into v_count_burst
  from public.listing_publish_events
  where user_id = v_owner
    and created_at >= now() - interval '10 minutes';

  if v_count_burst >= 5 then
    raise exception 'LISTING_RATE_LIMIT_10_MIN';
  end if;

  select count(*) into v_count_daily
  from public.listing_publish_events
  where user_id = v_owner
    and created_at >= now() - interval '24 hours';

  if v_count_daily >= 20 then
    raise exception 'LISTING_RATE_LIMIT_24_HOURS';
  end if;

  insert into public.listing_publish_events (user_id) values (v_owner);

  return new;
end;
$$;

revoke execute on function public.enforce_listing_rate_limit() from public, anon, authenticated;

-- 3. Триггер на public.listings
drop trigger if exists enforce_listing_rate_limit on public.listings;
create trigger enforce_listing_rate_limit
  before insert on public.listings
  for each row
  execute function public.enforce_listing_rate_limit();
;
