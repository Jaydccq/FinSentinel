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
    <div className="flex items-center justify-between gap-4 flex-wrap py-3">
      <p className="text-xs text-zinc-500">
        Showing <span className="text-zinc-300 font-medium">{from}–{to}</span> of{' '}
        <span className="text-zinc-300 font-medium">{totalElements}</span> documents
      </p>

      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={e => onPageSizeChange(Number(e.target.value))}
          className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-2 py-1 text-xs text-zinc-300 cursor-pointer"
        >
          {[10, 20, 50].map(s => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </select>

        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>

        {pages.map(p => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`h-7 min-w-[28px] rounded-lg text-xs font-medium transition-colors ${
              p === page
                ? 'bg-amber-500/20 text-amber-200 border border-amber-400/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {p + 1}
          </button>
        ))}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
