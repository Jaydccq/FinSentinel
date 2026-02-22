import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, CheckCircle, Clock, AlertCircle, File, BookOpen, Newspaper, BarChart2, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { documentsApi, type DocumentResponse } from '../api/documents'
import { DocumentListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const DOC_TYPES = ['REGULATION', 'RESEARCH', 'NEWS', 'EARNINGS', 'OTHER']
const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']

const STATUS_STYLE: Record<string, { border: string; badge: string; label: string }> = {
  COMPLETED: {
    border: 'border-l-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-400',
    label: 'Completed',
  },
  PROCESSING: {
    border: 'border-l-blue-500',
    badge: 'bg-blue-500/15 text-blue-400',
    label: 'Processing',
  },
  PENDING: {
    border: 'border-l-yellow-500',
    badge: 'bg-yellow-500/15 text-yellow-400',
    label: 'Pending',
  },
  FAILED: {
    border: 'border-l-red-500',
    badge: 'bg-red-500/15 text-red-400',
    label: 'Failed',
  },
}

const DOC_TYPE_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  REGULATION: { icon: <BookOpen size={16} />, color: 'text-emerald-400' },
  RESEARCH:   { icon: <BarChart2 size={16} />, color: 'text-blue-400' },
  NEWS:       { icon: <Newspaper size={16} />, color: 'text-purple-400' },
  EARNINGS:   { icon: <FileText size={16} />, color: 'text-orange-400' },
  OTHER:      { icon: <FolderOpen size={16} />, color: 'text-zinc-400' },
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED')  return <CheckCircle size={13} className="text-emerald-400" />
  if (status === 'PROCESSING') return <Clock       size={13} className="text-blue-400" />
  if (status === 'PENDING')    return <Clock       size={13} className="text-yellow-400" />
  return                              <AlertCircle  size={13} className="text-red-400" />
}

function formatSize(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`
  return                              `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FilterChips({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string
  options: string[]
  selected: string
  onSelect: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-muted)] font-medium">{label}</span>
      <button
        onClick={() => onSelect('')}
        className={`status-chip border transition-colors ${
          selected === ''
            ? 'bg-amber-400/18 border-amber-300/30 text-amber-100'
            : 'bg-slate-800/30 border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
      >
        All
      </button>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          className={`status-chip border transition-colors ${
            selected === opt
              ? 'bg-amber-400/18 border-amber-300/30 text-amber-100'
              : 'bg-slate-800/30 border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function DocumentsPage() {
  const [docs,         setDocs]         = useState<DocumentResponse[]>([])
  const [loading,      setLoading]      = useState(true)
  const [uploading,    setUploading]    = useState(false)
  const [docType,      setDocType]      = useState('REGULATION')
  const [sector,       setSector]       = useState('')
  const [dragOver,     setDragOver]     = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter,   setTypeFilter]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevStatusRef = useRef<Record<string, string>>({})

  const refresh = useCallback(() => {
    return documentsApi.list(statusFilter || undefined, typeFilter || undefined)
      .then(newDocs => {
        // Detect status transitions for toast notifications
        for (const doc of newDocs) {
          const prev = prevStatusRef.current[doc.id]
          if (prev && prev !== doc.status) {
            if (doc.status === 'COMPLETED') {
              toast.success(`"${doc.fileName}" processed successfully.`)
            } else if (doc.status === 'FAILED') {
              toast.error(`"${doc.fileName}" processing failed.`)
            }
          }
        }
        // Update previous status map
        const map: Record<string, string> = {}
        for (const doc of newDocs) map[doc.id] = doc.status
        prevStatusRef.current = map

        setDocs(newDocs)
        return newDocs
      })
      .catch(() => {
        toast.error('Failed to load documents.')
        setDocs([])
        return [] as DocumentResponse[]
      })
      .finally(() => setLoading(false))
  }, [statusFilter, typeFilter])

  // Initial load + re-fetch when filters change
  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  // Polling: check every 3s if any docs are PENDING/PROCESSING
  useEffect(() => {
    const hasPending = docs.some(d => d.status === 'PENDING' || d.status === 'PROCESSING')

    if (hasPending && !pollRef.current) {
      pollRef.current = setInterval(() => { refresh() }, 3000)
    } else if (!hasPending && pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [docs, refresh])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      await documentsApi.upload(file, docType, sector || undefined)
      toast.success(`"${file.name}" uploaded successfully.`)
      refresh()
    } catch {
      toast.error('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) upload(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  return (
    <div className="p-10 space-y-10">

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-display text-stone-50">
          Documents
        </h1>
        <p className="text-zinc-500 text-sm mt-2">
          Upload regulatory filings, research reports, and news for RAG analysis
        </p>
      </div>

      {/* Upload area */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/50 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Upload Document
        </h2>

        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="doc-type" className="block text-xs text-zinc-500 mb-1.5 font-medium">
              Document Type
            </label>
            <select
              id="doc-type"
              className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-stone-50 text-sm
                         focus:outline-none focus:ring-1 focus:ring-amber-500/20 focus:border-amber-500/40
                         transition-all cursor-pointer"
              value={docType}
              onChange={e => setDocType(e.target.value)}
            >
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="doc-sector" className="block text-xs text-zinc-500 mb-1.5 font-medium">
              Sector <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              id="doc-sector"
              className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-stone-50 text-sm w-44
                         placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/20
                         focus:border-amber-500/40 transition-all"
              placeholder="e.g. Technology"
              value={sector}
              onChange={e => setSector(e.target.value)}
            />
          </div>
        </div>

        {/* Drop zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="File upload drop zone. Click or press Enter to browse."
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
          className={`
            relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
            transition-all duration-200
            ${dragOver
              ? 'border-amber-500 bg-amber-500/5 shadow-[0_0_24px_rgba(196,163,90,0.08)]'
              : 'border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-800/20'
            }
          `}
        >
          <motion.div
            animate={dragOver ? { scale: [1, 1.1, 1], opacity: [1, 0.7, 1] } : { scale: 1, opacity: 1 }}
            transition={dragOver ? { duration: 0.8, repeat: Infinity, ease: 'easeInOut' } : {}}
            className="inline-block"
          >
            <Upload
              size={36}
              className={`mx-auto mb-3 transition-colors duration-200 ${
                dragOver ? 'text-amber-400' : 'text-zinc-600'
              }`}
            />
          </motion.div>

          <p className={`text-sm font-medium transition-colors duration-200 ${
            dragOver ? 'text-amber-300' : uploading ? 'text-amber-400' : 'text-zinc-400'
          }`}>
            {uploading
              ? 'Uploading…'
              : dragOver
              ? 'Drop to upload'
              : 'Drop a file here or click to browse'}
          </p>
          <p className="text-zinc-600 text-xs mt-1.5">PDF, DOCX, TXT, MD supported</p>

          <div className="mt-5 inline-flex">
            <span className="px-4 py-1.5 rounded-lg text-xs font-semibold text-zinc-950 bg-amber-600">
              Browse Files
            </span>
          </div>

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={onFileChange}
            accept=".pdf,.docx,.txt,.md"
            aria-hidden="true"
          />
        </div>
      </div>

      {/* Filter chips */}
      <div className="space-y-3">
        <FilterChips label="Status" options={STATUSES} selected={statusFilter} onSelect={setStatusFilter} />
        <FilterChips label="Type" options={DOC_TYPES} selected={typeFilter} onSelect={setTypeFilter} />
      </div>

      {/* Document list */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Uploaded Documents
          <span className="ml-2 text-zinc-600 normal-case font-normal">({docs.length})</span>
        </h2>

        {loading ? (
          <DocumentListSkeleton />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={<File size={28} />}
            title="No documents match the current filters."
            description="Upload a document or adjust your filters."
          />
        ) : (
          <div className="space-y-2">
            {docs.map((d, i) => {
              const statusStyle = STATUS_STYLE[d.status] ?? STATUS_STYLE.FAILED
              const typeIcon    = DOC_TYPE_ICON[d.docType] ?? DOC_TYPE_ICON.OTHER

              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`
                    bg-zinc-900 rounded-xl border border-zinc-800/50
                    border-l-[3px] ${statusStyle.border}
                    px-5 py-3.5 flex items-center gap-4
                    hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                    hover:border-zinc-700/60 transition-all duration-200
                  `}
                >
                  <span className={`flex-shrink-0 ${typeIcon.color}`} aria-hidden="true">
                    {typeIcon.icon}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-zinc-200 text-sm font-medium truncate">{d.fileName}</p>
                    <p className="text-zinc-500 text-xs mt-0.5 truncate">
                      {d.docType} · {formatSize(d.fileSize)} · {d.regionId}
                      {d.sector     ? ` · ${d.sector}` : ''}
                      {d.chunkCount != null ? ` · ${d.chunkCount} chunks` : ''}
                    </p>
                  </div>

                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusStyle.badge}`}
                    aria-label={`Status: ${statusStyle.label}`}
                  >
                    <StatusIcon status={d.status} />
                    {statusStyle.label}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
