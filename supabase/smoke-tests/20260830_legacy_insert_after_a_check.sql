-- ============================================================================
-- LEGACY-INSERT-AFTER-A COMPATIBILITY CHECK (3rd round pre-migration audit,
-- blocker 2)
-- ============================================================================
-- REAL, EXECUTABLE SQL. NOT a migration — outside supabase/migrations/, run
-- ONLY manually, ONLY against a disposable staging project that has
-- Migration A (20260830100000_listing_status_expand.sql) applied and Migration B
-- (20260830110000_listing_status_enforce.sql) NOT YET applied — this is the exact
-- "old client, A applied, code not deployed yet, B not applied yet" window
-- the rollout order relies on being safe. NEVER run against production.
--
-- This is the ONE checkpoint in the whole rollout where this specific test
-- is even meaningful: once B is applied, enforce_listing_lifecycle() forces
-- every INSERT to status='draft' regardless of what's sent (see that
-- file's INSERT branch) — running this AFTER B would correctly show
-- status='draft', which would look like a "failure" of this test even
-- though it's exactly the new, intended behavior. Do not run this after B.
--
-- WHAT THIS PROVES (see the full written proof in the audit report for the
-- exact line numbers this corresponds to):
--   Migration A, section 1:
--     alter table public.listings add column if not exists status text;
--     update public.listings set status = case when coalesce(is_active, true)
--       then 'active' else 'archived' end where status is null;
--     alter table public.listings alter column status set not null;
--     alter table public.listings alter column status set default 'active';
--       -- TRANSITIONAL default — matches old client behavior, NOT 'draft'.
--   Migration B, section 1 (only once B is applied):
--     alter table public.listings alter column status set default 'draft';
--       -- FINAL default — safe only because B's trigger ALSO now forces
--       -- every INSERT to 'draft' regardless of client input, so the
--       -- DEFAULT changing is not what protects anything by then; the
--       -- trigger is.
--   The OLD (pre-this-diff, currently in production) client's insert path
--   — src/lib/db.ts's listingToRow(), confirmed by reading git HEAD's copy
--   directly — sends `is_active: true` explicitly and has NO knowledge of
--   `status` at all (that column doesn't exist in its type). So an old-client
--   INSERT right after A (before the new code is deployed) omits `status`
--   entirely, and Postgres fills it from the transitional DEFAULT ('active'
--   at this point) — NOT NULL, so the row can't land with a NULL status
--   either.
--
-- Guard against accidental execution.
do $$
begin
  if :'confirm' is distinct from 'RUN_LEGACY_INSERT_CHECK' then
    raise exception 'Refusing to run: pass -v confirm="''RUN_LEGACY_INSERT_CHECK''" explicitly. Disposable staging only, Migration A applied, Migration B NOT applied, never production.';
  end if;
end $$;

-- Supply one REAL, already-existing auth uid from the target staging
-- project (any ordinary account is fine — this only tests the schema
-- default, not admin/owner branching, since B's trigger doesn't exist yet
-- in this window). Invoke with:
--   psql "$STAGING_DB_URL" \
--     -v owner_uid="'11111111-1111-1111-1111-111111111111'" \
--     -v confirm="'RUN_LEGACY_INSERT_CHECK'" \
--     -f 20260830_legacy_insert_after_a_check.sql

begin;

do $$
declare
  v_id bigint;
  v_row record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', :'owner_uid', 'role', 'authenticated')::text, true);

  -- Exact shape of the OLD client's INSERT (src/lib/db.ts listingToRow(),
  -- as it exists at git HEAD today) — no `status` column at all, is_active
  -- explicit true. This is what a still-not-yet-updated production client
  -- sends in the window between "Migration A applied" and "new code
  -- deployed".
  insert into public.listings (
    user_id, owner_id, title, type, price, area, district, address,
    city, condition, parking, separate_entrance, description, images, features,
    is_active
  ) values (
    :'owner_uid', :'owner_uid', 'Legacy client smoke test', 'Офіс', 15000, 40,
    'Приморський', 'Test address', 'Одеса', 'Євроремонт', false, false,
    null, array['/no-photo.png'], array[]::text[],
    true
  ) returning id into v_id;

  select * into v_row from public.listings where id = v_id;

  -- 1. status must have been filled by the transitional DEFAULT, not NULL,
  --    not 'draft' (that would hide the listing from anyone until an admin
  --    who doesn't exist yet in this workflow approves it — a real
  --    regression the audit explicitly checked for).
  if v_row.status is null then
    raise exception 'FAIL: status is NULL after a legacy INSERT — NOT NULL constraint should have prevented this or DEFAULT is missing';
  end if;
  if v_row.status <> 'active' then
    raise exception 'FAIL: status = % after a legacy INSERT, expected ''active'' (the transitional DEFAULT) — if this is ''draft'', Migration A''s DEFAULT was changed to the FINAL value too early, which is the exact rollout blocker this check exists to catch', v_row.status;
  end if;
  raise notice 'ok: legacy INSERT (no status field) received status=''active'' from the transitional DEFAULT';

  -- 2. is_active must be exactly what the old client sent — untouched,
  --    since Migration A does not add a trigger that could overwrite it.
  if v_row.is_active is distinct from true then
    raise exception 'FAIL: is_active = % after a legacy INSERT, expected true (what the old client explicitly sent)', v_row.is_active;
  end if;
  raise notice 'ok: is_active = true, exactly what the old client sent — untouched by Migration A (no trigger installed yet)';

  -- 3. status and is_active must NOT contradict each other — both say
  --    "this is a normal, live listing", consistent with the pre-A world.
  if (v_row.status = 'active') <> (v_row.is_active = true) then
    raise exception 'FAIL: status (%) and is_active (%) disagree on whether this listing is live', v_row.status, v_row.is_active;
  end if;
  raise notice 'ok: status=''active'' and is_active=true agree — no contradiction between the old and new lifecycle signals';

  -- 4. The still-live OLD public RLS policy ("anyone can read active
  --    listings", using (is_active = true)) is untouched by Migration A —
  --    this check cannot re-verify RLS itself here (it's running as
  --    `authenticated`/owner, which can already see its own row via the
  --    owner policy regardless), but confirms the DATA condition that
  --    policy depends on (is_active = true) is genuinely satisfied, so an
  --    anonymous/public read of this exact row would also succeed.
  raise notice 'ok: is_active=true is the condition the pre-A "anyone can read active listings" RLS policy checks — unaffected by this migration, so public visibility is preserved for this row';
end $$;

rollback;

-- Nothing persists. Confirm with a fresh session:
--   select count(*) from public.listings where title = 'Legacy client smoke test';
-- must return 0.
