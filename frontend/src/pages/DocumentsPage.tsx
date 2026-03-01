import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, CheckCircle, Clock, AlertCircle, File, BookOpen, Newspaper, BarChart2, FolderOpen, Download, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import Pagination from '../components/Pagination'
import { documentsApi, type DocumentResponse } from '../api/documents'
import { DocumentListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const DOC_TYPES = ['REGULATION', 'RESEARCH', 'NEWS', 'EARNINGS', 'OTHER']
const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']

const STATUS_STYLE: Record<string, { border: string; badge: string; label: string }> = {
  COMPLETED: {
    border: 'border-l-emerald-500',
    badge:  'bg-emerald-500/15 text-emerald-400',
    label:  'Completed',
  },
  PROCESSING: {
    border: 'border-l-blue-500',
    badge:  'bg-blue-500/15 text-blue-400',
    label:  'Processing',
  },
  PENDING: {
    border: 'border-l-yellow-500',
    badge:  'bg-yellow-500/15 text-yellow-400',
    label:  'Pending',
  },
  FAILED: {
    border: 'border-l-red-500',
    badge:  'bg-red-500/15 text-red-400',
    label:  'Failed',
  },
}

const DOC_TYPE_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  REGULATION: { icon: <BookOpen size={16} />, color: 'text-emerald-400' },
  RESEARCH:   { icon: <BarChart2 size={16} />, color: 'text-blue-400' },
  NEWS:       { icon: <Newspaper size={16} />, color: 'text-purple-400' },
  EARNINGS:   { icon: <FileText size={16} />, color: 'text-orange-400' },
  OTHER:      { icon: <FolderOpen size={16} />, color: 'text-[var(--text-secondary)]' },
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED')  return <CheckCircle size={13} className="text-emerald-400" />
  if (status === 'PROCESSING') return <Clock       size={13} className="text-blue-400" />
  if (status === 'PENDING')    return <Clock       size={13} className="text-yellow-400" />
  return                              <AlertCircle  size={13} className="text-red-400" />
}

function formatSize(bytes: number): string {
  if (bytes < 1024)           return `${bytes} B`
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(1)} KB`
  return                             `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
            ? 'bg-[var(--accent)]/15 border-[var(--accent)]/30 text-blue-100'
            : 'bg-[var(--bg-elevated)] border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
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
              ? 'bg-[var(--accent)]/15 border-[var(--accent)]/30 text-blue-100'
              : 'bg-[var(--bg-elevated)] border-[color:var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

export default function DocumentsPage() {
  const [docs,          setDocs]          = useState<DocumentResponse[]>([])
  const [loading,       setLoading]       = useState(true)
  const [uploading,     setUploading]     = useState(false)
  const [docType,       setDocType]       = useState('REGULATION')
  const [sector,        setSector]        = useState('')
  const [dragOver,      setDragOver]      = useState(false)
  const [statusFilter,  setStatusFilter]  = useState('')
  const [typeFilter,    setTypeFilter]    = useState('')
  const [page,          setPage]          = useState(0)
  const [pageSize,      setPageSize]      = useState(20)
  const [totalPages,    setTotalPages]    = useState(0)
  const [totalElements, setTotalElements] = useState(0)
  const fileRef    = useRef<HTMLInputElement>(null)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const prevStatusRef = useRef<Record<string, string>>({})

  const refresh = useCallback(() => {
    return documentsApi.list(page, pageSize, statusFilter || undefined, typeFilter || undefined)
      .then(result => {
        // Detect status transitions for toast notifications
        for (const doc of result.content) {
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
        for (const doc of result.content) map[doc.id] = doc.status
        prevStatusRef.current = map

        setDocs(result.content)
        setTotalPages(result.totalPages)
        setTotalElements(result.totalElements)
        return result.content
      })
      .catch(() => {
        toast.error('Failed to load documents.')
        setDocs([])
        return [] as DocumentResponse[]
      })
      .finally(() => setLoading(false))
  }, [page, pageSize, statusFilter, typeFilter])

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

  const downloadDoc = async (id: string) => {
    try {
      await documentsApi.download(id)
      toast.success('Download started.')
    } catch {
      toast.error('Download failed.')
    }
  }

  const deleteDoc = async (id: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return
    try {
      await documentsApi.delete(id)
      toast.success('Document deleted.')
      refresh()
    } catch {
      toast.error('Failed to delete document.')
    }
  }

  const handleStatusFilter = (v: string) => { setStatusFilter(v); setPage(0) }
  const handleTypeFilter   = (v: string) => { setTypeFilter(v);   setPage(0) }

  return (
    <div className="p-10 space-y-10">

      {/* Page title */}
      <div>
        <h1 className="text-3xl text-[var(--text-primary)]">
          Documents
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-2">
          Upload regulatory filings, research reports, and news for RAG analysis
        </p>
      </div>

      {/* Upload area */}
      <div className="bg-[var(--bg-panel)] rounded border border-[var(--border-subtle)] p-6 space-y-5">
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Upload Document
        </h2>

        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="doc-type" className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">
              Document Type
            </label>
            <select
              id="doc-type"
              className="bg-[var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded px-3 py-2 text-[var(--text-primary)] text-sm
                         focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)]/40
                         transition-colors cursor-pointer"
              value={docType}
              onChange={e => setDocType(e.target.value)}
            >
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="doc-sector" className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">
              Sector <span className="text-[var(--text-muted)] opacity-60">(optional)</span>
            </label>
            <input
              id="doc-sector"
              className="bg-[var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded px-3 py-2 text-[var(--text-primary)] text-sm w-44
                         placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]/20
                         focus:border-[var(--accent)]/40 transition-colors"
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
            relative border-2 border-dashed rounded p-12 text-center cursor-pointer
            transition-colors duration-200
            ${dragOver
              ? 'border-[var(--accent)] bg-[var(--accent)]/5'
              : 'border-[color:var(--border-subtle)] hover:border-[color:var(--border-strong)] hover:bg-[var(--bg-elevated)]'
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
                dragOver ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'
              }`}
            />
          </motion.div>

          <p className={`text-sm font-medium transition-colors duration-200 ${
            dragOver ? 'text-blue-300' : uploading ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'
          }`}>
            {uploading
              ? 'Uploading...'
              : dragOver
              ? 'Drop to upload'
              : 'Drop a file here or click to browse'}
          </p>
          <p className="text-[var(--text-muted)] text-xs mt-1.5">PDF, DOCX, TXT, MD supported</p>

          <div className="mt-5 inline-flex">
            <span className="px-4 py-1.5 rounded text-xs font-semibold text-white bg-[var(--accent)] hover:bg-blue-500 transition-colors">
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
        <FilterChips label="Status" options={STATUSES} selected={statusFilter} onSelect={handleStatusFilter} />
        <FilterChips label="Type"   options={DOC_TYPES} selected={typeFilter}   onSelect={handleTypeFilter} />
      </div>

      {/* Document list */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">
          Uploaded Documents
          <span className="ml-2 text-[var(--text-muted)] normal-case font-normal">({totalElements})</span>
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
                    bg-[var(--bg-panel)] rounded border border-[color:var(--border-subtle)]
                    border-l-[3px] ${statusStyle.border}
                    px-5 py-3.5 flex items-center gap-4
                    hover:border-[color:var(--border-strong)] transition-colors duration-200
                  `}
                >
                  <span className={`flex-shrink-0 ${typeIcon.color}`} aria-hidden="true">
                    {typeIcon.icon}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-primary)] text-sm font-medium truncate">{d.fileName}</p>
                    <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate">
                      {d.docType} · {formatSize(d.fileSize)} · {d.regionId}
                      {d.sector     ? ` · ${d.sector}` : ''}
                      {d.chunkCount != null ? ` · ${d.chunkCount} chunks` : ''}
                    </p>
                  </div>

                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${statusStyle.badge}`}
                    aria-label={`Status: ${statusStyle.label}`}
                  >
                    <StatusIcon status={d.status} />
                    {statusStyle.label}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {d.status === 'COMPLETED' && (
                      <button
                        onClick={() => downloadDoc(d.id)}
                        aria-label={`Download ${d.fileName}`}
                        className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-emerald-200 hover:bg-emerald-500/15 transition-colors"
                      >
                        <Download size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteDoc(d.id)}
                      aria-label={`Delete ${d.fileName}`}
                      className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-red-200 hover:bg-red-500/15 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {!loading && docs.length > 0 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            totalElements={totalElements}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={s => { setPageSize(s); setPage(0) }}
          />
        )}
      </div>
    </div>
  )
}
