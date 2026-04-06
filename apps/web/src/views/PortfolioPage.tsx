'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, ChevronDown, Lightbulb } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { toast } from 'sonner'
import Link from 'next/link'
import { portfolioApi, type PortfolioResponse, type PortfolioAnalytics, type PortfolioInsight } from '../api/portfolio'
import { marketApi } from '../api/market'
import { PortfolioListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import TickerSearchInput from '../components/TickerSearchInput'
import Sparkline from '../components/Sparkline'

const SECTOR_COLORS: Record<string, string> = {
  Technology: 'bg-blue-500/15 text-blue-100 border-blue-300/30',
  Healthcare: 'bg-green-500/15 text-green-100 border-green-300/30',
  Finance: 'bg-violet-500/15 text-violet-100 border-violet-300/30',
  Energy: 'bg-blue-500/15 text-blue-100 border-blue-300/30',
  'Real Estate': 'bg-rose-500/15 text-rose-100 border-rose-300/30',
  Consumer: 'bg-cyan-500/15 text-cyan-100 border-cyan-300/30',
  Industrials: 'bg-orange-500/15 text-orange-100 border-orange-300/30',
  Utilities: 'bg-teal-500/15 text-teal-100 border-teal-300/30',
  Materials: 'bg-lime-500/15 text-lime-100 border-lime-300/30',
  Communication: 'bg-sky-500/15 text-sky-100 border-sky-300/30',
}

const PIE_COLORS = [
  '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#fb7185',
  '#22d3ee', '#f97316', '#2dd4bf', '#a3e635', '#38bdf8',
]

const HHI_STYLE: Record<string, string> = {
  'Well Diversified': 'bg-green-500/15 text-[var(--up)] border-green-400/30',
  'Moderately Concentrated': 'bg-yellow-500/15 text-[var(--warn)] border-yellow-400/30',
  'Highly Concentrated': 'bg-red-500/15 text-[var(--down)] border-red-400/30',
}

function sectorClass(sector?: string | null) {
  if (!sector) return ''
  return SECTOR_COLORS[sector] ?? 'bg-slate-700/60 text-slate-100 border-slate-400/35'
}

function SectorBadge({ sector }: { sector?: string | null }) {
  if (!sector) return <span className="text-[var(--text-muted)]">-</span>
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${sectorClass(sector)}`}>
      {sector}
    </span>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const firstInput = dialogRef.current?.querySelector<HTMLElement>('input, button, select, textarea')
    firstInput?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="glass-panel w-full max-w-md rounded p-4"
      >
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-3">{title}</h2>
        {children}
        <button onClick={onClose} className="btn-ghost mt-3 px-3 py-2 text-xs">Cancel</button>
      </motion.div>
    </div>
  )
}

function InputField({
  id,
  label,
  value,
  onChange,
  type = 'text',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input
        id={id}
        type={type}
        className="field-input"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showCreatePortfolio, setShowCreatePortfolio] = useState(false)
  const [showAddHolding, setShowAddHolding] = useState<string | null>(null)
  const [portForm, setPortForm] = useState({ name: '', description: '' })
  const [holdForm, setHoldForm] = useState({ symbol: '', companyName: '', quantity: '', averageCost: '', sector: '' })
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState<Record<string, PortfolioAnalytics>>({})
  const [holdingQuotes, setHoldingQuotes] = useState<Record<string, Record<string, { close: number }>>>({})
  const [holdingHistory, setHoldingHistory] = useState<Record<string, Record<string, number[]>>>({})
  const [insights, setInsights] = useState<Record<string, PortfolioInsight>>({})
  const [insightsLoading, setInsightsLoading] = useState<Record<string, boolean>>({})

  const refresh = () => portfolioApi.list().then(setPortfolios).finally(() => setLoading(false))
  useEffect(() => { refresh() }, [])

  const createPortfolio = async () => {
    try {
      await portfolioApi.create({ name: portForm.name, description: portForm.description })
      toast.success(`Portfolio "${portForm.name}" created.`)
      setShowCreatePortfolio(false)
      setPortForm({ name: '', description: '' })
      refresh()
    } catch {
      toast.error('Failed to create portfolio.')
    }
  }

  const deletePortfolio = async (id: string) => {
    if (!confirm('Delete this portfolio?')) return
    try {
      await portfolioApi.delete(id)
      toast.success('Portfolio deleted.')
      refresh()
    } catch {
      toast.error('Failed to delete portfolio.')
    }
  }

  const addHolding = async (portfolioId: string) => {
    try {
      await portfolioApi.addHolding(portfolioId, {
        symbol: holdForm.symbol,
        companyName: holdForm.companyName || undefined,
        quantity: Number(holdForm.quantity),
        averageCost: Number(holdForm.averageCost),
        sector: holdForm.sector || undefined,
      })
      toast.success(`${holdForm.symbol} added to portfolio.`)
      setShowAddHolding(null)
      setHoldForm({ symbol: '', companyName: '', quantity: '', averageCost: '', sector: '' })
      refresh()
    } catch {
      toast.error('Failed to add holding.')
    }
  }

  const toggleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null)
      return
    }
    setExpanded(id)
    if (!analytics[id]) {
      portfolioApi.getAnalytics(id)
        .then(data => setAnalytics(prev => ({ ...prev, [id]: data })))
        .catch(() => toast.error('Failed to load analytics.'))
    }

    const portfolio = portfolios.find(p => p.id === id)
    if (portfolio && !holdingQuotes[id]) {
      const symbols = portfolio.holdings.map(h => h.symbol)
      if (symbols.length > 0) {
        marketApi.batchQuotes(symbols)
          .then(quotes => {
            const mapped: Record<string, { close: number }> = {}
            for (const [sym, q] of Object.entries(quotes)) {
              if (q && typeof q.close === 'number') mapped[sym] = { close: q.close }
            }
            setHoldingQuotes(prev => ({ ...prev, [id]: mapped }))
          })
          .catch(() => {})

        Promise.all(symbols.map(s =>
          marketApi.history(s, 7)
            .then(bars => ({ symbol: s, closes: bars.map(b => b.c) }))
            .catch(() => ({ symbol: s, closes: [] as number[] }))
        )).then(results => {
          const histMap: Record<string, number[]> = {}
          results.forEach(r => { histMap[r.symbol] = r.closes })
          setHoldingHistory(prev => ({ ...prev, [id]: histMap }))
        })
      }
    }
  }

  const deleteHolding = async (portfolioId: string, holdingId: string) => {
    try {
      await portfolioApi.deleteHolding(portfolioId, holdingId)
      toast.success('Holding removed.')
      refresh()
    } catch {
      toast.error('Failed to remove holding.')
    }
  }

  return (
    <div className="px-4 py-4 md:px-8 md:py-6 space-y-4">
      <section className="glass-panel rounded p-3 md:p-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Portfolio Studio</h1>
          <p className="page-subtitle">Create portfolios, manage holdings, and review sector exposure.</p>
        </div>
        <button onClick={() => setShowCreatePortfolio(true)} className="btn-primary px-4 py-2 text-sm">
          <Plus size={14} />
          New Portfolio
        </button>
      </section>

      {loading ? (
        <PortfolioListSkeleton />
      ) : portfolios.length === 0 ? (
        <EmptyState
          icon={<Plus size={28} />}
          title="No portfolios yet."
          description="Create one to get started with risk analysis."
        />
      ) : (
        <section className="space-y-3">
          {portfolios.map(portfolio => (
            <motion.div
              key={portfolio.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="surface-panel rounded overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 px-3 py-3 md:px-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => toggleExpand(portfolio.id)}
                    aria-label={expanded === portfolio.id ? 'Collapse holdings' : 'Expand holdings'}
                    className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  >
                    <ChevronDown
                      size={15}
                      className="transition-transform duration-200"
                      style={{ transform: expanded === portfolio.id ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </button>

                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{portfolio.name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{portfolio.description || 'No description'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                  <span className="kpi-value text-base sm:text-lg text-[var(--up)]">
                    ${Number(portfolio.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <button onClick={() => setShowAddHolding(portfolio.id)} className="btn-ghost px-2 py-1 text-xs">
                    <Plus size={12} /> Add
                  </button>
                  <button
                    onClick={() => deletePortfolio(portfolio.id)}
                    aria-label="Delete portfolio"
                    className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--down)] hover:bg-red-500/15 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {expanded === portfolio.id && (
                <div className="border-t border-[color:var(--border-subtle)] overflow-x-auto">
                {analytics[portfolio.id] && (() => {
                  const a = analytics[portfolio.id]
                  const pieData = Object.entries(a.sectorAllocation).map(([name, value]) => ({ name, value: Number(value) }))
                  return (
                    <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] space-y-3">
                      <div className="flex flex-wrap items-start gap-5">
                        {pieData.length > 0 && (
                          <div className="w-44 h-44">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={36}
                                  outerRadius={62}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {pieData.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(v) => typeof v === 'number' ? `${v.toFixed(1)}%` : String(v ?? '')}
                                  contentStyle={{ background: '#111113', border: '1px solid #252528', borderRadius: '4px', fontSize: '12px' }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                        <div className="flex-1 min-w-[200px] space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${HHI_STYLE[a.hhiClassification] ?? 'bg-slate-700 text-slate-300 border-slate-500/30'}`}>
                              HHI: {a.hhiIndex.toFixed(0)} — {a.hhiClassification}
                            </span>
                          </div>
                          {pieData.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {pieData.map((entry, i) => (
                                <span key={entry.name} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                                  <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  {entry.name}: {entry.value.toFixed(1)}%
                                </span>
                              ))}
                            </div>
                          )}
                          {a.concentrationWarnings.length > 0 && (
                            <div className="space-y-1">
                              {a.concentrationWarnings.map((w, i) => (
                                <p key={i} className="text-xs text-[var(--warn)] flex items-start gap-1.5">
                                  <span className="mt-0.5">&#9888;</span> {w}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
                {/* Insights Panel */}
                <div className="px-4 py-3 border-b border-[color:var(--border-subtle)]">
                  {!insights[portfolio.id] && !insightsLoading[portfolio.id] ? (
                    <button
                      onClick={() => {
                        setInsightsLoading(prev => ({ ...prev, [portfolio.id]: true }))
                        portfolioApi.getInsights(portfolio.id)
                          .then(data => setInsights(prev => ({ ...prev, [portfolio.id]: data })))
                          .catch(() => toast.error('Failed to load insights.'))
                          .finally(() => setInsightsLoading(prev => ({ ...prev, [portfolio.id]: false })))
                      }}
                      className="btn-ghost px-3 py-1.5 text-xs flex items-center gap-1.5"
                    >
                      <Lightbulb size={13} />
                      Get Insights
                    </button>
                  ) : insightsLoading[portfolio.id] ? (
                    <p className="text-xs text-[var(--text-muted)] animate-pulse">Loading insights...</p>
                  ) : insights[portfolio.id]?.freshness === 'empty' ? (
                    <p className="text-xs text-[var(--text-muted)]">No insights available</p>
                  ) : (() => {
                    const ins = insights[portfolio.id]
                    const riskColor = ins.riskLevel === 'LOW'
                      ? 'bg-green-500/15 text-[var(--up)] border-green-400/30'
                      : ins.riskLevel === 'HIGH'
                        ? 'bg-red-500/15 text-[var(--down)] border-red-400/30'
                        : 'bg-yellow-500/15 text-[var(--warn)] border-yellow-400/30'
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-3"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${riskColor}`}>
                            Risk: {ins.riskScore} — {ins.riskLevel}
                          </span>
                          {ins.freshness === 'degraded' && (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium border bg-yellow-500/15 text-[var(--warn)] border-yellow-400/30">
                              Degraded
                            </span>
                          )}
                        </div>

                        {ins.narration && (
                          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{ins.narration}</p>
                        )}

                        {ins.priorityActions.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Priority Actions</p>
                            <ul className="list-disc list-inside space-y-0.5">
                              {ins.priorityActions.map((action, i) => (
                                <li key={i} className="text-xs text-[var(--text-secondary)]">{action}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {ins.relevantEvents.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Relevant Events</p>
                            <div className="space-y-1">
                              {ins.relevantEvents.map((evt, i) => (
                                <div key={i} className="flex items-baseline gap-2 text-xs">
                                  <span className="text-[var(--text-primary)] font-medium truncate max-w-[60%]">{evt.headline}</span>
                                  <span className="text-[var(--text-muted)]">{evt.source}</span>
                                  <span className="text-[var(--text-muted)] tabular-nums">{new Date(evt.publishedAt).toLocaleDateString()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </motion.div>
                    )
                  })()}
                </div>

                  <table className="table-terminal w-full min-w-[960px]">
                    <thead>
                      <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                        <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Symbol</th>
                        <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Company</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Qty</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Avg Cost</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Price</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">P/L</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">P/L %</th>
                        <th className="px-3 py-2 text-center font-semibold uppercase tracking-[0.08em]">7D</th>
                        <th className="px-3 py-2 text-left font-semibold uppercase tracking-[0.08em]">Sector</th>
                        <th className="px-3 py-2 text-right font-semibold uppercase tracking-[0.08em]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-3 py-4 text-center text-[var(--text-muted)]">No holdings yet</td>
                        </tr>
                      ) : (
                        portfolio.holdings.map((holding, idx) => {
                          const quote = holdingQuotes[portfolio.id]?.[holding.symbol]
                          const closes = holdingHistory[portfolio.id]?.[holding.symbol]
                          const currentPrice = quote?.close
                          const avgCost = Number(holding.averageCost)
                          const qty = Number(holding.quantity)
                          const pl = currentPrice != null ? (currentPrice - avgCost) * qty : null
                          const plPct = currentPrice != null && avgCost !== 0 ? ((currentPrice - avgCost) / avgCost) * 100 : null
                          const plColor = pl != null ? (pl >= 0 ? 'text-[var(--up)]' : 'text-[var(--down)]') : ''

                          return (
                            <tr
                              key={holding.id}
                              className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${idx % 2 === 1 ? 'bg-slate-900/15' : ''}`}
                            >
                              <td className="px-3 py-2">
                                <Link href={`/stock/${holding.symbol}`} className="font-data font-bold text-blue-100 hover:text-blue-300 transition-colors">
                                  {holding.symbol}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{holding.companyName || '-'}</td>
                              <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">{holding.quantity}</td>
                              <td className="px-3 py-2 text-right text-[var(--text-secondary)] font-data tabular-nums">${avgCost.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-data tabular-nums text-[var(--text-primary)]">
                                {currentPrice != null ? `$${currentPrice.toFixed(2)}` : <span className="text-[var(--text-muted)]">&mdash;</span>}
                              </td>
                              <td className={`px-3 py-2 text-right font-data tabular-nums ${plColor}`}>
                                {pl != null ? `${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}` : <span className="text-[var(--text-muted)]">&mdash;</span>}
                              </td>
                              <td className={`px-3 py-2 text-right font-data tabular-nums ${plColor}`}>
                                {plPct != null ? `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%` : <span className="text-[var(--text-muted)]">&mdash;</span>}
                              </td>
                              <td className="px-3 py-2 flex justify-center">
                                {closes && closes.length > 1
                                  ? <Sparkline data={closes} isUp={closes[closes.length - 1] >= closes[0]} />
                                  : <span className="text-[var(--text-muted)]">&mdash;</span>}
                              </td>
                              <td className="px-3 py-2"><SectorBadge sector={holding.sector} /></td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => deleteHolding(portfolio.id, holding.id)}
                                  aria-label={`Delete holding ${holding.symbol}`}
                                  className="h-6 w-6 rounded inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--down)] hover:bg-red-500/15 transition-colors"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          ))}
        </section>
      )}

      {showCreatePortfolio && (
        <Modal title="Create Portfolio" onClose={() => setShowCreatePortfolio(false)}>
          <div className="space-y-3">
            <InputField id="port-name" label="Name" value={portForm.name} onChange={v => setPortForm(f => ({ ...f, name: v }))} />
            <InputField id="port-desc" label="Description (optional)" value={portForm.description} onChange={v => setPortForm(f => ({ ...f, description: v }))} />
            <button onClick={createPortfolio} className="btn-primary w-full py-2 text-sm">Create</button>
          </div>
        </Modal>
      )}

      {showAddHolding && (
        <Modal title="Add Holding" onClose={() => setShowAddHolding(null)}>
          <div className="space-y-3">
            {!holdForm.symbol ? (
              <div>
                <label className="field-label">Search Ticker</label>
                <TickerSearchInput
                  onSelect={({ symbol, name, assetType }) => {
                    setHoldForm(f => ({
                      ...f,
                      symbol,
                      companyName: name || '',
                      sector: assetType === 'CRYPTOCURRENCY' ? 'Crypto' : f.sector,
                    }))
                  }}
                  placeholder="Search stocks or crypto..."
                />
              </div>
            ) : (
              <div>
                <label className="field-label">Symbol</label>
                <div className="flex items-center gap-2">
                  <span className="field-input flex-1 py-2 text-blue-200 font-data font-bold">
                    {holdForm.symbol}
                  </span>
                  <button
                    onClick={() => setHoldForm(f => ({ ...f, symbol: '', companyName: '' }))}
                    className="btn-ghost px-2 py-1.5 text-xs"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}
            <InputField id="hold-company" label="Company Name" value={holdForm.companyName} onChange={v => setHoldForm(f => ({ ...f, companyName: v }))} />
            <InputField id="hold-qty" label="Quantity" value={holdForm.quantity} onChange={v => setHoldForm(f => ({ ...f, quantity: v }))} type="number" />
            <InputField id="hold-cost" label="Average Cost ($)" value={holdForm.averageCost} onChange={v => setHoldForm(f => ({ ...f, averageCost: v }))} type="number" />
            <InputField id="hold-sector" label="Sector" value={holdForm.sector} onChange={v => setHoldForm(f => ({ ...f, sector: v }))} />
            <button
              onClick={() => addHolding(showAddHolding)}
              disabled={!holdForm.symbol || !holdForm.quantity || !holdForm.averageCost}
              className="btn-primary w-full py-2 text-sm disabled:opacity-40"
            >
              Add Holding
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
