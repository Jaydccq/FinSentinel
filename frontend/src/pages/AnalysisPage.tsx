import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { chatApi, type RiskReport } from '../api/chat'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'

const LEVEL_STYLES: Record<string, { text: string; chip: string; bg: string; icon: string; border: string }> = {
  LOW: {
    text: 'text-[var(--up)]',
    chip: 'bg-green-500/20 text-[var(--up)] border-green-300/30',
    bg: 'bg-green-500/8',
    icon: 'text-[var(--up)]',
    border: 'border-status-up',
  },
  MEDIUM: {
    text: 'text-[var(--warn)]',
    chip: 'bg-yellow-500/20 text-[var(--warn)] border-yellow-300/30',
    bg: 'bg-yellow-500/8',
    icon: 'text-[var(--warn)]',
    border: 'border-status-warn',
  },
  HIGH: {
    text: 'text-orange-200',
    chip: 'bg-orange-500/20 text-orange-100 border-orange-300/30',
    bg: 'bg-orange-500/8',
    icon: 'text-orange-200',
    border: 'border-status-warn',
  },
  CRITICAL: {
    text: 'text-[var(--down)]',
    chip: 'bg-red-500/20 text-[var(--down)] border-red-300/30',
    bg: 'bg-red-500/8',
    icon: 'text-[var(--down)]',
    border: 'border-status-down',
  },
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-30" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function AnalysisPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [query, setQuery] = useState('Analyze my portfolio risk and provide a full assessment')
  const [report, setReport] = useState<RiskReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    portfolioApi.list().then(items => {
      setPortfolios(items)
      if (items.length > 0) setSelectedId(items[0].id)
    })
  }, [])

  const runAssessment = async () => {
    setLoading(true)
    setError('')

    try {
      const result = await chatApi.assess(query, selectedId || undefined)
      setReport(result)
    } catch {
      setError('Assessment failed. Ensure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const radarData = useMemo(
    () => report?.factors?.map(f => ({ subject: f.category, score: f.score })) ?? [],
    [report],
  )

  const styles = report ? (LEVEL_STYLES[report.riskLevel] ?? LEVEL_STYLES.MEDIUM) : null
  const isHighRisk = report && (report.riskLevel === 'HIGH' || report.riskLevel === 'CRITICAL')

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
      <section className="glass-panel rounded p-3 md:p-4">
        <p className="text-xs uppercase tracking-[0.13em] text-blue-200/80">AI Assessment</p>
        <h1 className="page-title mt-2">Risk Analysis</h1>
        <p className="page-subtitle max-w-2xl">Generate a structured risk report with score decomposition, recommendations, and compliance context.</p>
      </section>

      <section className="surface-panel rounded p-3 md:p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-3">
          <div>
            <label htmlFor="analysis-portfolio" className="field-label">Portfolio Scope</label>
            <select
              id="analysis-portfolio"
              className="field-input"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">No portfolio (general)</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="analysis-query" className="field-label">Prompt</label>
            <input
              id="analysis-query"
              className="field-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={runAssessment} disabled={loading} className="btn-primary px-5 py-2 text-sm">
            {loading && <Spinner />}
            {loading ? 'Analyzing...' : 'Run Assessment'}
          </button>
          <span className="status-chip bg-cyan-500/10 border-cyan-400/25 text-cyan-100">
            <Sparkles size={12} />
            LLM + tools
          </span>
        </div>

        {error && <p className="text-sm text-[var(--down)]">{error}</p>}
      </section>

      {report && styles && (
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          {/* Risk Score Banner — flat colored bg, left border indicator */}
          <div className={`surface-panel rounded p-4 md:p-5 border-l-2 ${styles.border} ${styles.bg}`}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-3 min-w-[240px]">
                <div className="h-10 w-10 rounded bg-white/5 border border-white/10 flex items-center justify-center">
                  {isHighRisk ? (
                    <ShieldAlert size={22} className={styles.icon} aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={22} className={styles.icon} aria-hidden="true" />
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-[0.11em] text-[var(--text-muted)]">Risk Score</p>
                  <div className="flex items-end gap-3 mt-0.5">
                    <p className={`kpi-value text-3xl md:text-4xl ${styles.text}`}>
                      {report.riskScore}
                      <span className="text-xl text-[var(--text-muted)]">/100</span>
                    </p>
                    <span className={`status-chip border ${styles.chip}`}>{report.riskLevel}</span>
                  </div>
                </div>
              </div>

              <div className="section-divider lg:hidden" />

              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{report.summary}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
            <div className="surface-panel rounded p-4 md:p-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Risk Factor Radar</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">Relative score by risk dimension</p>

              {radarData.length > 0 ? (
                <div className="mt-4 h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#333336" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#a7bad5', fontSize: 11 }} />
                      <Radar name="Risk" dataKey="score" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.22} />
                      <Tooltip
                        contentStyle={{
                          background: '#111113',
                          border: '1px solid #252528',
                          borderRadius: 4,
                          color: '#ecf3ff',
                        }}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-4 text-sm text-[var(--text-muted)]">No factor data available.</p>
              )}
            </div>

            <div className="surface-panel rounded p-4 md:p-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Actionable Recommendations</h2>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">Priority-ordered next steps</p>

              <ol className="mt-3 space-y-2">
                {report.actionableAdvice?.length ? report.actionableAdvice.map((advice, i) => (
                  <li key={i} className="rounded border border-[color:var(--border-subtle)] bg-slate-900/30 px-3 py-2.5 flex gap-3">
                    <span className="h-5 w-5 rounded bg-blue-400/20 text-blue-100 inline-flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-[var(--text-secondary)] leading-relaxed">{advice}</span>
                  </li>
                )) : (
                  <li className="text-sm text-[var(--text-muted)]">No recommendations available.</li>
                )}
              </ol>
            </div>
          </div>

          {report.factors?.length > 0 && (
            <div className="surface-panel rounded p-4 md:p-5">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Factor Detail</h2>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {report.factors.map((factor, i) => (
                  <div key={`${factor.category}-${i}`} className="rounded border border-[color:var(--border-subtle)] bg-slate-900/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{factor.category}</p>
                      <span className="status-chip bg-slate-800/60 text-[var(--text-secondary)] border-[color:var(--border-subtle)]">
                        {factor.score}/100
                      </span>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed">{factor.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </motion.section>
      )}
    </div>
  )
}
