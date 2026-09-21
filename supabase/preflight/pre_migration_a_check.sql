-- ============================================================================
-- PREFLIGHT — перед применением Migration A (20260830100000_listing_status_expand.sql)
-- ============================================================================
-- READ-ONLY. Безопасно выполнять напрямую против production (только SELECT,
-- ни одного изменяющего оператора). Не миграция, не ставится в очередь.
--
-- Выполнять НЕПОСРЕДСТВЕННО перед разрешённым применением A — не заранее
-- "для галочки": между подготовкой этого файла и реальным применением
-- прод могла измениться (новые объявления, ручные правки схемы).
-- ============================================================================


-- ── 1. История миграций ──────────────────────────────────────────────────
-- Ожидается: последняя примененная версия = 20260830090000 (storage policy).
-- 20260830100000 (A) и 20260830110000 (B) НЕ должны присутствовать —
-- если хотя бы одна уже есть, остановиться и разобраться, а не продолжать.
select version, name from supabase_migrations.schema_migrations order by version desc limit 15;

-- Локально (для сверки построчно, не входит в этот SQL-файл, выполнить
-- отдельно рядом): Get-ChildItem supabase\migrations | Sort Name
-- Ожидаемый полный список к этому моменту (11 файлов):
--   20260715154321_create_favorites_table
--   20260717093434_add_avatar_url_to_accounts
--   20260721201145_add_image_url_to_messages
--   20260721201155_create_chat_images_bucket
--   20260723045219_add_chat_images_bucket
--   20260808072944_stage1_auth_bridge_columns_and_trigger
--   20260811191254_stage2_rls_hardening
--   20260819181213_listing_rate_limit
--   20260830090000_listing_images_storage_policy
-- (20260830100000 и 20260830110000 — ГОТОВЯТСЯ, не в истории)


-- ── 2. SHA-256 файла миграции (сверить ПЕРЕД apply, не полагаться на
--      значение, зафиксированное в более раннем отчёте) ────────────────────
-- Выполнить локально прямо перед apply:
--   Get-FileHash supabase\migrations\20260830100000_listing_status_expand.sql -Algorithm SHA256
-- Ожидается ровно:
--   EEA8462970598BA567FC34EEE726D398E5E137056E54FE77706A6EBD72DA70A6
-- Любое расхождение — файл изменился после согласования, остановиться.


-- ── 3. Ожидаемая исходная схема/триггер (то, что A собирается ЗАМЕНИТЬ) ──
-- A делает `create or replace function enforce_listing_rate_limit()` и
-- пересоздаёт триггер как BEFORE INSERT OR UPDATE. Это безопасно только
-- если СЕЙЧАС в проде стоит ИМЕННО оригинальная версия из
-- 20260819181213_listing_rate_limit.sql — BEFORE INSERT ONLY,
-- безусловная на каждый INSERT, TG_OP не читает.
select tgname, tgtype, tgenabled
from pg_trigger
where tgrelid = 'public.listings'::regclass and not tgisinternal;
-- Ожидается РОВНО одна строка: enforce_listing_rate_limit, tgtype
-- соответствует "BEFORE INSERT" (без UPDATE), tgenabled = 'O'.
-- Если триггеров больше одного, или это уже TG_OP-aware версия (кто-то уже
-- накатил A вручную), или триггер отключён — остановиться, не применять A
-- поверх неизвестного состояния.

select pg_get_functiondef('public.enforce_listing_rate_limit'::regproc);
-- Свериться построчно с телом функции ИЗ 20260819181213_listing_rate_limit.sql
-- (не из A — A её только меняет). Любое расхождение с тем, что
-- предполагает A как отправную точку, — остановиться.

-- Заодно подтвердить состояние колонок, которые A собирается трогать —
-- status/pending_review_at/etc НЕ должны существовать ещё:
select column_name from information_schema.columns
where table_name = 'listings' and column_name in
  ('status','rejection_reason','moderated_at','moderated_by',
   'pending_review_at','published_at','archived_at','utilities','building_type');
-- Ожидается: 0 строк. Если хоть одна колонка уже есть — A уже частично
-- применена вручную или другим путём, остановиться и разобраться.


-- ── 4. Совместимость существующих данных с новым CHECK (listings_required_when_public) ──
-- A добавляет: is_active=true требует title/type/price/area/district/address
-- заполненными. До этой миграции такого ограничения не было — возможны
-- реальные публичные записи без части полей.
select id, title, type, price, area, district, address
from public.listings
where is_active is true and not (
  title    is not null and btrim(title)    <> '' and
  type     is not null and btrim(type)     <> '' and
  price    is not null and price > 0 and
  area     is not null and area > 0 and
  district is not null and btrim(district) <> '' and
  address  is not null and btrim(address)  <> ''
);
-- СТОП-УСЛОВИЕ: любая строка в результате — A НЕ применять. Это отдельное
-- решение (исправить конкретные записи или пересмотреть constraint), не
-- автоматическое "исправить и продолжить" в рамках этого прогона.
