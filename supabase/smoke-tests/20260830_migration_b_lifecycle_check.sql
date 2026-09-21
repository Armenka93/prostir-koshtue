-- ============================================================================
-- MIGRATION B — LIFECYCLE ENFORCEMENT CHECK (6th round pre-migration audit)
-- ============================================================================
-- REAL, EXECUTABLE SQL. NOT a migration — outside supabase/migrations/, run
-- ONLY manually, ONLY against a LOCAL Postgres instance that has Migration A
-- (20260830100000_listing_status_expand.sql) AND Migration B
-- (20260830110000_listing_status_enforce.sql, with the
-- count_distinct_nonempty_images() IMMUTABLE-function fix — the original
-- inline subquery in listings_required_for_review cannot be applied at all,
-- PostgreSQL rejects any subquery inside a CHECK constraint) already
-- applied. NEVER run against production or any project-linked connection
-- string — the target must be a bare localhost URL.
--
-- This local instance is NOT a full copy of production — see
-- 20260830_migration_a_rate_limit_and_required_fields_check.sql's header
-- for the excluded-schema list; the same applies here.
--
-- The existing Migration A smoke tests are NOT reused as a pass/fail
-- criterion here — they exercise the A-only transitional state (is_active
-- as the live signal, the transitional rate-limit trigger) which Migration
-- B replaces outright. A passing run of this file does not require them to
-- still pass afterward, and vice versa.
--
-- WHAT THIS PROVES (grouped by the rules enforce_listing_lifecycle() and
-- its CHECK constraints are meant to guarantee):
--   0.  RLS harness sanity — cross-owner INSERT rejected.
--   1.  INSERT: any status other than 'draft' is rejected outright.
--   2.  INSERT: is_active forced false and all six lifecycle fields forced
--       NULL, regardless of what the client sends.
--   3.  Incomplete draft is allowed (CHECK only applies outside draft).
--   4.  Submitting incomplete required fields is rejected, and — thanks to
--       statement-level atomicity — does NOT charge the rate limit either.
--   5.  Submitting with only 2 distinct non-empty photos is rejected (photo
--       floor); exactly 3 (after trim, one whitespace-duplicate) passes.
--   6.  listings_max_photos applies even to draft (11 photos rejected).
--   7.  pending_review is fully locked for the owner.
--   8.  Admin approve / reject from pending_review; a blank/omitted
--       rejection reason is rejected; a forbidden status transition is
--       rejected; owner cannot self-approve or self-reject.
--   9.  A significant field edit on an active listing forces it back to
--       pending_review and charges the rate limit; a non-significant field
--       edit does neither.
--   10. Archive / restore / pause set the right timestamp on the real
--       transition only, preserving history fields otherwise; admin
--       emergency archive preserves moderation history.
--   11. Delete: owner limited to draft/archived; admin unrestricted.
--   12. Public visibility: a non-owner/non-admin (authenticated or anon)
--       sees only status='active'; owner sees all own statuses; admin sees
--       everything.
--   13. Rate-limit burst exhaustion blocks a real submit.
--   14. owner_id/user_id are immutable — even for admin.
--
-- Guard against accidental execution.
select set_config('app.owner_uid', :owner_uid, false);
select set_config('app.other_uid', :other_uid, false);
select set_config('app.admin_uid', :admin_uid, false);
select set_config('app.confirm', :confirm, false);

-- psql does not interpolate :'var'/:var inside dollar-quoted ($$...$$)
-- blocks — see the Migration A smoke-test header for why. Everything below
-- reads the bridged values back via current_setting('app.*').
do $$
begin
  if current_setting('app.confirm', true) is distinct from 'RUN_LIFECYCLE_B_CHECK' then
    raise exception 'Refusing to run: pass -v confirm="''RUN_LIFECYCLE_B_CHECK''" explicitly. Disposable staging only, Migration A+B applied, never production.';
  end if;
end $$;

-- Supply three synthetic uids (owner_uid, other_uid — any non-owner,
-- non-admin authenticated user — and admin_uid, whose public.accounts row
-- must have role='admin') and a localhost-only connection string.
-- `-v ON_ERROR_STOP=1` is required. Invoke with:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 \
--     -v owner_uid="'11111111-1111-1111-1111-111111111111'" \
--     -v other_uid="'22222222-2222-2222-2222-222222222222'" \
--     -v admin_uid="'33333333-3333-3333-3333-333333333333'" \
--     -v confirm="'RUN_LIFECYCLE_B_CHECK'" \
--     -f 20260830_migration_b_lifecycle_check.sql
-- (confirm the actual local port via `supabase status`, don't assume it.)

begin;

-- Confirms every tested operation genuinely runs as `authenticated` with
-- the expected auth.uid() — kept in pg_temp (session-local, gone once this
-- connection ends, never touches the real schema).
create function pg_temp.assert_test_identity(expected_uid uuid) returns void
language plpgsql as $fn$
begin
  if current_user <> 'authenticated' then
    raise exception 'TEST HARNESS: expected current_user=authenticated, got %', current_user;
  end if;
  if auth.uid() is distinct from expected_uid then
    raise exception 'TEST HARNESS: expected auth.uid()=%, got %', expected_uid, auth.uid();
  end if;
end;
$fn$;

-- Switches the acting identity for subsequent statements and immediately
-- verifies it took effect.
create function pg_temp.set_actor(uid uuid) returns void
language plpgsql as $fn$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity(uid);
end;
$fn$;

-- listing_publish_events has RLS enabled with zero policies (same as in
-- the Migration A smoke test) — counting it requires a temporary role
-- bump to postgres, restored to `authenticated` (with the given uid
-- re-asserted) immediately after.
create function pg_temp.count_publish_events(uid uuid) returns integer
language plpgsql as $fn$
declare
  v_count integer;
begin
  set local role postgres;
  select count(*) into v_count from public.listing_publish_events where user_id = uid;
  set local role authenticated;
  perform pg_temp.assert_test_identity(uid);
  return v_count;
end;
$fn$;

-- A fresh synthetic auth.users row with its own, independent rate-limit
-- history (0 charges). `now()` is frozen for the whole surrounding
-- transaction (transaction timestamp, not statement timestamp), so the
-- 5/10min burst window can never naturally age out mid-file — scenarios
-- that need a real successful charge but aren't specifically testing
-- owner_uid's own limit history use a fresh identity instead of sharing
-- owner_uid's budget across the whole file.
create function pg_temp.new_synthetic_user() returns uuid
language plpgsql as $fn$
declare
  v_uid uuid := gen_random_uuid();
begin
  set local role postgres;
  insert into auth.users (id, email, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_uid, v_uid::text || '@synthetic.test', 'authenticated', 'authenticated', '', now(), now(), now());
  set local role authenticated;
  return v_uid;
end;
$fn$;

-- `now()` is frozen for the whole transaction, so a restore's genuine
-- `NEW.published_at := now()` reassignment is bit-identical to the value
-- already sitting in OLD from any earlier now()-based assignment in this
-- same transaction — value comparison alone cannot tell "reassigned" from
-- "left untouched". Backdating published_at first (bypassing the trigger,
-- postgres/table-owner only) gives it a value that is guaranteed to be
-- reachable only through a real reassignment, so a subsequent real-owner
-- restore proves the code path actually runs, not just holds the CHECK.
create function pg_temp.backdate_published_at(v_id bigint) returns void
language plpgsql as $fn$
begin
  set local role postgres;
  alter table public.listings disable trigger enforce_listing_lifecycle;
  update public.listings set published_at = now() - interval '1 day' where id = v_id;
  alter table public.listings enable trigger enforce_listing_lifecycle;
  set local role authenticated;
end;
$fn$;

-- Inserts a complete, valid draft (3 distinct photos, all required fields
-- filled) as the given uid — runs SECURITY INVOKER, so RLS ("owner can
-- insert own draft listings") applies exactly as it would for a real
-- request; the caller must already be acting as `uid` via set_actor().
create function pg_temp.new_complete_draft(uid uuid, ttl text) returns bigint
language plpgsql as $fn$
declare
  v_id bigint;
begin
  -- is_active explicit (false) — 8th round audit: an omitted is_active
  -- would hit the column's own DEFAULT true and now trip the trigger's
  -- INSERT-side legacy-client guard instead of creating a normal draft.
  insert into public.listings (user_id, owner_id, status, is_active, title, type, price, area, district, address, images)
    values (uid::text, uid, 'draft', false, ttl, 'Офіс', 10000, 30, 'Центр', 'Test address', array['/p1.jpg','/p2.jpg','/p3.jpg'])
    returning id into v_id;
  return v_id;
end;
$fn$;

-- ── SCENARIO 0: RLS harness sanity check ─────────────────────────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_other uuid := current_setting('app.other_uid')::uuid;
begin
  perform pg_temp.set_actor(v_owner);
  begin
    -- is_active explicit (false) — 8th round audit: the trigger now
    -- rejects any INSERT with is_active=true (LISTING_LEGACY_CLIENT_DETECTED,
    -- see Migration B section on legacy-client protection). Omitting it
    -- here would fall through to the column's own DEFAULT true and trip
    -- that check instead of the RLS rejection this scenario actually
    -- tests — exactly the false positive that WAS this line, before it
    -- got the (unrelated) INSERT-side check removed for a full round.
    insert into public.listings (user_id, owner_id, status, is_active, title)
      values (v_owner::text, v_other, 'draft', false, 'Scenario 0 RLS cross-owner attempt');
    raise exception 'FAIL scenario 0: RLS did NOT block an INSERT claiming a different owner_id';
  exception when insufficient_privilege then
    raise notice 'ok: scenario 0 — RLS rejects a cross-owner INSERT; session genuinely constrained as authenticated';
  end;
end $$;

-- ── SCENARIO 1: INSERT with a non-draft status is rejected ──────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
begin
  perform pg_temp.set_actor(v_owner);
  begin
    insert into public.listings (user_id, owner_id, status, title)
      values (v_owner::text, v_owner, 'active', 'Scenario 1 forbidden insert');
    raise exception 'FAIL scenario 1: INSERT with status=''active'' was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_INSERT' then
      raise exception 'FAIL scenario 1: expected LISTING_STATUS_FORBIDDEN_INSERT, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 1 — INSERT with a non-draft status is rejected (LISTING_STATUS_FORBIDDEN_INSERT)';
  end;
end $$;

-- ── SCENARIO 2a: INSERT with is_active=true is rejected outright ────────
-- 8th round audit — split out of the old Scenario 2, which asserted this
-- got silently FORCED to false. That was the correct expectation before
-- the 8th round's legacy-client INSERT guard; now it's the guard's own
-- job, and this INSERT must be REJECTED, not silently corrected — see
-- Migration B's INSERT-branch comment for why (no current client path
-- ever sends is_active=true on INSERT, so seeing it IS the signal).
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
begin
  perform pg_temp.set_actor(v_owner);
  begin
    insert into public.listings (user_id, owner_id, status, title, is_active)
      values (v_owner::text, v_owner, 'draft', 'Scenario 2a legacy INSERT', true);
    raise exception 'FAIL scenario 2a: INSERT with is_active=true was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_LEGACY_CLIENT_DETECTED' then
      raise exception 'FAIL scenario 2a: expected LISTING_LEGACY_CLIENT_DETECTED, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 2a — INSERT with is_active=true is rejected (LISTING_LEGACY_CLIENT_DETECTED)';
  end;
end $$;

-- ── SCENARIO 2b: a legitimate (is_active=false) INSERT still forces all
--    six lifecycle fields to NULL, regardless of client-injected values ──
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_id bigint;
  v_row record;
begin
  perform pg_temp.set_actor(v_owner);
  insert into public.listings (
    user_id, owner_id, status, title, is_active,
    rejection_reason, moderated_at, moderated_by,
    pending_review_at, published_at, archived_at
  ) values (
    v_owner::text, v_owner, 'draft', 'Scenario 2b forced fields', false,
    'smuggled reason', now(), v_owner,
    now(), now(), now()
  ) returning id into v_id;

  select * into v_row from public.listings where id = v_id;
  if v_row.is_active is distinct from false then
    raise exception 'FAIL scenario 2b: is_active = %, expected false', v_row.is_active;
  end if;
  if v_row.rejection_reason is not null or v_row.moderated_at is not null or v_row.moderated_by is not null
     or v_row.pending_review_at is not null or v_row.published_at is not null or v_row.archived_at is not null then
    raise exception 'FAIL scenario 2b: a lifecycle field survived client injection on INSERT: %', row_to_json(v_row);
  end if;
  raise notice 'ok: scenario 2b — a legitimate (is_active=false) INSERT still forces all six lifecycle fields to NULL regardless of client input';
end $$;

-- ── SCENARIO 3: incomplete draft is allowed (CHECK only applies outside draft) ──
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_id bigint;
begin
  perform pg_temp.set_actor(v_owner);
  insert into public.listings (user_id, owner_id, status, is_active, title)
    values (v_owner::text, v_owner, 'draft', false, 'Scenario 3 incomplete draft')
    returning id into v_id;
  raise notice 'ok: scenario 3 — incomplete draft (missing type/price/area/district/address/photos) is allowed';
end $$;

-- ── SCENARIO 4: submitting incomplete required fields is rejected, and
--    does NOT charge the rate limit (statement-level atomicity) ─────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_id bigint;
  v_before integer;
  v_after integer;
begin
  perform pg_temp.set_actor(v_owner);
  insert into public.listings (user_id, owner_id, status, is_active, title)
    values (v_owner::text, v_owner, 'draft', false, 'Scenario 4 incomplete submit')
    returning id into v_id;

  v_before := pg_temp.count_publish_events(v_owner);
  begin
    update public.listings set status = 'pending_review' where id = v_id;
    raise exception 'FAIL scenario 4: submitting with missing required fields was NOT rejected';
  exception when check_violation then
    if position('listings_required_for_review' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 4: expected listings_required_for_review violation, got: %', sqlerrm;
    end if;
  end;
  v_after := pg_temp.count_publish_events(v_owner);
  if v_after <> v_before then
    raise exception 'FAIL scenario 4: a rejected submit still charged the rate limit — events % -> %', v_before, v_after;
  end if;
  raise notice 'ok: scenario 4 — incomplete submit rejected by listings_required_for_review, and the rate limit was NOT charged (statement rolled back atomically)';
end $$;

-- ── SCENARIO 5: photo floor — 2 unique photos rejected, 3 (with a
--    whitespace-duplicate) accepted ─────────────────────────────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_id bigint;
begin
  perform pg_temp.set_actor(v_owner);
  insert into public.listings (user_id, owner_id, status, is_active, title, type, price, area, district, address, images)
    values (v_owner::text, v_owner, 'draft', false, 'Scenario 5a two photos', 'Офіс', 10000, 30, 'Центр', 'Test address', array['/p1.jpg', '/p2.jpg'])
    returning id into v_id;
  begin
    update public.listings set status = 'pending_review' where id = v_id;
    raise exception 'FAIL scenario 5a: submitting with only 2 unique photos was NOT rejected';
  exception when check_violation then
    if position('listings_required_for_review' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 5a: expected listings_required_for_review violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 5a — submitting with only 2 unique photos is rejected';
  end;

  insert into public.listings (user_id, owner_id, status, is_active, title, type, price, area, district, address, images)
    values (v_owner::text, v_owner, 'draft', false, 'Scenario 5b three photos', 'Офіс', 10000, 30, 'Центр', 'Test address', array['/p1.jpg', ' /p2.jpg ', '/p2.jpg', '/p3.jpg'])
    returning id into v_id;
  update public.listings set status = 'pending_review' where id = v_id;
  raise notice 'ok: scenario 5b — submitting with 3 distinct (after trim) photos among 4 raw entries is accepted';
end $$;

-- ── SCENARIO 6: listings_max_photos applies even to draft ────────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_many text[] := array(select '/p' || i || '.jpg' from generate_series(1, 11) as i);
begin
  perform pg_temp.set_actor(v_owner);
  begin
    insert into public.listings (user_id, owner_id, status, is_active, title, images)
      values (v_owner::text, v_owner, 'draft', false, 'Scenario 6 too many photos', v_many);
    raise exception 'FAIL scenario 6: an 11-photo draft INSERT was NOT rejected';
  exception when check_violation then
    if position('listings_max_photos' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 6: expected listings_max_photos violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 6 — listings_max_photos (11 > 10) is enforced even on a draft';
  end;
end $$;

-- ── SCENARIO 7: pending_review is fully locked for the owner ─────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_id bigint;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 7 locked while pending');
  update public.listings set status = 'pending_review' where id = v_id;

  begin
    update public.listings set price = 99999 where id = v_id;
    raise exception 'FAIL scenario 7: owner was able to edit a pending_review listing';
  exception when others then
    if sqlerrm <> 'LISTING_LOCKED_PENDING_REVIEW' then
      raise exception 'FAIL scenario 7: expected LISTING_LOCKED_PENDING_REVIEW, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 7 — owner cannot edit anything (including status) while pending_review';
  end;
end $$;

-- ── SCENARIO 8: admin approve — published_at/moderated_at/moderated_by
--    set, archived_at/rejection_reason cleared ──────────────────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
  v_row record;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 8 approve me');
  update public.listings set status = 'pending_review' where id = v_id;

  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_id;

  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'active' or v_row.is_active is distinct from true then
    raise exception 'FAIL scenario 8: status/is_active after approve = %/%', v_row.status, v_row.is_active;
  end if;
  if v_row.published_at is null or v_row.moderated_at is null or v_row.moderated_by is distinct from v_admin then
    raise exception 'FAIL scenario 8: published_at/moderated_at/moderated_by not set correctly: %', row_to_json(v_row);
  end if;
  if v_row.archived_at is not null or v_row.rejection_reason is not null then
    raise exception 'FAIL scenario 8: archived_at/rejection_reason not cleared: %', row_to_json(v_row);
  end if;
  raise notice 'ok: scenario 8 — admin approve sets published_at/moderated_at/moderated_by, clears archived_at/rejection_reason';
end $$;

-- ── SCENARIO 9: admin reject requires a non-blank reason ─────────────────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
  v_row record;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 9 reject me');
  update public.listings set status = 'pending_review' where id = v_id;

  perform pg_temp.set_actor(v_admin);
  begin
    update public.listings set status = 'rejected' where id = v_id;
    raise exception 'FAIL scenario 9a: reject with no rejection_reason at all was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_REJECTION_REASON_REQUIRED' then
      raise exception 'FAIL scenario 9a: expected LISTING_REJECTION_REASON_REQUIRED, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 9a — admin reject with no reason is rejected (LISTING_REJECTION_REASON_REQUIRED)';
  end;

  begin
    update public.listings set status = 'rejected', rejection_reason = '   ' where id = v_id;
    raise exception 'FAIL scenario 9b: reject with a blank (whitespace-only) reason was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_REJECTION_REASON_REQUIRED' then
      raise exception 'FAIL scenario 9b: expected LISTING_REJECTION_REASON_REQUIRED, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 9b — admin reject with a blank reason is rejected';
  end;

  update public.listings set status = 'rejected', rejection_reason = 'Фото не відповідають опису' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.rejection_reason <> 'Фото не відповідають опису' or v_row.moderated_by is distinct from v_admin or v_row.moderated_at is null then
    raise exception 'FAIL scenario 9c: reject did not store reason/moderated_at/moderated_by correctly: %', row_to_json(v_row);
  end if;
  raise notice 'ok: scenario 9c — admin reject with a real reason stores it plus moderated_at/moderated_by';
end $$;

-- ── SCENARIO 10: forbidden admin transition, self-approve, self-reject ──
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 10 forbidden transitions');

  perform pg_temp.set_actor(v_admin);
  begin
    update public.listings set status = 'active' where id = v_id;
    raise exception 'FAIL scenario 10a: admin draft->active was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION' then
      raise exception 'FAIL scenario 10a: expected LISTING_STATUS_FORBIDDEN_ADMIN_TRANSITION, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 10a — admin draft->active (not from pending_review) is rejected';
  end;

  perform pg_temp.set_actor(v_owner);
  begin
    update public.listings set status = 'active' where id = v_id;
    raise exception 'FAIL scenario 10b: owner self-approve draft->active was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_SELF_APPROVE' then
      raise exception 'FAIL scenario 10b: expected LISTING_STATUS_FORBIDDEN_SELF_APPROVE, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 10b — owner self-approve is rejected (LISTING_STATUS_FORBIDDEN_SELF_APPROVE)';
  end;

  begin
    update public.listings set status = 'rejected' where id = v_id;
    raise exception 'FAIL scenario 10c: owner self-reject was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_STATUS_FORBIDDEN_SELF_REJECT' then
      raise exception 'FAIL scenario 10c: expected LISTING_STATUS_FORBIDDEN_SELF_REJECT, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 10c — owner self-reject is rejected (LISTING_STATUS_FORBIDDEN_SELF_REJECT)';
  end;
end $$;

-- ── SCENARIO 11: significant edit on active forces pending_review and
--    charges the rate limit; a non-significant edit does neither ───────
-- Uses a fresh synthetic owner, not owner_uid — this needs 2 real charges
-- (setup submit + the significant-edit charge) and owner_uid's shared
-- 5/10min budget is already partly spent by scenarios 5b/7/8/9 above,
-- with `now()` frozen for the whole transaction (no natural aging-out).
do $$
declare
  v_owner uuid := pg_temp.new_synthetic_user();
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
  v_row record;
  v_before integer;
  v_after integer;
  v_published_at timestamptz;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 11 significant edit');
  update public.listings set status = 'pending_review' where id = v_id;
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_id;
  select published_at into v_published_at from public.listings where id = v_id;

  -- 8th round audit — price sent alongside status/is_active, matching
  -- exactly what the real client (dbUpdateListingForReview, src/lib/db.ts)
  -- sends: it always sets status:'pending_review' and the is_active
  -- bridge itself in the SAME request, never leaves the trigger to infer
  -- the downgrade from a bare field change alone (see Scenario 11a-legacy
  -- right below for what happens to the OLD shape now).
  perform pg_temp.set_actor(v_owner);
  v_before := pg_temp.count_publish_events(v_owner);
  update public.listings set price = 12345, status = 'pending_review', is_active = false where id = v_id;  -- price is a significant field
  v_after := pg_temp.count_publish_events(v_owner);
  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'pending_review' then
    raise exception 'FAIL scenario 11a: significant edit did not force pending_review, status=%', v_row.status;
  end if;
  if v_after <> v_before + 1 then
    raise exception 'FAIL scenario 11a: significant edit did not charge the rate limit — events % -> %', v_before, v_after;
  end if;
  if v_row.moderated_at is not null or v_row.moderated_by is not null or v_row.rejection_reason is not null then
    raise exception 'FAIL scenario 11a: moderated_at/by/rejection_reason not cleared on forced re-review: %', row_to_json(v_row);
  end if;
  if v_row.published_at is distinct from v_published_at then
    raise exception 'FAIL scenario 11a: published_at was touched by the forced re-review (should stay as history)';
  end if;
  raise notice 'ok: scenario 11a — significant edit on an active listing forces pending_review, charges the rate limit, clears moderation fields, preserves published_at as history';

  -- Admin re-approves so the listing is active again.
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_id;

  -- ── SCENARIO 11b: the OLD-client shape of 11a — price alone, no status
  --    or is_active — is now rejected outright, not silently corrected.
  --    8th round audit: replayed the exact request a pre-Migration-B
  --    client sends for a plain field edit; before this guard it was
  --    accepted with no error and silently downgraded the listing out of
  --    the public catalog — see Migration B's owner-branch comment.
  perform pg_temp.set_actor(v_owner);
  begin
    update public.listings set price = 54321 where id = v_id;  -- bare, no status/is_active — the legacy shape
    raise exception 'FAIL scenario 11b: bare significant-field edit (no status/is_active) was NOT rejected';
  exception when others then
    if sqlerrm <> 'LISTING_LEGACY_CLIENT_DETECTED' then
      raise exception 'FAIL scenario 11b: expected LISTING_LEGACY_CLIENT_DETECTED, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 11b — a bare significant-field edit with neither status nor is_active touched is rejected (LISTING_LEGACY_CLIENT_DETECTED)';
  end;
  -- Confirm the rejected attempt left the row genuinely untouched (not
  -- just "no exception propagated" — the update-error test above already
  -- proves atomicity, but assert it explicitly for this specific field).
  select price into v_row from public.listings where id = v_id;
  if v_row.price is distinct from 12345 then
    raise exception 'FAIL scenario 11b: price changed to % despite the rejected UPDATE', v_row.price;
  end if;

  perform pg_temp.set_actor(v_owner);
  v_before := pg_temp.count_publish_events(v_owner);
  update public.listings set views = coalesce(views, 0) + 1 where id = v_id;  -- not in the significant-fields list
  v_after := pg_temp.count_publish_events(v_owner);
  select status into v_row from public.listings where id = v_id;
  if v_row.status <> 'active' then
    raise exception 'FAIL scenario 11c: a non-significant field edit changed status to %', v_row.status;
  end if;
  if v_after <> v_before then
    raise exception 'FAIL scenario 11c: a non-significant field edit charged the rate limit — events % -> %', v_before, v_after;
  end if;
  raise notice 'ok: scenario 11c — editing a non-significant field (views) leaves status=active untouched and charges nothing';
end $$;

-- ── SCENARIO 12: archive / restore / pause timestamp behavior ───────────
-- Fresh synthetic owner — same shared-budget reasoning as scenario 11.
do $$
declare
  v_owner uuid := pg_temp.new_synthetic_user();
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
  v_row record;
  v_published_at timestamptz;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 12 archive restore pause');
  update public.listings set status = 'pending_review' where id = v_id;
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_id;
  perform pg_temp.set_actor(v_owner);
  select published_at into v_published_at from public.listings where id = v_id;

  update public.listings set status = 'archived' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.archived_at is null then
    raise exception 'FAIL scenario 12a: archive did not set archived_at';
  end if;
  if v_row.published_at is distinct from v_published_at then
    raise exception 'FAIL scenario 12a: archive touched published_at (should stay as history)';
  end if;
  raise notice 'ok: scenario 12a — active->archived (owner) sets archived_at, preserves published_at';

  perform pg_temp.backdate_published_at(v_id);
  perform pg_temp.set_actor(v_owner);
  update public.listings set status = 'active' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.archived_at is not null then
    raise exception 'FAIL scenario 12b: restore did not clear archived_at';
  end if;
  -- published_at was just backdated to now()-1day (bypassing the trigger);
  -- a real reassignment brings it back to the (frozen) transaction now(),
  -- which is exactly v_published_at — equality here proves reassignment,
  -- not mere preservation (v_published_at is unreachable any other way
  -- once backdated).
  if v_row.published_at is null or v_row.published_at <> v_published_at then
    raise exception 'FAIL scenario 12b: restore did not reassign published_at (still the backdated value, not a fresh now())';
  end if;
  raise notice 'ok: scenario 12b — archived->active (owner restore) reassigns a fresh published_at, clears archived_at';

  v_published_at := v_row.published_at;
  update public.listings set status = 'paused' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.published_at is distinct from v_published_at then
    raise exception 'FAIL scenario 12c: pause touched published_at';
  end if;
  raise notice 'ok: scenario 12c — active->paused preserves published_at unchanged';

  perform pg_temp.backdate_published_at(v_id);
  perform pg_temp.set_actor(v_owner);
  update public.listings set status = 'active' where id = v_id;
  select * into v_row from public.listings where id = v_id;
  if v_row.published_at is null or v_row.published_at <> v_published_at then
    raise exception 'FAIL scenario 12d: paused->active restore did not reassign published_at (still the backdated value, not a fresh now())';
  end if;
  raise notice 'ok: scenario 12d — paused->active (owner restore) reassigns a fresh published_at';

  -- Admin emergency archive preserves moderation history.
  declare
    v_mod_at timestamptz;
    v_mod_by uuid;
  begin
    select moderated_at, moderated_by into v_mod_at, v_mod_by from public.listings where id = v_id;
    perform pg_temp.set_actor(v_admin);
    update public.listings set status = 'archived' where id = v_id;
    select * into v_row from public.listings where id = v_id;
    if v_row.archived_at is null then
      raise exception 'FAIL scenario 12e: admin emergency archive did not set archived_at';
    end if;
    if v_row.moderated_at is distinct from v_mod_at or v_row.moderated_by is distinct from v_mod_by then
      raise exception 'FAIL scenario 12e: admin emergency archive altered moderation history';
    end if;
    raise notice 'ok: scenario 12e — admin emergency archive (active/paused->archived) preserves moderated_at/moderated_by';
  end;
end $$;

-- ── SCENARIO 13: delete restrictions ──────────────────────────────────────
-- Fresh synthetic owner — same shared-budget reasoning as scenario 11
-- (needs 2 real charges: one active listing plus one archived-from-active).
do $$
declare
  v_owner uuid := pg_temp.new_synthetic_user();
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_draft_id bigint;
  v_active_id bigint;
  v_archived_id bigint;
  v_deleted bigint;
begin
  perform pg_temp.set_actor(v_owner);
  v_draft_id := pg_temp.new_complete_draft(v_owner, 'Scenario 13 draft to delete');

  v_active_id := pg_temp.new_complete_draft(v_owner, 'Scenario 13 active, not deletable by owner');
  update public.listings set status = 'pending_review' where id = v_active_id;
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_active_id;
  perform pg_temp.set_actor(v_owner);

  v_archived_id := pg_temp.new_complete_draft(v_owner, 'Scenario 13 archived to delete');
  update public.listings set status = 'pending_review' where id = v_archived_id;
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_archived_id;
  perform pg_temp.set_actor(v_owner);
  update public.listings set status = 'archived' where id = v_archived_id;

  delete from public.listings where id = v_active_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 0 then
    raise exception 'FAIL scenario 13a: owner was able to delete an ACTIVE listing (% rows deleted)', v_deleted;
  end if;
  perform 1 from public.listings where id = v_active_id;
  if not found then
    raise exception 'FAIL scenario 13a: active listing disappeared despite 0 reported deletions';
  end if;
  raise notice 'ok: scenario 13a — owner cannot delete an active listing (RLS silently deletes 0 rows)';

  delete from public.listings where id = v_draft_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'FAIL scenario 13b: owner could not delete own draft (% rows)', v_deleted; end if;
  raise notice 'ok: scenario 13b — owner can delete own draft';

  delete from public.listings where id = v_archived_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'FAIL scenario 13c: owner could not delete own archived listing (% rows)', v_deleted; end if;
  raise notice 'ok: scenario 13c — owner can delete own archived listing';

  perform pg_temp.set_actor(v_admin);
  delete from public.listings where id = v_active_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then raise exception 'FAIL scenario 13d: admin could not delete an active listing (% rows)', v_deleted; end if;
  raise notice 'ok: scenario 13d — admin can delete a listing in any status';
end $$;

-- ── SCENARIO 14: public visibility ───────────────────────────────────────
-- Fresh synthetic owner for the same shared-budget reason as scenario 11;
-- v_other stays the real app.other_uid — that identity is what actually
-- matters for this scenario's cross-visibility check.
do $$
declare
  v_owner uuid := pg_temp.new_synthetic_user();
  v_other uuid := current_setting('app.other_uid')::uuid;
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_draft_id bigint;
  v_active_id bigint;
  v_count integer;
begin
  perform pg_temp.set_actor(v_owner);
  v_draft_id := pg_temp.new_complete_draft(v_owner, 'Scenario 14 draft not public');
  v_active_id := pg_temp.new_complete_draft(v_owner, 'Scenario 14 active is public');
  update public.listings set status = 'pending_review' where id = v_active_id;
  perform pg_temp.set_actor(v_admin);
  update public.listings set status = 'active' where id = v_active_id;

  perform pg_temp.set_actor(v_other);
  select count(*) into v_count from public.listings where id in (v_draft_id, v_active_id);
  if v_count <> 1 then
    raise exception 'FAIL scenario 14a: non-owner/non-admin sees % of the 2 rows, expected exactly 1 (the active one)', v_count;
  end if;
  perform 1 from public.listings where id = v_active_id;
  if not found then
    raise exception 'FAIL scenario 14a: non-owner/non-admin cannot see the active listing';
  end if;
  raise notice 'ok: scenario 14a — a non-owner/non-admin authenticated user sees only the active listing, not the draft';

  set local role anon;
  select count(*) into v_count from public.listings where id in (v_draft_id, v_active_id);
  if v_count <> 1 then
    raise exception 'FAIL scenario 14b: anon sees % of the 2 rows, expected exactly 1', v_count;
  end if;
  raise notice 'ok: scenario 14b — anon (no JWT at all) also sees only the active listing';

  perform pg_temp.set_actor(v_owner);
  select count(*) into v_count from public.listings where id in (v_draft_id, v_active_id);
  if v_count <> 2 then
    raise exception 'FAIL scenario 14c: owner sees % of own 2 rows, expected 2 (all own statuses)', v_count;
  end if;
  raise notice 'ok: scenario 14c — owner sees both own listings regardless of status';

  perform pg_temp.set_actor(v_admin);
  select count(*) into v_count from public.listings where id in (v_draft_id, v_active_id);
  if v_count <> 2 then
    raise exception 'FAIL scenario 14d: admin sees % of the 2 rows, expected 2', v_count;
  end if;
  raise notice 'ok: scenario 14d — admin sees both listings regardless of owner or status';
end $$;

-- ── SCENARIO 15: rate-limit burst exhaustion blocks a real submit ───────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_count_burst integer;
  v_id bigint;
  i integer;
  v_blocked boolean := false;
begin
  perform pg_temp.set_actor(v_owner);
  v_count_burst := pg_temp.count_publish_events(v_owner);

  -- Top up to exactly 5 charged events within the burst window for this
  -- owner (earlier scenarios already contributed some).
  for i in 1..(5 - v_count_burst) loop
    v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 15 filler ' || i);
    update public.listings set status = 'pending_review' where id = v_id;
  end loop;

  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 15 blocked submit');
  begin
    update public.listings set status = 'pending_review' where id = v_id;
  exception when others then
    if sqlerrm = 'LISTING_RATE_LIMIT_10_MIN' then
      v_blocked := true;
    else
      raise exception 'FAIL scenario 15: expected LISTING_RATE_LIMIT_10_MIN, got: %', sqlerrm;
    end if;
  end;
  if not v_blocked then
    raise exception 'FAIL scenario 15: a real submit was NOT blocked after the burst limit was exhausted';
  end if;
  raise notice 'ok: scenario 15 — burst limit exhausted (5/10min) blocks a further real submit';
end $$;

-- ── SCENARIO 16: owner_id / user_id are immutable, even for admin ───────
do $$
declare
  v_owner uuid := current_setting('app.owner_uid')::uuid;
  v_other uuid := current_setting('app.other_uid')::uuid;
  v_admin uuid := current_setting('app.admin_uid')::uuid;
  v_id bigint;
begin
  perform pg_temp.set_actor(v_owner);
  v_id := pg_temp.new_complete_draft(v_owner, 'Scenario 16 owner immutable');

  perform pg_temp.set_actor(v_admin);
  begin
    update public.listings set owner_id = v_other where id = v_id;
    raise exception 'FAIL scenario 16: admin was able to reassign owner_id';
  exception when others then
    if sqlerrm <> 'LISTING_OWNER_IMMUTABLE' then
      raise exception 'FAIL scenario 16: expected LISTING_OWNER_IMMUTABLE, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 16 — owner_id is immutable even for admin (LISTING_OWNER_IMMUTABLE)';
  end;
end $$;

rollback;

-- Nothing persists. Confirm with a fresh session:
--   select count(*) from public.listings;
--   select count(*) from public.listing_publish_events;
-- both must be unchanged from before this run.
