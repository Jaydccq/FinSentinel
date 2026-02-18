import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, ShieldAlert, ShieldCheck, Calendar } from 'lucide-react'
import { portfolioApi, type PortfolioResponse, type RiskReportSummary } from '../api/portfolio'
import { downloadPdf } from '../api/reports'

const LEVEL_COLOR: Record<string, string> = {
  LOW: 'text-green-400 bg-green-900/20 border-green-800',
  MEDIUM: 'text-yellow-400 bg-yellow-900/20 border-yellow-800',
  HIGH: 'text-orange-400 bg-orange-900/20 border-orange-800',
  CRITICAL: 'text-red-400 bg-red-900/20 border-red-800',
}

export default function ReportsPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [reports, setReports] = useState<RiskReportSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    portfolioApi.list().then(ps => {
      setPortfolios(ps)
      if (ps.length > 0) setSelectedId(ps[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    portfolioApi.listReports(selectedId)
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false))
  }, [selectedId])

  const handleDownload = async (reportId: string) => {
    setDownloading(reportId)
    try {
      await downloadPdf(reportId)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Risk Reports</h1>
        <p className="text-gray-500 text-sm mt-1">Download PDF risk assessment reports for your portfolios</p>
      </div>

      {/* Portfolio selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="reports-portfolio" className="text-gray-400 text-sm">Portfolio:</label>
        <select
          id="reports-portfolio"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Reports list */}
      {loading ? (
        <p className="text-gray-500">Loading reports...</p>
      ) : reports.length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400">No risk reports yet for this portfolio.</p>
          <p className="text-gray-600 text-sm mt-2">Run an assessment on the Analysis page to generate a report.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex items-center gap-5"
            >
              <div>
                {r.riskLevel === 'LOW' || r.riskLevel === 'MEDIUM'
                  ? <ShieldCheck size={32} className={r.riskLevel === 'LOW' ? 'text-green-400' : 'text-yellow-400'} />
                  : <ShieldAlert size={32} className={r.riskLevel === 'HIGH' ? 'text-orange-400' : 'text-red-400'} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${LEVEL_COLOR[r.riskLevel] ?? 'text-gray-400 bg-gray-800 border-gray-700'}`}>
                    {r.riskLevel}
                  </span>
                  <span className="text-gray-100 font-bold text-lg">{r.riskScore}/100</span>
                </div>
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{r.summary}</p>
                {r.createdAt && (
                  <p className="text-gray-600 text-xs flex items-center gap-1 mt-1">
                    <Calendar size={11} /> {new Date(r.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => handleDownload(r.id)}
                disabled={downloading === r.id}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0"
              >
                <FileDown size={16} />
                {downloading === r.id ? 'Downloading...' : 'PDF'}
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
