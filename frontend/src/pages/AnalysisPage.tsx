import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'
import { chatApi, type RiskReport } from '../api/chat'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { ShieldAlert, ShieldCheck } from 'lucide-react'

// Per-level styling maps
const LEVEL_TEXT_COLOR: Record<string, string> = {
  LOW:      'text-emerald-400',
  MEDIUM:   'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-400',
}

const LEVEL_BANNER_GRADIENT: Record<string, string> = {
  LOW:      'from-emerald-900/40 via-gray-900 to-gray-900 border-emerald-700/30',
  MEDIUM:   'from-yellow-900/40 via-gray-900 to-gray-900 border-yellow-700/30',
  HIGH:     'from-orange-900/40 via-gray-900 to-gray-900 border-orange-700/30',
  CRITICAL: 'from-red-900/50 via-gray-900 to-gray-900 border-red-700/30',
}

const LEVEL_PILL: Record<string, string> = {
  LOW:      'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  MEDIUM:   'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30',
  HIGH:     'bg-orange-500/15 text-orange-300 border border-orange-500/30',
  CRITICAL: 'bg-red-500/15 text-red-300 border border-red-500/30',
}

const LEVEL_SHIELD_COLOR: Record<string, string> = {
  LOW:      'text-emerald-400',
  MEDIUM:   'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-400',
}

// Spinner SVG used in the loading state of the Run Assessment button
function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-white"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

export default function AnalysisPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [query, setQuery] = useState('Analyze my portfolio risk and provide a full assessment')
  const [report, setReport] = useState<RiskReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    portfolioApi.list().then(ps => {
      setPortfolios(ps)
      if (ps.length > 0) setSelectedId(ps[0].id)
    })
  }, [])

  const runAssessment = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await chatApi.assess(query, selectedId || undefined)
      setReport(r)
    } catch {
      setError('Assessment failed. Ensure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const radarData = report?.factors?.map(f => ({ subject: f.category, score: f.score })) ?? []

  const bannerGradient = report ? (LEVEL_BANNER_GRADIENT[report.riskLevel] ?? 'from-gray-900 to-gray-900 border-gray-700') : ''
  const shieldColor    = report ? (LEVEL_SHIELD_COLOR[report.riskLevel]    ?? 'text-gray-400')                              : ''
  const levelTextColor = report ? (LEVEL_TEXT_COLOR[report.riskLevel]      ?? 'text-gray-100')                              : ''
  const pillClass      = report ? (LEVEL_PILL[report.riskLevel]            ?? 'bg-gray-700/50 text-gray-300')               : ''
  const isHighRisk     = report && (report.riskLevel === 'HIGH' || report.riskLevel === 'CRITICAL')

  return (
    <div className="p-8 space-y-6">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Risk Analysis</h1>
        {/* Gradient underline bar decoration */}
        <div className="mt-1.5 h-0.5 w-28 rounded-full bg-gradient-to-r from-blue-500 to-transparent" />
        <p className="text-gray-500 text-sm mt-2">AI-powered structured risk assessment with radar visualization</p>
      </div>

      {/* Controls panel */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="analysis-portfolio" className="block text-sm text-gray-400 mb-1">Portfolio</label>
            <select
              id="analysis-portfolio"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">No portfolio (general)</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[300px]">
            <label htmlFor="analysis-query" className="block text-sm text-gray-400 mb-1">Assessment Query</label>
            <input
              id="analysis-query"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Run Assessment button with gradient and loading spinner */}
        <button
          onClick={runAssessment}
          disabled={loading}
          className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/30"
        >
          {loading && <Spinner />}
          {loading ? 'Analyzing...' : 'Run Assessment'}
        </button>

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {report && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Risk score banner — gradient shifts with risk level */}
          <div className={`bg-gradient-to-r ${bannerGradient} rounded-xl border p-6 flex items-center gap-6`}>
            <div className="flex-shrink-0">
              {isHighRisk
                ? <ShieldAlert size={48} className={shieldColor} />
                : <ShieldCheck size={48} className={shieldColor} />
              }
            </div>
            <div className="flex-shrink-0">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Risk Score</p>
              <div className="flex items-baseline gap-3">
                <p className={`text-5xl font-bold tabular-nums ${levelTextColor}`}>
                  {report.riskScore}
                  <span className="text-2xl text-gray-500">/100</span>
                </p>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${pillClass}`}>
                  {report.riskLevel}
                </span>
              </div>
            </div>
            <div className="flex-1 border-l border-gray-700/60 pl-6">
              <p className="text-gray-300 text-sm leading-relaxed">{report.summary}</p>
            </div>
          </div>

          {/* Radar chart with glow border */}
          {radarData.length > 0 && (
            <div className="bg-gray-900/50 rounded-xl border border-blue-500/20 p-6 shadow-lg shadow-blue-900/10">
              <h2 className="text-lg font-semibold text-gray-200 mb-4">Risk Factor Radar</h2>
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Radar
                    name="Risk Score"
                    dataKey="score"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                  />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#d1d5db' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Actionable Recommendations */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-4">Actionable Recommendations</h2>
            <ol className="space-y-3">
              {report.actionableAdvice?.map((a, i) => (
                <li key={i} className="flex gap-4 items-start border-l-2 border-blue-500/20 pl-4 py-1">
                  {/* Numbered blue gradient circle badge */}
                  <span
                    className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center text-xs font-bold text-white shadow-md shadow-blue-900/40"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="text-gray-300 text-sm leading-relaxed">{a}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Compliance note — amber tinted */}
          {report.complianceNote && (
            <div
              className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5 flex gap-3"
              role="note"
              aria-label="Compliance notice"
            >
              <ShieldAlert size={18} className="text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-amber-400/80 text-xs font-semibold uppercase tracking-wider mb-1.5">
                  {report.complianceNote.regulatoryFramework} Compliance Notice
                </p>
                <p className="text-amber-300/60 text-xs leading-relaxed">{report.complianceNote.disclaimer}</p>
              </div>
            </div>
          )}

        </motion.div>
      )}
    </div>
  )
}
