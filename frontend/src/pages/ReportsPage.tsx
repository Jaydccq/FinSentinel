import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileDown,
  ShieldAlert,
  ShieldCheck,
  Clock,
  FileText,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  CheckCircle,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { portfolioApi, type PortfolioResponse, type RiskReportSummary } from '../api/portfolio'
import { downloadPdf } from '../api/reports'
import { ReportListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'

const LEVEL: Record<string, {
  border:       string
  scoreBg:      string
  scoreText:    string
  badgeBg:      string
  badgeText:    string
  badgeShadow:  string
  iconColor:    string
  chartColor:   string
}> = {
  LOW: {
    border:      'border-l-emerald-500',
    scoreBg:     'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
    scoreText:   'text-emerald-300',
    badgeBg:     'bg-emerald-500/15',
    badgeText:   'text-emerald-400',
    badgeShadow: 'shadow-emerald-500/20',
    iconColor:   'text-emerald-400',
    chartColor:  '#34d399',
  },
  MEDIUM: {
    border:      'border-l-yellow-500',
    scoreBg:     'linear-gradient(135deg, #451a03 0%, #78350f 100%)',
    scoreText:   'text-yellow-300',
    badgeBg:     'bg-yellow-500/15',
    badgeText:   'text-yellow-400',
    badgeShadow: 'shadow-yellow-500/20',
    iconColor:   'text-yellow-400',
    chartColor:  '#fbbf24',
  },
  HIGH: {
    border:      'border-l-orange-500',
    scoreBg:     'linear-gradient(135deg, #431407 0%, #7c2d12 100%)',
    scoreText:   'text-orange-300',
    badgeBg:     'bg-orange-500/15',
    badgeText:   'text-orange-400',
    badgeShadow: 'shadow-orange-500/20',
    iconColor:   'text-orange-400',
    chartColor:  '#fb923c',
  },
  CRITICAL: {
    border:      'border-l-red-500',
    scoreBg:     'linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%)',
    scoreText:   'text-red-300',
    badgeBg:     'bg-red-500/15',
    badgeText:   'text-red-400',
    badgeShadow: 'shadow-red-500/20',
    iconColor:   'text-red-400',
    chartColor:  '#f87171',
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function scoreColor(score: number): string {
  if (score <= 30) return 'text-emerald-400'
  if (score <= 50) return 'text-yellow-400'
  if (score <= 70) return 'text-orange-400'
  return 'text-red-400'
}

function ScoreTrendChart({ reports }: { reports: RiskReportSummary[] }) {
  const data = [...reports]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(r => ({
      date: shortDate(r.createdAt),
      score: r.riskScore,
      level: r.riskLevel,
    }))

  const latestLevel = data[data.length - 1]?.level ?? 'MEDIUM'
  const color = LEVEL[latestLevel]?.chartColor ?? '#fbbf24'

  return (
    <div className="surface-panel rounded-2xl p-5 mb-5">
      <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        Risk Score Trend
      </h3>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#6e819f' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#6e819f' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              fontSize: '12px',
              color: 'var(--text-primary)',
            }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, stroke: color, strokeWidth: 2, fill: 'var(--bg-panel)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function FactorBar({ category, score, description }: { category: string; score: number; description: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)]">{category}</span>
        <span className={`text-xs font-data font-bold ${scoreColor(score)}`}>{score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-full rounded-full"
          style={{
            background: score <= 30 ? '#34d399'
              : score <= 50 ? '#fbbf24'
              : score <= 70 ? '#fb923c'
              : '#f87171',
          }}
        />
      </div>
      <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{description}</p>
    </div>
  )
}

function FactorComparison({
  current,
  previous,
}: {
  current: RiskReportSummary
  previous: RiskReportSummary
}) {
  const prevMap = new Map(previous.factors.map(f => [f.category, f.score]))

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Change vs Previous</p>
      <div className="flex flex-wrap gap-2">
        {current.factors.map(f => {
          const prevScore = prevMap.get(f.category)
          if (prevScore === undefined) return null
          const diff = f.score - prevScore
          if (diff === 0) return null
          const isUp = diff > 0
          return (
            <span
              key={f.category}
              className={`status-chip border ${isUp ? 'bg-red-500/10 text-red-300 border-red-400/20' : 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20'}`}
            >
              {f.category}: {prevScore} → {f.score}
              {isUp ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
              {isUp ? '+' : ''}{diff}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [reports,    setReports]    = useState<RiskReportSummary[]>([])
  const [loading,    setLoading]    = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    portfolioApi.list().then(ps => {
      setPortfolios(ps)
      if (ps.length > 0) setSelectedId(ps[0].id)
    }).catch(() => toast.error('Failed to load portfolios.'))
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    setExpandedId(null)
    portfolioApi.listReports(selectedId)
      .then(setReports)
      .catch(() => {
        toast.error('Failed to load reports.')
        setReports([])
      })
      .finally(() => setLoading(false))
  }, [selectedId])

  const handleDownload = async (reportId: string) => {
    setDownloading(reportId)
    try {
      await downloadPdf(reportId)
      toast.success('PDF downloaded.')
    } catch {
      toast.error('Failed to download PDF.')
    } finally {
      setDownloading(null)
    }
  }

  // For factor comparison, sort reports chronologically
  const sortedByDate = [...reports].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )

  const getPreviousReport = (reportId: string): RiskReportSummary | null => {
    const idx = sortedByDate.findIndex(r => r.id === reportId)
    return idx > 0 ? sortedByDate[idx - 1] : null
  }

  return (
    <div className="p-10 space-y-10">

      {/* Page title */}
      <div>
        <h1 className="text-3xl font-display text-stone-50">
          Reports
        </h1>
        <p className="text-zinc-500 text-sm mt-2">
          View risk assessment details, track score trends, and download PDF reports
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

      {/* Score trend chart — shown when 2+ reports exist */}
      {!loading && reports.length >= 2 && (
        <ScoreTrendChart reports={reports} />
      )}

      {/* Reports list */}
      {loading ? (
        <ReportListSkeleton />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<FileText size={36} />}
          title="No risk reports yet"
          description="Run an assessment on the Analysis page to generate a report."
        />
      ) : (
        <div className="space-y-3">
          {reports.map((r, i) => {
            const lv = LEVEL[r.riskLevel] ?? LEVEL.CRITICAL
            const isLow = r.riskLevel === 'LOW' || r.riskLevel === 'MEDIUM'
            const isExpanded = expandedId === r.id
            const previousReport = getPreviousReport(r.id)

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`
                  bg-zinc-900 rounded-2xl border border-zinc-800/50
                  border-l-[3px] ${lv.border}
                  overflow-hidden
                  hover:border-zinc-700/60 transition-all duration-200
                `}
              >
                {/* Card header — always visible */}
                <div className="p-5 flex items-center gap-5">
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

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Expand/collapse toggle */}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      className="h-9 w-9 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                      aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                    >
                      <ChevronDown
                        size={16}
                        className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

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
                  </div>
                </div>

                {/* Expanded detail section */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-zinc-800/50 px-5 pb-5 pt-4 space-y-5">
                        {/* Risk Factors */}
                        {r.factors && r.factors.length > 0 && (
                          <div>
                            <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-3">
                              Risk Factors
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              {r.factors.map(f => (
                                <FactorBar key={f.category} {...f} />
                              ))}
                            </div>

                            {/* Factor comparison vs previous */}
                            {previousReport && (
                              <FactorComparison current={r} previous={previousReport} />
                            )}
                          </div>
                        )}

                        {/* Actionable Advice */}
                        {r.actionableAdvice && r.actionableAdvice.length > 0 && (
                          <div>
                            <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-2">
                              Actionable Advice
                            </h4>
                            <ul className="space-y-1.5">
                              {r.actionableAdvice.map((advice, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                                  <span className="text-amber-400 mt-0.5 flex-shrink-0">•</span>
                                  {advice}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Compliance Note */}
                        {r.complianceNote && (
                          <div className="surface-panel rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">
                              {r.complianceNote.isCompliant ? (
                                <CheckCircle size={14} className="text-emerald-400" />
                              ) : (
                                <XCircle size={14} className="text-red-400" />
                              )}
                              <span className={`text-xs font-semibold ${
                                r.complianceNote.isCompliant ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {r.complianceNote.isCompliant ? 'Compliant' : 'Non-Compliant'}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)]">
                                ({r.complianceNote.regulatoryFramework})
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                              {r.complianceNote.disclaimer}
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}
