-- ============================================================================
-- Простір Коштує — переход на Supabase Auth + жёсткий RLS
-- ПОДГОТОВЛЕНО, НЕ ПРИМЕНЕНО. Ничего из этого файла не выполнялось.
--
-- Файл разбит на STAGE 1 и STAGE 2 — это не формальность, а обязательный
-- порядок. STAGE 2 нельзя применять, пока код приложения не переведён на
-- supabase.auth.* и не задеплоен, иначе PRIVATE RLS-политики (на auth.uid())
-- заблокируют вообще все запросы, потому что сегодня клиент никогда не
-- аутентифицируется в Supabase Auth — у него просто нет JWT.
-- См. итоговый отчёт в чате: "Порядок безопасного применения".
-- ============================================================================


-- ============================================================================
-- STAGE 1 — АДДИТИВНАЯ ПОДГОТОВКА (безопасно выполнить в любой момент)
-- Ничего не удаляет, ничего не ломает, старые публичные политики пока не
-- трогает — старый код продолжит работать как раньше, пока STAGE 2 не
-- применён.
-- ============================================================================

-- 1.1 accounts: колонка-мост к auth.users. Пока nullable — заполняется
-- скриптом миграции пользователей (см. отчёт, раздел "Provisioning").
alter table public.accounts
  add column if not exists auth_id uuid references auth.users(id);

create unique index if not exists accounts_auth_id_key
  on public.accounts(auth_id)
  where auth_id is not null;

-- 1.2 Владелец объявления как UUID (Supabase Auth), рядом со старым
-- текстовым user_id — не трогаем старую колонку, только добавляем новую.
alter table public.listings
  add column if not exists owner_id uuid references auth.users(id);

-- 1.3 Аналогично для остальных пользовательских таблиц.
alter table public.favorites
  add column if not exists user_id_uuid uuid references auth.users(id);

alter table public.chats
  add column if not exists buyer_id_uuid  uuid references auth.users(id),
  add column if not exists seller_id_uuid uuid references auth.users(id);

alter table public.messages
  add column if not exists sender_id_uuid uuid references auth.users(id);

-- 1.4 Бэкфилл: выполнять ПОСЛЕ того, как для каждого существующего
-- аккаунта создан соответствующий auth.users и accounts.auth_id заполнен
-- (см. отчёт — это делается через Admin API, не через SQL).
-- Ниже — сами команды бэкфилла, готовые к разовому запуску в нужный момент:

-- update public.listings l
--   set owner_id = a.auth_id
--   from public.accounts a
--   where a.id = l.user_id and a.auth_id is not null;
--
-- update public.favorites f
--   set user_id_uuid = a.auth_id
--   from public.accounts a
--   where a.id = f.user_id and a.auth_id is not null;
--
-- update public.chats c
--   set buyer_id_uuid  = ab.auth_id,
--       seller_id_uuid = as_.auth_id
--   from public.accounts ab, public.accounts as_
--   where ab.id = c.buyer_id and as_.id = c.seller_id
--     and (ab.auth_id is not null or as_.auth_id is not null);
--
-- update public.messages m
--   set sender_id_uuid = a.auth_id
--   from public.accounts a
--   where a.id = m.sender_id and a.auth_id is not null;

-- 1.5 Автосоздание строки accounts при регистрации через Supabase Auth.
-- Это ЕДИНСТВЕННОЕ место, которое создаёт строку в accounts при регистрации:
-- клиентский код (src/lib/auth.ts registerAccount()) сознательно НЕ делает
-- параллельный INSERT — только этот триггер, чтобы не было двух источников
-- истины и гонки между ними. Триггер вешается на auth.users (схема auth
-- доступна для триггеров, хотя не доступна напрямую клиенту через PostgREST).
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
    -- No email-based admin bootstrap here — every new signup is a plain
    -- 'landlord' regardless of email. Admin is assigned manually afterwards
    -- (UPDATE public.accounts SET role='admin' WHERE auth_id = '<uuid>'),
    -- once the owner's own auth.users row exists/is linked.
    'landlord',
    '',  -- пароль больше не хранится в accounts — им управляет Supabase Auth
    now()
  )
  -- Idempotency guard only (e.g. a retried trigger firing twice) — not a
  -- merge with a client-side insert, since there isn't one anymore.
  on conflict (auth_id) where auth_id is not null do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 1.6 Хелпер для политик — есть ли у текущего auth.uid() роль admin.
-- SECURITY DEFINER + фиксированный search_path (в т.ч. закрывает WARN
-- "function_search_path_mutable" для новых функций).
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


-- ============================================================================
-- STAGE 2 — ЖЁСТКИЙ RLS (применять ТОЛЬКО после того, как:
--   а) для всех существующих accounts создан auth.users и accounts.auth_id
--      заполнен (см. отчёт, Provisioning),
--   б) бэкфилл владельцев (1.4) выполнен для listings/favorites/chats/messages,
--   в) новый код приложения (supabase.auth.signUp/signInWithPassword/signOut/
--      getSession/onAuthStateChange) задеплоен и подтверждён рабочим.
-- До этого момента STAGE 2 гарантированно сломает вход, публикацию
-- объявлений, избранное и чаты — см. "Что может перестать работать".
-- ============================================================================

-- 2.1 Убираем все существующие политики — включая опасные "public ALL true"
-- и множество дублирующих друг друга правил, накопившихся за несколько
-- итераций (см. аудит в чате).

drop policy if exists "Allow login read"          on public.accounts;
drop policy if exists "Allow registration"        on public.accounts;
drop policy if exists "Allow update own account"  on public.accounts;
drop policy if exists "public all accounts"       on public.accounts;

drop policy if exists "Allow public delete"          on public.listings;
drop policy if exists "Allow public insert"          on public.listings;
drop policy if exists "Allow public read"            on public.listings;
drop policy if exists "Allow public update"          on public.listings;
drop policy if exists "Anyone can read active listings" on public.listings;
drop policy if exists "Owner can delete own listings"    on public.listings;
drop policy if exists "Owner can insert listings"        on public.listings;
drop policy if exists "Owner can update own listings"    on public.listings;
drop policy if exists "public delete listings"           on public.listings;
drop policy if exists "public insert listings"           on public.listings;
drop policy if exists "public read listings"             on public.listings;
drop policy if exists "public update listings"           on public.listings;

drop policy if exists "public all favorites" on public.favorites;
drop policy if exists "public all chats"     on public.chats;
drop policy if exists "public all messages"  on public.messages;

drop policy if exists "Allow feedback read"       on public.feedback;
drop policy if exists "Allow feedback submission" on public.feedback;
drop policy if exists "Allow feedback update"     on public.feedback;
drop policy if exists "public all feedback"       on public.feedback;

-- 2.2 Включаем RLS там, где он ещё не включён (listings сейчас выключен
-- полностью — критическая находка аудита).
alter table public.listings  enable row level security;
alter table public.accounts  enable row level security;   -- уже был включён, но политики были дырявые
alter table public.favorites enable row level security;
alter table public.chats     enable row level security;
alter table public.messages  enable row level security;
alter table public.feedback  enable row level security;

-- 2.3 accounts — анонимный доступ запрещён полностью. Ни одной политики
-- не создаём: RLS включён, политик ноль => доступ только у service_role.
-- Таблица становится "только для чтения бэкендом/миграциями", живой
-- профиль пользователя приложение больше не читает напрямую отсюда для
-- авторизации — это делает Supabase Auth. Для профиля/списка "мои данные"
-- у самого себя нужна отдельная политика (ниже), иначе пользователь не
-- сможет прочитать даже свой профиль (ProfileScreen сломается).

create policy "user can read own account row"
  on public.accounts for select
  to authenticated
  using (auth_id = auth.uid());

create policy "user can update own account row"
  on public.accounts for update
  to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

create policy "admin can read all accounts"
  on public.accounts for select
  to authenticated
  using (public.is_admin());

-- Явно НЕТ insert-политики для accounts — строки создаёт только триггер
-- handle_new_auth_user() (SECURITY DEFINER, схема auth), клиент никогда
-- не вставляет в accounts напрямую.
-- Явно НЕТ delete-политики — удаление аккаунта, если понадобится,
-- через service_role/Edge Function, не с anon/authenticated ключом.

-- 2.4 listings — публичное чтение опубликованных, владелец/админ — CRUD
-- своих.
create policy "anyone can read active listings"
  on public.listings for select
  to anon, authenticated
  using (is_active = true);

create policy "owner or admin can read own listings incl. archived"
  on public.listings for select
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

create policy "owner can insert own listings"
  on public.listings for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owner or admin can update own listings"
  on public.listings for update
  to authenticated
  using (owner_id = auth.uid() or public.is_admin())
  with check (owner_id = auth.uid() or public.is_admin());

create policy "owner or admin can delete own listings"
  on public.listings for delete
  to authenticated
  using (owner_id = auth.uid() or public.is_admin());

-- Примечание: increment_listing_views / adjust_listing_likes — уже
-- SECURITY DEFINER, RLS их не касается, анонимные просмотры/лайки
-- продолжат работать без изменений.

-- 2.5 favorites — строго приватные, только свои.
create policy "user can read own favorites"
  on public.favorites for select
  to authenticated
  using (user_id_uuid = auth.uid());

create policy "user can add own favorites"
  on public.favorites for insert
  to authenticated
  with check (user_id_uuid = auth.uid());

create policy "user can remove own favorites"
  on public.favorites for delete
  to authenticated
  using (user_id_uuid = auth.uid());

-- 2.6 chats — только участники диалога (buyer/seller).
create policy "participant can read own chats"
  on public.chats for select
  to authenticated
  using (buyer_id_uuid = auth.uid() or seller_id_uuid = auth.uid());

create policy "buyer can start a chat"
  on public.chats for insert
  to authenticated
  with check (buyer_id_uuid = auth.uid());

create policy "participant can update own chat"
  on public.chats for update
  to authenticated
  using (buyer_id_uuid = auth.uid() or seller_id_uuid = auth.uid())
  with check (buyer_id_uuid = auth.uid() or seller_id_uuid = auth.uid());

create policy "participant can delete own chat"
  on public.chats for delete
  to authenticated
  using (buyer_id_uuid = auth.uid() or seller_id_uuid = auth.uid());

-- 2.7 messages — читать/писать может только участник родительского chats.
create policy "participant can read chat messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id_uuid = auth.uid() or c.seller_id_uuid = auth.uid())
    )
  );

create policy "participant can send chat message"
  on public.messages for insert
  to authenticated
  with check (
    sender_id_uuid = auth.uid()
    and exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and (c.buyer_id_uuid = auth.uid() or c.seller_id_uuid = auth.uid())
    )
  );

-- 2.8 feedback — отправить может кто угодно (в т.ч. гость), читать и
-- отмечать прочитанным — только admin. Раньше было "SELECT true" — любой
-- мог прочитать чужие обращения в поддержку.
create policy "anyone can submit feedback"
  on public.feedback for insert
  to anon, authenticated
  with check (true);

create policy "admin can read feedback"
  on public.feedback for select
  to authenticated
  using (public.is_admin());

create policy "admin can mark feedback read"
  on public.feedback for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- Явно НЕ входит в этот файл (следующая, отдельная миграция — только после
-- полного переключения кода и проверки STAGE 2 в проде):
--   - drop column accounts.password_hash (после того как ни один код-путь
--     его больше не читает)
--   - drop column listings.user_id / favorites.user_id / chats.buyer_id /
--     chats.seller_id / messages.sender_id (старые text-колонки)
--   - alter table accounts drop constraint accounts_pkey / сделать auth_id
--     основным id (переименование id -> id_legacy, auth_id -> id)
--   - not null на owner_id/*_uuid колонках
-- Всё это — после подтверждённого, стабильного периода работы на новой
-- схеме, отдельным review.
-- ============================================================================
