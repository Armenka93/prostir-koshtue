-- ============================================================================
-- Простір Коштує — rate limiting на создание объявлений
-- ПОДГОТОВЛЕНО, НЕ ПРИМЕНЕНО. Ничего из этого файла не выполнялось.
--
-- Контекст: создание объявления идёт напрямую из браузера в Supabase
-- (supabase.from('listings').insert(...) в src/lib/db.ts), без backend/API
-- слоя. Единственный уровень, через который ОБЯЗАТЕЛЬНО проходит любой
-- INSERT независимо от источника (UI, curl, Postman, другая
-- вкладка/устройство) — сама база Postgres. Отсюда решение: триггер на
-- таблице, а не middleware/API route (Next.js middleware физически не
-- видит REST-трафик к Supabase — он идёт на другой хост).
--
-- ВТОРАЯ ИТЕРАЦИЯ этого файла — первая версия (COUNT(*) по
-- public.listings.created_at) была отклонена ДО применения из-за двух
-- реальных обходов:
--   1) created_at в listings — обычное клиентское поле; прямой REST-запрос
--      мог прислать искусственно старый created_at и вывести свежий INSERT
--      из окна подсчёта.
--   2) COUNT по listings можно было обнулить, удалив свои же объявления
--      (create → delete → create → delete ...), поскольку DELETE уменьшает
--      число строк, которые видит COUNT.
-- Решение: источник истины для лимита — ОТДЕЛЬНАЯ append-only таблица
-- public.listing_publish_events, которую обычный клиент не может ни
-- читать, ни писать, ни удалять НИКАК (ни через UI, ни через прямой REST) —
-- писать в неё может только сам триггер (SECURITY DEFINER). listings
-- триггером для подсчёта лимита больше не читается вообще.
--
-- Что делает эта миграция:
--   - создаёт служебную таблицу public.listing_publish_events (история
--     успешных публикаций, addition-only, недоступна клиенту)
--   - добавляет индекс (user_id, created_at desc) на неё
--   - добавляет BEFORE INSERT trigger на public.listings, который:
--       auth.uid() → advisory lock → COUNT по listing_publish_events
--       (5/10 мин, 20/24 часа) → если ок, INSERT в listing_publish_events
--       → return new (разрешить INSERT в listings)
--   - защищает от race condition между параллельными INSERT одного
--     пользователя через pg_advisory_xact_lock
--
-- Что эта миграция НЕ делает:
--   - не трогает Supabase Auth
--   - не меняет ни одной существующей RLS policy на listings/accounts/
--     favorites/chats/messages/feedback (см. STAGE 2 в
--     20260806_auth_rls_hardening.sql — "owner can insert own listings"
--     остаётся как есть, эта миграция работает СВЕРХУ неё, не вместо)
--   - не меняет схему listings вообще — ни колонок, ни constraints, ни
--     индексов на listings эта версия не создаёт (в отличие от первой
--     отклонённой итерации — тот индекс на listings был нужен только для
--     подсчёта по listings, который здесь больше не делается)
--   - не удаляет и не изменяет ни одной существующей строки в любой таблице
--   - не ограничивает SELECT/UPDATE/DELETE на listings — только INSERT
-- ============================================================================


-- ============================================================================
-- 1. Служебная таблица истории публикаций
-- ============================================================================
--
-- Минимальные поля по требованию: id, user_id, created_at. user_id — просто
-- uuid, БЕЗ FK на auth.users(id) (намеренно, в отличие от остальных
-- пользовательских ссылок в схеме проекта вроде listings.owner_id). Служебная
-- история rate-limit не должна создавать зависимость, которая помешала бы
-- удалить пользователя из auth.users — FK с ON DELETE RESTRICT/NO ACTION
-- заблокировал бы такое удаление, пока в этой таблице остаются его строки.
-- Целостность значения тем не менее гарантирована на уровне кода, а не FK:
-- единственный писатель — SECURITY DEFINER триггерная функция
-- enforce_listing_rate_limit() ниже, которая всегда берёт user_id из
-- auth.uid() текущей сессии и никогда не принимает его от клиента.
create table if not exists public.listing_publish_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  created_at timestamptz not null default now()
);

comment on table public.listing_publish_events is
  'Server-side append-only history of successful listing publish attempts, '
  'used only by enforce_listing_rate_limit(). Not readable/writable by '
  'anon/authenticated — see RLS + REVOKE below. Never exposed as client CRUD.';

-- Индекс под ровно тот фильтр, который делает триггер:
-- WHERE user_id = ? AND created_at >= ?
create index if not exists idx_listing_publish_events_user_created
  on public.listing_publish_events (user_id, created_at desc);

-- ── RLS + grants: таблица полностью недоступна клиенту ────────────────────
-- Два независимых слоя защиты, оба перекрывают друг друга намеренно:
--
--  (а) RLS enabled, ноль policies. В Postgres/PostgREST это означает: ни
--      одна роль, кроме владельца таблицы (или роли с BYPASSRLS), не может
--      выполнить НИ ОДНУ операцию — SELECT/INSERT/UPDATE/DELETE — вне
--      зависимости от табличных GRANT'ов. Это тот же паттерн, что уже
--      применён в этом проекте для public.accounts (STAGE 2, см.
--      20260806_auth_rls_hardening.sql, п.2.3: "RLS включён, политик ноль
--      => доступ только у service_role/владельца").
--
--  (б) Явный REVOKE табличных grant'ов от anon/authenticated. Технически
--      избыточно поверх (а) — но Supabase по умолчанию выдаёт новым
--      таблицам в public широкие ALTER DEFAULT PRIVILEGES на
--      anon/authenticated/service_role, и explicit REVOKE делает
--      security-посture проверяемым при read-only аудите (как в этой
--      сессии — pg_policies одной RLS не покажет табличные grants), а не
--      зависящим только от "мы просто не написали policy".
--
-- service_role НЕ трогаем — это серверный ключ, не выдаётся клиенту,
-- нужен для возможного будущего админ/мониторингового доступа к этой
-- таблице напрямую.
alter table public.listing_publish_events enable row level security;

revoke all on public.listing_publish_events from anon, authenticated;
revoke all on public.listing_publish_events from public;

-- Явно НЕТ ни одной policy на эту таблицу — INSERT в неё делает
-- исключительно SECURITY DEFINER функция ниже, от имени своего владельца,
-- который RLS не подчиняется (как handle_new_auth_user() уже делает для
-- accounts в существующей миграции).


-- ============================================================================
-- 2. Триггерная функция
-- ============================================================================
--
-- SECURITY DEFINER — здесь ОБЯЗАТЕЛЕН, в отличие от первой (отклонённой)
-- версии этого файла. Причина: функции нужны SELECT и INSERT на
-- listing_publish_events, а у роли authenticated их нет и не должно быть
-- (см. блок RLS/grants выше — это принципиально, таблица не должна быть
-- доступна authenticated "просто чтобы триггер работал", это прямо
-- запрещено требованием). SECURITY DEFINER выполняет функцию с правами её
-- владельца (той же роли, что владеет и самой таблицей — обе создаются в
-- одной миграции), поэтому эта функция обходит RLS ровно и только для
-- операций с listing_publish_events, оставаясь единственной дверью в эту
-- таблицu.
--
-- search_path зафиксирован (pg_catalog, public) — обязательное требование
-- для любой SECURITY DEFINER функции, иначе вызывающая сторона теоретически
-- может подменить search_path перед вызовом и подсунуть свой объект вместо
-- public.listing_publish_events/auth.uid() (search_path hijacking). Все
-- обращения к таблицам в теле функции дополнительно даны с явным префиксом
-- схемы (public.listing_publish_events) — не полагаемся только на
-- search_path.
--
-- auth.uid() внутри SECURITY DEFINER продолжает возвращать РЕАЛЬНОГО
-- текущего пользователя: она читает GUC request.jwt.claim.sub — сессионную
-- настройку текущего запроса, которую PostgREST выставляет один раз на
-- HTTP-запрос независимо от того, под какой ролью выполняется конкретная
-- SQL-функция внутри транзакции. DEFINER меняет то, ЧЬИ ПРИВИЛЕГИИ
-- используются для проверки прав доступа — не то, что возвращает auth.uid().
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
  -- Как и в предыдущей версии: НЕ читаем NEW.owner_id (клиентское поле,
  -- BEFORE ROW триггер к тому же выполняется до проверки RLS WITH CHECK на
  -- listings, так что NEW.owner_id на этом этапе ещё не гарантированно
  -- равен auth.uid()). Единственный источник личности — auth.uid(),
  -- полученный из проверенного JWT текущей сессии.
  v_owner := auth.uid();

  if v_owner is null then
    -- Защитный fallback: существующая INSERT-policy на listings ("owner
    -- can insert own listings", to authenticated) и так не пускает сюда
    -- анонимные запросы — оставлено на случай будущих изменений RLS.
    raise exception 'LISTING_RATE_LIMIT_NO_AUTH';
  end if;

  -- ── Сериализация параллельных попыток публикации одного пользователя ──
  -- pg_advisory_xact_lock — transaction-level lock: захватывается здесь,
  -- освобождается автоматически в конце текущей транзакции (COMMIT или
  -- ROLLBACK). Без этого лока два параллельных INSERT одного пользователя
  -- могли бы оба выполнить COUNT ниже до того, как другой закоммитит свою
  -- запись в listing_publish_events, оба увидеть один и тот же (не
  -- увеличенный) count и оба пройти проверку лимита (TOCTOU race).
  --
  -- Ключ лока — 64-битное число из hex-среза md5-хэша UUID пользователя.
  -- У разных пользователей (разных auth.uid()) ключи с подавляющей
  -- вероятностью разные (64-битное пространство) — но это НЕ гарантия
  -- "разные UUID — разные ключи всегда": md5-хэш в 64 бита теоретически
  -- допускает коллизию между двумя разными auth.uid(). Такая коллизия —
  -- НЕ обход лимита: COUNT ниже всё равно фильтруется по реальному
  -- user_id = v_owner, чужие события в подсчёт не попадут ни при каких
  -- условиях. Коллизия ключей в худшем случае означает, что транзакция
  -- одного пользователя на короткое время подождёт снятия лока другого
  -- (случайного, никак не связанного) пользователя — не более того.
  v_lock_key := ('x' || substr(md5(v_owner::text), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  -- ── Burst limit: не более 5 публикаций за последние 10 минут ──────────
  -- Считаем по listing_publish_events, НЕ по listings — эту таблицу
  -- нельзя ни подделать (created_at всегда серверный now(), см. INSERT
  -- ниже — клиент никогда не пишет в эту таблицу вообще), ни обнулить
  -- через DELETE объявления (DELETE FROM listings никак не касается
  -- listing_publish_events — это независимая, ничем не связанная с
  -- listings таблица, без FK/CASCADE между ними).
  --
  -- Выполняется ПОСЛЕ захвата лока — если два запроса одного пользователя
  -- пришли параллельно, второй дождётся здесь коммита/отката первого и
  -- увидит уже актуальный count.
  select count(*) into v_count_burst
  from public.listing_publish_events
  where user_id = v_owner
    and created_at >= now() - interval '10 minutes';

  if v_count_burst >= 5 then
    raise exception 'LISTING_RATE_LIMIT_10_MIN';
  end if;

  -- ── Daily limit: не более 20 публикаций за последние 24 часа ───────────
  select count(*) into v_count_daily
  from public.listing_publish_events
  where user_id = v_owner
    and created_at >= now() - interval '24 hours';

  if v_count_daily >= 20 then
    raise exception 'LISTING_RATE_LIMIT_24_HOURS';
  end if;

  -- ── Фиксируем факт публикации ────────────────────────────────────────
  -- created_at не указываем явно — берётся из column default (now()),
  -- то есть всегда серверное время в момент реальной вставки, никогда не
  -- значение из тела запроса клиента (у listing_publish_events вообще нет
  -- клиентского INSERT-пути, которым можно было бы передать created_at).
  --
  -- Это происходит внутри той же транзакции, что и сам INSERT в listings
  -- (BEFORE ROW триггер — часть той же транзакции, что вызвавший его
  -- INSERT; PostgREST выполняет каждый HTTP-запрос как одну транзакцию).
  -- Если ПОСЛЕ этой точки INSERT в listings всё же будет отклонён RLS WITH
  -- CHECK, NOT NULL constraint, FK или любой другой ошибкой — вся
  -- транзакция откатится целиком, включая эту вставку в
  -- listing_publish_events. Событие "потратит" лимит только если реальное
  -- объявление действительно было создано.
  insert into public.listing_publish_events (user_id) values (v_owner);

  return new;
end;
$$;

-- Функция возвращает trigger — Postgres в принципе не даёт вызвать такую
-- функцию напрямую через SELECT/RPC ("trigger functions can only be called
-- as triggers"), только через реальный триггер. REVOKE EXECUTE — явное,
-- защитное подтверждение того же самого на уровне привилегий, а не
-- полагание только на это ограничение типа возврата. На срабатывание
-- самого триггера REVOKE EXECUTE не влияет: вызов триггерной функции —
-- часть внутреннего DML-процессинга Postgres, а не обычный вызов функции
-- текущей ролью, поэтому EXECUTE-привилегия invoking-роли здесь не
-- проверяется.
revoke execute on function public.enforce_listing_rate_limit() from public, anon, authenticated;


-- ============================================================================
-- 3. Триггер на public.listings
-- ============================================================================
-- BEFORE INSERT, FOR EACH ROW — публикация всегда идёт одной строкой
-- (supabase.from('listings').insert(row).select().single() в db.ts), но
-- FOR EACH ROW корректен и для гипотетического будущего bulk-insert.
-- Только INSERT — UPDATE/DELETE/SELECT на listings этот триггер не
-- затрагивает, схему/constraints/RLS самой listings не меняет.
drop trigger if exists enforce_listing_rate_limit on public.listings;
create trigger enforce_listing_rate_limit
  before insert on public.listings
  for each row
  execute function public.enforce_listing_rate_limit();

-- ============================================================================
-- Почему это нельзя обойти прямым Supabase REST / curl / Postman:
-- PostgREST не имеет отдельного "быстрого" пути для INSERT — каждый вызов
-- REST API транслируется в обычный SQL INSERT INTO listings ..., который
-- проходит через ВСЕ обычные механизмы Postgres: constraints, triggers,
-- RLS. Отключить конкретно триггер может только роль уровня владельца
-- таблицы/суперпользователя (ALTER TABLE ... DISABLE TRIGGER или
-- session_replication_role = replica) — этого нет ни у anon, ни у
-- authenticated роли, только у service_role/владельца БД. Подделать
-- auth.uid() тоже нельзя — JWT проверяется и парсится Supabase/PostgREST
-- до обращения к базе, невалидная подпись = 401 раньше, чем запрос вообще
-- коснётся listings. А сама таблица-источник истины
-- (listing_publish_events) для anon/authenticated закрыта на два
-- независимых замка (RLS без policies + REVOKE) — прочитать или
-- записать её напрямую через REST невозможно ни при каких заголовках и
-- ни с каким валидным пользовательским JWT, только с секретным
-- service_role-ключом, который никогда не попадает в браузер.
-- ============================================================================


-- ============================================================================
-- ROLLBACK (для справки — НЕ выполняется этой миграцией автоматически).
-- Полностью аддитивно: откат не трогает listings/данные/другие таблицы/RLS.
--
--   drop trigger if exists enforce_listing_rate_limit on public.listings;
--   drop function if exists public.enforce_listing_rate_limit();
--   drop table if exists public.listing_publish_events;
--     -- дропает вместе с собой и её индекс
--     -- (idx_listing_publish_events_user_created), отдельного DROP INDEX
--     -- не требуется.
-- ============================================================================
