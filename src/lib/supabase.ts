import { createClient } from '@supabase/supabase-js'

// persistSession/autoRefreshToken are required for supabase.auth.* (signUp,
// signInWithPassword, getSession, onAuthStateChange) to keep a real session
// across reloads — see src/lib/auth.ts. detectSessionInUrl must be true:
// email confirmation (signUp with Confirm Email on) redirects back to
// Site URL with the session tokens in the URL fragment
// (#access_token=...&refresh_token=...&type=signup) — without this, the
// client never picks them up, so the server issues a real session
// (visible in auth.sessions) but the app still shows as logged out.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
)
