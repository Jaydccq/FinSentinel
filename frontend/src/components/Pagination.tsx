import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  totalPages: number
  totalElements: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export default function Pagination({
  page, totalPages, totalElements, pageSize, onPageChange, onPageSizeChange,
}: Props) {
  if (totalElements === 0) return null

  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, totalElements)

  const pages: number[] = []
  const start = Math.max(0, page - 2)
  const end = Math.min(totalPages - 1, page + 2)
  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap py-2.5">
      <p className="text-[10px] text-[var(--text-muted)]">
        Showing <span className="text-[var(--text-secondary)] font-medium">{from}–{to}</span> of{' '}
        <span className="text-[var(--text-secondary)] font-medium">{totalElements}</span> documents
      </p>

      <div className="flex items-center gap-1.5">
        <select
          value={pageSize}
          onChange={e => onPageSizeChange(Number(e.target.value))}
          className="bg-[var(--bg-elevated)] border border-[var(--border-strong)] rounded px-2 py-1 text-[10px] text-[var(--text-secondary)] cursor-pointer"
        >
          {[10, 20, 50].map(s => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </select>

        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className="h-6 w-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={13} />
        </button>

        {pages.map(p => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`h-6 min-w-[24px] px-1 rounded text-[10px] font-mono font-medium transition-colors ${
              p === page
                ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
            }`}
          >
            {p + 1}
          </button>
        ))}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className="h-6 w-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}
