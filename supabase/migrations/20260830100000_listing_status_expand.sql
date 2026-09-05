-- ============================================================================
-- Простір Коштує — статусный жизненный цикл, ШАГ A (EXPAND)
-- ПОДГОТОВЛЕНО ДЛЯ АУДИТА E.1, НЕ ПРИМЕНЕНО. apply_migration не вызывался.
--
-- 4-й раунд pre-migration audit — версионирование: переименовано с
-- 20260830_listing_status_expand.sql на полный YYYYMMDDHHMMSS
-- (20260830100000) — изначально этот файл, enforce и storage policy
-- делили одну и ту же 8-значную дату 20260830, что Supabase migration
-- tooling трактует как неоднозначный порядок (в т.ч. риск применить
-- enforce раньше expand). Новый порядок: storage (20260830090000) →
-- ЭТОТ файл, expand (20260830100000) → enforce (20260830110000).
-- Содержимое SQL не менялось, только имя файла и ссылки на него/соседние
-- файлы в комментариях.
--
-- ЭТО ПЕРВЫЙ ИЗ ДВУХ ФАЙЛОВ. Порядок развёртывания строго такой:
--
--   1) применить ЭТОТ файл (migration A / expand)
--   2) задеплоить обновлённый клиентский код (src/lib/db.ts,
--      AddListingScreen.tsx и весь список из отчёта E.1 — "TypeScript")
--      и подтвердить, что он реально работает в проде
--   3) только ПОСЛЕ этого применить 20260830110000_listing_status_enforce.sql
--      (migration B / enforce)
--
-- ВАЖНАЯ ПРАВКА ПОСЛЕ ПРЕДЫДУЩЕЙ ВЕРСИИ ЭТОГО ФАЙЛА: этот файл — НЕ
-- "нулевое изменение поведения". Снятие NOT NULL (раздел 3 ниже) —
-- реальное, необратимое-без-данных расширение допустимых состояний
-- схемы: до этой миграции строка listings физически не могла существовать
-- без title/type/price/area/district/address; после — может. Publicly
-- видимое поведение приложения (что показывает каталог, что делают
-- кнопки) действительно не меняется, потому что старый клиентский код
-- как заполнял все эти поля, так и продолжает — но сама СХЕМА теперь
-- разрешает больше, чем раньше. Это совместимое расширение (существующие
-- строки и существующие пути записи не нарушены), но не "ничего не
-- произошло".
--
-- Применять B раньше шага 2 нельзя — см. подробности в шапке файла B.
--
-- Что делает ИМЕННО этот файл (A):
--   1. Новые колонки на public.listings: status, rejection_reason,
--      moderated_at, moderated_by, utilities, building_type,
--      pending_review_at, published_at, archived_at (E.2.4 — очередь
--      модерации сортируется по pending_review_at, не updated_at).
--   2. Бэкфилл status из существующего is_active для всех текущих строк.
--   3. status получает DEFAULT 'active' — ПОКА ЧТО ведёт себя как
--      is_active по смыслу (см. раздел "Стратегия status между A и B"
--      ниже — это самый важный раздел файла).
--   4. Заменяет ТЕЛО существующей enforce_listing_rate_limit() (не имя, не
--      триггер — см. раздел 1.2) так, чтобы она списывала лимит только с
--      status='active' INSERT (старая прямая публикация), а не с каждого
--      INSERT — иначе создание черновика (status='draft') расходовало бы
--      публикационный лимит впустую, а submit после B списывал бы его же
--      второй раз за одно и то же объявление.
--   5. Индексы (owner_id), (status, created_at desc).
--   6. Снимает NOT NULL с title/type/price/area/district/address —
--      предпосылка для частичного черновика (см. "Анализ NOT NULL").
--
-- Чего этот файл НЕ делает (сознательно, оставлено для B):
--   - НЕ трогает RLS ни одной policy
--   - НЕ трогает ИМЯ/определение триггера enforce_listing_rate_limit —
--     только тело функции, которую он вызывает (см. п.4/раздел 1.2)
--   - НЕ ставит триггер синхронизации/защиты переходов status/is_active
--   - НЕ добавляет CHECK на обязательные поля для pending_review
--   - НЕ удаляет и не переименовывает is_active или любую другую
--     существующую колонку
-- ============================================================================


-- ============================================================================
-- СТРАТЕГИЯ status МЕЖДУ A И B (читать перед apply)
-- ============================================================================
--
-- После применения ТОЛЬКО этого файла (A), без B:
--   - status: NOT NULL, DEFAULT 'active'
--   - is_active: без изменений — тот же nullable boolean, DEFAULT true,
--     как был исходно; ничем новым не тронут
--   - rejection_reason/moderated_at/moderated_by: nullable, без
--     ограничений и без чтения кем-либо
--   - НИКАКОГО триггера, синхронизирующего status и is_active, ещё нет
--
-- Backfill (выполняется один раз, в момент apply A):
--   status = 'active' там, где is_active было true (или NULL — coalesce
--            трактует NULL как true, совпадает с тем, как сегодня трактует
--            это же значение rowToListing() в src/lib/db.ts:
--            `isActive: row.is_active !== false`)
--   status = 'archived' там, где is_active было явно false
-- Это разовая операция над СУЩЕСТВУЮЩИМИ на момент apply строками.
-- Гарантия "ни одна активная запись не станет draft/archived":
--   - в 'draft' backfill не переводит НИ ОДНУ строку ни при каких
--     условиях — 'draft' в этой формуле не встречается вообще;
--   - в 'archived' переводятся только те строки, у которых is_active
--     УЖЕ было false ДО миграции (то есть уже были в архиве по
--     сегодняшней логике dbArchiveListing) — ни одна is_active=true
--     запись не может получить status='archived' этим UPDATE.
--
-- Сценарий "старый клиент создаёт объявление МЕЖДУ A и деплоем нового
-- кода": src/lib/db.ts::listingToRow() сегодня не знает о колонке status
-- и не передаёт её в INSERT. INSERT получает status по DEFAULT — 'active'
-- (см. выше, это и есть причина, по которой default здесь ВРЕМЕННО
-- 'active', а не 'draft'). Одновременно тот же INSERT явно передаёт
-- is_active:true (как и сегодня, listingToRow() пишет это сама). Итог:
-- новая строка получает status='active' И is_active=true — согласовано,
-- публично видна сразу, ПОЛНОСТЬЮ идентично сегодняшнему поведению.
-- Ни в какой момент этого сценария объект не становится "случайно"
-- draft или archived.
--
-- Что ЭТА миграция сознательно НЕ решает и оставляет как есть до B:
-- если в промежутке между A и деплоем нового кода кто-то вызовет
-- dbArchiveListing/dbRestoreListing (меняют только is_active, status не
-- трогают вообще, потому что старый клиент о status не знает) — у такой
-- строки status и is_active временно разойдутся (status останется
-- 'active', is_active уйдёт в false, или наоборот). Это НЕ баг миграции
-- A и не видимый регресс: единственная политика чтения в этом окне —
-- всё ещё "anyone can read active listings" на is_active (RLS не
-- менялась), то есть видимость каталога считается ПО-ПРЕЖНЕМУ по
-- is_active и остаётся корректной. Расхождение в status — чисто
-- внутреннее, невидимое, и B (см. её файл, раздел 0) выполняет
-- повторный, ограниченный по scope backfill прямо перед тем, как status
-- станет источником истины — это устраняет любой накопленный за время
-- A-окна дрейф до включения enforcement.
-- ============================================================================


-- ============================================================================
-- 1. Новые колонки жизненного цикла
-- ============================================================================

alter table public.listings add column if not exists status text;

update public.listings
   set status = case when coalesce(is_active, true) then 'active' else 'archived' end
 where status is null;

alter table public.listings alter column status set not null;
alter table public.listings alter column status set default 'active';  -- временно, см. раздел выше — B меняет на 'draft'

alter table public.listings add constraint listings_status_check
  check (status in ('draft','pending_review','active','rejected','paused','archived'));

alter table public.listings add column if not exists rejection_reason text;

alter table public.listings add column if not exists moderated_at timestamptz;

-- on delete set null — история модерации не должна блокировать будущее
-- удаление auth.users администратора (см. отчёт E.1: именно отсутствие
-- подобного ON DELETE на accounts.auth_id_fkey сейчас не даёт удалить
-- один тестовый неподтверждённый аккаунт).
alter table public.listings add column if not exists moderated_by uuid
  references auth.users(id) on delete set null;

-- pending_review_at / published_at / archived_at — E.2.4 (аудит кабінету
-- модератора виявив, що очередь до цього моменту сортувалась по
-- updated_at, який НЕ є надійним проксі: значимая правка, autosave чи
-- будь-яка інша операція теж чіпає updated_at, не тільки реальний вхід у
-- pending_review). Усі три — timestamptz, nullable, без default:
--   - pending_review_at виставляється ЛИШЕ Migration B'вським
--     enforce_listing_lifecycle() при КОЖНОМУ реальному вході в
--     pending_review (draft→pending_review, rejected→pending_review,
--     примусовий downgrade active/paused/archived→pending_review) —
--     клієнт не може його підробити, деталі й точні місця див. Migration
--     B, розділ 4;
--   - published_at — той самий тригер, момент, коли рядок ФАКТИЧНО стає
--     status='active' (admin-approve АБО власницьке paused/archived→active
--     без правок) — "останній раз опубліковано", не "перший раз колись";
--   - archived_at — той самий тригер, момент входу в status='archived'
--     (власницький archive АБО екстрене admin-зняття).
-- До Migration B (тобто ПІД ЧАС A-вікна) усі три залишаються NULL —
-- чесно, оскільки тригер, який їх виставляє, ще не існує; клієнтський код
-- НЕ пише в них напряму ніде (на відміну від is_active — тут немає
-- потреби в dual-write bridge, бо жодна publicly-видима логіка сьогодні
-- не читає ці три поля).
alter table public.listings add column if not exists pending_review_at timestamptz;
alter table public.listings add column if not exists published_at timestamptz;
alter table public.listings add column if not exists archived_at timestamptz;


-- ============================================================================
-- 1.1. Новые поля объявления (шаг 2 мастера, спека §19) — заранее, чтобы
-- их можно было включить в список "значимых полей" в migration B без
-- отдельной ещё одной миграции перед релизом E.2.
-- ============================================================================
-- Тип и допустимые значения — по тому же принципу, что уже используют
-- существующие соседние колонки type/condition/district: plain text,
-- БЕЗ CHECK на конкретный словарь значений (валидацию словаря сегодня
-- везде в этой схеме делает только клиент — см. PROPERTY_TYPES/
-- CONDITIONS/DISTRICTS в src/types/index.ts; ни у type, ни у condition,
-- ни у district в БД сейчас нет enum/CHECK). Сохраняю тот же паттерн
-- для консистentности схемы, а не добавляю новое поведение выборочно.
--
-- utilities — "Комунальні платежі" (спека §19: "Включено / Окремо / За
-- домовленістю"). Актуально только для аренды (rent) — тип сделки
-- (rent/sale) в этом этапе отложен продуктом, поэтому колонка сейчас
-- всегда практически "для аренды"; при добавлении sale в будущем этот
-- столбец либо остаётся пустым для sale-объявлений, либо потребует
-- отдельного решения — вне текущего скоупа.
alter table public.listings add column if not exists utilities text;

-- building_type — "Тип будівлі" (спека §19: "Бізнес-центр / Окрема
-- будівля / Житловий будинок / Інше").
alter table public.listings add column if not exists building_type text;

-- Оба — nullable, без default: не обязательны ни для draft, ни (в этой
-- версии) для pending_review — в CHECK "обязательно для модерации"
-- (migration B) они НЕ включены, только в список "значимых полей"
-- (правка требует повторной модерации), как явно запрошено. Если нужно
-- сделать их обязательными для отправки на модерацию — отдельное
-- решение, не входит в текущий согласованный скоуп.


-- ============================================================================
-- 1.2. Транзитная защита rate-limit на окно A → деплой кода → B
-- ============================================================================
-- Read-only аудит (2026-08-31, живая БД, без изменений) подтвердил: сейчас
-- на public.listings есть РОВНО один активный триггер —
-- enforce_listing_rate_limit (BEFORE INSERT, из 20260818_listing_rate_limit.sql),
-- который считает лимит (5/10мин, 20/24ч) на КАЖДЫЙ INSERT в listings,
-- вообще не зная о status (этой колонки не было, когда он писался).
--
-- Без правки, после применения этого файла и деплоя нового клиентского
-- кода (который вставляет черновик как INSERT status='draft'):
--   - создание ЧЕРНОВИКА расходовало бы лимит публикации — черновик не
--     является публикацией и не должен ничего стоить;
--   - тот же пользователь при реальном submit (после B, через
--     check_publish_rate_limit() в enforce_listing_lifecycle()) заплатил
--     бы ЕЩЁ РАЗ за то же самое объявление — фактически лимит 5/10мин и
--     20/24ч для нового клиента незаметно становится вдвое строже, чем
--     заявлено продуктом.
--
-- Правка ниже — CREATE OR REPLACE ТЕЛА той же функции (имя функции, имя и
-- определение триггера — BEFORE INSERT on public.listings — НЕ меняются,
-- их создал 20260818 и они здесь не пересоздаются заново, только
-- заменяется тело). Добавлено ровно одно условие в начале: лимит
-- считается, только если NEW.status = 'active' — то есть только для
-- INSERT, который ведёт себя как СТАРАЯ прямая публикация:
--   - старый (ещё не обновлённый) клиент из окна A→деплой не передаёт
--     status вообще — Postgres подставляет его из DEFAULT 'active'
--     (раздел 1 выше) ДО срабатывания BEFORE INSERT триггера, так что
--     NEW.status внутри функции уже равен 'active' — лимит для него
--     считается ровно как раньше, бесплатного обхода нет;
--   - новый клиент, вставляющий status='draft' явно (dbSaveDraft(null,…)
--     в src/lib/db.ts) — условие ложно, INSERT проходит без обращения к
--     listing_publish_events вообще, лимит не расходуется.
--
-- Тело функции ПОСЛЕ этой проверки — дословная копия 20260818 (тот же
-- advisory lock, тот же burst/daily подсчёт, тот же INSERT в
-- listing_publish_events) — концептуальных изменений в самой логике
-- лимита нет, только новый ранний guard.
--
-- Migration B (см. её раздел 5) удаляет и эту функцию, и этот триггер
-- целиком по тем же именам — то, что дропается там, это уже ЭТА,
-- транзитная версия, не оригинал из 20260818 (см. обновлённый комментарий
-- в файле B). Взамен B ставит постоянную пару check_publish_rate_limit() +
-- enforce_listing_lifecycle(), где лимит списывается один раз, в момент
-- фактического входа в pending_review — INSERT черновика не платит лимит
-- ни до, ни после B.
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
  -- Единственное добавление к оригиналу 20260818 — см. пояснение выше.
  if NEW.status is distinct from 'active' then
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

-- Триггер сам НЕ пересоздаётся — 20260818 уже создал `enforce_listing_rate_limit`
-- (BEFORE INSERT on public.listings, FOR EACH ROW), CREATE OR REPLACE
-- FUNCTION выше меняет только то, что он выполняет. Ничего здесь делать
-- с самим триггером не нужно.


-- ============================================================================
-- 2. Индексы
-- ============================================================================

create index if not exists idx_listings_owner_id
  on public.listings (owner_id);

create index if not exists idx_listings_status_created
  on public.listings (status, created_at desc);

-- E.2.4 — черга модерації читає `where status='pending_review' order by
-- pending_review_at asc, id asc` з курсорною пагінацією (див. звіт: складений
-- курсор pending_review_at+id, tie-breaker по id). Складений індекс під
-- саме цей запит — без нього кожна сторінка черги робить послідовне
-- сканування всієї таблиці, відфільтроване по status.
create index if not exists idx_listings_pending_review_queue
  on public.listings (status, pending_review_at, id);


-- ============================================================================
-- 3. Снятие NOT NULL — предпосылка для частичного черновика
-- ============================================================================
-- Текущие NOT NULL столбцы public.listings (полный список, кроме id и
-- user_id — их не трогаем: id системный serial, user_id всегда есть из
-- auth.uid() при создании и должен оставаться обязательным даже для
-- draft, иначе строка не будет принадлежать никому):
--   title, type, price, area, district, address
-- Это ровно те поля, которых не будет после одного лишь Шага 1 мастера
-- (площадь/район/адреса/тип — шаг 1, ціна — шаг 2). Без снятия NOT NULL
-- частичный черновик не сохранится в БД никаким способом, кроме
-- фиктивных значений.
--
-- ЭТО РЕАЛЬНОЕ РАСШИРЕНИЕ ДОПУСТИМОГО СОСТОЯНИЯ СХЕМЫ (см. шапку файла):
-- до этой строки Postgres физически гарантировал, что ни одна строка
-- listings не может существовать без этих шести значений; после —
-- гарантирует. Обратная совместимость сохраняется, потому что ни один
-- существующий писатель (src/lib/db.ts, весь текущий клиент) не
-- начинает вдруг присылать NULL — компенсирующая проверка "обязательно
-- для pending_review и далее" добавляется в migration B как CHECK,
-- зависящий от status, так что итоговая гарантия "нет неполных
-- РЕАЛЬНЫХ объявлений" не теряется — она просто становится условной
-- (обязательна вне draft), а не безусловной (обязательна всегда).
alter table public.listings alter column title    drop not null;
alter table public.listings alter column type     drop not null;
alter table public.listings alter column price    drop not null;
alter table public.listings alter column area     drop not null;
alter table public.listings alter column district drop not null;
alter table public.listings alter column address  drop not null;


-- ============================================================================
-- ROLLOUT (безопасный порядок применения ИМЕННО этого файла)
-- ============================================================================
-- 1. Применить этот файл в окно низкой нагрузки (не обязательно, но
--    рекомендуется — ALTER TABLE ... ALTER COLUMN DROP NOT NULL и
--    добавление колонок требуют ACCESS EXCLUSIVE lock на listings на
--    короткое время; на таблице с 0 строк сейчас это доли секунды, но
--    как только там появятся реальные данные — стоит помнить).
-- 2. Прогнать полный regression-прогон текущего (СТАРОГО, ещё не
--    тронутого) клиента против БД с применённой A — публикация,
--    архивирование, восстановление, каталог, "Мої оголошення" должны
--    работать ВИЗУАЛЬНО И ФУНКЦИОНАЛЬНО как до миграции.
-- 3. Только после этого — деплой обновлённого клиентского кода (см.
--    список файлов из отчёта E.1, раздел TypeScript).
-- 4. Только после подтверждения, что новый код работает в проде —
--    применить migration B.
--
-- ============================================================================
-- ROLLBACK (справочно — НЕ выполняется автоматически)
-- ============================================================================
--
-- -- Раздел 1.2 — вернуть enforce_listing_rate_limit() к ОРИГИНАЛЬНОМУ телу
-- -- дословно из supabase/migrations/20260818_listing_rate_limit.sql
-- -- (create or replace function ... до "return new; end; $$;", без guard
-- -- "if NEW.status is distinct from 'active' then return NEW; end if;").
-- -- Триггер (имя/BEFORE INSERT) не трогать — он не создавался этим файлом.
-- -- Актуально, только если откатывается ТОЛЬКО A, без применённой B (если
-- -- B уже применена, эта функция/триггер к тому моменту уже удалены её
-- -- разделом 5, откатывать здесь нечего).
--
-- alter table public.listings alter column title    set not null;
-- alter table public.listings alter column type     set not null;
-- alter table public.listings alter column price    set not null;
-- alter table public.listings alter column area     set not null;
-- alter table public.listings alter column district set not null;
-- alter table public.listings alter column address  set not null;
--   -- Сработает, только если на момент отката в таблице нет ни одной
--   -- строки с NULL в этих колонках (т.е. ни одного черновика с
--   -- неполными данными). Если такие строки есть — сначала удалить
--   -- или дозаполнить их, иначе ALTER упадёт с constraint violation.
--   -- Единственный пункт отката A, который может зависеть от данных,
--   -- накопленных ПОСЛЕ применения миграции.
--
-- drop index if exists idx_listings_pending_review_queue;
-- drop index if exists idx_listings_status_created;
-- drop index if exists idx_listings_owner_id;
--
-- alter table public.listings drop column if exists archived_at;
-- alter table public.listings drop column if exists published_at;
-- alter table public.listings drop column if exists pending_review_at;
-- alter table public.listings drop column if exists building_type;
-- alter table public.listings drop column if exists utilities;
-- alter table public.listings drop column if exists moderated_by;
-- alter table public.listings drop column if exists moderated_at;
-- alter table public.listings drop column if exists rejection_reason;
-- alter table public.listings drop constraint if exists listings_status_check;
-- alter table public.listings drop column if exists status;
--
-- Не трогает is_active, существующие строки (кроме удаления самих новых
-- колонок этой миграции), другие таблицы.
-- ============================================================================
