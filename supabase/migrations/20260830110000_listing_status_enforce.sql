-- ============================================================================
-- Простір Коштує — статусный жизненный цикл, ШАГ B (ENFORCE)
-- ПОДГОТОВЛЕНО ДЛЯ АУДИТА E.1, НЕ ПРИМЕНЕНО. apply_migration не вызывался.
--
-- 4-й раунд pre-migration audit — версионирование: переименовано с
-- 20260830_listing_status_enforce.sql на полный YYYYMMDDHHMMSS
-- (20260830110000) — изначально этот файл, expand и storage policy
-- делили одну и ту же 8-значную дату 20260830, что Supabase migration
-- tooling трактует как неоднозначный порядок (в т.ч. риск применить
-- ЭТОТ файл раньше expand — критично, т.к. B требует уже применённой A).
-- Новый порядок: storage (20260830090000) → expand (20260830100000) →
-- ЭТОТ файл (20260830110000), гарантированно последний. Содержимое SQL
-- не менялось, только имя файла и ссылки на него/соседние файлы в
-- комментариях.
--
-- ВТОРОЙ ИЗ ДВУХ ФАЙЛОВ. НЕ ПРИМЕНЯТЬ раньше, чем:
--   1) применена 20260830100000_listing_status_expand.sql (migration A)
--   2) обновлённый клиентский код задеплоен и подтверждён рабочим —
--      src/lib/db.ts должен явно слать status при публикации,
--      dbArchiveListing/dbRestoreListing должны работать через status.
--
-- ПОЧЕМУ порядок жёсткий: эта миграция делает is_active ЧИСТО
-- ПРОИЗВОДНЫМ от status — клиентское is_active нигде не читается. Старый
-- клиент шлёт только is_active, никогда status. Применить B раньше
-- деплоя кода: кнопки "Архівувати"/"Відновити" перестанут иметь эффект
-- молча (RLS их пропустит, is_active перезапишется тем же значением,
-- что уже было, т.к. status в запросе не менялся) — задокументировано,
-- чтобы не проверять это на проде.
--
-- Что делает этот файл:
--   0. Реконсиляция: ещё раз выравнивает status по is_active, но ТОЛЬКО
--      для строк, всё ещё находящихся в {active, archived} — защита от
--      дрейфа, накопленного за время A-окна (см. файл A, раздел
--      "Стратегия status между A и B"). Не трогает draft/pending_review/
--      rejected/paused — такие строки к моменту B может создать уже
--      обновлённый (между A и B) клиент, их трогать нельзя.
--   1. status DEFAULT: 'active' (временный, из A) → 'draft' (финальный).
--   2. CHECK: обязательные поля + минимум 3 / максимум 10 фото — вне
--      draft, на уровне БД.
--   3. CHECK: rejection_reason обязателен при status='rejected'.
--   4. check_publish_rate_limit() (SECURITY DEFINER) — та же логика
--      лимита 5/10мин + 20/24ч из 20260819181213_listing_rate_limit.sql,
--      вызывается явно, не отдельным триггером.
--   5. enforce_listing_lifecycle() (SECURITY DEFINER) — единственная
--      функция, решающая: разрешён ли переход; нужен ли принудительный
--      возврат на модерацию; когда дёрнуть rate-limit; чему равен
--      итоговый is_active. Клиентские is_active/rejection_reason/
--      moderated_at/moderated_by/owner_id/user_id нигде не читаются как
--      источник решения.
--   6. Один триггер (BEFORE INSERT OR UPDATE) — никакой зависимости от
--      порядка/имён нескольких триггеров, вся последовательность внутри
--      одной функции.
--   7. RLS — полный пересмотр по операциям, admin вынесен в отдельные
--      policies (см. раздел 7).
-- ============================================================================


-- ============================================================================
-- 0. Реконсиляция status ⟵ is_active перед включением enforcement
-- ============================================================================
-- Scope сознательно узкий: строго status in ('active','archived') — это
-- единственные два значения, которые могли получить строки СТАРЫМ
-- клиентом (до деплоя нового кода) или backfill'ом самой A. Любая
-- строка с status в ('draft','pending_review','rejected','paused') к
-- этому моменту — дело рук УЖЕ ОБНОВЛЁННОГО клиента (задеплоен между A
-- и B по контракту выше) и не должна пересчитываться из is_active,
-- который новый клиент для таких строк мог уже не поддерживать в
-- актуальном состоянии.
update public.listings
   set status = case when coalesce(is_active, true) then 'active' else 'archived' end
 where status in ('active', 'archived')
   and status is distinct from (case when coalesce(is_active, true) then 'active' else 'archived' end);


-- ============================================================================
-- 1. status: финальный default
-- ============================================================================
alter table public.listings alter column status set default 'draft';


-- ============================================================================
-- 2. Обязательные поля и фото — только вне draft, на уровне БД
-- ============================================================================
-- 5th round audit fix (requirement 4 — B остаётся ЕДИНСТВЕННЫМ источником
-- lifecycle-правил): Migration A вводит ВРЕМЕННЫЙ CHECK
-- listings_required_when_public (ключ — is_active, единственный сигнал,
-- что-либо решавший в окне A-без-B). Как только здесь появляется
-- постоянная, status-зависимая версия с полной проверкой (включая фото),
-- временная снимается — иначе на публичной активной записи действовали бы
-- ДВЕ независимые, частично дублирующие проверки одновременно (лишняя
-- нагрузка на каждую запись и два места, которые в будущем могли бы
-- разойтись). Снимается ДО создания новой — порядок здесь не важен для
-- корректности (обе проверки в момент этого файла требуют одного и того
-- же непустого набора полей для is_active=true/status!='draft' строк,
-- переходного момента рассинхронизации между ними нет), но так нагляднее.
alter table public.listings drop constraint if exists listings_required_when_public;

-- images: минимум 3 РЕАЛЬНЫХ (непустых после trim) и РАЗЛИЧНЫХ URL —
-- не просто array_length, иначе ['a','a','a'] формально проходил бы как
-- "3 фото". max 10 — отдельный, БЕЗУСЛОВНЫЙ constraint ниже (действует
-- и для draft тоже — сервер не должен позволять накопить в черновике
-- больше, чем когда-либо разрешит опубликовать).
--
-- Подсчёт вынесен в IMMUTABLE-функцию: CHECK constraint не может содержать
-- подзапрос напрямую (жёсткое ограничение PostgreSQL — "cannot use
-- subquery in check constraint"), но вызов IMMUTABLE-функции допустим.
-- SECURITY INVOKER (по умолчанию) — функция не читает ничего, кроме
-- переданного аргумента, повышенные права не нужны.
create or replace function public.count_distinct_nonempty_images(imgs text[])
returns integer
language sql
immutable
as $$
  select count(distinct btrim(img))::integer
  from unnest(imgs) as img
  where img is not null and btrim(img) <> '';
$$;

alter table public.listings add constraint listings_required_for_review
  check (
    status = 'draft' or (
      title is not null and btrim(title) <> '' and
      type is not null and btrim(type) <> '' and
      price is not null and price > 0 and
      area is not null and area > 0 and
      district is not null and btrim(district) <> '' and
      address is not null and btrim(address) <> '' and
      public.count_distinct_nonempty_images(images) >= 3
    )
  );

-- Максимум фото — безусловно, включая draft (сервер, не только UI).
alter table public.listings add constraint listings_max_photos
  check (coalesce(array_length(images, 1), 0) <= 10);

-- Требование продукта: отклонение обязательно содержит причину.
alter table public.listings add constraint listings_rejection_reason_check
  check (status <> 'rejected' or rejection_reason is not null);


-- ============================================================================
-- 3. Rate-limit как обычная функция, не триггер
-- ============================================================================
-- 1:1 логика enforce_listing_rate_limit() из 20260818 (advisory lock,
-- burst 5/10мин, daily 20/24ч, запись в listing_publish_events).
-- Конкурентная безопасность — тот же pg_advisory_xact_lock, что и
-- раньше: два параллельных запроса одного пользователя сериализуются
-- этим локом ДО подсчёта count(*), так что оба не могут одновременно
-- увидеть один и тот же (не увеличенный) счётчик и оба пройти проверку
-- (TOCTOU race закрыт так же, как в исходной версии).
create or replace function public.check_publish_rate_limit()
returns void
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
end;
$$;

revoke execute on function public.check_publish_rate_limit() from public, anon, authenticated;


-- ============================================================================
-- 4. enforce_listing_lifecycle() — единственная точка принятия решений
-- ============================================================================
-- SECURITY DEFINER — нужно, чтобы вызывать check_publish_rate_limit(),
-- у которого EXECUTE отозван у authenticated. auth.uid()/is_admin()
-- внутри по-прежнему возвращают реальные значения текущего запроса
-- (тот же принцип, что в 20260819181213_listing_rate_limit.sql).
--
-- Гарантии (проверено построчно):
--   - NEW.is_active клиента НИГДЕ не читается — ни в одном if/elsif
--     во всей функции; is_active только ПРИСВАИВАЕТСЯ, один раз, в
--     самом конце, из финального NEW.status.
--   - NEW.rejection_reason клиента-владельца игнорируется (см. раздел
--     "владелец" — принудительный сброс на OLD.rejection_reason в
--     начале ветки, до какой-либо иной логики).
--   - NEW.owner_id / NEW.user_id — смена владельца блокируется явно,
--     ДО разделения на admin/owner ветки — admin эту защиту не обходит,
--     переназначения владельца нет ни для кого.
--   - NEW.moderated_at / NEW.moderated_by — владельцем игнорируются
--     (сброс на OLD), пишутся только в admin-ветке при реальном решении
--     модерации (approve/reject из pending_review).
--   - Admin НЕ обходит допустимый enum статуса (listings_status_check,
--     обычный table CHECK — применяется к любой роли одинаково) и НЕ
--     обходит серверную валидацию публикуемой записи
--     (listings_required_for_review/listings_max_photos — тоже table
--     CHECK, а не часть этой функции, поэтому одинаково действуют и на
--     admin, и на владельца: admin не может approve в active запись с
--     неполными обязательными полями или без 3 уникальных фото — COMMIT
--     такого UPDATE упадёт с constraint violation).
--   - Admin ограничен явным списком переходов (см. ветку "if v_admin"
--     ниже: только pending_review→active, pending_review→rejected,
--     {active,paused}→archived) — НЕ "любой статус в любой", любая иная
--     попытка сменить status — LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION.
--   - Обход через "несколько полей одним UPDATE" исключён порядком
--     операций: v_significant считается по ВСЕМ значимым полям сразу,
--     а результат проверяется РАНЬШЕ, чем запрошенный NEW.status —
--     значимая правка форсирует pending_review независимо от того, что
--     ещё было в том же UPDATE.
--   - pending_review для не-admin — полностью закрытое состояние: НИ
--     ОДНО поле, включая сам status, не может быть изменено владельцем,
--     пока объявление на модерации.
--   - NEW.pending_review_at / NEW.published_at / NEW.archived_at /
--     NEW.moderated_at / NEW.moderated_by / NEW.rejection_reason — ни одно
--     не подконтрольно клиенту, ни owner'у, ни admin'у: INSERT форсирует
--     все шесть в NULL безусловно (до первого обращения к OLD — на INSERT
--     OLD не существует, см. комментарий в самой INSERT-ветке); каждая
--     UPDATE-ветка (admin и owner) сбрасывает их на OLD.* в начале, ДО
--     какой-либо иной логики, и только перечисленные ниже переходы
--     осознанно перезаписывают ровно то поле, которое реально меняется
--     именно сейчас. Ни одно из шести полей не ЧИТАЕТСЯ ни в одном
--     if/elsif этой функции (как и is_active) — они только присваиваются,
--     отражая факт, а не участвуют в принятии решений.
--
--     Полная таблица переходов (2nd round E.2.4 audit, п.1):
--
--     draft → pending_review (owner, явный submit):
--       pending_review_at = now() · published_at OLD · archived_at NULL
--       (инвариантно уже NULL) · moderated_at/by NULL (уже NULL после
--       INSERT, но обнуляется явно) · rejection_reason NULL.
--
--     rejected → pending_review (owner, повторная подача):
--       pending_review_at = now() ЗАНОВО (не наследует старую) ·
--       published_at OLD (история, если когда-то реально была активна) ·
--       archived_at NULL (явно) · moderated_at/by NULL (явно — старое
--       решение "відхилено" по старому контенту более не действует) ·
--       rejection_reason NULL.
--
--     значимая правка active/paused/archived → pending_review (owner,
--     принудительный откат триггером):
--       pending_review_at = now() · published_at OLD (не трогаем) ·
--       archived_at NULL (явно — если OLD.status был 'archived', запись
--       только что покинула archived, старая дата не должна выглядеть
--       актуальной) · moderated_at/by NULL (явно — новая заявка по сути
--       другой контент) · rejection_reason NULL.
--
--     pending_review → active (admin approve):
--       published_at = now() · moderated_at = now() · moderated_by =
--       auth.uid() · archived_at NULL (явно) · rejection_reason NULL ·
--       pending_review_at OLD (не трогаем — честная метка исходной
--       подачи, решение её не отменяет).
--
--     pending_review → rejected (admin reject):
--       moderated_at = now() · moderated_by = auth.uid() ·
--       rejection_reason = обязательная причина (проверяется до записи) ·
--       published_at OLD (история "была ли когда-то реально live", если
--       рассматривался значимо отредактированный active/paused → reject) ·
--       archived_at OLD (на этой точке уже гарантированно NULL — см. ветку
--       значимой правки выше) · pending_review_at OLD (не трогаем).
--
--     active → paused (owner):
--       published_at OLD — РЕШЕНИЕ: сохраняется как дата последней
--       публикации (paused — временное снятие, не "никогда не было
--       опубликовано"; при restore будет переписано новым now()) ·
--       archived_at OLD (уже NULL) · остальное не трогается.
--
--     active/paused → archived (owner explicit ИЛИ admin emergency):
--       archived_at = now() · published_at/moderated_at/moderated_by/
--       pending_review_at OLD (честная история, не переписывается снятием
--       с публикации) · rejection_reason OLD (уже NULL по инварианту).
--
--     paused/archived → active (owner restore):
--       published_at = now() (восстановление тоже "стало активным
--       сейчас") · archived_at NULL (явно — выход из archived) ·
--       rejection_reason NULL (явно, хотя уже NULL по инварианту) ·
--       moderated_at/by OLD — РЕШЕНИЕ: сохраняются как история последнего
--       реального решения модератора (restore не новый цикл модерации,
--       контент не менялся, значимая правка форсировала бы pending_review
--       веткой выше и сюда бы не дошла) · pending_review_at OLD.
create or replace function public.enforce_listing_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin boolean;
  v_significant boolean;
begin
  if NEW.status is null then
    raise exception 'LISTING_STATUS_REQUIRED';
  end if;

  if TG_OP = 'INSERT' then
    -- Единое правило для ЛЮБОЙ роли, включая admin: строка может попасть
    -- в БД только как draft. Никто, включая admin, не создаёт объявление
    -- сразу active/pending_review/иным статусом — если появится реальная
    -- потребность (например, служебный импорт), это отдельное, явно
    -- запрошенное решение, не часть текущей модели.
    if NEW.status <> 'draft' then
      raise exception 'LISTING_STATUS_FORBIDDEN_INSERT';
    end if;
    -- 8th round audit — REVERSING the 7th round's rejection of this check.
    -- The 7th round worried a trigger can't tell "client explicitly sent
    -- is_active=true" apart from "client omitted it and got the column's
    -- own DEFAULT true" — that's still true (a trigger only ever sees the
    -- resulting NEW.is_active value, on INSERT same as UPDATE — it cannot
    -- observe which keys were present in the client's request body), but
    -- it turns out to be irrelevant here: a source review of
    -- listingToRow() (src/lib/db.ts, the ONLY current INSERT path —
    -- dbPublishListing's direct is_active:true insert is retired) confirms
    -- every current INSERT explicitly sets is_active (isActiveBridge('draft'),
    -- currently false) to a value of its own choosing — never leaves it to
    -- the column DEFAULT. So there is no current request shape this check
    -- could ever misfire against, whether or not it could in principle
    -- distinguish "explicit" from "defaulted". The false positive that got
    -- this check removed last round was this smoke-test file's OWN
    -- Scenario 0 (cross-owner RLS check) deliberately leaving the column
    -- to its DEFAULT — fixed there instead of leaving a real gap here.
    -- Confirmed by two REAL old-client requests replayed locally without
    -- this check: an old client's direct "publish" INSERT (is_active:true,
    -- no status key at all — it predates that column) landed as an
    -- ordinary invisible draft with NO error — old UI reads back a 2xx
    -- response and believes it just published live. That is a silent
    -- wrong success, not "no data corruption" as the 7th round
    -- characterized it — raise loudly instead.
    if NEW.is_active is true then
      raise exception 'LISTING_LEGACY_CLIENT_DETECTED';
    end if;
    NEW.is_active := false;  -- status='draft' гарантирован проверкой выше
    -- E.2.4 (2nd round, п.1): все шість lifecycle-полів примусово в NULL
    -- на INSERT, незалежно від того, що надіслав клієнт — без цього
    -- сирий INSERT міг би підробити "вже колись був активним/на
    -- модерації/відхиленим" одразу для щойно створеного чернетки. Це
    -- ДО будь-якого звернення до OLD (якого для INSERT просто не існує) —
    -- порядок навмисний: TG_OP='INSERT' перевіряється і повністю
    -- обробляється, з return NEW, ПЕРШ ніж нижче з'являється перше
    -- звернення до OLD.* (рядок з owner_id/user_id) — інакше на INSERT
    -- OLD був би NULL і будь-яке OLD.поле впало б з помилкою.
    NEW.pending_review_at := null;
    NEW.published_at := null;
    NEW.archived_at := null;
    NEW.moderated_at := null;
    NEW.moderated_by := null;
    NEW.rejection_reason := null;
    return NEW;
  end if;

  -- TG_OP = 'UPDATE' ниже.

  -- Неизменность владельца — ДО разделения на admin/owner ветки и общая
  -- для ОБЕИХ ролей: в модели нет функции "переназначить владельца", и
  -- admin эту защиту не обходит точно так же, как и обычный владелец.
  if NEW.owner_id is distinct from OLD.owner_id or NEW.user_id is distinct from OLD.user_id then
    raise exception 'LISTING_OWNER_IMMUTABLE';
  end if;

  v_admin := public.is_admin();

  if v_admin then
    -- E.2.4: pending_review_at/published_at/archived_at клиенту не
    -- подконтрольны точно так же, как moderated_at/moderated_by ниже —
    -- сброс на OLD по умолчанию, конкретные переходы осознанно
    -- перезаписывают ТОЛЬКО то поле, которое реально наступает именно
    -- сейчас. approve/reject НЕ трогает pending_review_at — это была
    -- честная метка ИСХОДНОЙ отправки на модерацию, решение модератора
    -- её не отменяет и не переписывает.
    NEW.pending_review_at := OLD.pending_review_at;
    NEW.published_at := OLD.published_at;
    NEW.archived_at := OLD.archived_at;

    -- Admin — НЕ произвольный bypass "любой статус → любой статус".
    -- Разрешены только явно нужные продукту переходы модерации; любая
    -- другая попытка сменить статус (включая self-insert-в-active,
    -- перекрыто выше в INSERT-ветке; draft/pending_review/paused
    -- произвольно; approve не из pending_review и т.п.) — запрещена.
    if NEW.status is distinct from OLD.status then
      if OLD.status = 'pending_review' and NEW.status = 'active' then
        NEW.moderated_at := now();
        NEW.moderated_by := auth.uid();
        NEW.rejection_reason := null;
        NEW.published_at := now(); -- E.2.4: момент фактической публикации этим решением
        -- 2nd round, п.1: явно в NULL, а не "оставить как в OLD" —
        -- запись, скорее всего, УЖЕ null здесь (архивная запись не может
        -- дойти сюда, минуя значимую правку → pending_review, которая
        -- сама уже обнуляет archived_at, см. ниже), но обнуляем явно,
        -- а не полагаемся на цепочку инвариантов: approve — это всегда
        -- "сейчас активно", архивным оно точно быть не может.
        NEW.archived_at := null;

      elsif OLD.status = 'pending_review' and NEW.status = 'rejected' then
        -- Причина обязана прийти В ЭТОМ ЖЕ запросе, не быть унаследована
        -- от какого-то более раннего цикла отклонения.
        if NEW.rejection_reason is null or btrim(NEW.rejection_reason) = '' then
          raise exception 'LISTING_REJECTION_REASON_REQUIRED';
        end if;
        NEW.moderated_at := now();
        NEW.moderated_by := auth.uid();
        -- pending_review_at сознательно НЕ трогаем (см. reset выше) —
        -- новое значение появится только при следующей реальной
        -- отправке (rejected → pending_review, владельческая ветка ниже).
        -- 2nd round, п.1 — published_at/archived_at: сознательно НЕ
        -- трогаем ни одно из двух (см. блок reset в начале admin-ветки).
        -- published_at остаётся тем, чем было — если запись когда-то уже
        -- реально была опубликована (значимая правка active→pending_review
        -- → reject), это честная история "était live", а не текущий
        -- статус; UI обязан судить о текущем статусе по status='rejected',
        -- не по наличию published_at. archived_at на этой точке уже
        -- гарантированно null (единственный путь войти в pending_review
        -- из archived — значимая правка, которая сама обнуляет archived_at
        -- ниже, до того как запись вообще может дойти досюда).

      elsif OLD.status in ('active', 'paused') and NEW.status = 'archived' then
        -- Экстренное снятие с публикации admin'ом (спам/жалоба), без
        -- обязательного прохождения через paused. Не факт из исходного
        -- запроса — минимально необходимое расширение для модерации,
        -- помечено как решение, требующее вашего подтверждения, как и
        -- остальные явно помеченные пункты этого файла.
        NEW.moderated_at := OLD.moderated_at;
        NEW.moderated_by := OLD.moderated_by;
        NEW.rejection_reason := OLD.rejection_reason;
        NEW.archived_at := now(); -- E.2.4
        -- 2nd round, п.1: та же логика, что и у владельческого archive
        -- выше — published_at/pending_review_at остаются честной историей,
        -- не переписываются экстренным снятием с публикации.

      else
        raise exception 'LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION';
      end if;
    else
      -- Статус не меняется — обычная правка полей admin'ом (например,
      -- исправление контента без повторной модерации). Служебные поля
      -- модерации не трогаем.
      NEW.moderated_at := OLD.moderated_at;
      NEW.moderated_by := OLD.moderated_by;
      NEW.rejection_reason := OLD.rejection_reason;
    end if;

    -- is_active — ТОЛЬКО из финального status, так же, как и у владельца;
    -- ни одна ветка выше ни разу не читает NEW.is_active клиента.
    NEW.is_active := (NEW.status = 'active');
    return NEW;
  end if;

  -- ── Владелец (не admin) ──────────────────────────────────────────────

  -- Объявление на модерации — владелец не может менять В НЁМ НИЧЕГО,
  -- включая сам статус. Единственный выход из pending_review для
  -- не-admin роли — не существует; решение принимает только admin.
  if OLD.status = 'pending_review' then
    raise exception 'LISTING_LOCKED_PENDING_REVIEW';
  end if;

  -- 7th round audit — legacy-client protection. PRECISION NOTE (9th round):
  -- this compares NEW against OLD, i.e. it detects that the RESULTING VALUE
  -- of is_active differs while status's does not — a trigger has no way to
  -- see which keys were present in the client's request body (UPDATE ...
  -- SET only ever touches the columns actually listed, so "column omitted"
  -- and "column re-sent with its current value" produce an identical NEW
  -- row); this is value-change detection, not request-shape detection. It
  -- is still a reliable legacy-client signal because no current owner-facing
  -- write path (dbSetListingStatus/isActiveBridge in src/lib/db.ts) ever
  -- produces a request whose FINAL is_active value differs from OLD while
  -- status's does not — archive/restore/pause always change both values
  -- together, a plain field edit changes neither. A request whose values
  -- show is_active changed with status unchanged can therefore only be a
  -- pre-Migration-B client's direct is_active toggle (the original
  -- archive/restore, from before status existed). Without this check it
  -- would fall through silently: is_active is unconditionally recomputed
  -- from the unchanged status at the end of this function regardless, so
  -- the old client's toggle would have no effect and raise no error —
  -- raise loudly here instead of leaving both at once.
  if NEW.status is not distinct from OLD.status
     and NEW.is_active is distinct from OLD.is_active then
    raise exception 'LISTING_LEGACY_CLIENT_DETECTED';
  end if;

  -- Служебные модераторские поля владельцу не подконтрольны — что бы
  -- клиент ни прислал, сохраняем прежние значения. Ветки ниже могут
  -- осознанно их изменить (обнуление при возврате на модерацию) — это
  -- присвоение происходит ПОСЛЕ данной строки и имеет приоритет.
  NEW.moderated_at := OLD.moderated_at;
  NEW.moderated_by := OLD.moderated_by;
  NEW.rejection_reason := OLD.rejection_reason;
  -- E.2.4: та же логика для pending_review_at/published_at/archived_at —
  -- сброс на OLD по умолчанию, конкретные ветки ниже осознанно ставят
  -- now() ровно в момент реального перехода.
  NEW.pending_review_at := OLD.pending_review_at;
  NEW.published_at := OLD.published_at;
  NEW.archived_at := OLD.archived_at;

  -- Список — "все публичные данные объявления": тип, назва, ціна,
  -- площа, поверх, район, адреса, стан, тип будівлі, комунальні умови,
  -- зручності (parking/separate_entrance/features), опис, фото.
  v_significant := (
    NEW.title             is distinct from OLD.title or
    NEW.type              is distinct from OLD.type or
    NEW.price              is distinct from OLD.price or
    NEW.area               is distinct from OLD.area or
    NEW.floor               is distinct from OLD.floor or
    NEW.district            is distinct from OLD.district or
    NEW.address             is distinct from OLD.address or
    NEW.condition           is distinct from OLD.condition or
    NEW.building_type       is distinct from OLD.building_type or
    NEW.utilities           is distinct from OLD.utilities or
    NEW.parking             is distinct from OLD.parking or
    NEW.separate_entrance   is distinct from OLD.separate_entrance or
    NEW.description         is distinct from OLD.description or
    NEW.images              is distinct from OLD.images or
    NEW.features            is distinct from OLD.features
  );

  if OLD.status in ('active', 'paused', 'archived') and v_significant then
    -- 8th round audit — legacy-client protection, INSERT/UPDATE-mirror of
    -- the is_active-toggle check above. PRECISION NOTE (9th round): this
    -- compares NEW against OLD — it detects that the RESULTING VALUES of
    -- status and is_active are unchanged, not that the client's request
    -- omitted those keys (a trigger cannot observe that; see the same note
    -- on the is_active-toggle check above). It is still a reliable
    -- legacy-client signal here specifically because dbUpdateListingForReview()
    -- (src/lib/db.ts) — the ONLY current code path that edits a significant
    -- field on a live listing — ALWAYS sets status to the literal value
    -- 'pending_review' in that same request, which structurally DIFFERS
    -- from OLD.status for every OLD.status this branch runs on (active/
    -- paused/archived, never pending_review itself). No currently-shipped
    -- request can therefore reach this branch with status's value
    -- unchanged; one that does can only be a pre-Migration-B client's
    -- ordinary field edit (the original "just PATCH the changed columns",
    -- from before status existed). Confirmed by replaying that exact
    -- request locally without this check: {price: X} alone on an active
    -- listing was accepted with no error, silently forced the row to
    -- pending_review/is_active=false by the branch below, and the old
    -- client — which never reads status or is_active — had no way to see
    -- its "successful" edit just pulled the listing from the public
    -- catalog. Must run BEFORE the branch forces NEW.status below, or the
    -- unchanged-value signal is gone.
    if NEW.status is not distinct from OLD.status
       and NEW.is_active is not distinct from OLD.is_active then
      raise exception 'LISTING_LEGACY_CLIENT_DETECTED';
    end if;

    -- Значимая правка живого/приостановленного/архивного объявления —
    -- всегда на повторную модерацию, что бы клиент ни просил в
    -- NEW.status (включая одновременную попытку "відновити" с правкой
    -- в одном запросе — правка побеждает намерение).
    --
    -- Тратит rate-limit: без этого повторная правка туда-сюда одного
    -- поля стала бы бесплатным способом обойти 5/10мин и 20/24ч —
    -- решение, помечено для согласования отдельно (не факт из
    -- исходного запроса), альтернатива была бы дырой в анти-абьюз
    -- механике.
    perform public.check_publish_rate_limit();
    NEW.status := 'pending_review';
    NEW.rejection_reason := null;
    NEW.pending_review_at := now(); -- E.2.4: реальный, новый вход в pending_review
    -- 2nd round, п.1: новый цикл модерации — старое решение админа по
    -- ЭТОЙ версии контента больше не относится к тому, что сейчас
    -- реально лежит на рассмотрении (поля изменились, это другая
    -- заявка по сути). Явно очищаем, а не наследуем из OLD.
    NEW.moderated_at := null;
    NEW.moderated_by := null;
    -- Обнуляем безусловно, даже если OLD.status был 'active'/'paused'
    -- (тогда archived_at уже и так null) — если OLD.status был
    -- 'archived', запись только что покинула archived, и archived_at
    -- обязан это отражать: "текущий archived_at" значим только пока
    -- статус реально archived, иначе вводит UI в заблуждение (спека
    -- 2nd round, преференс "при выходе из archived archived_at
    -- очищается").
    NEW.archived_at := null;

  elsif NEW.status is distinct from OLD.status then
    -- Явный запрос смены статуса, БЕЗ значимой правки полей в этом же
    -- апдейте — таблица разрешённых самообслуживаемых переходов.
    if NEW.status = 'active' then
      if OLD.status not in ('paused', 'archived') then
        -- draft/rejected → active самим владельцем запрещено в любом
        -- случае — только через admin approve. (pending_review сюда
        -- дойти не может — перехвачено выше, до этой точки.)
        raise exception 'LISTING_STATUS_FORBIDDEN_SELF_APPROVE';
      end if;
      -- paused/archived → active: разрешено, т.к. v_significant=false
      -- в этой ветке — данные не менялись с последнего одобрения ни в
      -- этом, ни в каком-либо предыдущем апдейте (иначе застряло бы в
      -- pending_review веткой выше и не дошло бы сюда как paused/
      -- archived с расхождением).
      NEW.published_at := now(); -- E.2.4: restore тоже считается "стало активным сейчас"
      -- 2nd round, п.1: явный выход из archived (если OLD.status был
      -- 'archived'; для 'paused' это уже и так null) — restore означает
      -- "сейчас реально активно", archived_at обязан перестать выглядеть
      -- актуальным. Безусловно, той же логике, что и в ветке значимой
      -- правки выше.
      NEW.archived_at := null;
      -- rejection_reason: инвариантно уже null на этой точке (paused и
      -- archived достижимы только из 'active', а 'active' достижимо
      -- только через approve или другой restore — оба уже гарантируют
      -- null), но обнуляем явно, а не полагаемся на цепочку рассуждений —
      -- дешёвая защита от будущего изменения инварианта где-то выше.
      NEW.rejection_reason := null;
      -- moderated_at/moderated_by: РЕШЕНИЕ (2nd round, п.1) — сохраняются
      -- как есть (см. reset в начале owner-ветки), НЕ очищаются. Restore
      -- не новый цикл модерации, а просто возврат уже одобренного контента
      -- в публичный доступ без повторного рассмотрения — moderated_at/by
      -- продолжают честно отражать "когда и кем это в последний раз
      -- реально проверялось", что остаётся полезной историей. Отличие от
      -- значимой правки выше: там контент меняется (это по сути новая
      -- заявка), здесь — нет.

    elsif NEW.status = 'rejected' then
      raise exception 'LISTING_STATUS_FORBIDDEN_SELF_REJECT';

    elsif NEW.status = 'pending_review' then
      if OLD.status not in ('draft', 'rejected') then
        -- Самообслуживаемый вход в pending_review отсюда — draft →
        -- pending_review (обычная отправка на модерацию: мастер после
        -- первого INSERT'а черновика продолжает жить как UPDATE'ы того
        -- же id, "Опублікувати" — тоже UPDATE, не второй INSERT) и
        -- rejected → pending_review (повторная подача после отклонения).
        raise exception 'LISTING_STATUS_INVALID_TRANSITION';
      end if;
      NEW.rejection_reason := null;  -- явно, хотя уже сброшено выше — читаемости ради
      NEW.pending_review_at := now(); -- E.2.4: draft→pending_review и rejected→pending_review — оба реальный, новый вход
      -- 2nd round, п.1: та же логика "новый цикл модерации", что и в
      -- ветке значимой правки выше — новая заявка на рассмотрение не
      -- наследует чьё-то предыдущее решение. Для draft→pending_review оба
      -- поля и так уже null (INSERT их обнуляет), для rejected→pending_review
      -- это реальное обнуление предыдущего решения "отхилено, ким і коли".
      NEW.moderated_at := null;
      NEW.moderated_by := null;
      -- archived_at: инвариантно уже null (draft/rejected никогда не были
      -- archived без прохождения через значимую правку, которая сама уже
      -- обнуляет это поле), обнуляем явно для той же защиты от будущих
      -- изменений инварианта, а не молчаливого допущения.
      NEW.archived_at := null;
      perform public.check_publish_rate_limit();
      -- CHECK listings_required_for_review (раздел 2) валидирует ЭТУ ЖЕ
      -- строку целиком на COMMIT — "повторная полная валидация" не
      -- отдельный шаг, а естественное следствие декларативного CHECK,
      -- который применяется к любому non-draft статусу одинаково,
      -- независимо от того, как именно строка в него попала.

    elsif NEW.status = 'paused' then
      if OLD.status <> 'active' then
        raise exception 'LISTING_STATUS_INVALID_TRANSITION';
      end if;
      -- 2nd round, п.1 — РЕШЕНИЕ: published_at НЕ трогаем, остаётся датой
      -- последней публикации (см. reset в начале owner-ветки — по
      -- умолчанию наследуется из OLD, здесь никакая ветка его не
      -- перезаписывает). paused — временное снятие с публикации, а не
      -- "никогда не было опубликовано"; при restore обратно в active оно
      -- будет просто переписано новым now() (см. ту ветку), так что
      -- сохранение здесь не вводит в заблуждение — оно просто станет
      -- неактуальным до следующего реального входа в active.
      -- archived_at остаётся null (уже null — paused достижимо только из
      -- active, где оно тоже null).

    elsif NEW.status = 'archived' then
      if OLD.status not in ('active', 'paused') then
        raise exception 'LISTING_STATUS_INVALID_TRANSITION';
      end if;
      NEW.archived_at := now(); -- E.2.4
      -- 2nd round, п.1: published_at/moderated_at/moderated_by/
      -- pending_review_at сознательно НЕ трогаем — остаются честной
      -- историей ("когда было опубликовано", "когда/кем в последний раз
      -- проверялось"), archived — это снятие с публикации, а не
      -- переписывание истории того, что уже реально происходило.

    else
      -- 'draft' или что-либо иное — владельцу не разрешено пытаться
      -- попасть в draft из чего-либо через UPDATE в этой модели.
      raise exception 'LISTING_STATUS_INVALID_TRANSITION';
    end if;
  end if;
  -- NEW.status = OLD.status и не сработал forced-branch — обычная
  -- правка draft/rejected (или несущественная правка active/paused/
  -- archived, если такая в принципе возможна — см. v_significant
  -- список выше, он purposely исчерпывающий по "публичным данным").

  NEW.is_active := (NEW.status = 'active');
  return NEW;
end;
$$;

revoke execute on function public.enforce_listing_lifecycle() from public, anon, authenticated;

-- ПРИМЕЧАНИЕ про service_role / postgres (superuser) / будущие
-- бэкенд-скрипты и аварийное обслуживание — оба случая ниже НАМЕРЕННО
-- НЕ получают отдельного bypass-пути в этой функции, это не пробел, а
-- защита по умолчанию:
--
--   service_role: обходит RLS, но НЕ обходит обычные (не constraint)
--   триггеры — INSERT/UPDATE от service_role пройдёт через эту функцию
--   как обычно. auth.uid() для запроса от service_role обычно NULL (нет
--   JWT-контекста пользователя), поэтому is_admin() вернёт false, и
--   такой запрос будет обработан как "владелец" — большинство переходов
--   будет заблокировано (LISTING_OWNER_IMMUTABLE сработает почти всегда,
--   т.к. owner_id/user_id останутся текущими, но остальные владельческие
--   ограничения тоже применятся). Сегодня в проекте НЕТ ни одного
--   service_role-пути, обращающегося к listings напрямую.
--
--   postgres / владелец таблицы (Supabase Dashboard SQL Editor, прямые
--   миграции, psql-доступ): обходит RLS (владелец таблицы по умолчанию
--   не подчиняется своим же policy, если явно не включён FORCE ROW
--   LEVEL SECURITY — здесь он не включён), но ТРИГГЕР при этом НЕ
--   пропускается — обычные BEFORE-триггеры выполняются и для суперюзера,
--   и для владельца таблицы. auth.uid() в чистом SQL-соединении без
--   JWT — NULL, is_admin() — false, значит и прямой SQL от postgres
--   попадёт в ветку "владелец" и будет ограничен теми же правилами
--   (в частности, не сможет одним UPDATE перевести что угодно в active,
--   не заплатив rate-limit и не пройдя CHECK на обязательные поля).
--   Это осознанное решение: аварийное вмешательство должно требовать
--   ЯВНОГО дополнительного шага (например, `alter table public.listings
--   disable trigger enforce_listing_lifecycle;` перед разовой ручной
--   правкой и `enable trigger` сразу после), а не проходить незаметно
--   через обычный UPDATE в SQL-редакторе.
--
-- Если в будущем понадобится настоящая бэкенд-автоматизация поверх
-- listings — потребуется отдельная, явно запрошенная проверка (например,
-- `current_setting('request.jwt.claim.role', true) = 'service_role'`),
-- дающая тот же bypass, что и v_admin. Не добавляю её сейчас, чтобы не
-- расширять поверхность без реального сценария использования.


-- ============================================================================
-- 5. Триггер — ОДИН, вместо двух
-- ============================================================================
drop trigger if exists enforce_listing_rate_limit on public.listings;
drop function if exists public.enforce_listing_rate_limit();
-- ^ триггер изначально из 20260818; к этому моменту — уже ТРАНЗИТНАЯ
-- версия из миграции A (раздел 1.2: BEFORE INSERT OR UPDATE, платит
-- только на реальный переход в is_active=true). Эта строка удаляет и
-- триггер, и функцию по имени безусловно — не зависит от того, какое
-- именно определение у них было (INSERT-only или INSERT OR UPDATE),
-- удаляет их насовсем, не только откатывает A. Обе роли полностью
-- поглощены enforce_listing_lifecycle() + check_publish_rate_limit() выше.
-- Точное содержимое ОРИГИНАЛЬНОЙ (до A) версии для справки —
-- supabase/migrations/20260819181213_listing_rate_limit.sql.

drop trigger if exists enforce_listing_status_policy on public.listings;
-- ^ имя из более ранней (уже отозванной) версии этого файла — на
-- случай, если та версия когда-либо применялась в тестовой среде.

drop trigger if exists enforce_listing_lifecycle on public.listings;
create trigger enforce_listing_lifecycle
  before insert or update on public.listings
  for each row
  execute function public.enforce_listing_lifecycle();


-- ============================================================================
-- 6. RLS — полный пересмотр по операциям, admin отдельными policy
-- ============================================================================
-- Удаляем ВСЕ существующие policy на listings по точным именам (из
-- 20260811191254_stage2_rls_hardening.sql), создаём заново — так проще
-- проверить полный набор целиком, чем угадывать, что уже перекрыто.

drop policy if exists "anyone can read active listings"                on public.listings;
drop policy if exists "owner can insert own listings"                  on public.listings;
drop policy if exists "owner or admin can delete own listings"         on public.listings;
drop policy if exists "owner or admin can read own listings incl. archived" on public.listings;
drop policy if exists "owner or admin can update own listings"         on public.listings;

-- 6.1 SELECT — публично только активные.
create policy "public can read active listings"
  on public.listings for select
  using (status = 'active');

-- 6.2 SELECT — владелец видит ВСЕ свои статусы (включая draft/pending/
-- rejected/paused/archived). Отдельно от публичной — не OR-условие в
-- одной policy, а две policy на одну команду (Postgres их всё равно
-- комбинирует через OR при выборе видимых строк — эффект идентичен
-- прежней объединённой policy, но каждое правило читается отдельно).
create policy "owner can read own listings any status"
  on public.listings for select
  to authenticated
  using (owner_id = auth.uid());

-- 6.3 SELECT — admin видит всё, отдельной policy.
create policy "admin can read all listings"
  on public.listings for select
  to authenticated
  using (public.is_admin());

-- 6.4 INSERT — обычный пользователь: только свой черновик. NEW.owner_id
-- обязан совпасть с auth.uid() (иначе не сможет и прочитать/поменять
-- потом свою же запись — тот же принцип, что и раньше), NEW.status
-- обязан быть 'draft' — тем же самым требованием, что дублирует и
-- триггер (см. п.4), но здесь это ЕЩЁ и защита на уровне RLS,
-- независимая от триггера.
create policy "owner can insert own draft listings"
  on public.listings for insert
  to authenticated
  with check (owner_id = auth.uid() and status = 'draft');

-- 6.5 INSERT — отдельной admin-policy НЕТ (сознательно убрано после
-- вашего замечания "не должен создавать сразу active, если это отдельно
-- не требуется"). Триггер (п.4, INSERT-ветка) в любом случае разрешает
-- INSERT только со status='draft' для ЛЮБОЙ роли — отдельный bypass для
-- admin тут не нужен и не создаётся: если admin'у понадобится создать
-- черновик, для этого достаточно policy 6.4 (owner_id=auth.uid() и для
-- admin тоже — он вставляет запись как собственный черновик). Создание
-- записи admin'ом от имени другого пользователя ("на месте" неё) —
-- отдельная, не запрошенная сейчас функция; если понадобится, потребует
-- собственной explicit policy + явного решения по продукту.

-- 6.6 UPDATE — владелец: разрешённость КОНКРЕТНОГО перехода статуса
-- проверяет триггер (enforce_listing_lifecycle), не RLS — RLS здесь
-- отвечает за более грубую вещь: этот UPDATE вообще принадлежит
-- вызывающему, и до, и после записи. Смена owner_id/user_id
-- дополнительно исключена триггером явно (LISTING_OWNER_IMMUTABLE), но
-- WITH CHECK owner_id=auth.uid() ниже уже структурно не пропустит
-- попытку передать чужой owner_id: если бы NEW.owner_id стал чужим, он
-- перестал бы равняться auth.uid() вызывающего — и WITH CHECK отклонил
-- бы запись сам, независимо от триггера.
create policy "owner can update own listings"
  on public.listings for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 6.7 UPDATE — admin: без ограничения по owner_id (модерация чужих
-- объявлений).
create policy "admin can update any listing"
  on public.listings for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 6.8 DELETE — владелец: РЕШЕНИЕ (согласовать отдельно, если не
-- устраивает) — жёсткое удаление разрешено только для draft (никогда
-- не публиковался, нечего терять) и archived (уже снят с публикации
-- explicit-действием, соответствует текущей UI-логике "Архівувати" →
-- потом "Видалити назавжди" из вкладки архива в RequestsScreen). Все
-- остальные статусы (pending_review, active, rejected, paused) должны
-- сначала перейти в archived (через разрешённые переходы выше), прежде
-- чем их можно будет удалить окончательно. Это ИЗМЕНЕНИЕ относительно
-- сегодняшней policy (сейчас owner может удалить в любом статусе) —
-- явно новое ограничение, а не факт из вашего сообщения.
create policy "owner can delete own draft or archived listings"
  on public.listings for delete
  to authenticated
  using (owner_id = auth.uid() and status in ('draft', 'archived'));

-- 6.9 DELETE — admin: без ограничения по статусу (например, срочное
-- удаление спама на модерации, не дожидаясь архивации).
create policy "admin can delete any listing"
  on public.listings for delete
  to authenticated
  using (public.is_admin());


-- ============================================================================
-- ROLLOUT (безопасный порядок применения ИМЕННО этого файла)
-- ============================================================================
-- 1. Убедиться, что migration A уже применена и обновлённый клиент уже
--    задеплоен и работает в проде (см. ROLLOUT в файле A).
-- 2. Применить этот файл целиком одной транзакцией (все ALTER/CREATE
--    здесь — единый DDL-скрипт; Supabase apply_migration выполняет файл
--    как одну транзакцию по умолчанию).
-- 3. Сразу после apply — вручную проверить: публикация нового
--    объявления реально создаёт status='draft', "Опублікувати"
--    переводит в pending_review и тратит запись в
--    listing_publish_events, архивирование/восстановление работают
--    через status, RLS отдаёт публично только status='active'.
-- 4. Если что-то не сходится — использовать подготовленный черновик отката
--    supabase/prepared-rollbacks/listing_status_enforce_rollback.sql
--    НЕМЕДЛЕННО: скопировать в supabase/migrations/ под АКТУАЛЬНОЙ на
--    момент отката датой-версией и применить через обычный apply_migration
--    (отдельное разрешение) — см. инструкцию в шапке того файла. Не
--    пытаться патчить поверх на живой базе и не выполнять SQL из
--    справочного раздела ниже вручную — 9th round audit: способ отката ЭТО
--    применение того файла как миграции, а не "сначала вручную, потом
--    оформить как миграцию". Черновик сознательно лежит вне
--    supabase/migrations/, чтобы обычный `migration up` его не подхватил.
--
-- ============================================================================
-- ROLLBACK (справочно — что делает
-- supabase/prepared-rollbacks/listing_status_enforce_rollback.sql;
-- НЕ выполнять эти операторы вручную — применяется только тот файл целиком,
-- скопированный в migrations/ с актуальной версией)
-- ============================================================================
--
-- -- 6. RLS — назад к состоянию из 20260811191254_stage2_rls_hardening.sql:
-- drop policy if exists "admin can delete any listing"                on public.listings;
-- drop policy if exists "owner can delete own draft or archived listings" on public.listings;
-- drop policy if exists "admin can update any listing"                on public.listings;
-- drop policy if exists "owner can update own listings"                on public.listings;
-- drop policy if exists "owner can insert own draft listings"          on public.listings;
--   -- ("admin can insert any listing" в этой версии файла не создаётся — см. 6.5)
-- drop policy if exists "admin can read all listings"                  on public.listings;
-- drop policy if exists "owner can read own listings any status"       on public.listings;
-- drop policy if exists "public can read active listings"              on public.listings;
--
-- create policy "anyone can read active listings" on public.listings for select using (is_active = true);
-- create policy "owner can insert own listings" on public.listings for insert with check (owner_id = auth.uid());
-- create policy "owner or admin can delete own listings" on public.listings for delete using (owner_id = auth.uid() or public.is_admin());
-- create policy "owner or admin can read own listings incl. archived" on public.listings for select using (owner_id = auth.uid() or public.is_admin());
-- create policy "owner or admin can update own listings" on public.listings for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
--
-- -- 5. Триггер:
-- drop trigger if exists enforce_listing_lifecycle on public.listings;
-- drop function if exists public.enforce_listing_lifecycle();
-- drop function if exists public.check_publish_rate_limit();
--
-- -- Восстановить триггер лимита — ДОСЛОВНО из Migration A
-- -- (20260830100000_listing_status_expand.sql, раздел 1.2) как она стоит
-- -- ПОСЛЕ 6th round audit fix: BEFORE INSERT OR UPDATE, TG_OP-aware тело
-- -- (charges только на реальный переход в is_active=true, INSERT или
-- -- UPDATE), НЕ первоначальный оригинал из 20260819181213 (BEFORE INSERT
-- -- ONLY, безусловный на каждый INSERT). Откат ТОЛЬКО B должен вернуть
-- -- систему ровно в состояние "A применена, B ещё нет" — в этом состоянии
-- -- обе защиты A (rate-limit guard и required-when-public CHECK) уже
-- -- стоят и должны остаться, иначе откат B сам по себе тихо открыл бы обе
-- -- регрессии, которых не было до отката.
--
-- -- Восстановить временную защиту от Migration A (тем же принципом —
-- -- откат B возвращает в состояние "A без B", где эта защита обязана
-- -- существовать):
-- alter table public.listings add constraint listings_required_when_public
--   check (
--     is_active is not true or (
--       title is not null and btrim(title) <> '' and
--       type is not null and btrim(type) <> '' and
--       price is not null and price > 0 and
--       area is not null and area > 0 and
--       district is not null and btrim(district) <> '' and
--       address is not null and btrim(address) <> ''
--     )
--   );
--
-- -- 2-3. Constraints:
-- alter table public.listings drop constraint if exists listings_rejection_reason_check;
-- alter table public.listings drop constraint if exists listings_max_photos;
-- alter table public.listings drop constraint if exists listings_required_for_review;
--   -- Функция ниже дропается ПОСЛЕ constraint'а, который её вызывает —
--   -- иначе DROP FUNCTION упадёт с "cannot drop function ... because other
--   -- objects depend on it" (constraint зависит от функции).
-- drop function if exists public.count_distinct_nonempty_images(text[]);
--
-- -- 1. Default:
-- alter table public.listings alter column status set default 'active';
--
-- Откат B НЕ требует отката A — A остаётся безопасной сама по себе.
-- Реконсиляция из раздела 0 НЕ откатывается (это разовое исправление
-- данных, не структурное изменение) — если нужно вернуть status к
-- состоянию непосредственно перед B, потребуется отдельный backup/point-
-- in-time restore, а не DDL-rollback.
-- ============================================================================
