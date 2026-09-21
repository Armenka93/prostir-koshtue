-- ============================================================================
-- MIGRATION A — RATE-LIMIT BYPASS + INCOMPLETE-PUBLIC-ROW FIX CHECK
-- (5th round pre-migration audit)
-- ============================================================================
-- REAL, EXECUTABLE SQL. NOT a migration — outside supabase/migrations/, run
-- ONLY manually, ONLY against a LOCAL Postgres instance (`supabase start`,
-- localhost only — see the environment plan in the audit report) that has
-- Migration A (20260830100000_listing_status_expand.sql, WITH this round's
-- fix) applied and Migration B (20260830110000_listing_status_enforce.sql)
-- NOT YET applied — the exact window the two regressions this file checks
-- only exist in. NEVER run against production or any project-linked
-- connection string — the target must be a bare localhost URL.
--
-- That local instance is NOT a full copy of production: it's this
-- project's own (public-schema) objects restored from a verified
-- schema-only dump, running on top of Supabase's generic local platform
-- baseline for auth/storage/etc. (`supabase start`'s bundled images, not
-- anything copied from this project). See the audit report for the exact
-- list of excluded schemas and which of them this file's scenarios
-- actually depend on (only auth.users + auth.uid(), both provided by that
-- generic baseline, not reconstructed by guessing).
--
-- HONESTY NOTE: as of this draft, this file has still NOT been executed
-- against any live Postgres instance — local Docker installation is
-- pending on the user's side. It remains a well-reasoned draft, not proof,
-- until it is actually run. A TypeScript model of this logic would not be
-- proof either (the bug this file exists to catch is a live-SQL/RLS-
-- interaction bug — a reference model reimplemented in TS could just as
-- easily reproduce the same mistake as the SQL it's supposed to check).
--
-- WHAT THIS PROVES (scenario 0 + 8 numbered scenarios, matching the audit's exact wording):
--   0. RLS harness sanity check — confirms this test session is genuinely
--      constrained by RLS as `authenticated` (not bypassing it via table
--      ownership/postgres role): a synthetic user cannot INSERT a listing
--      claiming a different owner_id.
--   1. Legacy INSERT (no status, explicit is_active=true) — still charges
--      the rate limit, exactly as before Migration A existed.
--   2. Incomplete draft (is_active=false) — allowed with missing fields,
--      and does NOT charge the rate limit (not public, not a publish).
--   3. status='draft' + is_active=true (the exact crafted bypass this
--      audit round found) — with COMPLETE fields: now correctly CHARGED
--      (closes the bypass). With INCOMPLETE fields: rejected outright by
--      listings_required_when_public (closes the second regression).
--   4. UPDATE of an incomplete draft into is_active=true without filling
--      the required fields — rejected by the same CHECK (proves the fix
--      covers UPDATE, not just INSERT).
--   5. Burst limit (5/10min) exhausted, then a 6th publicly-visible
--      attempt under a DIFFERENT status value — still blocked. status
--      cannot be used to dodge an already-exhausted limit.
--   6. 6th round fix — COMPLETE draft (is_active=false, no charge) then
--      UPDATE ... SET is_active=true — the UPDATE-only bypass this round
--      found: charged exactly once, on the UPDATE (trigger now fires on
--      UPDATE too). Unlike scenario 4, this one passes the CHECK (fields
--      are complete) — it actually exercises the rate-limit path, not
--      just the constraint.
--   7. Same complete-draft-to-public UPDATE, but with the burst limit
--      already exhausted (reusing scenario 5's exhaustion) — rejected.
--   8. Editing an already-public row's unrelated field (is_active stays
--      true) — never consults the rate limit at all, charges nothing,
--      succeeds even while the limit is exhausted.
--
-- psql does not interpolate :'var' inside dollar-quoted ($$...$$) blocks
-- (by design — otherwise plpgsql's := and array[a:b] would be mistaken for
-- substitutions), and every scenario below runs inside one. Bridge the
-- three -v values into session GUCs here, outside any $$ block, so the DO
-- blocks can read them back via current_setting('app.*'). Unquoted :name
-- (not :'name') — the -v values above are already single-quoted SQL
-- literals; :'name' would quote them a second time.
select set_config('app.owner_uid', :owner_uid, false);
select set_config('app.other_uid', :other_uid, false);
select set_config('app.confirm', :confirm, false);

-- Guard against accidental execution.
do $$
begin
  if current_setting('app.confirm', true) is distinct from 'RUN_RATE_LIMIT_FIX_CHECK' then
    raise exception 'Refusing to run: pass -v confirm="''RUN_RATE_LIMIT_FIX_CHECK''" explicitly. Disposable staging only, Migration A (with this round''s fix) applied, Migration B NOT applied, never production.';
  end if;
end $$;

-- Supply two synthetic uids (owner_uid — the acting user; other_uid — any
-- distinct uuid, does not need a real auth.users/accounts row, used only
-- as a mismatched owner_id target in scenario 0's negative RLS check) and
-- a localhost-only connection string. `-v ON_ERROR_STOP=1` is required —
-- without it psql continues past a failed statement instead of aborting,
-- which would hide a real failure. Invoke with:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -v ON_ERROR_STOP=1 \
--     -v owner_uid="'11111111-1111-1111-1111-111111111111'" \
--     -v other_uid="'22222222-2222-2222-2222-222222222222'" \
--     -v confirm="'RUN_RATE_LIMIT_FIX_CHECK'" \
--     -f 20260830_migration_a_rate_limit_and_required_fields_check.sql
-- (127.0.0.1:54322 is `supabase start`'s default local port — confirm the
-- actual port via `supabase status` once it's running, don't assume it.)

begin;

-- Confirms every tested operation genuinely runs as `authenticated` with
-- the expected auth.uid() — kept in pg_temp (session-local, gone once this
-- connection ends, never touches the real schema). Needed because
-- listing_publish_events has RLS enabled with zero policies (see below):
-- counting its rows requires a temporary role bump to postgres, and this
-- catches it if that bump is ever left engaged by mistake.
create function pg_temp.assert_test_identity() returns void
language plpgsql as $fn$
begin
  if current_user <> 'authenticated' then
    raise exception 'TEST HARNESS: expected current_user=authenticated, got %', current_user;
  end if;
  if auth.uid() is distinct from current_setting('app.owner_uid')::uuid then
    raise exception 'TEST HARNESS: expected auth.uid()=%, got %', current_setting('app.owner_uid'), auth.uid();
  end if;
end;
$fn$;

-- ── SCENARIO 0: RLS harness sanity check ─────────────────────────────────
-- Runs OUTSIDE the other DO blocks, first, deliberately: if this fails,
-- every other scenario's result is suspect (it would mean this session
-- isn't actually constrained by RLS as `authenticated`).
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.owner_uid'), 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity();
  begin
    insert into public.listings (user_id, owner_id, title, is_active)
      values (current_setting('app.owner_uid'), current_setting('app.other_uid')::uuid, 'Scenario 0 RLS cross-owner attempt', false);
    raise exception 'FAIL scenario 0: RLS did NOT block an INSERT claiming a different owner_id — this test session may be bypassing RLS entirely (e.g. running as table owner/postgres instead of authenticated); no other scenario in this file can be trusted until this is fixed';
  exception when insufficient_privilege then
    raise notice 'ok: scenario 0 — RLS (owner can insert own listings, with check owner_id=auth.uid()) rejects a cross-owner INSERT; this session is genuinely constrained by RLS as authenticated';
  end;
end $$;

do $$
declare
  v_id bigint;
  v_row record;
  v_events_before integer;
  v_events_after integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.owner_uid'), 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity();

  -- ── SCENARIO 1: legacy INSERT — no status, explicit is_active=true ────
  set local role postgres;  -- listing_publish_events: RLS on, zero policies — reading its own count needs elevation, not a grant
  select count(*) into v_events_before from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  insert into public.listings (
    user_id, owner_id, title, type, price, area, district, address, is_active
  ) values (
    current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'Scenario 1 legacy insert', 'Офіс', 10000, 30, 'Центр', 'Test address 1', true
  ) returning id into v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();
  if v_events_after <> v_events_before + 1 then
    raise exception 'FAIL scenario 1: legacy INSERT (is_active=true, no status) did not charge the rate limit — events % -> %', v_events_before, v_events_after;
  end if;
  select * into v_row from public.listings where id = v_id;
  if v_row.status <> 'active' then
    raise exception 'FAIL scenario 1: status = %, expected the transitional DEFAULT ''active''', v_row.status;
  end if;
  raise notice 'ok: scenario 1 — legacy INSERT (is_active=true, no status) charges the rate limit exactly as before Migration A';

  -- ── SCENARIO 2: incomplete draft, is_active=false — allowed, not charged ──
  set local role postgres;
  select count(*) into v_events_before from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  insert into public.listings (
    user_id, owner_id, status, title, is_active
  ) values (
    current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 2 incomplete draft', false
    -- type/price/area/district/address all omitted — must be allowed for a non-public draft
  ) returning id into v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();
  if v_events_after <> v_events_before then
    raise exception 'FAIL scenario 2: incomplete non-public draft (is_active=false) charged the rate limit — events % -> %', v_events_before, v_events_after;
  end if;
  raise notice 'ok: scenario 2 — incomplete draft (is_active=false) is allowed with missing fields and is NOT charged';

  -- ── SCENARIO 3a: THE CRAFTED BYPASS — status=''draft'' + is_active=true,
  --    COMPLETE fields — must now be CHARGED (this is the fix) ──────────
  set local role postgres;
  select count(*) into v_events_before from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  insert into public.listings (
    user_id, owner_id, status, title, type, price, area, district, address, is_active
  ) values (
    current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 3a crafted bypass attempt', 'Офіс', 10000, 30, 'Центр', 'Test address 3a', true
  ) returning id into v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();
  if v_events_after <> v_events_before + 1 then
    raise exception 'FAIL scenario 3a: status=''draft''+is_active=true (complete fields) did NOT charge the rate limit — the exact bypass this audit found is still open! events % -> %', v_events_before, v_events_after;
  end if;
  raise notice 'ok: scenario 3a — status=''draft''+is_active=true with complete fields is now correctly CHARGED — bypass closed';

  -- ── SCENARIO 3b: same crafted shape, but INCOMPLETE fields — must be
  --    REJECTED by listings_required_when_public ─────────────────────────
  begin
    insert into public.listings (
      user_id, owner_id, status, title, is_active
    ) values (
      current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 3b incomplete public', true
      -- type/price/area/district/address omitted, but is_active=true — must be rejected
    );
    raise exception 'FAIL scenario 3b: an incomplete PUBLIC (is_active=true) row was NOT rejected — listings_required_when_public is not working';
  exception when check_violation then
    if position('listings_required_when_public' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 3b: expected listings_required_when_public violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 3b — incomplete public (is_active=true) row rejected by listings_required_when_public';
  end;

  -- ── SCENARIO 4: UPDATE of an incomplete draft into is_active=true
  --    without filling required fields — must be rejected ────────────────
  insert into public.listings (user_id, owner_id, status, title, is_active)
    values (current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 4 draft to be flipped', false)
    returning id into v_id;

  begin
    update public.listings set is_active = true where id = v_id;
    raise exception 'FAIL scenario 4: UPDATE flipping an incomplete draft to is_active=true was NOT rejected';
  exception when check_violation then
    if position('listings_required_when_public' in sqlerrm) = 0 then
      raise exception 'FAIL scenario 4: expected listings_required_when_public violation, got: %', sqlerrm;
    end if;
    raise notice 'ok: scenario 4 — UPDATE flipping an incomplete draft to is_active=true is rejected (fix covers UPDATE, not just INSERT)';
  end;

  -- ── SCENARIO 6: COMPLETE draft, is_active=false (no charge), then
  --    UPDATE ... SET is_active=true — must be charged exactly once, on
  --    the UPDATE (the specific bypass this round found and fixed) ──────
  set local role postgres;
  select count(*) into v_events_before from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  insert into public.listings (user_id, owner_id, status, title, type, price, area, district, address, is_active)
    values (current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 6 complete draft', 'Офіс', 10000, 30, 'Центр', 'Test address 6', false)
    returning id into v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();
  if v_events_after <> v_events_before then
    raise exception 'FAIL scenario 6: complete draft INSERT (is_active=false) charged the rate limit before any UPDATE — events % -> %', v_events_before, v_events_after;
  end if;

  update public.listings set is_active = true where id = v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();
  if v_events_after <> v_events_before + 1 then
    raise exception 'FAIL scenario 6: UPDATE of a complete draft into is_active=true did NOT charge the rate limit — the UPDATE-only bypass is still open! events % -> %', v_events_before, v_events_after;
  end if;
  raise notice 'ok: scenario 6 — UPDATE of a complete non-public draft into is_active=true is charged exactly once (UPDATE-only bypass closed)';
end $$;

-- ── SCENARIO 5: exhaust the burst limit, then try to dodge it via a
--    different status value — separate DO block so scenario 1/3a's two
--    charges above count toward this same user's burst total too (this
--    session's advisory lock + count logic is per-user, not per-block).
do $$
declare
  v_id bigint;
  v_count_burst integer;
  i integer;
  v_dodge_failed boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.owner_uid'), 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity();

  set local role postgres;
  select count(*) into v_count_burst
  from public.listing_publish_events
  where user_id = current_setting('app.owner_uid')::uuid and created_at >= now() - interval '10 minutes';
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  -- Top up to exactly 5 charged events for this user within the burst
  -- window (scenarios 1 and 3a above already contributed 2).
  for i in 1..(5 - v_count_burst) loop
    insert into public.listings (user_id, owner_id, title, type, price, area, district, address, is_active)
      values (current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'Scenario 5 filler ' || i, 'Офіс', 10000, 30, 'Центр', 'Test address 5-' || i, true);
  end loop;

  -- The 6th publicly-visible attempt, deliberately under a DIFFERENT
  -- status value (not 'active') — must still be blocked by the burst limit.
  begin
    insert into public.listings (user_id, owner_id, status, title, type, price, area, district, address, is_active)
      values (current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'paused', 'Scenario 5 dodge attempt', 'Офіс', 10000, 30, 'Центр', 'Test address 5-dodge', true);
  exception when others then
    if sqlerrm = 'LISTING_RATE_LIMIT_10_MIN' then
      v_dodge_failed := true;
    else
      raise exception 'FAIL scenario 5: expected LISTING_RATE_LIMIT_10_MIN, got: %', sqlerrm;
    end if;
  end;

  if not v_dodge_failed then
    raise exception 'FAIL scenario 5: a 6th publicly-visible INSERT under status=''paused'' was NOT blocked after the burst limit was exhausted — status can still be used to dodge the limit';
  end if;
  raise notice 'ok: scenario 5 — burst limit exhausted, a different status value does not dodge it (LISTING_RATE_LIMIT_10_MIN still raised)';
end $$;

-- ── SCENARIO 7: same complete-draft-to-public UPDATE as scenario 6, but
--    with the burst limit already exhausted (reusing scenario 5's state)
--    — must be rejected, not silently let through. ─────────────────────
do $$
declare
  v_id bigint;
  v_rejected boolean := false;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.owner_uid'), 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity();

  insert into public.listings (user_id, owner_id, status, title, type, price, area, district, address, is_active)
    values (current_setting('app.owner_uid'), current_setting('app.owner_uid')::uuid, 'draft', 'Scenario 7 complete draft exhausted', 'Офіс', 10000, 30, 'Центр', 'Test address 7', false)
    returning id into v_id;

  begin
    update public.listings set is_active = true where id = v_id;
  exception when others then
    if sqlerrm = 'LISTING_RATE_LIMIT_10_MIN' then
      v_rejected := true;
    else
      raise exception 'FAIL scenario 7: expected LISTING_RATE_LIMIT_10_MIN, got: %', sqlerrm;
    end if;
  end;

  if not v_rejected then
    raise exception 'FAIL scenario 7: UPDATE of a complete draft into is_active=true was NOT rejected despite an exhausted burst limit';
  end if;
  raise notice 'ok: scenario 7 — UPDATE into is_active=true is rejected when the burst limit is already exhausted';
end $$;

-- ── SCENARIO 8: editing an already-public row's unrelated field never
--    consults the rate limit — succeeds even while the limit above is
--    still exhausted, charges nothing. ──────────────────────────────────
do $$
declare
  v_id bigint;
  v_events_before integer;
  v_events_after integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('app.owner_uid'), 'role', 'authenticated')::text, true);
  perform pg_temp.assert_test_identity();

  -- listings.user_id is `text` (confirmed against the restored schema),
  -- unlike listing_publish_events.user_id below, which is uuid — no cast here.
  select id into v_id from public.listings where title = 'Scenario 1 legacy insert' and user_id = current_setting('app.owner_uid');

  set local role postgres;
  select count(*) into v_events_before from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  update public.listings set price = 12000 where id = v_id;

  set local role postgres;
  select count(*) into v_events_after from public.listing_publish_events where user_id = current_setting('app.owner_uid')::uuid;
  set local role authenticated;
  perform pg_temp.assert_test_identity();

  if v_events_after <> v_events_before then
    raise exception 'FAIL scenario 8: editing an already-public row (is_active stays true) charged the rate limit — events % -> %', v_events_before, v_events_after;
  end if;
  raise notice 'ok: scenario 8 — editing an already-public row does not consult the rate limit, succeeds even while it is exhausted';
end $$;

rollback;

-- Nothing persists. Confirm with a fresh session:
--   select count(*) from public.listings where title like 'Scenario %';
--   select count(*) from public.listing_publish_events where user_id = '<owner_uid>';
-- both must be unchanged from before this run.
