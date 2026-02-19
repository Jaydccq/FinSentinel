import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, CheckCircle, Clock, AlertCircle, File, BookOpen, Newspaper, BarChart2, FolderOpen } from 'lucide-react'
import { documentsApi, type DocumentResponse } from '../api/documents'

const DOC_TYPES = ['REGULATION', 'RESEARCH', 'NEWS', 'EARNINGS', 'OTHER']

// Status styling: border color + badge color
const STATUS_STYLE: Record<string, { border: string; badge: string; label: string }> = {
  COMPLETED: {
    border: 'border-l-green-500',
    badge: 'bg-green-500/15 text-green-400',
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

// Doc type icon + color
const DOC_TYPE_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  REGULATION: { icon: <BookOpen size={16} />, color: 'text-emerald-400' },
  RESEARCH:   { icon: <BarChart2 size={16} />, color: 'text-blue-400' },
  NEWS:       { icon: <Newspaper size={16} />, color: 'text-purple-400' },
  EARNINGS:   { icon: <FileText size={16} />, color: 'text-orange-400' },
  OTHER:      { icon: <FolderOpen size={16} />, color: 'text-gray-400' },
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'COMPLETED')  return <CheckCircle size={13} className="text-green-400" />
  if (status === 'PROCESSING') return <Clock       size={13} className="text-blue-400" />
  if (status === 'PENDING')    return <Clock       size={13} className="text-yellow-400" />
  return                              <AlertCircle  size={13} className="text-red-400" />
}

function formatSize(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`
  if (bytes < 1024 * 1024)    return `${(bytes / 1024).toFixed(1)} KB`
  return                              `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs,      setDocs]      = useState<DocumentResponse[]>([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [docType,   setDocType]   = useState('REGULATION')
  const [sector,    setSector]    = useState('')
  const [dragOver,  setDragOver]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    documentsApi.list().then(setDocs).finally(() => setLoading(false))

  useEffect(() => { refresh() }, [])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      await documentsApi.upload(file, docType, sector || undefined)
      refresh()
    } catch {
      alert('Upload failed')
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
    <div className="p-8 space-y-8">

      {/* Page title with gradient underline */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100 inline-block">
          Documents
          <span
            className="block mt-1 h-0.5 w-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)' }}
            aria-hidden="true"
          />
        </h1>
        <p className="text-gray-500 text-sm mt-2">
          Upload regulatory filings, research reports, and news for RAG analysis
        </p>
      </div>

      {/* Upload area */}
      <div className="bg-gray-900/70 rounded-2xl border border-gray-800/60 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Upload Document
        </h2>

        {/* Controls row */}
        <div className="flex gap-4 flex-wrap">
          {/* Document type selector */}
          <div>
            <label htmlFor="doc-type" className="block text-xs text-gray-500 mb-1.5 font-medium">
              Document Type
            </label>
            <select
              id="doc-type"
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-gray-100 text-sm
                         focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/50
                         transition-all cursor-pointer"
              value={docType}
              onChange={e => setDocType(e.target.value)}
            >
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Sector input */}
          <div>
            <label htmlFor="doc-sector" className="block text-xs text-gray-500 mb-1.5 font-medium">
              Sector <span className="text-gray-600">(optional)</span>
            </label>
            <input
              id="doc-sector"
              className="bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-gray-100 text-sm w-44
                         placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/30
                         focus:border-blue-500/50 transition-all"
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
              ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_24px_rgba(59,130,246,0.10)]'
              : 'border-gray-700/70 hover:border-gray-600 hover:bg-gray-800/30'
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
                dragOver ? 'text-blue-400' : 'text-gray-600'
              }`}
            />
          </motion.div>

          <p className={`text-sm font-medium transition-colors duration-200 ${
            dragOver ? 'text-blue-300' : uploading ? 'text-blue-400' : 'text-gray-400'
          }`}>
            {uploading
              ? 'Uploading…'
              : dragOver
              ? 'Drop to upload'
              : 'Drop a file here or click to browse'}
          </p>
          <p className="text-gray-600 text-xs mt-1.5">PDF, DOCX, TXT, MD supported</p>

          {/* Gradient upload button */}
          <div className="mt-5 inline-flex">
            <span
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white pointer-events-none"
              style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)' }}
            >
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

      {/* Document list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Uploaded Documents
          <span className="ml-2 text-gray-600 normal-case font-normal">({docs.length})</span>
        </h2>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-800 p-10 text-center">
            <File size={28} className="mx-auto text-gray-700 mb-2" />
            <p className="text-gray-600 text-sm">No documents uploaded yet.</p>
          </div>
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
                    bg-gray-900/70 rounded-xl border border-gray-800/60
                    border-l-[3px] ${statusStyle.border}
                    px-5 py-3.5 flex items-center gap-4
                    hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                    hover:border-gray-700/80 transition-all duration-200
                  `}
                >
                  {/* Doc type icon */}
                  <span className={`flex-shrink-0 ${typeIcon.color}`} aria-hidden="true">
                    {typeIcon.icon}
                  </span>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-200 text-sm font-medium truncate">{d.fileName}</p>
                    <p className="text-gray-500 text-xs mt-0.5 truncate">
                      {d.docType} · {formatSize(d.fileSize)} · {d.regionId}
                      {d.sector     ? ` · ${d.sector}` : ''}
                      {d.chunkCount != null ? ` · ${d.chunkCount} chunks` : ''}
                    </p>
                  </div>

                  {/* Status badge */}
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
