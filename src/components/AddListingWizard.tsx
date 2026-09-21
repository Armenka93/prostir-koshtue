'use client'
import { useState, useRef, useEffect } from 'react'
import type { ListingData, User } from '@/types'
import { PROPERTY_TYPES, CONDITIONS, DISTRICTS, UTILITIES_OPTIONS, BUILDING_TYPES, formatPhone } from '@/types'
import {
  dbFindExistingDraft, dbGetDraftById, dbSaveDraft, dbSubmitListingForReview, dbDeleteDraftListing,
  dbUploadListingImage, dbDeleteListingImage,
  ListingLifecycleError,
} from '@/lib/db'
import { createAutosaveEngine, type AutosaveState } from '@/lib/autosaveEngine'
import { messageForLifecycleError } from '@/lib/listingStatus'
import { MIGRATION_B_LIVE } from '@/lib/featureFlags'
import ConfirmModal from './ConfirmModal'

// ============================================================================
// E.2.2 — п'ятикроковий майстер публікації (спека §17–19).
//
// ОДИН майстер, ОДНЕ джерело стану (fields/photos/draftId нижче). draftId
// живе в draftIdRef і використовується аж до кінця роботи цього екрану —
// перший autosave створює ЄДИНИЙ draft-рядок (INSERT status='draft'),
// кожен наступний autosave/крок/submit — UPDATE того самого id.
//
// Recovery дивиться ТІЛЬКИ на status='draft' — ніколи 'rejected'.
// Відхилене оголошення це вже опубліковане й переглянуте об'єкт'явлення,
// яке власник може відредагувати й повторно надіслати (rejected →
// pending_review), але це НЕ "чернетка, яку можна продовжити чи видалити"
// — модель DELETE дозволяє власнику лише draft/archived, rejected сюди не
// входить ніколи. Редагування/resubmit rejected — поверхня E.2.3 ("Мої
// оголошення"), не recovery цього майстра. Recovery МОЖЕ знайти кілька
// draft-рядків одного користувача (легасі-дані, гонки, ручні правки) —
// жоден з них НЕ видаляється автоматично. Якщо їх кілька, показується
// список, користувач явно обирає, який продовжити; видалення інших
// відбувається ТІЛЬКИ через явний "Почати нове" + ConfirmModal,
// послідовно, з чесним звітом що саме видалено (див. confirmStartFresh
// нижче).
//
// Це ПЕРЕДБАЧАЄ застосовану Migration A. Жодна SQL-міграція цим файлом не
// застосовується.
// ============================================================================

interface Props {
  user: User | null
  onBack: () => void
  onGoProfile?: () => void
  // `warning` is non-null only when some already-orphaned Storage files
  // (images the DB no longer references) could not be cleaned up even
  // after a bounded retry right before submit — the submission itself
  // still succeeds (the DB was never blocked on Storage), this is purely
  // informational for whatever the caller wants to do with it (log,
  // surface later, feed a future admin/cleanup view).
  onSubmitted: (listing: ListingData, warning?: { orphanedImageCount: number }) => void
  // E.2.3 requirement 5 — "Продовжити заповнення" from a specific draft's
  // own card in "Мої оголошення" opens EXACTLY that draft, skipping the
  // generic multi-draft recovery prompt entirely. When set, the wizard
  // re-fetches this id server-side (dbGetDraftById — verifies owner_id AND
  // status='draft' fresh, never trusts a possibly-stale object the caller
  // already had in memory) instead of running dbFindExistingDraft. If the
  // row is gone/no longer a draft by the time this resolves, a conflict
  // screen is shown instead of silently falling back to "create a new
  // draft" — see the 'not-found' Recovery state below. Omit this prop
  // (undefined) for the ordinary "Додати оголошення" entry point, which
  // keeps using the generic recovery flow.
  initialDraftId?: number
}

type StepIndex = 1 | 2 | 3 | 4 | 5
type Recovery = 'checking' | 'prompt' | 'resolved' | 'not-found'

interface PhotoItem {
  id: string
  previewUrl: string
  uploadedUrl: string | null
  uploading: boolean
  failed: boolean
}

interface FormFields {
  title: string
  type: string
  district: string
  address: string
  price: string
  area: string
  floor: string
  totalFloors: string
  condition: string
  utilities: string
  buildingType: string
  parking: boolean
  separateEntrance: boolean
  description: string
  features: string
  ownerName: string
}

const DEBOUNCE_MS = 900
const STEP_TITLES: Record<StepIndex, string> = {
  1: 'Основна інформація',
  2: 'Характеристики',
  3: 'Фото та опис',
  4: 'Контакти',
  5: 'Перегляд і відправка',
}
const sanitize = (s: string) => s.replace(/<[^>]*>/g, '').trim()

function emptyFields(user: User | null): FormFields {
  return {
    title: '', type: 'Офіс', district: 'Приморський', address: '',
    price: '', area: '', floor: '', totalFloors: '',
    condition: 'Євроремонт', utilities: '', buildingType: '',
    parking: false, separateEntrance: false, description: '', features: '',
    ownerName: user?.name || '',
  }
}

function fieldsFromListing(l: ListingData): FormFields {
  return {
    title: l.title || '', type: l.type || 'Офіс', district: l.district || 'Приморський', address: l.address || '',
    price: l.price ? String(l.price) : '', area: l.area ? String(l.area) : '',
    floor: l.floor != null ? String(l.floor) : '', totalFloors: l.totalFloors != null ? String(l.totalFloors) : '',
    condition: l.condition || 'Євроремонт', utilities: l.utilities || '', buildingType: l.buildingType || '',
    parking: l.parking || false, separateEntrance: l.separateEntrance || false,
    description: l.description || '', features: l.features?.join(', ') || '',
    ownerName: l.ownerName || '',
  }
}

function photosFromListing(l: ListingData): PhotoItem[] {
  return (l.images || [])
    .filter(url => url && url !== '/no-photo.png')
    .map(url => ({ id: url, previewUrl: url, uploadedUrl: url, uploading: false, failed: false }))
}

type StepErrors = Partial<Record<'title' | 'type' | 'district' | 'address' | 'price' | 'area' | 'photos' | 'ownerName', string>>

function validateStep(n: StepIndex, f: FormFields, uploadedPhotoCount: number): StepErrors {
  const errors: StepErrors = {}
  if (n === 1) {
    const t = f.title.trim()
    if (!t) errors.title = "Введіть назву об'єкту"
    else if (/(.)\1{2,}/i.test(t)) errors.title = 'Назва виглядає некоректно — забагато однакових символів поспіль'
    if (!f.type.trim()) errors.type = 'Оберіть тип нерухомості'
    if (!f.district.trim()) errors.district = 'Оберіть район'
    if (!f.address.trim()) errors.address = 'Введіть адресу об\'єкту'
  }
  if (n === 2) {
    const priceNum = Number(f.price)
    if (!f.price.trim() || isNaN(priceNum) || priceNum < 100) errors.price = 'Ціна має бути не менше 100 ₴'
    const areaNum = Number(f.area)
    if (!f.area.trim() || isNaN(areaNum) || areaNum < 1 || areaNum > 50000) errors.area = 'Площа має бути від 1 до 50 000 м²'
  }
  if (n === 3) {
    if (uploadedPhotoCount < 3) errors.photos = 'Додайте щонайменше 3 фото'
  }
  if (n === 4) {
    if (!f.ownerName.trim()) errors.ownerName = "Введіть ім'я для зв'язку"
  }
  return errors
}

function firstStepWithError(errors: StepErrors): StepIndex {
  if (errors.title || errors.type || errors.district || errors.address) return 1
  if (errors.price || errors.area) return 2
  if (errors.photos) return 3
  if (errors.ownerName) return 4
  return 5
}


export default function AddListingWizard({ user, onBack, onGoProfile, onSubmitted, initialDraftId }: Props) {
  const [recovery, setRecovery] = useState<Recovery>(user ? 'checking' : 'resolved')
  // ALL status='draft' rows found for this user (never 'rejected' — see
  // the header comment on dbFindExistingDraft), newest first — never
  // trimmed to "just the canonical one" automatically. Length 0 = none
  // found, 1 = the simple continue/start-fresh prompt, >1 = an explicit
  // picker (requirement 1: no silent extra-draft deletion, ever).
  const [recoveredDrafts, setRecoveredDrafts] = useState<ListingData[]>([])

  const [step, setStep] = useState<StepIndex>(1)
  const [fields, setFields] = useState<FormFields>(() => emptyFields(user))
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [stepErrors, setStepErrors] = useState<StepErrors>({})
  const [photoError, setPhotoError] = useState('')
  const [saveState, setSaveState] = useState<AutosaveState>('idle')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showStartFreshConfirm, setShowStartFreshConfirm] = useState(false)
  const [startingFresh, setStartingFresh] = useState(false)
  const [startFreshError, setStartFreshError] = useState('')
  const [, forceRender] = useState(0) // draftId lives in a ref (see setDraftId) — this forces a re-render when it changes

  const fileRef = useRef<HTMLInputElement>(null)
  const draftIdRef = useRef<number | null>(null)
  function setDraftId(id: number | null) {
    draftIdRef.current = id
    forceRender(n => n + 1)
  }

  // user.id never changes for a session, but name/phone theoretically could
  // (e.g. edited in another tab) — mirrored so async code (save/delete
  // callbacks captured once into the autosave engine, see below) never
  // reads a value frozen at the wizard's first render.
  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])

  // Mirrors of the latest render's state for use inside async closures
  // that must never read a stale snapshot.
  const fieldsRef = useRef(fields)
  useEffect(() => { fieldsRef.current = fields }, [fields])
  const photosRef = useRef(photos)
  useEffect(() => { photosRef.current = photos }, [photos])

  // ── Photo deletion safety (requirements 3 & 6) ───────────────────
  // confirmedImageUrlsRef: exactly the images the LAST successfully saved
  // row referenced. A url only becomes safe to actually delete from
  // Storage once a save CONFIRMS the row no longer references it — never
  // before (requirement 3: never delete before the confirmed UPDATE).
  const confirmedImageUrlsRef = useRef<Set<string>>(new Set())
  // pendingImageDeletesRef: urls removed locally that WERE in
  // confirmedImageUrlsRef when removed — queued until a subsequent save
  // confirms the row no longer references them, then actually deleted.
  // Checked for "reappeared" before every deletion attempt so a fast
  // remove-then-re-add can never destroy a file the draft is using again.
  const pendingImageDeletesRef = useRef<Set<string>>(new Set())

  // Set once submit succeeds — stops any further autosave scheduling so a
  // stray/late timer can never fire an UPDATE against a row that is no
  // longer draft/rejected (requirement 7: no false error after success).
  const stoppedRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const submitInFlightRef = useRef(false)

  // Requirement 2 (upload-in-flight-at-exit race): set the instant the
  // user explicitly leaves (handleBack). While true: handleFiles() refuses
  // to start any NEW upload, and any upload's completion callback that
  // fires after this was set skips touching React state entirely (the
  // screen is going away) — if it actually succeeded, it's cleaned up
  // immediately instead of being left for cleanupUnconfirmedUploads(),
  // which by definition has already run its one pass by the time this
  // matters. activeUploadsRef tracks every in-flight upload promise so
  // handleBack can await them all before deciding what's "unconfirmed".
  const exitingRef = useRef(false)
  const activeUploadsRef = useRef<Set<Promise<void>>>(new Set())

  // ── Autosave engine (src/lib/autosaveEngine.ts — plain, testable, no
  // React/Supabase deps; see scripts/test-autosave-engine.ts for the
  // deterministic proof of its single-flight + freshness guarantees) ──
  function buildDraftPayload(): Partial<ListingData> {
    const f = fieldsRef.current
    const uploaded = photosRef.current.filter(p => p.uploadedUrl).map(p => p.uploadedUrl as string)
    const payload: Partial<ListingData> = {
      userId: userRef.current?.id || '',
      ownerId: userRef.current?.id || '',
      ownerName: (f.ownerName.trim() || userRef.current?.name || null) as string | null,
      ownerPhone: userRef.current?.phone || null,
      city: 'Одеса',
      type: f.type,
      district: f.district,
      condition: f.condition || null,
      utilities: f.utilities || null,
      buildingType: f.buildingType || null,
      parking: f.parking,
      separateEntrance: f.separateEntrance,
      description: f.description.trim() ? sanitize(f.description) : null,
      features: f.features ? f.features.split(',').map(s => sanitize(s)).filter(Boolean) : [],
      images: uploaded,
      floor: f.floor.trim() ? Number(f.floor) : null,
      totalFloors: f.totalFloors.trim() ? Number(f.totalFloors) : null,
    }
    // title/address/price/area stay OMITTED (not sent as null) when empty
    // — ListingData types them non-nullable, so Partial<ListingData> only
    // accepts a real value or "not present", never an explicit null.
    // Omitting has the same DB effect as null: listingToRow()/
    // listingToUpdateRow() write a genuine SQL NULL for an absent key on
    // INSERT and leave the column untouched on UPDATE — never a
    // fictitious 0/''/placeholder ("без фиктивных значений", E.1 audit).
    if (f.title.trim()) payload.title = sanitize(f.title)
    if (f.address.trim()) payload.address = sanitize(f.address)
    if (f.price.trim() && !isNaN(Number(f.price))) payload.price = Number(f.price)
    if (f.area.trim() && !isNaN(Number(f.area))) payload.area = Number(f.area)
    return payload
  }

  // Runs pending Storage deletions that a save has just made safe:
  // requirement 3 (only delete after the confirmed UPDATE) + requirement 6
  // (never delete a url that reappeared in the current photo list).
  async function flushPendingImageDeletes() {
    const ownerId = userRef.current?.id || ''
    for (const url of Array.from(pendingImageDeletesRef.current)) {
      if (photosRef.current.some(p => p.uploadedUrl === url)) {
        pendingImageDeletesRef.current.delete(url) // reappeared — the draft is using it again, don't delete
        continue
      }
      if (confirmedImageUrlsRef.current.has(url)) continue // the row that was just confirmed still references it — not safe yet
      const ok = await dbDeleteListingImage(url, ownerId)
      if (ok) pendingImageDeletesRef.current.delete(url)
      // else: stays queued, retried after the NEXT successful save — idempotent by design
    }
  }

  // Requirement 3: called right before submit, on top of whatever the last
  // autosave already flushed. Bounded (never an infinite/unbounded retry
  // loop) — a real Storage outage must not hang publishing. A failure here
  // is NEVER allowed to block the listing being submitted: the DB row
  // already doesn't reference these files (that's WHY they're queued at
  // all — see flushPendingImageDeletes), so the only cost of giving up is
  // an orphan file, not incorrect/dangling DB state. Whatever remains
  // queued after the bound is hit is returned so the caller can report it
  // — never silently dropped, even though stoppedRef will stop autosave
  // (and therefore any further automatic retry) right after submit.
  async function flushPendingImageDeletesWithRetry(maxAttempts: number): Promise<number> {
    for (let attempt = 0; attempt < maxAttempts && pendingImageDeletesRef.current.size > 0; attempt++) {
      await flushPendingImageDeletes()
    }
    if (pendingImageDeletesRef.current.size > 0) {
      console.error(`[AddListingWizard] ${pendingImageDeletesRef.current.size} image delete(s) still pending after ${maxAttempts} attempts — orphan file(s) in Storage, submission proceeds anyway`)
    }
    return pendingImageDeletesRef.current.size
  }

  async function saveSnapshot(payload: Partial<ListingData>): Promise<boolean> {
    const result = await dbSaveDraft(draftIdRef.current, payload)
    if (!result) return false
    if (draftIdRef.current == null) setDraftId(result.id)
    // This save is now the row's CONFIRMED state — update the confirmed
    // set from what was actually sent (not from photosRef, which may have
    // changed again already) before flushing deletions.
    confirmedImageUrlsRef.current = new Set(Array.isArray(payload.images) ? (payload.images as string[]) : [])
    await flushPendingImageDeletes()
    return true
  }

  const engineRef = useRef<ReturnType<typeof createAutosaveEngine<Partial<ListingData>>> | null>(null)
  if (!engineRef.current) {
    engineRef.current = createAutosaveEngine<Partial<ListingData>>({
      getSnapshot: buildDraftPayload,
      save: saveSnapshot,
      onStateChange: setSaveState,
    })
  }

  function scheduleAutosave() {
    if (stoppedRef.current) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      engineRef.current?.markDirty()
    }, DEBOUNCE_MS)
  }

  async function flushAutosave(): Promise<void> {
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = undefined }
    if (stoppedRef.current) return
    await engineRef.current?.flush()
  }

  useEffect(() => {
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current) }
  }, [])

  function updateField<K extends keyof FormFields>(key: K, value: FormFields[K]) {
    setFields(prev => ({ ...prev, [key]: value }))
    setStepErrors(prev => { if (!(key in prev)) return prev; const n = { ...prev }; delete (n as any)[key]; return n })
    scheduleAutosave()
  }

  // ── Draft recovery on open (reads the DB, not a ref/localStorage — so a
  // page reload recovers correctly too, not just an in-session remount) ──
  useEffect(() => {
    if (!user) { setRecovery('resolved'); return }
    let cancelled = false

    if (initialDraftId != null) {
      // Requirement 5 — a specific draft was requested (its own card's
      // "Продовжити заповнення"). Re-verified server-side (owner_id AND
      // status='draft'), never just trusted from whatever the caller
      // already had. Generic multi-draft recovery is skipped entirely —
      // this is a direct, targeted open, not "pick from a list".
      dbGetDraftById(initialDraftId, user.id).then(draft => {
        if (cancelled) return
        if (draft) {
          continueDraft(draft)
        } else {
          // Gone, or no longer a draft (submitted/deleted elsewhere since
          // the list was last loaded) — a conflict, not "silently start a
          // new one instead".
          setRecovery('not-found')
        }
      })
      return () => { cancelled = true }
    }

    dbFindExistingDraft(user.id).then(({ draft, extraDrafts }) => {
      if (cancelled) return
      if (draft) {
        setRecoveredDrafts([draft, ...extraDrafts])
        setRecovery('prompt')
      } else {
        setRecovery('resolved')
      }
    })
    return () => { cancelled = true }
  }, [user, initialDraftId])

  // Requirement 1: the user explicitly picks WHICH draft to continue when
  // more than one exists — the others are left completely untouched (not
  // deleted, not silently merged). They'll be found again next time
  // recovery runs; that's fine, they only ever disappear via an explicit
  // "Почати нове" + ConfirmModal on THIS list.
  function continueDraft(chosen: ListingData) {
    setFields(fieldsFromListing(chosen))
    const restoredPhotos = photosFromListing(chosen)
    setPhotos(restoredPhotos)
    confirmedImageUrlsRef.current = new Set(restoredPhotos.map(p => p.uploadedUrl).filter(Boolean) as string[])
    setDraftId(chosen.id)
    setStep(1)
    setRecovery('resolved')
  }

  // Requirement 2: deletes ALL recoveredDrafts, but predictably —
  // sequentially (never Promise.all), extras first, the row the user was
  // just looking at (recoveredDrafts[0], newest) LAST. If any extra fails,
  // stop immediately: the "last" draft is never touched and no clean form
  // is opened, so the user is never left with zero drafts while believing
  // one survived. The DB row and its Storage photos are two separate
  // systems with no shared transaction — this never claims otherwise; it
  // reports exactly what happened via startFreshError instead.
  async function confirmStartFresh() {
    if (recoveredDrafts.length === 0 || !user) { setShowStartFreshConfirm(false); return }
    setStartingFresh(true)
    setStartFreshError('')
    const [last, ...extras] = recoveredDrafts
    const deletedIds: number[] = []

    for (const extra of extras) {
      const r = await dbDeleteDraftListing(extra.id, extra.images || [], user.id)
      if (r.ok) {
        deletedIds.push(extra.id)
      } else {
        // Stop here — do NOT touch `last`. Report exactly what's gone and
        // what remains, refresh the picker to match reality.
        setStartingFresh(false)
        setShowStartFreshConfirm(false)
        setRecoveredDrafts(prev => prev.filter(d => !deletedIds.includes(d.id)))
        setStartFreshError(
          deletedIds.length > 0
            ? `⚠️ Видалено ${deletedIds.length} із ${extras.length} старих чернеток, але одну не вдалося — основну чернетку НЕ чіпали. Спробуйте ще раз.`
            : '⚠️ Не вдалося видалити стару чернетку. Основну чернетку НЕ чіпали. Спробуйте ще раз.'
        )
        return
      }
    }

    const lastResult = await dbDeleteDraftListing(last.id, last.images || [], user.id)
    setStartingFresh(false)
    if (!lastResult.ok) {
      setShowStartFreshConfirm(false)
      setRecoveredDrafts([last])
      setStartFreshError(
        extras.length > 0
          ? `⚠️ Старі чернетки видалено (${deletedIds.length}), але основну — ні. Спробуйте ще раз.`
          : '⚠️ Не вдалося видалити чернетку. Спробуйте ще раз.'
      )
      return
    }

    // Everything gone, confirmed one at a time — safe to open a clean form.
    setShowStartFreshConfirm(false)
    setFields(emptyFields(user))
    setPhotos([])
    confirmedImageUrlsRef.current = new Set()
    pendingImageDeletesRef.current = new Set()
    setDraftId(null)
    setStep(1)
    setRecovery('resolved')
  }

  // ── Photos ────────────────────────────────────────────────────
  function handleFiles(files: FileList | null) {
    if (!files || !user) return
    if (exitingRef.current) return // requirement 2: no new uploads once the user has started leaving
    const remaining = 10 - photos.length
    const MAX_SIZE = 10 * 1024 * 1024
    Array.from(files).slice(0, remaining).forEach(file => {
      if (file.size > MAX_SIZE) { setPhotoError(`Файл "${file.name}" більший за 10 MB`); return }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const previewUrl = URL.createObjectURL(file)
      setPhotos(p => [...p, { id, previewUrl, uploadedUrl: null, uploading: true, failed: false }])
      // Real auth.uid() only — no 'anonymous' fallback. The wizard never
      // renders without a phone-verified user (see the gate below), so
      // user.id is always a real Supabase Auth uid here.
      const uploadPromise = dbUploadListingImage(file, user.id).then(url => {
        if (exitingRef.current) {
          // Requirement 2: the wizard is closing — don't touch React state
          // for a screen that's on its way out. If the upload actually
          // succeeded, it's now unconfirmed and unreferenced by anything
          // and nothing will ever autosave again to pick it up via the
          // normal queue — clean it up right here instead.
          if (url) {
            dbDeleteListingImage(url, user.id).then(ok => {
              if (!ok) console.error('[AddListingWizard] failed to clean up a late-finishing upload after exit — may remain as an orphan file')
            })
          }
          return
        }
        // Requirement 6: this file is now uploaded but UNCONFIRMED (no
        // saved row references it yet) until the next successful autosave
        // — confirmedImageUrlsRef is only updated inside saveSnapshot().
        // If the user removes it before that happens, removePhoto() below
        // sees it's not in confirmedImageUrlsRef and deletes it right
        // away instead of queueing (nothing in the DB could be pointing
        // at it yet). If the tab closes before any save ever runs, this
        // file becomes a genuine orphan that no client-side code still
        // running can find — a known gap, see the report; only a
        // server-side sweep (comparing Storage objects against
        // listings.images) can catch that case.
        setPhotos(p => p.map(ph => ph.id === id ? { ...ph, uploadedUrl: url, uploading: false, failed: !url } : ph))
        if (url) scheduleAutosave()
      })
      activeUploadsRef.current.add(uploadPromise)
      uploadPromise.finally(() => { activeUploadsRef.current.delete(uploadPromise) })
    })
  }

  async function removePhoto(index: number) {
    const photo = photosRef.current[index]
    setPhotos(prev => prev.filter((_, i) => i !== index))
    scheduleAutosave()
    if (!photo?.uploadedUrl) return
    if (confirmedImageUrlsRef.current.has(photo.uploadedUrl)) {
      // Requirement 3: a saved row still references this — must wait for
      // a confirmed UPDATE without it before actually deleting from
      // Storage. Queued, flushed from saveSnapshot() above.
      pendingImageDeletesRef.current.add(photo.uploadedUrl)
    } else {
      // Requirement 6: never made it into a confirmed save — no row can
      // reference it, safe to delete immediately.
      const ok = await dbDeleteListingImage(photo.uploadedUrl, userRef.current?.id || '')
      if (!ok) console.error('[AddListingWizard] failed to remove an unconfirmed photo from Storage')
    }
  }

  // Requirement 4: covers "upload succeeded, but the row never confirmed
  // it, and the user leaves" — e.g. the first save keeps failing and the
  // user gives up and hits "← Назад" instead of retrying or deleting the
  // draft outright (confirmDeleteDraft already cleans up EVERYTHING,
  // confirmed or not, via its own imageUrls list — this is only for the
  // "just navigate away, draft stays as-is" path). Best-effort (a failed
  // individual delete is only logged, not retried further) but each
  // deletion call re-checks confirmedImageUrlsRef right before firing, in
  // case a save landed between when this loop started and that specific
  // photo's turn. Ordinary mid-session save failures do NOT trigger this
  // — only an explicit exit does; autosave keeps retrying on its own
  // otherwise (see saveSnapshot/flushPendingImageDeletes). Must only be
  // called AFTER every in-flight upload has settled (see handleBack) — the
  // whole point of requirement 2 is that this snapshot of photosRef must
  // be the FINAL one, not one a still-running upload can add to afterward.
  //
  // Known, honestly-documented gap: if the tab/browser closes or crashes
  // instead of the user clicking "Назад", no client-side code runs
  // at all and an uploaded-but-never-saved file can be a genuine, permanent
  // orphan that nothing here can find. Closing that gap needs a
  // server-side scheduled sweep (compare Storage objects under
  // listing-images/<uid>/ against the uid's listings.images arrays and
  // delete what's old and unreferenced) — intentionally NOT built in
  // E.2.2, this is a client-only stage.
  function cleanupUnconfirmedUploads() {
    const ownerId = userRef.current?.id || ''
    for (const photo of photosRef.current) {
      const url = photo.uploadedUrl
      if (!url || confirmedImageUrlsRef.current.has(url)) continue
      dbDeleteListingImage(url, ownerId).then(ok => {
        if (!ok) console.error('[AddListingWizard] failed to clean up an unconfirmed upload on exit — may remain as an orphan file')
      })
    }
  }

  // Requirement 2: guards against "upload finishes right after cleanup
  // already ran" by (1) blocking any NEW upload from starting the instant
  // this fires, (2) awaiting every upload already in flight so their
  // outcome (added to photos, or self-cleaned if exitingRef beat them to
  // it — see handleFiles) is fully settled, and only THEN (3) running the
  // unconfirmed-uploads sweep against that now-final photo list.
  async function handleBack() {
    if (exitingRef.current) return // already leaving — a second click/call is a no-op, not a second cleanup pass
    exitingRef.current = true
    await Promise.all(Array.from(activeUploadsRef.current))
    cleanupUnconfirmedUploads()
    onBack()
  }

  function movePhoto(index: number, dir: -1 | 1) {
    setPhotos(prev => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
    scheduleAutosave()
  }

  // ── Step navigation ──────────────────────────────────────────────
  const uploadedPhotoCount = photos.filter(p => p.uploadedUrl).length
  function goNext() {
    const errors = validateStep(step, fields, uploadedPhotoCount)
    if (Object.keys(errors).length > 0) { setStepErrors(errors); return }
    setStepErrors({})
    if (step < 5) setStep((step + 1) as StepIndex)
  }
  function goBackStep() {
    setStepErrors({})
    if (step > 1) setStep((step - 1) as StepIndex)
  }

  // ── Submit (requirement 7) ────────────────────────────────────────
  async function handleSubmit() {
    if (submitInFlightRef.current) return
    const allErrors: StepErrors = {
      ...validateStep(1, fields, uploadedPhotoCount),
      ...validateStep(2, fields, uploadedPhotoCount),
      ...validateStep(3, fields, uploadedPhotoCount),
    }
    if (Object.keys(allErrors).length > 0) {
      setStepErrors(allErrors)
      setStep(firstStepWithError(allErrors))
      return
    }
    if (photos.some(p => p.uploading)) { setPhotoError('Зачекайте, фото ще завантажуються'); setStep(3); return }
    if (photos.some(p => p.failed)) { setPhotoError('Деякі фото не вдалося завантажити — видаліть їх або спробуйте ще раз'); setStep(3); return }

    submitInFlightRef.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      // 1. Wait for the LAST revision to be confirmed saved. saveSnapshot()
      //    itself awaits flushPendingImageDeletes() before resolving, so by
      //    the time flushAutosave() resolves, pending photo deletions from
      //    that save have already completed or been safely re-queued.
      await flushAutosave()
      // One more bounded attempt specifically for whatever is STILL queued
      // (a transient Storage error earlier, etc.) — never blocks/fails
      // submit either way (requirement 3); just measures what's left.
      const orphanedImageCount = await flushPendingImageDeletesWithRetry(3)
      let id = draftIdRef.current
      if (id == null) {
        // Last-resort direct save for the edge case of a submit before
        // any autosave ever ran (e.g. instant paste + immediate click).
        const created = await dbSaveDraft(null, buildDraftPayload())
        if (!created) { setSubmitError('⚠️ Не вдалося зберегти чернетку. Перевірте підключення.'); return }
        setDraftId(created.id)
        id = created.id
      }
      // 2. Same draft id, one dbSubmitListingForReview call.
      let result: ListingData | null = null
      try {
        result = await dbSubmitListingForReview(id, buildDraftPayload())
      } catch (e) {
        if (e instanceof ListingLifecycleError) setSubmitError(messageForLifecycleError(e.code))
        else setSubmitError('⚠️ Не вдалося надіслати на модерацію. Спробуйте пізніше.')
        return
      }
      if (!result) { setSubmitError('⚠️ Не вдалося надіслати на модерацію. Спробуйте пізніше.'); return }
      // 3. Success — stop autosave FOR GOOD before handing off: the row is
      //    now pending_review, a late/stray timer must never fire an
      //    UPDATE against it (dbSaveDraft's own .in('status',['draft',
      //    'rejected']) guard would reject that anyway, but this avoids
      //    even attempting it — and avoids a false error toast for a
      //    request nobody is listening for the result of any more).
      stoppedRef.current = true
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = undefined }
      // Requirement 3: anything still stuck in the queue at this point is
      // now permanently out of this session's reach (autosave — the only
      // thing that retries the queue — is stopped for good above) — never
      // dropped silently, reported to the caller instead.
      onSubmitted(result, orphanedImageCount > 0 ? { orphanedImageCount } : undefined)
    } finally {
      submitInFlightRef.current = false
      setSubmitting(false)
    }
  }

  // ── Delete draft ──────────────────────────────────────────────
  async function confirmDeleteDraft() {
    if (draftIdRef.current == null || !user) { setShowDeleteConfirm(false); onBack(); return }
    setDeleting(true)
    const imageUrls = photosRef.current.filter(p => p.uploadedUrl).map(p => p.uploadedUrl as string)
    const result = await dbDeleteDraftListing(draftIdRef.current, imageUrls, user.id)
    setDeleting(false)
    setShowDeleteConfirm(false)
    if (result.ok) {
      stoppedRef.current = true
      if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = undefined }
      setDraftId(null)
      onBack()
    } else {
      setSubmitError(
        result.code === 'LISTING_UPDATE_CONFLICT'
          ? '⚠️ Чернетку вже змінено або видалено деінде. Оновіть сторінку.'
          : '⚠️ Не вдалося видалити чернетку. Спробуйте ще раз.'
      )
    }
  }

  // ── Styling helpers (same visual language as the rest of the app) ──
  const inpStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%', background: '#1A1F2E',
    border: `1px solid ${hasError ? '#EF4444' : '#2A3045'}`,
    borderRadius: 12, padding: '14px 16px', color: '#fff', fontSize: 15,
    fontFamily: 'Inter, sans-serif', outline: 'none', display: 'block',
    boxSizing: 'border-box', WebkitAppearance: 'none' as any,
    transition: 'border-color .15s',
  })
  const lbl: React.CSSProperties = {
    fontSize: 12, color: '#A0A8BC', marginBottom: 6, fontWeight: 600,
    display: 'block', textTransform: 'uppercase' as const, letterSpacing: '.5px',
  }
  const errMsg: React.CSSProperties = { fontSize: 12, color: '#EF4444', marginTop: 4, display: 'block' }

  // ── Gate: no phone → can't publish (same rule as before E.2.2) ─────
  if (!user?.phone) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Потрібен номер телефону</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 300 }}>
          Без номера телефону не можна публікувати об'єкти. Зареєструйтесь з номером телефону.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>← Назад</button>
        {onGoProfile && <button onClick={onGoProfile} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Перейти в профіль</button>}
      </div>
    )
  }

  // ── Recovery gate: found an existing draft, ask before touching it ──
  if (recovery === 'checking') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#A0A8BC', fontSize: 14 }}>Завантаження…</div>
      </div>
    )
  }
  if (recovery === 'not-found') {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 20 }}>⚠️</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Цю чернетку більше не знайдено</div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 24, maxWidth: 320 }}>
          Її вже видалено або надіслано на модерацію в іншому місці. Поверніться до списку оголошень.
        </div>
        <button onClick={onBack} style={{ width: '100%', maxWidth: 300, padding: '14px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>← До списку оголошень</button>
      </div>
    )
  }
  if (recovery === 'prompt' && recoveredDrafts.length > 0) {
    const multiple = recoveredDrafts.length > 1
    const fmtDate = (iso: string) => {
      try { return new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
      catch { return iso }
    }
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1117', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 24px 40px', textAlign: 'center' }}>
        <div style={{ fontSize: 48, margin: '20px 0' }}>📝</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>
          {multiple ? 'У вас декілька незавершених чернеток' : 'У вас є незавершена чернетка'}
        </div>
        <div style={{ fontSize: 14, color: '#A0A8BC', lineHeight: 1.6, marginBottom: 20, maxWidth: 380 }}>
          {multiple
            ? 'Оберіть, яку продовжити — інші лишаться недоторканими, доки ви явно не видалите їх.'
            : 'Продовжити редагування чи почати нове оголошення?'}
        </div>
        {startFreshError && <span style={{ ...errMsg, display: 'block', marginBottom: 16, maxWidth: 380 }}>{startFreshError}</span>}

        <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
          {recoveredDrafts.map(d => {
            const photoCount = (d.images || []).filter(u => u && u !== '/no-photo.png').length
            return (
              <div key={d.id} style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, padding: 14, textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{d.title ? `«${d.title}»` : 'Без назви'}</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                  Оновлено {fmtDate(d.updatedAt)} · {photoCount} фото
                </div>
                <button onClick={() => continueDraft(d)} style={{ width: '100%', padding: '11px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)', border: 'none', borderRadius: 10, color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Продовжити цю чернетку</button>
              </div>
            )
          })}
        </div>

        <button onClick={() => setShowStartFreshConfirm(true)} style={{ width: '100%', maxWidth: 380, padding: '15px', background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, color: '#A0A8BC', fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>
          {multiple ? 'Видалити всі й почати нове' : 'Почати нове оголошення'}
        </button>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: 13, cursor: 'pointer', padding: 8 }}>← Назад</button>

        {showStartFreshConfirm && (
          <ConfirmModal
            title={multiple ? 'Видалити всі чернетки?' : 'Видалити чернетку?'}
            message={
              multiple
                ? `Усі ${recoveredDrafts.length} чернетки (${recoveredDrafts.map(d => `«${d.title || 'без назви'}»`).join(', ')}) і всі їхні фото будуть видалені без можливості відновлення. Якщо якесь видалення не вдасться — процес зупиниться і повідомить, що саме видалено.`
                : `Чернетка "${recoveredDrafts[0].title || 'без назви'}" і всі завантажені фото будуть видалені без можливості відновлення, після чого відкриється чиста форма.`
            }
            confirmLabel={startingFresh ? 'Видалення…' : 'Видалити і почати нове'}
            cancelLabel="Скасувати"
            danger
            onConfirm={confirmStartFresh}
            onCancel={() => setShowStartFreshConfirm(false)}
          />
        )}
      </div>
    )
  }

  const saveStatusText =
    saveState === 'saving' ? 'Збереження…' :
    saveState === 'saved' ? 'Збережено' :
    saveState === 'error' ? 'Помилка збереження' : ''
  const saveStatusColor = saveState === 'error' ? '#EF4444' : saveState === 'saved' ? '#22C55E' : '#A0A8BC'

  return (
    <div className="desktop-wide-screen">
      <div className="desktop-wide-screen-inner">
        <div className="wizard-inner" style={{ minHeight: '100dvh', background: '#0F1117' }}>
          {/* Header */}
          <div style={{
            padding: '44px 20px 14px',
            paddingTop: 'max(44px, env(safe-area-inset-top, 44px))',
            background: '#0D1018',
            display: 'flex', alignItems: 'center', gap: 12,
            position: 'sticky', top: 0, zIndex: 10,
            borderBottom: '1px solid #1E2334',
          }}>
            <button onClick={handleBack} aria-label="Назад" style={{ background: '#1A1F2E', border: 'none', borderRadius: 10, width: 36, height: 36, color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>←</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{STEP_TITLES[step]}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Крок {step} з 5</div>
            </div>
            {saveStatusText && (
              <span style={{ fontSize: 11, color: saveStatusColor, flexShrink: 0, whiteSpace: 'nowrap' }}>{saveStatusText}</span>
            )}
            {draftIdRef.current != null && (
              <button onClick={() => setShowDeleteConfirm(true)} aria-label="Видалити чернетку" style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: 18, cursor: 'pointer', padding: 4, flexShrink: 0 }}>🗑️</button>
            )}
          </div>

          {/* Step progress */}
          <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <div key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: n <= step ? '#FF6B1A' : '#2A3045' }} />
            ))}
          </div>

          <div style={{ padding: '20px 20px 140px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {step === 1 && (
              <>
                <div>
                  <label style={lbl}>Назва *</label>
                  <input style={inpStyle(!!stepErrors.title)} value={fields.title} onChange={e => updateField('title', e.target.value)} placeholder="Наприклад: Офіс у центрі" />
                  {stepErrors.title && <span style={errMsg}>⚠ {stepErrors.title}</span>}
                </div>
                <div>
                  <label style={lbl}>Тип нерухомості *</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {PROPERTY_TYPES.map(t => (
                      <button key={t} onClick={() => updateField('type', t)} style={{
                        padding: '8px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                        background: fields.type === t ? '#FF6B1A' : '#1A1F2E',
                        color: fields.type === t ? '#fff' : '#A0A8BC',
                        fontSize: 13, fontFamily: 'Inter, sans-serif', fontWeight: fields.type === t ? 600 : 400,
                      }}>{t}</button>
                    ))}
                  </div>
                  {stepErrors.type && <span style={errMsg}>⚠ {stepErrors.type}</span>}
                </div>
                <div>
                  <label style={lbl}>Район *</label>
                  <select style={{ ...inpStyle(!!stepErrors.district), appearance: 'none' } as React.CSSProperties} value={fields.district} onChange={e => updateField('district', e.target.value)}>
                    {DISTRICTS.filter(d => d !== 'Всі райони').map(d => <option key={d}>{d}</option>)}
                  </select>
                  {stepErrors.district && <span style={errMsg}>⚠ {stepErrors.district}</span>}
                </div>
                <div>
                  <label style={lbl}>Адреса *</label>
                  <input style={inpStyle(!!stepErrors.address)} value={fields.address} onChange={e => updateField('address', e.target.value)} placeholder="вул. Дерибасівська, 18, Одеса" autoComplete="street-address" />
                  {stepErrors.address && <span style={errMsg}>⚠ {stepErrors.address}</span>}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>Ціна ₴/міс *</label>
                    <input style={inpStyle(!!stepErrors.price)} type="number" inputMode="numeric" value={fields.price} onChange={e => updateField('price', e.target.value)} placeholder="25000" />
                    {stepErrors.price && <span style={errMsg}>⚠ {stepErrors.price}</span>}
                  </div>
                  <div>
                    <label style={lbl}>Площа м² *</label>
                    <input style={inpStyle(!!stepErrors.area)} type="number" inputMode="numeric" value={fields.area} onChange={e => updateField('area', e.target.value)} placeholder="120" />
                    {stepErrors.area && <span style={errMsg}>⚠ {stepErrors.area}</span>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>Поверх</label>
                    <input style={inpStyle(false)} type="number" inputMode="numeric" value={fields.floor} onChange={e => updateField('floor', e.target.value)} placeholder="напр. 3" />
                  </div>
                  <div>
                    <label style={lbl}>Всього поверхів</label>
                    <input style={inpStyle(false)} type="number" inputMode="numeric" value={fields.totalFloors} onChange={e => updateField('totalFloors', e.target.value)} placeholder="напр. 9" />
                  </div>
                </div>
                <div>
                  <label style={lbl}>Стан приміщення</label>
                  <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={fields.condition} onChange={e => updateField('condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={lbl}>Комунальні платежі</label>
                    <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={fields.utilities} onChange={e => updateField('utilities', e.target.value)}>
                      <option value="">—</option>
                      {UTILITIES_OPTIONS.map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={lbl}>Тип будівлі</label>
                    <select style={{ ...inpStyle(false), appearance: 'none' } as React.CSSProperties} value={fields.buildingType} onChange={e => updateField('buildingType', e.target.value)}>
                      <option value="">—</option>
                      {BUILDING_TYPES.map(b => <option key={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => updateField('parking', !fields.parking)} style={{
                    flex: 1, padding: '12px 8px',
                    background: fields.parking ? '#FF6B1A22' : '#1A1F2E',
                    border: `1px solid ${fields.parking ? '#FF6B1A' : '#2A3045'}`,
                    borderRadius: 12, color: fields.parking ? '#FF6B1A' : '#A0A8BC',
                    fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}>🅿️ Паркінг</button>
                  <button onClick={() => updateField('separateEntrance', !fields.separateEntrance)} style={{
                    flex: 1, padding: '12px 8px',
                    background: fields.separateEntrance ? '#FF6B1A22' : '#1A1F2E',
                    border: `1px solid ${fields.separateEntrance ? '#FF6B1A' : '#2A3045'}`,
                    borderRadius: 12, color: fields.separateEntrance ? '#FF6B1A' : '#A0A8BC',
                    fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                  }}>🚪 Окремий вхід</button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ ...lbl, marginBottom: 0 }}>Фотографії * (мінімум 3)</label>
                    <span style={{ fontSize: 12, color: '#6B7280' }}>{photos.length}/10</span>
                  </div>
                  {photos.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      {photos.map((p, i) => (
                        <div key={p.id} style={{ position: 'relative', flexShrink: 0 }}>
                          <img src={p.previewUrl} style={{
                            width: 84, height: 84, objectFit: 'cover', borderRadius: 10,
                            opacity: p.uploading ? 0.5 : 1,
                            border: p.failed ? '2px solid #EF4444' : 'none',
                          }} />
                          {p.uploading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>⏳</div>}
                          {p.failed && <div style={{ position: 'absolute', bottom: 16, left: 2, right: 2, fontSize: 9, color: '#fff', background: '#EF4444CC', borderRadius: 4, textAlign: 'center', padding: '1px 0' }}>Помилка</div>}
                          <button onClick={() => removePhoto(i)} aria-label="Видалити фото" style={{
                            position: 'absolute', top: -6, right: -6,
                            background: '#EF4444', border: 'none', borderRadius: '50%',
                            width: 20, height: 20, cursor: 'pointer', color: '#fff',
                            fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>✕</button>
                          <div style={{ position: 'absolute', bottom: -2, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 2 }}>
                            <button onClick={() => movePhoto(i, -1)} disabled={i === 0} aria-label="Перемістити ліворуч" style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 6, width: 20, height: 16, color: i === 0 ? '#3A4055' : '#A0A8BC', fontSize: 10, cursor: i === 0 ? 'default' : 'pointer', lineHeight: 1 }}>‹</button>
                            <button onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} aria-label="Перемістити праворуч" style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 6, width: 20, height: 16, color: i === photos.length - 1 ? '#3A4055' : '#A0A8BC', fontSize: 10, cursor: i === photos.length - 1 ? 'default' : 'pointer', lineHeight: 1 }}>›</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(photoError || stepErrors.photos) && <span style={{ ...errMsg, display: 'block', marginBottom: 6 }}>⚠ {photoError || stepErrors.photos}</span>}
                  <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
                  <button onClick={() => fileRef.current?.click()} disabled={photos.length >= 10} style={{
                    width: '100%', padding: '18px',
                    background: '#1A1F2E', border: '1px dashed #FF6B1A44', borderRadius: 12,
                    cursor: photos.length >= 10 ? 'default' : 'pointer', opacity: photos.length >= 10 ? 0.5 : 1,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  }}>
                    <div style={{ fontSize: 24 }}>📷</div>
                    <div style={{ fontSize: 13, color: '#FF6B1A', fontWeight: 600 }}>Додати фото</div>
                    <div style={{ fontSize: 11, color: '#6B7280' }}>JPG, PNG, WEBP до 10 MB кожне</div>
                  </button>
                </div>
                <div>
                  <label style={lbl}>Опис</label>
                  <textarea style={{ ...inpStyle(false), resize: 'none', minHeight: 100 } as React.CSSProperties} value={fields.description} onChange={e => updateField('description', e.target.value)} placeholder="Детальний опис приміщення..." rows={4} />
                </div>
                <div>
                  <label style={lbl}>Переваги (через кому)</label>
                  <input style={inpStyle(false)} value={fields.features} onChange={e => updateField('features', e.target.value)} placeholder="Ліфт, Кондиціонер, Охорона, Wi-Fi" />
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div>
                  <label style={lbl}>Ім'я для зв'язку *</label>
                  <input style={inpStyle(!!stepErrors.ownerName)} value={fields.ownerName} onChange={e => updateField('ownerName', e.target.value)} placeholder="Як до вас звертатись" />
                  {stepErrors.ownerName && <span style={errMsg}>⚠ {stepErrors.ownerName}</span>}
                </div>
                <div>
                  <label style={lbl}>Телефон</label>
                  <div style={{ ...inpStyle(false), color: '#A0A8BC', cursor: 'default' }}>{formatPhone(user.phone)}</div>
                  <span style={{ fontSize: 12, color: '#6B7280', marginTop: 4, display: 'block' }}>Прив'язаний до вашого акаунту — змінити можна в профілі</span>
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <div style={{ background: '#1A1F2E', border: '1px solid #2A3045', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{fields.title || '(без назви)'}</div>
                  <div style={{ fontSize: 13, color: '#A0A8BC' }}>{fields.type} · {fields.district} · {fields.address || '(без адреси)'}</div>
                  <div style={{ fontSize: 13, color: '#A0A8BC' }}>{fields.price ? `${fields.price} ₴/міс` : '—'} · {fields.area ? `${fields.area} м²` : '—'}{fields.floor ? ` · ${fields.floor} поверх` : ''}</div>
                  <div style={{ fontSize: 13, color: '#A0A8BC' }}>{fields.condition}{fields.utilities ? ` · Комунальні: ${fields.utilities}` : ''}{fields.buildingType ? ` · ${fields.buildingType}` : ''}</div>
                  {fields.description && <div style={{ fontSize: 13, color: '#A0A8BC', lineHeight: 1.5 }}>{fields.description}</div>}
                  {photos.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                      {photos.map(p => <img key={p.id} src={p.previewUrl} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />)}
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: '#A0A8BC' }}>Контакт: {fields.ownerName || '—'}, {formatPhone(user.phone)}</div>
                </div>
                {/* E.2.4 requirement 3 — supplementary UX only: the real
                    block is in dbSubmitListingForReview itself (throws
                    before any request when the flag is off), this just
                    tells the owner why up front instead of after a failed
                    submit. */}
                {!MIGRATION_B_LIVE && (
                  <div style={{ padding: '12px 14px', background: '#FFB02022', border: '1px solid #FFB02066', borderRadius: 12, color: '#FFB020', fontSize: 13, lineHeight: 1.5 }}>
                    🚧 Надсилання на модерацію тимчасово недоступне — технічні роботи. Чернетка збережена, спробуйте пізніше.
                  </div>
                )}
                {submitError && <span style={{ ...errMsg, display: 'block' }}>{submitError}</span>}
              </>
            )}
          </div>

          {/* Fixed footer nav */}
          <div className="wizard-footer" style={{
            position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
            width: '100%',
            padding: '12px 20px',
            paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))',
            background: 'linear-gradient(transparent, #0F1117 30%)',
            zIndex: 100,
            display: 'flex', gap: 10,
          }}>
            {step > 1 && (
              <button onClick={goBackStep} style={{
                padding: '16px 20px', background: '#1A1F2E', border: '1px solid #2A3045',
                borderRadius: 14, color: '#A0A8BC', fontSize: 15, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif', minHeight: 52,
              }}>← Назад</button>
            )}
            {step < 5 ? (
              <button onClick={goNext} style={{
                flex: 1, padding: '16px', background: 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
                border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif', minHeight: 52, touchAction: 'manipulation',
                boxShadow: '0 4px 20px rgba(255,107,26,.35)',
              }}>Далі →</button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting || photos.some(p => p.uploading) || !MIGRATION_B_LIVE}
                style={{
                  flex: 1, padding: '16px',
                  background: (submitting || photos.some(p => p.uploading) || !MIGRATION_B_LIVE) ? '#4B5563' : 'linear-gradient(135deg,#FF6B1A,#FF8C3A)',
                  border: 'none', borderRadius: 14, color: '#fff', fontSize: 16, fontWeight: 700,
                  cursor: (submitting || photos.some(p => p.uploading) || !MIGRATION_B_LIVE) ? 'wait' : 'pointer',
                  fontFamily: 'Inter, sans-serif', minHeight: 52, touchAction: 'manipulation',
                  boxShadow: (submitting || photos.some(p => p.uploading) || !MIGRATION_B_LIVE) ? 'none' : '0 4px 20px rgba(255,107,26,.35)',
                }}
              >
                {!MIGRATION_B_LIVE ? '🚧 Тимчасово недоступно' : submitting ? '⏳ Надсилання...' : photos.some(p => p.uploading) ? '⏳ Завантаження фото...' : '✅ Надіслати на модерацію'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <ConfirmModal
          title="Видалити чернетку?"
          message="Чернетка та всі завантажені фото будуть видалені без можливості відновлення."
          confirmLabel={deleting ? 'Видалення…' : 'Видалити'}
          cancelLabel="Скасувати"
          danger
          onConfirm={confirmDeleteDraft}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  )
}
