'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  watchlistApi,
  type WatchlistItemResponse,
  type WatchlistCategoryResponse,
} from '../api/watchlist'

interface Props {
  /** Symbol being edited — used to look up the item in the category. */
  symbol: string
  /** Category name the item lives under (Dashboard's is a constant). */
  categoryName: string
  /** Close handler — parent drives open/close state. */
  onClose: () => void
  /** Called after a successful save so the parent can refresh. */
  onSaved?: (item: WatchlistItemResponse) => void
}

/**
 * F-6: edit drawer for a single watchlist item. Opens from the Dashboard
 * ticker tile, loads the item by symbol (server round-trip because the
 * parent stores string[], not items[]), and writes thesis / notes /
 * priority back through `watchlistApi.updateItem`.
 *
 * Kept self-contained so wiring is a two-line diff at the call site —
 * this component owns its load/save lifecycle and doesn't touch the
 * parent's watchlist state. A full refactor where the parent stores
 * items[] from day one would be cleaner but touches far more code.
 */
export default function WatchlistItemEditor({
  symbol,
  categoryName,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [item, setItem] = useState<WatchlistItemResponse | null>(null)
  const [thesis, setThesis] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Load on mount — find the matching item across the user's categories.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const overview = await watchlistApi.list()
        if (cancelled) return
        const category: WatchlistCategoryResponse | undefined =
          overview.categories.find((c) => c.name === categoryName)
        const found = category?.items.find(
          (i) => i.symbol.toUpperCase() === symbol.toUpperCase(),
        )
        if (!found) {
          toast.error(`${symbol} not found in ${categoryName}`)
          onClose()
          return
        }
        setItem(found)
        setThesis(found.thesis ?? '')
        setNotes(found.notes ?? '')
        setPriority(found.priority ?? 0)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to load item',
        )
        onClose()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [symbol, categoryName, onClose])

  // Close on Escape — keeps keyboard users out of trap scenarios.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      const updated = await watchlistApi.updateItem(item.id, {
        thesis: thesis.trim() || undefined,
        notes: notes.trim() || undefined,
        priority: Number.isFinite(priority) ? priority : 0,
      })
      toast.success(`Saved ${updated.symbol}`)
      onSaved?.(updated)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${symbol}`}
    >
      <div
        ref={dialogRef}
        className="glass-panel rounded w-full max-w-md mx-4 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {symbol}
            <span className="ml-2 text-xs text-[var(--text-muted)] font-normal">
              Research notes
            </span>
          </h2>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded flex items-center justify-center hover:bg-white/5"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center text-[var(--text-muted)]">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void save()
            }}
            className="space-y-3"
          >
            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Thesis
              </label>
              <textarea
                value={thesis}
                onChange={(e) => setThesis(e.target.value)}
                className="field-input w-full mt-1 min-h-[80px] font-mono text-sm"
                placeholder="Why are you watching this?"
                maxLength={4000}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="field-input w-full mt-1 min-h-[60px] font-mono text-sm"
                placeholder="Running commentary, catalysts, etc."
                maxLength={4000}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
                Priority (0-1000)
              </label>
              <input
                type="number"
                min={0}
                max={1000}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="field-input w-32 mt-1 font-data text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost px-3 py-2 text-sm"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="btn-primary px-3 py-2 text-sm flex items-center gap-1"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
