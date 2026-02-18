import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { documentsApi, type DocumentResponse } from '../api/documents'

const DOC_TYPES = ['REGULATION', 'RESEARCH', 'NEWS', 'EARNINGS', 'OTHER']

function StatusIcon({ status }: { status: string }) {
  if (status === 'PROCESSED') return <CheckCircle size={14} className="text-green-400" />
  if (status === 'PENDING') return <Clock size={14} className="text-yellow-400" />
  return <AlertCircle size={14} className="text-red-400" />
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState('REGULATION')
  const [sector, setSector] = useState('')
  const [dragOver, setDragOver] = useState(false)
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
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Documents</h1>
        <p className="text-gray-500 text-sm mt-1">Upload regulatory filings, research reports, and news for RAG analysis</p>
      </div>

      {/* Upload area */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-200">Upload Document</h2>

        <div className="flex gap-4 flex-wrap">
          <div>
            <label htmlFor="doc-type" className="block text-sm text-gray-400 mb-1">Document Type</label>
            <select
              id="doc-type"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              value={docType}
              onChange={e => setDocType(e.target.value)}
            >
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="doc-sector" className="block text-sm text-gray-400 mb-1">Sector (optional)</label>
            <input
              id="doc-sector"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-40"
              placeholder="e.g. Technology"
              value={sector}
              onChange={e => setSector(e.target.value)}
            />
          </div>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-900/10' : 'border-gray-700 hover:border-gray-500'
          }`}
        >
          <Upload size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm">
            {uploading ? 'Uploading...' : 'Drop a file here or click to browse'}
          </p>
          <p className="text-gray-600 text-xs mt-1">PDF, DOCX, TXT supported</p>
          <input ref={fileRef} type="file" className="hidden" onChange={onFileChange} accept=".pdf,.docx,.txt,.md" />
        </div>
      </div>

      {/* Document list */}
      <div>
        <h2 className="text-base font-semibold text-gray-200 mb-3">
          Uploaded Documents ({docs.length})
        </h2>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : docs.length === 0 ? (
          <p className="text-gray-600">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-3 flex items-center gap-4"
              >
                <FileText size={18} className="text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-sm font-medium truncate">{d.fileName}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {d.docType} · {formatSize(d.fileSize)} · {d.regionId}
                    {d.sector ? ` · ${d.sector}` : ''}
                    {d.chunkCount != null ? ` · ${d.chunkCount} chunks` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <StatusIcon status={d.status} />
                  {d.status}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
