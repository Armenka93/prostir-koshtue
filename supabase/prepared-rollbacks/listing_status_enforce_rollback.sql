-- ============================================================================
-- Простір Коштує — ОТКАТ Migration B (enforce) — подготовленная
-- компенсирующая миграция. НЕ ПРИМЕНЕНА. apply_migration не вызывался.
-- ============================================================================
-- 9th round audit — РАСПОЛОЖЕНИЕ. Этот файл сознательно лежит ВНЕ
-- supabase/migrations/ и вне обычного рабочего каталога выпуска A/B —
-- `supabase db push` / `migration up` обходят каждый файл в migrations/ по
-- порядку имени и применили бы его как обычную "следующую" миграцию при
-- любом штатном прогоне, даже когда B должна оставаться применённой. Файл
-- здесь — не мигрция в очереди, а ГОТОВЫЙ ЧЕРНОВИК, который добавляют в
-- очередь ТОЛЬКО в момент принятого решения об откате.
--
-- Порядок применения, когда (и если) решение об откате B принято:
--   1. Скопировать этот файл в supabase/migrations/ под ИМЕНЕМ С АКТУАЛЬНОЙ
--      НА ТОТ МОМЕНТ датой-версией (позже последней реально применённой
--      миграции на момент отката — НЕ 20260830120000 и не любая другая
--      дата, зафиксированная здесь заранее: к моменту реального отката
--      после B могли накопиться другие миграции, и версия должна быть
--      актуальной, а не "зарезервированной" сегодня).
--   2. Перед копированием — свериться, что SQL ниже всё ещё дословно
--      соответствует ДЕЙСТВУЮЩЕЙ на тот момент версии Migration B (SHA-256
--      файла B ниже фиксирует, для какой именно версии B этот откат
--      готовился; если B с тех пор менялась — этот черновик нужно
--      пересмотреть, а не применять как есть).
--   3. Применить получившийся файл через обычный apply_migration —
--      применение истории и есть акт отката, никакого отдельного
--      "сначала вручную выполнить SQL, потом оформить как миграцию" шага.
--
-- НЕ применять при обычном ходе выпуска. Существует только на случай, если
-- Migration B (20260830110000_listing_status_enforce.sql) уже применена в
-- проде и её нужно откатить.
--
-- Содержимое SQL — дословно раздел ROLLBACK из файла B (актуален на момент
-- SHA-256 файла B = 71FE6E1ACBDC9C56CEDB818BD80005B2B6F4E21BE72073FDBB21D6ED0A076796,
-- 9th round — включает оба legacy-client guard'а на INSERT и UPDATE; сам
-- SQL DDL идентичен 8th round (33B11BB5...), изменились только комментарии
-- в файле B про точность формулировки guard'ов, не исполняемый код).
-- Локально проверено (7th round, отдельная одноразовая копия): данные
-- сохраняются, публичная видимость и поведение Migration A (rate-limit
-- триггер, listings_required_when_public) восстанавливаются корректно —
-- см. отчёт по Requirement 4. Этот файл дополнительно проверен как
-- САМОСТОЯТЕЛЬНАЯ миграция (8th round) — накатывается поверх A+B с exit 0.
-- Обе проверки — на SQL, идентичном текущему; при реальном проде-откате
-- нужно повторно проверить на актуальной копии, если B к тому моменту
-- менялась (см. шаг 2 выше).
--
-- Migration A этим файлом НЕ откатывается — см. её собственный ROLLBACK
-- раздел, отдельное решение. Реконсиляция раздела 0 файла B (backfill
-- status) тоже не откатывается — это разовое исправление данных, не
-- структурное изменение; для возврата status к состоянию до B нужен
-- отдельный backup/point-in-time restore, не DDL.
-- ============================================================================

-- 6. RLS — назад к состоянию из 20260811191254_stage2_rls_hardening.sql:
drop policy if exists "admin can delete any listing"                on public.listings;
drop policy if exists "owner can delete own draft or archived listings" on public.listings;
drop policy if exists "admin can update any listing"                on public.listings;
drop policy if exists "owner can update own listings"                on public.listings;
drop policy if exists "owner can insert own draft listings"          on public.listings;
drop policy if exists "admin can read all listings"                  on public.listings;
drop policy if exists "owner can read own listings any status"       on public.listings;
drop policy if exists "public can read active listings"              on public.listings;

create policy "anyone can read active listings" on public.listings for select using (is_active = true);
create policy "owner can insert own listings" on public.listings for insert with check (owner_id = auth.uid());
create policy "owner or admin can delete own listings" on public.listings for delete using (owner_id = auth.uid() or public.is_admin());
create policy "owner or admin can read own listings incl. archived" on public.listings for select using (owner_id = auth.uid() or public.is_admin());
create policy "owner or admin can update own listings" on public.listings for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());

-- 5. Триггер:
drop trigger if exists enforce_listing_lifecycle on public.listings;
drop function if exists public.enforce_listing_lifecycle();
drop function if exists public.check_publish_rate_limit();

-- Восстановить триггер лимита — ДОСЛОВНО из Migration A
-- (20260830100000_listing_status_expand.sql, раздел 1.2) как она стоит
-- ПОСЛЕ 6th round audit fix: BEFORE INSERT OR UPDATE, TG_OP-aware тело
-- (charges только на реальный переход в is_active=true, INSERT или
-- UPDATE), НЕ первоначальный оригинал из 20260819181213 (BEFORE INSERT
-- ONLY, безусловный на каждый INSERT). Откат ТОЛЬКО B должен вернуть
-- систему ровно в состояние "A применена, B ещё нет" — в этом состоянии
-- обе защиты A (rate-limit guard и required-when-public CHECK) уже
-- стоят и должны остаться, иначе откат B сам по себе тихо открыл бы обе
-- регрессии, которых не было до отката.
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
  v_becomes_public boolean;
begin
  if TG_OP = 'INSERT' then
    v_becomes_public := (NEW.is_active is true);
  else
    v_becomes_public := (OLD.is_active is not true) and (NEW.is_active is true);
  end if;

  if not v_becomes_public then
    return NEW;
  end if;

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

  return NEW;
end;
$$;

revoke execute on function public.enforce_listing_rate_limit() from public, anon, authenticated;

drop trigger if exists enforce_listing_rate_limit on public.listings;
create trigger enforce_listing_rate_limit
  before insert or update on public.listings
  for each row
  execute function public.enforce_listing_rate_limit();

-- Восстановить временную защиту от Migration A (тем же принципом —
-- откат B возвращает в состояние "A без B", где эта защита обязана
-- существовать):
alter table public.listings add constraint listings_required_when_public
  check (
    is_active is not true or (
      title is not null and btrim(title) <> '' and
      type is not null and btrim(type) <> '' and
      price is not null and price > 0 and
      area is not null and area > 0 and
      district is not null and btrim(district) <> '' and
      address is not null and btrim(address) <> ''
    )
  );

-- 2-3. Constraints:
alter table public.listings drop constraint if exists listings_rejection_reason_check;
alter table public.listings drop constraint if exists listings_max_photos;
alter table public.listings drop constraint if exists listings_required_for_review;
-- Функция ниже дропается ПОСЛЕ constraint'а, который её вызывает —
-- иначе DROP FUNCTION упадёт с "cannot drop function ... because other
-- objects depend on it" (constraint зависит от функции).
drop function if exists public.count_distinct_nonempty_images(text[]);

-- 1. Default:
alter table public.listings alter column status set default 'active';

-- ============================================================================
-- Production (будущее действие, отдельное разрешение)
-- ============================================================================
-- Копирование этого файла в supabase/migrations/ и его apply_migration —
-- реальное решение откатить B в проде, требует отдельного явного
-- разрешения пользователя, отдельного от разрешения на исходный выпуск A/B.
--
-- Migration history после реального применения: `supabase migration repair`
-- / `db pull` против прода НЕ выполнять — скопированный файл сам ведёт себя
-- как обычная forward-миграция (B применена → откачена миграцией со
-- следующей по порядку датой), поэтому supabase_migrations.schema_migrations
-- остаётся правдивой и линейной без какого-либо ручного редактирования
-- истории. Если B нужно будет включить снова позже — это отдельный,
-- третий файл (ещё одна forward-миграция, переигрывающая DDL B), а не
-- повторное применение оригинального файла B после правки истории.
-- ============================================================================
