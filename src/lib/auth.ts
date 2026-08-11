/**
 * AUTH — Supabase Auth (supabase.auth.*)
 *
 * Live flow uses supabase.auth.signUp / signInWithPassword / signOut /
 * getSession / onAuthStateChange. The `accounts` table is still used as a
 * profile store (name/phone/role/avatar_url), looked up by email — that
 * works today without any schema change. This file never inserts into
 * `accounts` itself: once supabase/migrations/20260806_auth_rls_hardening.sql
 * (STAGE 1) is applied, its handle_new_auth_user() trigger becomes the one
 * and only place that creates a profile row, keyed by auth_id — see the
 * comment in registerAccount() for what that means before STAGE 1 lands.
 *
 * The old hash-based accounts login (LEGACY section at the bottom of this
 * file) is kept for reference/rollback only — nothing in the app's live
 * flow calls it anymore.
 */
import type { AuthChangeEvent, EmailOtpType, User as SupabaseAuthUser } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { dbFindAccount, isSupabaseReady } from './db'
import type { User } from '@/types'

// Supabase Auth returns one generic message for both "no such account" and
// "wrong password" (Invalid login credentials) — deliberately, to avoid
// leaking which emails are registered. That's a UX regression from the old
// precise messages but a real security improvement (no account enumeration).
function mapAuthError(message: string | undefined): string {
  const msg = message || ''
  if (/already registered|already exists|user already registered/i.test(msg)) {
    return 'Акаунт з таким email вже існує. Увійдіть.'
  }
  if (/invalid login credentials/i.test(msg)) return 'Невірний email або пароль.'
  if (/email not confirmed/i.test(msg)) return 'Підтвердіть email — перевірте пошту.'
  if (/password.*(least|character|weak)/i.test(msg)) return 'Пароль занадто короткий.'
  if (/rate limit|too many/i.test(msg)) return 'Забагато спроб. Спробуйте пізніше.'
  if (/token.*(expired|invalid)|expired.*token|otp_expired/i.test(msg)) {
    return 'Посилання недійсне або застаріло. Зареєструйтесь ще раз.'
  }
  return msg || 'Сталася помилка. Спробуйте ще раз.'
}

// Builds the app's User shape from a Supabase Auth user, enriched with
// profile fields (name/phone/role/avatar) from the legacy `accounts` table
// — matched by email, which works today with no schema change. `id` is
// always the Supabase Auth uid (not accounts.id), matching where the rest
// of the migration is headed (listings.owner_id, favorites.user_id_uuid, …).
//
// `role` comes from accounts.role alone — that's the single source of
// admin status app-wide now. There used to also be a hardcoded-email check
// here (and duplicated in ProfileScreen.tsx and storage.ts) that granted
// 'admin' client-side regardless of the DB value; removed as prep for
// STAGE 2, where public.is_admin() (the RLS helper) already only trusts
// accounts.role too — the client and the database now agree on one source
// instead of two that could silently disagree.
async function buildUser(
  authUser: Pick<SupabaseAuthUser, 'id' | 'email' | 'user_metadata'>,
  fallback?: { name?: string; phone?: string }
): Promise<User> {
  const email = (authUser.email || '').toLowerCase().trim()
  const acc = await dbFindAccount(email).catch(() => null)
  const meta = (authUser.user_metadata || {}) as { name?: string; phone?: string }
  return {
    id: authUser.id,
    name: acc?.name || fallback?.name || meta.name || (email ? email.split('@')[0] : 'User'),
    email,
    phone: acc?.phone || fallback?.phone || meta.phone || '',
    role: (acc?.role as User['role']) || 'landlord',
    image: acc?.avatar_url || undefined,
  }
}

export async function registerAccount(
  name: string, email: string, phone: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User; needsEmailConfirmation?: boolean }> {
  if (!isSupabaseReady()) {
    return { ok: false, error: 'База даних не налаштована. Перевірте налаштування Vercel.' }
  }

  const { data, error } = await supabase.auth.signUp({
    email: email.toLowerCase().trim(),
    password,
    options: {
      data: { name: name.trim(), phone: phone.trim() },
      // Becomes {{ .RedirectTo }} in the "Confirm signup" email template —
      // the confirmation link points at our own /auth/confirm page (which
      // requires an explicit button click before calling verifyOtp()),
      // not straight at Supabase's /verify. Using window.location.origin
      // means this resolves correctly whether signup happened on
      // localhost or the deployed Vercel domain — both are already in
      // the project's Redirect URLs allow-list.
      emailRedirectTo: `${window.location.origin}/auth/confirm`,
    },
  })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  if (!data.user) return { ok: false, error: 'Не вдалося створити акаунт.' }

  // The `accounts` profile row (name/phone/role/avatar_url) is created by a
  // single source: the handle_new_auth_user() DB trigger on auth.users, from
  // supabase/migrations/20260806_auth_rls_hardening.sql (STAGE 1) — not by
  // this client code. Deliberately NOT inserting into `accounts` here too:
  // doing both would race the trigger and either duplicate the row (if keyed
  // differently) or fight over who's authoritative for it. Until STAGE 1 is
  // applied, no `accounts` row exists yet for a freshly-registered user —
  // buildUser() below already falls back to auth user_metadata (name/phone)
  // and a default 'landlord' role in that case, so login/display still work;
  // only avatar_url and a DB-persisted role are unavailable until then.
  if (!data.session) {
    // "Confirm email" is enabled in Supabase Auth: the account exists but
    // there is no session yet, and won't be until the user clicks the
    // confirmation link. Do NOT report this as a successful login.
    return { ok: true, needsEmailConfirmation: true }
  }

  const user = await buildUser(data.user, { name, phone })
  return { ok: true, user }
}

export async function loginAccount(
  email: string, password: string
): Promise<{ ok: boolean; error?: string; user?: User; needsEmailConfirmation?: boolean }> {
  if (!isSupabaseReady()) {
    return { ok: false, error: 'База даних не налаштована.' }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  })
  if (error) {
    // Lets the UI offer a resend button right here on the sign-in form —
    // the natural place a *returning* unconfirmed user hits this, as
    // opposed to needsEmailConfirmation from registerAccount() (right
    // after signing up, in the same session).
    const needsEmailConfirmation = /email not confirmed/i.test(error.message || '')
    return { ok: false, error: mapAuthError(error.message), needsEmailConfirmation }
  }
  if (!data.user) return { ok: false, error: 'Не вдалося увійти.' }
  // Defensive: signInWithPassword normally errors (not a null session) when
  // the email isn't confirmed yet — see mapAuthError's "email not confirmed"
  // case. This is a fallback for any edge case that slips through without
  // an error, so the app never treats a sessionless response as logged in.
  if (!data.session) return { ok: false, error: 'Підтвердіть email, щоб увійти.' }

  const user = await buildUser(data.user)
  return { ok: true, user }
}

// Called from src/app/auth/confirm/page.tsx, only in response to the
// user's own click on that page's "Підтвердити email" button — never on
// page load. verifyOtp() is a POST that returns the session directly in
// its response body (not via a URL fragment), so this doesn't depend on
// detectSessionInUrl at all; supabase-js persists the returned session
// itself. token_hash/type come from the confirmation link's query string
// (?token_hash=...&type=signup), set by the "Confirm signup" email
// template pointing at {{ .RedirectTo }} instead of the raw Supabase
// /verify link — see supabase/migrations/20260806_auth_rls_hardening.sql's
// neighboring notes for why a plain GET must never consume the token.
export async function confirmEmailToken(
  tokenHash: string, type: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  if (!tokenHash || !type) return { ok: false, error: 'Невірне посилання підтвердження.' }

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as EmailOtpType,
  })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  return { ok: true }
}

// Resends the "Confirm signup" email for an account that already exists but
// hasn't confirmed yet (e.g. the original link expired — a fresh signUp()
// call for an existing email would just error). Same emailRedirectTo as
// registerAccount(), so the new link also lands on our own /auth/confirm
// page rather than Supabase's raw /verify.
export async function resendConfirmation(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.toLowerCase().trim(),
    options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
  })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  return { ok: true }
}

// Requires re-entering the current password: supabase.auth.updateUser()
// operates on the current session and doesn't itself re-verify the old
// password, so we confirm identity first via signInWithPassword.
export async function changePassword(
  currentPassword: string, newPassword: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  if (newPassword.length < 6) return { ok: false, error: 'Новий пароль має містити щонайменше 6 символів.' }

  const { data: userData } = await supabase.auth.getUser()
  const email = userData.user?.email
  if (!email) return { ok: false, error: 'Ви не авторизовані.' }

  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) return { ok: false, error: 'Поточний пароль невірний.' }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  return { ok: true }
}

// Supabase sends a confirmation link to the NEW address; the email only
// changes once that link is clicked — unlike the old changeEmail(), this
// no longer takes effect immediately. That's a real, deliberate behavior
// change (this app never had email confirmation before at all).
export async function changeEmail(
  newEmail: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseReady()) return { ok: false, error: 'База даних не налаштована.' }
  const email = newEmail.toLowerCase().trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Введіть коректний email.' }

  const { error } = await supabase.auth.updateUser({ email })
  if (error) return { ok: false, error: mapAuthError(error.message) }
  return { ok: true }
}

// ── SESSION (supabase.auth.getSession / onAuthStateChange) ────────────────

export async function getSessionUser(): Promise<User | null> {
  if (!isSupabaseReady()) return null
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.user) return null
  return buildUser(data.session.user)
}

// Fires on sign-in, sign-out, user updates, and token refresh — including
// from other tabs. The event is passed through so callers can decide what
// to react to; TOKEN_REFRESHED is filtered out here before it ever reaches
// buildUser(), since a silent token renewal never changes who the user is —
// re-querying `accounts` for it on every refresh would just be a wasted
// round trip repeated for as long as the tab stays open.
// Returns an unsubscribe function.
export function subscribeAuthChanges(cb: (user: User | null, event: AuthChangeEvent) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED') return
    if (!session?.user) { cb(null, event); return }
    buildUser(session.user).then(u => cb(u, event))
  })
  return () => data.subscription.unsubscribe()
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

// ============================================================================
// LEGACY — pre-Supabase-Auth flow. Not called anywhere in the live app
// anymore (see registerAccount/loginAccount/signOut above). Kept only so
// rollback doesn't require reconstructing this file from git history, and
// because src/components/ProfileScreen.tsx historically imported saveSession
// from src/lib/storage.ts (a *different*, also-legacy copy — see the note
// there). Do not wire these back into the app; they check password_hash
// against the old non-cryptographic hash() below, which the new flow never
// writes at all — registerAccount() no longer touches `accounts` directly
// (see its comment: that's now the handle_new_auth_user() trigger's job).
// ============================================================================

/** @deprecated LEGACY — not cryptographic, not used by the live auth flow. */
export function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return h.toString(36)
}

/** @deprecated LEGACY — superseded by getSessionUser()/supabase.auth session storage. */
const SESSION_KEY = 'pk_session_v3'

/** @deprecated LEGACY — Supabase Auth persists its own session; nothing should call this. */
export function saveSession(user: User) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
}

/** @deprecated LEGACY — use getSessionUser() instead. */
export function loadSession(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as User
  } catch { return null }
}

/** @deprecated LEGACY — use signOut() instead. Left as a no-op-safe cleanup helper only. */
export function clearSession() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem('pk_session_v2')
    localStorage.removeItem('pk_session')
  } catch {}
}
