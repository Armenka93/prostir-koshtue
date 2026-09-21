// Pure, framework/Supabase-independent validation for listing-image public
// URLs before they're ever handed to a Storage delete call. Extracted so it
// can be unit-tested directly (scripts/test-listing-image-path.ts) with no
// network, no env vars, no module-load side effects — db.ts's
// dbDeleteListingImage() is a thin wrapper that supplies the live
// bucket/origin and calls this.
//
// A rejection here means the delete is never attempted — this is a
// defense-in-depth check that matters even before Storage RLS
// (supabase/migrations/20260830090000_listing_images_storage_policy.sql, not yet
// applied) is in place, and remains meaningful afterward too, since a
// rejected call here never reaches Storage to test that policy at all.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(s: string): boolean {
  return UUID_RE.test(s)
}

/**
 * Validates that `publicUrl` unambiguously names a file this exact user
 * owns, in this exact bucket, on this exact Supabase project — and returns
 * the bucket-relative path to delete if so, or `null` if any check fails.
 *
 * Rejects (returns null):
 *   - `expectedOwnerId` is not a well-formed UUID
 *   - `publicUrl` is not a well-formed absolute URL
 *   - its origin isn't EXACTLY `supabaseOrigin` (the configured project URL)
 *   - its pathname doesn't START WITH exactly
 *     `/storage/v1/object/public/<bucket>/` (not just "contains" it
 *     somewhere — a crafted URL could otherwise embed that string later in
 *     an unrelated path and still match a loose substring search)
 *   - fewer than 2 remaining path segments (no room for "<owner>/<file>")
 *   - any segment, decoded INDIVIDUALLY (never the whole path decoded as
 *     one string — see below), is empty, ".", or ".."
 *   - decodeURIComponent throws on any segment (malformed percent-encoding)
 *   - a decoded segment itself CONTAINS a literal "/" — i.e. the raw
 *     segment held an encoded slash (%2F): decoding the whole path in one
 *     pass before splitting would let that smuggle in an extra path level
 *     that wasn't a real separator in the URL Storage will actually parse,
 *     so segments are split on the RAW (undecoded) path first, then each
 *     is decoded and checked on its own
 *   - the first decoded segment isn't EXACTLY `expectedOwnerId`
 */
export function parseOwnListingImagePath(
  publicUrl: string,
  expectedOwnerId: string,
  bucket: string,
  supabaseOrigin: string
): string | null {
  if (!isValidUuid(expectedOwnerId)) return null
  if (!bucket || !supabaseOrigin) return null

  let parsed: URL
  try {
    parsed = new URL(publicUrl)
  } catch {
    return null
  }
  let expectedOrigin: URL
  try {
    expectedOrigin = new URL(supabaseOrigin)
  } catch {
    return null
  }
  if (parsed.origin !== expectedOrigin.origin) return null

  const prefix = `/storage/v1/object/public/${bucket}/`
  if (!parsed.pathname.startsWith(prefix)) return null
  const rawPath = parsed.pathname.slice(prefix.length)
  if (!rawPath) return null

  const rawSegments = rawPath.split('/')
  if (rawSegments.length < 2) return null

  const decodedSegments: string[] = []
  for (const rawSeg of rawSegments) {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawSeg)
    } catch {
      return null
    }
    if (decoded === '' || decoded === '.' || decoded === '..') return null
    if (decoded.includes('/')) return null // encoded slash (%2F) — would smuggle an extra path segment
    decodedSegments.push(decoded)
  }

  if (decodedSegments[0] !== expectedOwnerId) return null
  return decodedSegments.join('/')
}
