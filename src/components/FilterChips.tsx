'use client'

export interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

// Spec §07: applied-filter chips with a cross — removing one immediately
// updates the applied filters and the result list, bypassing the
// draft/apply cycle. Shared between the home inline panel and the catalog.
export default function FilterChips({ chips }: { chips: FilterChip[] }) {
  if (chips.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '0 20px 12px' }}>
      {chips.map(chip => (
        <button
          key={chip.key}
          onClick={chip.onRemove}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#1A1F2E', border: '1px solid #2A3045',
            borderRadius: 20, padding: '6px 8px 6px 12px',
            color: '#fff', fontSize: 12, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
          }}
        >
          {chip.label}
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: '50%', background: '#2A3045',
            fontSize: 11, lineHeight: 1, color: '#A0A8BC',
          }}>✕</span>
        </button>
      ))}
    </div>
  )
}
