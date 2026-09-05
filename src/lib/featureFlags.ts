// Single switch flipped only once Migration B (supabase/migrations/
// 20260830110000_listing_status_enforce.sql) has actually been applied to the
// live DB. Before that point old RLS still allows an admin UPDATE on
// `listings`, but the lifecycle trigger doesn't exist yet — so
// approve/reject (or submit) through the new code could mutate
// status/is_active without the server stamping moderated_at/moderated_by/
// pending_review_at/published_at/archived_at and without strict transition
// enforcement (see that migration's rollout comment).
//
// A UI label alone was explicitly rejected as insufficient (a moderator
// could still click through). This flag is what actually blocks the
// network call: dbSubmitListingForReview / dbUpdateListingForReview /
// dbApproveListing / dbRejectListing in src/lib/db.ts all check it FIRST
// and throw ListingLifecycleError('MIGRATION_B_NOT_LIVE') with no request
// sent when it's false. ModerationScreen and AddListingWizard read the same
// exported constant to show a maintenance notice instead of their real UI —
// that's supplementary (better UX), not the actual guard; there is
// deliberately only ONE flag, not a separate one per screen, so they can
// never drift out of sync with each other or with the data layer.
//
// E.2.4 2nd round audit, п.2 — NOT a hardcoded `= false` that would need a
// new source edit and commit just to turn on: an env var, so enabling
// production after Migration B is a deployment/env-config change.
//
//   NEXT_PUBLIC_LISTING_LIFECYCLE_ENABLED === 'true'   → enabled
//   anything else (unset, '', 'false', '1', 'TRUE', typos, ...) → disabled
//
// Deliberately an exact, case-sensitive match against 'true' and nothing
// else — an unset var, a typo, or any other truthy-looking string ('1',
// 'yes', 'True') all fail closed to `false`. Secure-by-default shape: the
// safe state (disabled) is what you get by doing nothing, and only one
// exact spelling turns it on.
//
// NEXT_PUBLIC_ prefix (required by Next.js to expose a var to the browser
// bundle, not a choice made here) means this value is visible to anyone
// who opens devtools — by design, it is NOT a secret. It carries no
// credential, key, or anything service-role-shaped: it's a plain boolean
// gate on client-side behavior, mirroring a server-side fact (whether
// Migration B has been applied) the client has no way to detect on its
// own. Never put a real secret in a NEXT_PUBLIC_ var.
//
// ── Rollout sequence (two deployments) ───────────────────────────────────
// 1. Deploy this code with the env var UNSET (or explicitly 'false') as a
//    maintenance/private/preview deployment, NOT public production — this
//    code already references columns Migration A adds (pending_review_at
//    etc.), so it must not be what real production traffic hits yet.
// 2. Apply Migration A (20260830100000_listing_status_expand.sql) to the live
//    DB — purely additive, safe for the OLD client still serving public
//    production at this exact moment. Once confirmed applied, promote
//    step 1's build to public production (still flag=false) — this
//    ordering, not the flag, is what protects users here: the flag only
//    gates approve/reject/submit, it does nothing for an unrelated screen
//    reading a column that doesn't exist yet.
// 3. Controlled technical check on production — confirm the new
//    columns/index exist and are read/written without error, confirm
//    MIGRATION_B_NOT_LIVE is actually refusing submit/moderation as
//    expected (flag is still false).
// 4. Apply Migration B (20260830110000_listing_status_enforce.sql) — installs
//    the trigger, tightens RLS — then apply the Storage policy migration.
// 5. New deployment / env activation: set
//    NEXT_PUBLIC_LISTING_LIFECYCLE_ENABLED=true and redeploy. Next.js
//    inlines NEXT_PUBLIC_ vars at BUILD time — flipping the platform's env
//    var without triggering a new build does NOT take effect.
// 6. End-to-end check in production: submit a real draft through the
//    wizard, approve/reject it as admin, confirm the six lifecycle fields
//    behave exactly as documented in that migration's "Гарантии" comment
//    and in scripts/test-lifecycle-timestamps.ts.
//
// Never do step 5 ahead of step 4 actually being applied and confirmed.
export const MIGRATION_B_LIVE = process.env.NEXT_PUBLIC_LISTING_LIFECYCLE_ENABLED === 'true'
