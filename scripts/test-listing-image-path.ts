// Unit tests for src/lib/listingImagePath.ts — pure, no Supabase, no
// network, no env vars. Run via `npm run test:image-path`
// (scripts/run-image-path-test.js compiles + runs this and cleans up).

import { parseOwnListingImagePath, isValidUuid } from '../src/lib/listingImagePath'

let failed = false
function assert(cond: boolean, msg: string) {
  if (!cond) { failed = true; console.error('FAIL:', msg) }
  else console.log('ok:', msg)
}

const ORIGIN = 'https://abcdefghij.supabase.co'
const BUCKET = 'listing-images'
const OWNER = '11111111-2222-3333-4444-555555555555'
const OTHER_OWNER = '99999999-8888-7777-6666-555555555555'

function ownUrl(path: string): string {
  return `${ORIGIN}/storage/v1/object/public/${BUCKET}/${path}`
}

function main() {
  // ── Valid ────────────────────────────────────────────────────
  assert(
    parseOwnListingImagePath(ownUrl(`${OWNER}/1700000000-ab12cd.jpg`), OWNER, BUCKET, ORIGIN) === `${OWNER}/1700000000-ab12cd.jpg`,
    'own URL, correct bucket/owner/origin — accepted, path returned verbatim'
  )
  assert(
    parseOwnListingImagePath(ownUrl(`${OWNER}/sub/name.jpg`), OWNER, BUCKET, ORIGIN) === `${OWNER}/sub/name.jpg`,
    'a legitimate extra path segment beyond owner/filename is accepted'
  )

  // ── Wrong owner ──────────────────────────────────────────────
  assert(
    parseOwnListingImagePath(ownUrl(`${OTHER_OWNER}/file.jpg`), OWNER, BUCKET, ORIGIN) === null,
    "another user's own-looking URL is rejected (first segment != expectedOwnerId)"
  )

  // ── Wrong bucket ─────────────────────────────────────────────
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/avatars/${OWNER}/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    'a URL naming a different bucket (avatars) is rejected'
  )

  // ── Wrong origin ─────────────────────────────────────────────
  assert(
    parseOwnListingImagePath(`https://evil-mirror.example.com/storage/v1/object/public/${BUCKET}/${OWNER}/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    'a URL on a different origin (not the configured Supabase project) is rejected'
  )
  assert(
    parseOwnListingImagePath(`https://other-project.supabase.co/storage/v1/object/public/${BUCKET}/${OWNER}/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    'a URL on a DIFFERENT Supabase project origin is rejected'
  )

  // ── Malformed URL / prefix ───────────────────────────────────
  assert(parseOwnListingImagePath('not a url', OWNER, BUCKET, ORIGIN) === null, 'not-a-URL string is rejected')
  assert(
    parseOwnListingImagePath(`${ORIGIN}/some/other/path/${BUCKET}/${OWNER}/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    '"/object/public/" appearing later in an unrelated path (not as the real prefix) is rejected — exact prefix match, not substring search'
  )
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}`, OWNER, BUCKET, ORIGIN) === null,
    'owner segment with no filename segment (only 1 segment) is rejected'
  )

  // ── Encoded slash (%2F) — path-segment smuggling ────────────────
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}%2F..%2Fother-user/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    '%2F inside a raw segment (would smuggle extra path levels once decoded) is rejected'
  )
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}/evil%2Ffile.jpg`, OWNER, BUCKET, ORIGIN) === null,
    '%2F inside the filename segment is rejected'
  )

  // ── Encoded traversal (%2e%2e) ───────────────────────────────
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/%2e%2e/file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    '%2e%2e (encoded "..") as the owner segment is rejected'
  )
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}/%2e%2e`, OWNER, BUCKET, ORIGIN) === null,
    '%2e%2e (encoded "..") as the filename segment is rejected'
  )

  // ── Empty segments ───────────────────────────────────────────
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}//file.jpg`, OWNER, BUCKET, ORIGIN) === null,
    'an empty owner segment (double slash) is rejected'
  )
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}/`, OWNER, BUCKET, ORIGIN) === null,
    'a trailing empty filename segment is rejected'
  )

  // ── Malformed percent-encoding ───────────────────────────────
  assert(
    parseOwnListingImagePath(`${ORIGIN}/storage/v1/object/public/${BUCKET}/${OWNER}/%E0%A4%A`, OWNER, BUCKET, ORIGIN) === null,
    'malformed percent-encoding (decodeURIComponent throws) is rejected'
  )

  // ── ownerId must itself be a valid UUID ──────────────────────
  assert(isValidUuid(OWNER), 'a well-formed UUID passes isValidUuid')
  assert(!isValidUuid('not-a-uuid'), 'a non-UUID string fails isValidUuid')
  assert(
    parseOwnListingImagePath(ownUrl(`not-a-uuid/file.jpg`), 'not-a-uuid', BUCKET, ORIGIN) === null,
    'a non-UUID expectedOwnerId is rejected outright, regardless of URL shape'
  )

  console.log('')
  if (failed) {
    console.error('LISTING IMAGE PATH TEST: FAILED')
    process.exit(1)
  } else {
    console.log('LISTING IMAGE PATH TEST: PASSED')
  }
}

main()
