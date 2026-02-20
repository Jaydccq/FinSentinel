import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, ShieldAlert, ShieldCheck, Clock, FileText } from 'lucide-react'
import { portfolioApi, type PortfolioResponse, type RiskReportSummary } from '../api/portfolio'
import { downloadPdf } from '../api/reports'

const LEVEL: Record<string, {
  border:       string
  scoreBg:      string
  scoreText:    string
  badgeBg:      string
  badgeText:    string
  badgeShadow:  string
  iconColor:    string
}> = {
  LOW: {
    border:      'border-l-emerald-500',
    scoreBg:     'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
    scoreText:   'text-emerald-300',
    badgeBg:     'bg-emerald-500/15',
    badgeText:   'text-emerald-400',
    badgeShadow: 'shadow-emerald-500/20',
    iconColor:   'text-emerald-400',
  },
  MEDIUM: {
    border:      'border-l-yellow-500',
    scoreBg:     'linear-gradient(135deg, #451a03 0%, #78350f 100%)',
    scoreText:   'text-yellow-300',
    badgeBg:     'bg-yellow-500/15',
    badgeText:   'text-yellow-400',
    badgeShadow: 'shadow-yellow-500/20',
    iconColor:   'text-yellow-400',
  },
  HIGH: {
    border:      'border-l-orange-500',
    scoreBg:     'linear-gradient(135deg, #431407 0%, #7c2d12 100%)',
    scoreText:   'text-orange-300',
    badgeBg:     'bg-orange-500/15',
    badgeText:   'text-orange-400',
    badgeShadow: 'shadow-orange-500/20',
    iconColor:   'text-orange-400',
  },
  CRITICAL: {
    border:      'border-l-red-500',
    scoreBg:     'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)',
    scoreText:   'text-red-300',
    badgeBg:     'bg-red-500/15',
    badgeText:   'text-red-400',
    badgeShadow: 'shadow-red-500/20',
    iconColor:   'text-red-400',
  },
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)  return `${diffDays} days ago`

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ReportsPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [reports,    setReports]    = useState<RiskReportSummary[]>([])
  const [loading,    setLoading]    = useState(false)
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
    <div className="p-10 space-y-10">

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-display text-stone-50">
          Reports
        </h1>
        <p className="text-zinc-500 text-sm mt-2">
          Download PDF risk assessment reports for your portfolios
        </p>
      </div>

      {/* Portfolio selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="reports-portfolio" className="text-zinc-400 text-sm font-medium">
          Portfolio
        </label>
        <select
          id="reports-portfolio"
          className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-stone-50 text-sm
                     focus:outline-none focus:ring-1 focus:ring-amber-500/20 focus:border-amber-500/40
                     transition-all cursor-pointer"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Reports list */}
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading reports…</p>
      ) : reports.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/60 border border-dashed border-zinc-800/50 rounded-2xl p-16 text-center"
        >
          <FileText size={36} className="mx-auto text-zinc-700 mb-4" />
          <p className="text-zinc-400 font-medium">No risk reports yet</p>
          <p className="text-zinc-600 text-sm mt-1.5">
            Run an assessment on the Analysis page to generate a report.
          </p>
        </motion.div>
      ) : (
        <div className="space-y-3">
          {reports.map((r, i) => {
            const lv = LEVEL[r.riskLevel] ?? LEVEL.CRITICAL
            const isLow = r.riskLevel === 'LOW' || r.riskLevel === 'MEDIUM'

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`
                  bg-zinc-900 rounded-2xl border border-zinc-800/50
                  border-l-[3px] ${lv.border}
                  p-5 flex items-center gap-5
                  hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                  hover:border-zinc-700/60 transition-all duration-200
                `}
              >
                {/* Circular risk score badge */}
                <div
                  className="flex-shrink-0 w-14 h-14 rounded-full flex flex-col items-center justify-center"
                  style={{ background: lv.scoreBg }}
                  aria-label={`Risk score: ${r.riskScore} out of 100`}
                >
                  <span className={`text-xl font-bold font-data leading-none ${lv.scoreText}`}>
                    {r.riskScore}
                  </span>
                  <span className="text-zinc-500 text-[9px] font-medium tracking-wide mt-0.5">/100</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span aria-hidden="true" className={lv.iconColor}>
                      {isLow ? <ShieldCheck size={15} /> : <ShieldAlert size={15} />}
                    </span>
                    <span
                      className={`
                        px-2 py-0.5 rounded-full text-xs font-semibold
                        shadow-md ${lv.badgeShadow}
                        ${lv.badgeBg} ${lv.badgeText}
                      `}
                    >
                      {r.riskLevel}
                    </span>
                  </div>

                  <p className="text-zinc-400 text-sm line-clamp-2">{r.summary}</p>

                  {r.createdAt && (
                    <p className="text-zinc-500 text-xs flex items-center gap-1 mt-1.5">
                      <Clock size={11} aria-hidden="true" />
                      <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>
                    </p>
                  )}
                </div>

                {/* PDF download button */}
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleDownload(r.id)}
                  disabled={downloading === r.id}
                  aria-label={`Download PDF report — risk score ${r.riskScore}`}
                  className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-zinc-950 px-4 py-2 rounded-lg text-sm font-semibold
                             disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0
                             transition-all duration-200"
                >
                  <FileDown size={15} aria-hidden="true" />
                  {downloading === r.id ? 'Downloading…' : 'PDF'}
                </motion.button>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
