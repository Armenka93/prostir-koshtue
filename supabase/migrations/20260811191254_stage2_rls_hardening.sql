-- STAGE 2 — from supabase/migrations/20260806_auth_rls_hardening.sql, applied verbatim.

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
;
