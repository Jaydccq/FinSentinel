import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'
import { chatApi, type RiskReport } from '../api/chat'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { ShieldAlert, ShieldCheck } from 'lucide-react'

const LEVEL_COLOR: Record<string, string> = {
  LOW: 'text-green-400',
  MEDIUM: 'text-yellow-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-400',
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

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Risk Analysis</h1>
        <p className="text-gray-500 text-sm mt-1">AI-powered structured risk assessment with radar visualization</p>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="analysis-portfolio" className="block text-sm text-gray-400 mb-1">Portfolio</label>
            <select
              id="analysis-portfolio"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
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
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={runAssessment}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Analyzing...' : 'Run Assessment'}
        </button>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Score banner */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 flex items-center gap-6">
            <div>
              {report.riskLevel === 'LOW' || report.riskLevel === 'MEDIUM'
                ? <ShieldCheck size={48} className="text-green-400" />
                : <ShieldAlert size={48} className="text-red-400" />
              }
            </div>
            <div>
              <p className="text-gray-400 text-sm">Risk Score</p>
              <p className={`text-5xl font-bold ${LEVEL_COLOR[report.riskLevel] ?? 'text-gray-100'}`}>
                {report.riskScore}<span className="text-2xl text-gray-500">/100</span>
              </p>
              <p className={`text-lg font-semibold mt-1 ${LEVEL_COLOR[report.riskLevel] ?? 'text-gray-100'}`}>
                {report.riskLevel}
              </p>
            </div>
            <div className="flex-1 border-l border-gray-700 pl-6">
              <p className="text-gray-300 text-sm leading-relaxed">{report.summary}</p>
            </div>
          </div>

          {/* Radar chart */}
          {radarData.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
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

          {/* Advice */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-3">Actionable Recommendations</h2>
            <ol className="space-y-2">
              {report.actionableAdvice?.map((a, i) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-blue-400 font-bold flex-shrink-0">{i + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
          </div>

          {/* Compliance */}
          {report.complianceNote && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                {report.complianceNote.regulatoryFramework} Compliance Notice
              </p>
              <p className="text-gray-500 text-xs">{report.complianceNote.disclaimer}</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
