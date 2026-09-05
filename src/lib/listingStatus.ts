import type { ListingStatus } from '@/types'
import type { ListingLifecycleErrorCode } from '@/lib/db'

// Single source of truth for status → label/color/description — E.2.3
// requirement 6: "не разбрасывать строки по компонентам", never show a raw
// `null` or an English enum value to the user. Every screen that renders a
// listing's lifecycle status goes through this.

export interface StatusMeta {
  label: string
  color: string
  bg: string
  description: string
  // True for the one real gap in the model: a live row whose `status`
  // column is `null` — either the schema migration hasn't been applied
  // yet, or (in principle) a row somehow slipped through without a
  // backfilled value. NOT one of the six real lifecycle states. Any
  // lifecycle-changing action (edit/delete/pause/archive/restore/resubmit)
  // must refuse to run against this — see isLifecycleActionable below.
  unknown?: boolean
}

const META: Record<ListingStatus, StatusMeta> = {
  draft:           { label: 'Чернетка',    color: '#A0A8BC', bg: '#6B728022', description: 'Ще не надіслано на модерацію' },
  pending_review:  { label: 'На модерації', color: '#FFB020', bg: '#FFB02022', description: 'Очікує на перевірку адміністратором' },
  active:          { label: 'Активне',      color: '#22C55E', bg: '#22C55E22', description: 'Опубліковано, видно в каталозі' },
  rejected:        { label: 'Відхилено',    color: '#EF4444', bg: '#EF444422', description: 'Не пройшло модерацію' },
  paused:          { label: 'Призупинено',  color: '#2A9FD6', bg: '#2A9FD622', description: 'Тимчасово прибрано з каталогу' },
  archived:        { label: 'В архіві',     color: '#6B7280', bg: '#6B728022', description: 'Знято з публікації' },
}

const UNKNOWN_META: StatusMeta = {
  label: 'Статус невідомий',
  color: '#6B7280',
  bg: '#6B728022',
  description: 'Дані оновлюються — спробуйте оновити сторінку',
  unknown: true,
}

export function getStatusMeta(status: ListingStatus | null | undefined): StatusMeta {
  if (status == null) return UNKNOWN_META
  return META[status] || UNKNOWN_META
}

// Requirement 6: "для временного status=null... не делать небезопасный
// вывод статуса для lifecycle-действий... заблокировать изменяющие дії".
// Every button that changes a listing's lifecycle (edit, delete, pause,
// archive, restore, resubmit, continue-draft) must check this first — a
// null status is not "assume it's probably active", it's "don't know,
// don't act".
export function isLifecycleActionable(status: ListingStatus | null | undefined): status is ListingStatus {
  return status != null
}

// Shared, human, Ukrainian message for every classified DB-side lifecycle
// rejection (supabase/migrations/20260830110000_listing_status_enforce.sql) —
// ONE copy, used by AddListingWizard, EditListingForm, and page.tsx's
// status-lifecycle handlers, instead of three slightly-different translated
// copies drifting apart. Rate-limit messages state the actual wait window
// explicitly ("кілька хвилин" / "завтра"), not just "try again".
export function messageForLifecycleError(code: ListingLifecycleErrorCode): string {
  switch (code) {
    case 'LISTING_RATE_LIMIT_10_MIN': return '⚠️ Забагато спроб за короткий час. Спробуйте через кілька хвилин.'
    case 'LISTING_RATE_LIMIT_24_HOURS': return '⚠️ Досягнуто денний ліміт публікацій. Спробуйте завтра.'
    case 'LISTING_REQUIRED_FIELDS_MISSING': return "⚠️ Заповніть усі обов'язкові поля та додайте щонайменше 3 фото."
    case 'LISTING_TOO_MANY_PHOTOS': return '⚠️ Забагато фото — максимум 10.'
    case 'LISTING_UPDATE_CONFLICT': return '⚠️ Дані застаріли — хтось або щось інше вже змінило цей запис. Оновіть список і спробуйте ще раз.'
    case 'LISTING_LOCKED_PENDING_REVIEW': return '⚠️ Це оголошення вже на модерації.'
    case 'LISTING_OWNER_IMMUTABLE': return '⚠️ Помилка власника оголошення. Оновіть сторінку.'
    case 'LISTING_REJECTION_REASON_REQUIRED': return "⚠️ Вкажіть причину відхилення — це обов'язково."
    case 'MIGRATION_B_NOT_LIVE': return '🚧 Модерація тимчасово недоступна — технічні роботи. Спробуйте пізніше.'
    default: return '⚠️ Не вдалося виконати дію. Спробуйте пізніше.'
  }
}
