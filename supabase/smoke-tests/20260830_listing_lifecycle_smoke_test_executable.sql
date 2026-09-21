-- ============================================================================
-- POST-MIGRATION-B EXECUTABLE SMOKE TEST (E.2.4, 3rd round pre-migration audit)
-- ============================================================================
-- REAL, EXECUTABLE SQL — not comments. Still NOT a migration, and still
-- deliberately outside supabase/migrations/ so no migration tool ever picks
-- it up automatically. Run ONLY:
--   - manually, by a human, statement-by-statement or as one script;
--   - against a DISPOSABLE STAGING project;
--   - AFTER Migration B (../migrations/20260830110000_listing_status_enforce.sql)
--     has actually been applied there;
--   - NEVER against production.
--
-- HONESTY NOTE (do not skip): this script has been written by careful,
-- line-by-line correspondence to the actual trigger logic in
-- 20260830110000_listing_status_enforce.sql and cross-checked against
-- scripts/test-lifecycle-timestamps.ts's transition table. It has NOT been
-- executed against any live Postgres instance — the session that wrote it
-- has no database access at all (by design — this whole audit is
-- read-only/drafting-only). Its first real run, by a human, in a
-- disposable staging environment, IS the actual validation, not this
-- authoring step. Treat a clean run as the real proof; treat this text as
-- a well-reasoned draft, not a substitute for that run. If a statement
-- errors on a name/type mismatch (e.g. a column or constraint name typo),
-- fix it in place — that would mean this draft has a bug, not that the
-- trigger does.
--
-- SCOPE — what this script DOES cover, executably:
--   - INSERT branch: forbidden non-draft INSERT; the six lifecycle fields
--     forced to NULL regardless of what's sent.
--   - CHECK constraints: listings_required_for_review, listings_max_photos,
--     listings_rejection_reason_check.
--   - Owner UPDATE transitions: draft→pending_review, the significant-edit
--     forced downgrade (active→pending_review), pause, archive, restore,
--     self-approve/self-reject forbidden, pending_review lockout.
--   - Admin UPDATE transitions: approve, reject (incl. required reason),
--     forbidden admin transition, emergency archive.
--   - The full six-field timestamp table for every transition above.
--   - A STRUCTURAL approximation of the "someone already changed it"
--     conflict case (see SCENARIO 9) — matched-zero-rows-on-a-stale-guard,
--     not a true two-session race (see that scenario's own note for why).
--
-- SCOPE — what this script deliberately does NOT cover, and why:
--   - True concurrent-session races (two REAL simultaneous transactions
--     hitting pg_advisory_xact_lock / the same row at the same instant).
--     A single script, single session, cannot create real concurrency —
--     doing so needs two separate psql/client connections run in parallel
--     by a human, which is out of scope for one SQL file. See the
--     checklist file (20260830_listing_lifecycle_smoke_test.sql) for a
--     manual two-session recipe to run separately.
--   - Rate-limit behavior (5/10min, 20/24ha) — check_publish_rate_limit()
--     reads/writes public.listing_publish_events keyed on auth.uid(); this
--     script intentionally never commits (see ROLLBACK below), so hitting
--     real limits here would only prove something about THIS run's own
--     throwaway rows, not about real user behavior, and would pollute the
--     rate-limit table for the two staging accounts used below if this
--     script is ever run with COMMIT by mistake. Test the rate limit
--     separately, deliberately, outside this script.
--   - RLS as the actually-serving-traffic path: this script runs the
--     UPDATE/INSERT statements as whichever role you SET beforehand (see
--     SETUP below) — it exercises the trigger for real, and RLS for real
--     IF you set `role authenticated` (not superuser/postgres) before each
--     block, but the script cannot force you to do that; skipping it means
--     you're only testing the trigger, not "RLS + trigger together". Do
--     not skip the SET ROLE lines.
--
-- ── SETUP — read before running ─────────────────────────────────────────
-- This script deliberately does NOT create fake auth.users rows (auth.users'
-- exact required columns depend on your Supabase Auth/GoTrue version, which
-- this drafting session has no way to verify without live access — an
-- invented INSERT INTO auth.users here could be wrong in ways this session
-- cannot catch). Instead, supply TWO REAL, ALREADY-EXISTING accounts from
-- your disposable staging project:
--   :'owner_uid'  — an ordinary authenticated user (any role != admin)
--   :'admin_uid'  — a user whose public.accounts row has role = 'admin'
--     (public.is_admin() must return true for them — see
--     20260808072944_stage1_auth_bridge_columns_and_trigger.sql, section 1.6)
-- Pass them as psql variables when invoking this file, e.g.:
--   psql "$STAGING_DB_URL" \
--     -v owner_uid="'11111111-1111-1111-1111-111111111111'" \
--     -v admin_uid="'22222222-2222-2222-2222-222222222222'" \
--     -v confirm="'RUN_SMOKE_TEST'" \
--     -f 20260830_listing_lifecycle_smoke_test_executable.sql
-- All rows this script creates are `public.listings` rows owned by
-- :owner_uid — nothing is inserted into auth.users or public.accounts, and
-- the whole script runs inside one transaction that ends in ROLLBACK, so
-- nothing persists even if every assertion passes.
--
-- Guard against accidental execution — refuses to run unless the :confirm
-- variable is passed with the exact expected value. psql substitutes :'x'
-- as a quoted literal; an unset variable is substituted literally as the
-- text ":'confirm'" (not a valid uuid/string match), which also fails
-- closed here.
do $$
begin
  if :'confirm' is distinct from 'RUN_SMOKE_TEST' then
    raise exception 'Refusing to run: pass -v confirm="''RUN_SMOKE_TEST''" explicitly. This must only run against a disposable staging project, after Migration B, never production.';
  end if;
end $$;

begin;

-- Never allow this transaction to commit no matter what happens below —
-- belt-and-braces on top of the explicit `rollback;` at the end of the
-- file: if the script is interrupted partway (Ctrl-C, connection drop,
-- an unexpected error outside a DO block's own handling), an open
-- transaction with no COMMIT is abandoned/rolled back automatically when
-- the session ends, so nothing from this script can survive that either.

-- ── SCENARIO 1: INSERT — forbidden non-draft, six-field NULL reset ──────
do $$
declare
  v_id bigint;
begin
  -- Forbidden non-draft INSERT — must raise.
  begin
    insert into public.listings (owner_id, user_id, status, title)
      values (:'owner_uid', :'owner_uid', 'active', 'Smoke test — should never insert');
    raise exception 'FAIL scenario 1a: non-draft INSERT was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_INSERT' then
      raise exception 'FAIL scenario 1a: expected LISTING_STATUS_FORBIDDEN_INSERT, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 1a — non-draft INSERT rejected with LISTING_STATUS_FORBIDDEN_INSERT';
  end;

  -- draft INSERT with forged non-null lifecycle fields — must land all six NULL.
  insert into public.listings (
    owner_id, user_id, status, title, is_active,
    pending_review_at, published_at, archived_at, moderated_at, moderated_by, rejection_reason
  ) values (
    :'owner_uid', :'owner_uid', 'draft', 'Smoke test draft', true,
    now(), now(), now(), now(), :'admin_uid', 'forged reason'
  ) returning id into v_id;

  perform 1 from public.listings
    where id = v_id
      and is_active = false
      and pending_review_at is null and published_at is null and archived_at is null
      and moderated_at is null and moderated_by is null and rejection_reason is null;
  if not found then
    raise exception 'FAIL scenario 1b: INSERT did not force all six lifecycle fields to NULL (and is_active to false)';
  end if;
  raise notice 'ok: scenario 1b — draft INSERT forces is_active=false and all six lifecycle fields NULL despite forged input';
end $$;

-- ── SCENARIO 2: listings_required_for_review / listings_max_photos ──────
do $$
declare
  v_id bigint;
begin
  insert into public.listings (owner_id, user_id, status, title)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test incomplete')
    returning id into v_id;

  -- Incomplete row → pending_review must fail the required-fields CHECK.
  begin
    update public.listings set status = 'pending_review' where id = v_id;
    raise exception 'FAIL scenario 2a: incomplete listing was allowed into pending_review';
  exception when check_violation then
    if position('listings_required_for_review' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 2a: expected listings_required_for_review violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 2a — incomplete listing blocked by listings_required_for_review';
  end;

  -- Max photos — 11 images must fail regardless of status.
  begin
    update public.listings
      set images = array(select 'https://example.invalid/' || g || '.jpg' from generate_series(1,11) g)
      where id = v_id;
    raise exception 'FAIL scenario 2b: 11 images was NOT rejected by listings_max_photos';
  exception when check_violation then
    if position('listings_max_photos' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 2b: expected listings_max_photos violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 2b — 11 images blocked by listings_max_photos';
  end;
end $$;

-- ── Helper role-switch — from here on, run each block AS the intended
-- role. `set local role` + `set local request.jwt.claims` is Supabase's
-- own documented mechanism for auth.uid()/is_admin() to see a specific
-- user inside a plain SQL session — standard across Supabase projects,
-- but this session cannot confirm your exact Postgres/GoTrue version
-- accepts the GUC name below unchanged; adjust if your project errors here.
-- ────────────────────────────────────────────────────────────────────────

-- ── SCENARIO 3: draft → pending_review (owner, complete listing) ────────
do $$
declare
  v_id bigint;
  v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);

  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test complete', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;

  update public.listings set status = 'pending_review' where id = v_id;

  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'pending_review' then raise exception 'FAIL scenario 3: status did not become pending_review'; end if;
  if v_row.pending_review_at is null then raise exception 'FAIL scenario 3: pending_review_at was not set'; end if;
  if v_row.published_at is not null or v_row.archived_at is not null
     or v_row.moderated_at is not null or v_row.moderated_by is not null or v_row.rejection_reason is not null then
    raise exception 'FAIL scenario 3: an unrelated lifecycle field was set (expected only pending_review_at)';
  end if;
  raise notice 'ok: scenario 3 — draft→pending_review sets pending_review_at only, matches the transition table';

  -- Owner is now locked out entirely while pending_review.
  begin
    update public.listings set title = 'attempted edit while pending' where id = v_id;
    raise exception 'FAIL scenario 3b: owner was able to edit a pending_review row';
  exception when others then
    if sqlerrm <> 'LISTING_LOCKED_PENDING_REVIEW' then
      raise exception 'FAIL scenario 3b: expected LISTING_LOCKED_PENDING_REVIEW, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 3b — owner locked out of a pending_review row (LISTING_LOCKED_PENDING_REVIEW)';
  end;
end $$;

-- ── SCENARIO 4: admin approve — pending_review → active ──────────────────
do $$
declare
  v_id bigint;
  v_row record;
begin
  -- Re-create as owner (each DO block is its own scope; role persists
  -- session-wide via `set local`, which lasts to end of transaction — reset
  -- to owner explicitly before creating the fixture row).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test approve', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;

  -- Switch to admin.
  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

  update public.listings set status = 'active' where id = v_id;

  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'active' or v_row.is_active <> true then raise exception 'FAIL scenario 4: not active/is_active after approve'; end if;
  if v_row.published_at is null then raise exception 'FAIL scenario 4: published_at not set'; end if;
  if v_row.moderated_at is null or v_row.moderated_by is distinct from :'admin_uid'::uuid then
    raise exception 'FAIL scenario 4: moderated_at/moderated_by not stamped to the admin';
  end if;
  if v_row.archived_at is not null then raise exception 'FAIL scenario 4: archived_at should be null after approve'; end if;
  if v_row.pending_review_at is null then raise exception 'FAIL scenario 4: pending_review_at should be preserved, not null'; end if;
  raise notice 'ok: scenario 4 — admin approve stamps published_at/moderated_at/moderated_by, clears archived_at, preserves pending_review_at';

  -- Owner cannot self-reject/self-approve a currently-active listing back
  -- to draft-ish states outside the allowed set.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  begin
    update public.listings set status = 'rejected' where id = v_id;
    raise exception 'FAIL scenario 4b: owner was able to self-reject';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_SELF_REJECT' then
      raise exception 'FAIL scenario 4b: expected LISTING_STATUS_FORBIDDEN_SELF_REJECT, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 4b — owner cannot self-reject an active listing';
  end;
end $$;

-- ── SCENARIO 5: admin reject requires a reason ───────────────────────────
do $$
declare
  v_id bigint;
  v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test reject', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

  begin
    update public.listings set status = 'rejected' where id = v_id;
    raise exception 'FAIL scenario 5a: reject without a reason was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_REJECTION_REASON_REQUIRED' then
      raise exception 'FAIL scenario 5a: expected LISTING_REJECTION_REASON_REQUIRED, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 5a — reject without a reason blocked (LISTING_REJECTION_REASON_REQUIRED)';
  end;

  update public.listings set status = 'rejected', rejection_reason = 'Smoke test reason' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.rejection_reason <> 'Smoke test reason' then raise exception 'FAIL scenario 5b: rejection_reason not stored'; end if;
  if v_row.moderated_at is null or v_row.moderated_by is distinct from :'admin_uid'::uuid then
    raise exception 'FAIL scenario 5b: moderated_at/by not stamped';
  end if;
  raise notice 'ok: scenario 5b — reject stamps moderated_at/by and stores the reason';
end $$;

-- ── SCENARIO 6: significant edit on active forces pending_review, clears
--    moderated_at/by, does NOT touch published_at ───────────────────────
do $$
declare
  v_id bigint;
  v_row record;
  v_published_at timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test edit', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
  update public.listings set status = 'active' where id = v_id;
  select published_at into v_published_at from public.listings where id = v_id;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  update public.listings set price = 12000 where id = v_id;

  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'pending_review' then raise exception 'FAIL scenario 6: significant edit did not force pending_review'; end if;
  if v_row.moderated_at is not null or v_row.moderated_by is not null then raise exception 'FAIL scenario 6: moderated_at/by not cleared on new cycle'; end if;
  if v_row.published_at is distinct from v_published_at then raise exception 'FAIL scenario 6: published_at changed — should be preserved as history'; end if;
  if v_row.pending_review_at is null then raise exception 'FAIL scenario 6: pending_review_at not set'; end if;
  raise notice 'ok: scenario 6 — significant edit on active forces pending_review, clears moderated_at/by, preserves published_at';
end $$;

-- ── SCENARIO 7: pause / archive / restore + archived_at clearing ────────
do $$
declare
  v_id bigint;
  v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test pause', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;
  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
  update public.listings set status = 'active' where id = v_id;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);

  update public.listings set status = 'paused' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'paused' or v_row.is_active <> false then raise exception 'FAIL scenario 7a: pause did not set status/is_active correctly'; end if;
  raise notice 'ok: scenario 7a — active→paused';

  update public.listings set status = 'archived' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'archived' or v_row.archived_at is null then raise exception 'FAIL scenario 7b: archive did not set status/archived_at'; end if;
  raise notice 'ok: scenario 7b — paused→archived sets archived_at';

  update public.listings set status = 'active' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'active' then raise exception 'FAIL scenario 7c: restore did not set status=active'; end if;
  if v_row.archived_at is not null then raise exception 'FAIL scenario 7c: archived_at NOT cleared after restore — this is the exact bug the 2nd-round audit fixed'; end if;
  if v_row.published_at is null then raise exception 'FAIL scenario 7c: published_at not refreshed on restore'; end if;
  raise notice 'ok: scenario 7c — archived→active restore clears archived_at and refreshes published_at';
end $$;

-- ── SCENARIO 8: admin cannot perform a non-whitelisted transition ───────
do $$
declare
  v_id bigint;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test admin forbidden')
    returning id into v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
  begin
    update public.listings set status = 'active' where id = v_id;  -- draft -> active is not in admin's whitelist
    raise exception 'FAIL scenario 8: admin was able to force draft directly to active';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION' then
      raise exception 'FAIL scenario 8: expected LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 8 — admin cannot force draft->active (not in the whitelisted transition set)';
  end;
end $$;

-- ── SCENARIO 9: structural conflict-detection approximation ─────────────
-- NOT a true concurrency test (see header) — this only proves the
-- mechanism the app relies on (`WHERE id=.. AND status='pending_review'`
-- matching zero rows once the status has already moved on) behaves as
-- expected, using two sequential UPDATEs in the SAME session rather than
-- two genuinely concurrent sessions.
do $$
declare
  v_id bigint;
  v_rows_affected int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);
  insert into public.listings (owner_id, user_id, status, title, type, price, area, district, address, images)
    values (:'owner_uid', :'owner_uid', 'draft', 'Smoke test conflict', 'Офіс', 10000, 30, 'Центр', 'Test address', array['https://example.invalid/a.jpg','https://example.invalid/b.jpg','https://example.invalid/c.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
  update public.listings set status = 'active' where id = v_id;  -- "first admin" wins

  -- "second admin", still holding a stale in-memory copy at pending_review,
  -- tries the exact same guarded UPDATE the app would send.
  update public.listings set status = 'rejected', rejection_reason = 'stale attempt'
    where id = v_id and status = 'pending_review';
  get diagnostics v_rows_affected = row_count;
  if v_rows_affected <> 0 then
    raise exception 'FAIL scenario 9: a stale guarded UPDATE matched a row it should not have';
  end if;
  raise notice 'ok: scenario 9 — a stale status-guarded UPDATE matches zero rows once another admin already moved the row (structural approximation, not a true concurrent-session race)';
end $$;

-- Reset role before rollback (tidiness, not required for correctness —
-- ROLLBACK undoes the role change along with everything else).
reset role;

rollback;

-- If every block above printed "ok: ..." and this file reached ROLLBACK
-- without an unhandled error, the trigger's behavior matches the
-- documented transition table for everything in SCOPE above. Nothing
-- persists — confirm with a `select count(*) from public.listings where
-- title like 'Smoke test%'` in a NEW transaction/session, which must
-- return 0.
