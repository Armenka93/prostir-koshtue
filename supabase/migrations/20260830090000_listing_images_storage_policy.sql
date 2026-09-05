-- ============================================================================
-- Простір Коштує — владельческие Storage-политики для listing-images
-- ПОДГОТОВЛЕНО ДЛЯ АУДИТА E.1, НЕ ПРИМЕНЕНО. apply_migration не вызывался.
--
-- 4-й раунд pre-migration audit — версионирование: изначально все три
-- новых файла (этот + expand + enforce) делили одну и ту же 8-значную
-- дату 20260830, что Supabase migration tooling трактует как
-- неоднозначный/непредсказуемый порядок (в т.ч. риск применить enforce
-- раньше expand). Переименовано на полный YYYYMMDDHHMMSS, уникальный и
-- больше любой уже существующей миграции проекта (максимум был 20260818):
-- этот файл — 20260830090000 (независим от A/B, идёт первым по
-- рекомендованному порядку, но функционально может применяться в любой
-- момент — см. ниже), expand — 20260830100000, enforce — 20260830110000.
-- Содержимое SQL не менялось, только имя файла и ссылки на него/соседние
-- файлы в комментариях.
--
-- НЕЗАВИСИМА от 20260830100000_listing_status_expand.sql /
-- 20260830110000_listing_status_enforce.sql — не трогает public.listings,
-- применима в любой момент. НЕ опциональна — подтверждённая проблема
-- безопасности, не следствие статусной модели.
--
-- Проблема (read-only аудит, полный список ДО этой миграции):
--   "public read listing images"   select  bucket_id='listing-images'
--   "public upload listing images" insert  bucket_id='listing-images'
--   "public delete listing images" delete  bucket_id='listing-images'
-- Ни одна не проверяет ПУТЬ — только bucket_id. UPDATE-policy для этого
-- бакета нет вообще (в списке из 11 policy на storage.objects её нет ни
-- у одного из трёх бакетов listing-images/avatars/chat-images) — но
-- storage.objects имеет RLS enabled (проверено: relrowsecurity=true), а
-- значит для команды, у которой НЕТ ни одной policy, доступ уже
-- полностью закрыт по умолчанию (тот же принцип "RLS + ноль policy =
-- нет доступа", что и у public.listing_publish_events). UPDATE сегодня
-- УЖЕ безопасен — эта миграция добавляет для него policy не потому что
-- там дыра, а для полноты набора (INSERT/UPDATE/DELETE/SELECT) и на
-- случай, если приложение когда-либо начнёт использовать upsert:true
-- (сейчас dbUploadListingImage() всегда шлёт upsert:false).
--
-- Формат пути подтверждён ЧТЕНИЕМ КОДА, не данными: bucket сейчас пуст
-- (0 объектов — как и public.listings, 0 строк), проверить реальный
-- сохранённый путь фактическим SELECT из storage.objects было не на
-- чем.
--   src/lib/db.ts, dbUploadListingImage():
--     const path = `${userId}/${Date.now()}-${...}.${ext}`
--   Вызывающие места (обновлено при финальном pre-migration audit —
--   AddListingScreen.tsx с этого момента удалён из кодовой базы,
--   заменён на AddListingWizard.tsx (E.2.2) + EditListingForm.tsx
--   (E.2.3), оба вызывают dbUploadListingImage(file, user.id) РОВНО ТАК
--   же, без fallback):
--     src/components/AddListingWizard.tsx: dbUploadListingImage(file, user.id)
--     src/components/EditListingForm.tsx:  dbUploadListingImage(file, user.id)
--   Оба места guard'ят вызов через `if (!files || !user) return` ДО
--   вызова — user гарантированно не null в момент вызова, `user.id` —
--   реальный auth.uid(), без fallback-строки вообще. РИСК
--   'user?.id || anonymous', ранее описанный здесь как найденный при
--   чтении AddListingScreen.tsx, устранён — в текущем коде такой
--   fallback не существует ни в одном вызывающем месте (перепроверено
--   при этом аудите чтением обоих файлов).
--
-- (storage.foldername(name))[1] — первый сегмент пути объекта.
-- ============================================================================

-- Удаляем старые широкие policy по точным именам.
drop policy if exists "public upload listing images" on storage.objects;
drop policy if exists "public delete listing images" on storage.objects;

-- SELECT — без изменений: bucket публичный по продукту (фото объявлений
-- видны всем), это не относится к безопасности записи/удаления.
-- Существующая policy "public read listing images" не трогается этой
-- миграцией; приводится здесь только для полноты картины набора.
--   using (bucket_id = 'listing-images')

-- INSERT — только в свою папку.
create policy "owner can upload own listing images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE — и USING (объект ДО правки должен уже лежать в своей папке),
-- и WITH CHECK (объект ПОСЛЕ правки тоже должен остаться в своей папке)
-- — без WITH CHECK можно было бы переименовать/переместить СВОЙ файл в
-- чужую папку тем же UPDATE, которым Storage выполняет upsert-перезапись
-- (name — часть строки, которую можно менять). Сегодня клиент не
-- использует upsert:true нигде для этого бакета — policy добавлена для
-- полноты и на будущее, ничего не включает из того, что реально
-- вызывается прямо сейчас.
create policy "owner can update own listing images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE — своя папка или admin (модерация: снять фото у чужого
-- отклонённого/спам-объявления).
create policy "owner or admin can delete own listing images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ============================================================================
-- ROLLOUT
-- ============================================================================
-- Независима от статусных миграций — можно применить в любой момент,
-- в том числе прямо сейчас, до A/B. Проверить сразу после apply:
-- загрузка нового фото в СВОЮ папку работает как раньше; попытка
-- (вручную, для проверки) загрузить/удалить объект с чужим первым
-- сегментом пути — отклоняется.
--
-- ============================================================================
-- ROLLBACK (справочно — НЕ выполняется автоматически)
-- ============================================================================
-- drop policy if exists "owner or admin can delete own listing images" on storage.objects;
-- drop policy if exists "owner can update own listing images" on storage.objects;
-- drop policy if exists "owner can upload own listing images" on storage.objects;
--
-- create policy "public upload listing images" on storage.objects for insert with check (bucket_id = 'listing-images');
-- create policy "public delete listing images" on storage.objects for delete using (bucket_id = 'listing-images');
--   -- UPDATE-policy этой миграции при откате просто удаляется (см.
--   -- выше) — до этой миграции для UPDATE не было policy вообще, что
--   -- уже эквивалентно "доступа нет"; откат её не восстанавливает как
--   -- "public", потому что такой policy никогда не существовало.
-- ============================================================================
