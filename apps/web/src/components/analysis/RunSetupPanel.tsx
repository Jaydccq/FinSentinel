'use client'

import { useState } from 'react'
import { analysisRunsApi, type AnalysisPreset, type AnalysisStageKey } from '../../api/analysis-runs'

const ALL_STAGES = ['INTELLIGENCE', 'THESIS', 'RISK', 'EXECUTION_PREP'] as const satisfies readonly AnalysisStageKey[]

export interface RunSetupPanelProps {
  portfolios: Array<{ id: string; name: string }>
  onRunCreated: (runId: string) => void
}

export function RunSetupPanel({ portfolios, onRunCreated }: RunSetupPanelProps) {
  const [ticker, setTicker] = useState('AAPL')
  const [prompt, setPrompt] = useState('Complete analysis of AAPL with decision and order draft')
  const [portfolioId, setPortfolioId] = useState(portfolios[0]?.id ?? '')
  const [preset, setPreset] = useState<AnalysisPreset>('STANDARD_ANALYSIS')
  const [researchDepth, setResearchDepth] = useState<'SHALLOW' | 'STANDARD' | 'DEEP'>('STANDARD')
  const [enabledTeams, setEnabledTeams] = useState<AnalysisStageKey[]>([...ALL_STAGES])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const toggleTeam = (key: AnalysisStageKey) => {
    setEnabledTeams((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    )
  }

  const startRun = async () => {
    setSubmitting(true)
    setError('')
    try {
      const run = await analysisRunsApi.create({
        prompt,
        sourceMode: 'WORKSPACE',
        ticker,
        portfolioId: portfolioId || undefined,
        preset,
        enabledTeams,
        researchDepth,
      })
      onRunCreated(run.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="surface-panel rounded p-4 space-y-3">
      <h2 className="text-base font-semibold">Run Setup</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label>
          <span className="field-label">Ticker</span>
          <input
            className="field-input"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          <span className="field-label">Portfolio (optional)</span>
          <select
            className="field-input"
            value={portfolioId}
            onChange={(e) => setPortfolioId(e.target.value)}
          >
            <option value="">No portfolio</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="field-label">Prompt</span>
        <textarea
          rows={3}
          className="field-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div className="flex gap-4 items-end">
        <label>
          <span className="field-label">Preset</span>
          <select
            className="field-input"
            value={preset}
            onChange={(e) => setPreset(e.target.value as AnalysisPreset)}
          >
            <option value="FAST_RISK_CHECK">Fast Risk Check</option>
            <option value="STANDARD_ANALYSIS">Standard Analysis</option>
            <option value="DEEP_THESIS">Deep Thesis</option>
            <option value="EXECUTION_READY">Execution Ready</option>
          </select>
        </label>
        <label>
          <span className="field-label">Research depth</span>
          <select
            className="field-input"
            value={researchDepth}
            onChange={(e) =>
              setResearchDepth(e.target.value as 'SHALLOW' | 'STANDARD' | 'DEEP')
            }
          >
            <option value="SHALLOW">Shallow</option>
            <option value="STANDARD">Standard</option>
            <option value="DEEP">Deep</option>
          </select>
        </label>
        <div>
          <span className="field-label">Teams</span>
          <div className="flex gap-2 flex-wrap">
            {ALL_STAGES.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => toggleTeam(team)}
                className={`status-chip border ${
                  enabledTeams.includes(team)
                    ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/40'
                    : 'bg-slate-800/60 text-slate-300 border-slate-700'
                }`}
              >
                {team}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-[var(--down)]">{error}</p>}
      <button
        onClick={startRun}
        disabled={submitting}
        className="btn-primary px-5 py-2 text-sm"
      >
        {submitting ? 'Starting...' : 'Start Analysis Run'}
      </button>
    </section>
  )
}
