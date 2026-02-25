import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { toast } from 'sonner'
import { portfolioApi, type PortfolioResponse, type PortfolioAnalytics } from '../api/portfolio'
import { PortfolioListSkeleton } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import TickerSearchInput from '../components/TickerSearchInput'

const SECTOR_COLORS: Record<string, string> = {
  Technology: 'bg-blue-500/15 text-blue-100 border-blue-300/30',
  Healthcare: 'bg-emerald-500/15 text-emerald-100 border-emerald-300/30',
  Finance: 'bg-violet-500/15 text-violet-100 border-violet-300/30',
  Energy: 'bg-amber-500/15 text-amber-100 border-amber-300/30',
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
  'Well Diversified': 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  'Moderately Concentrated': 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  'Highly Concentrated': 'bg-red-500/15 text-red-300 border-red-400/30',
}

function sectorClass(sector?: string | null) {
  if (!sector) return ''
  return SECTOR_COLORS[sector] ?? 'bg-slate-700/60 text-slate-100 border-slate-400/35'
}

function SectorBadge({ sector }: { sector?: string | null }) {
  if (!sector) return <span className="text-[var(--text-muted)]">-</span>
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${sectorClass(sector)}`}>
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="glass-panel w-full max-w-md rounded-2xl p-5"
      >
        <h2 className="text-xl font-display text-[var(--text-primary)] mb-3">{title}</h2>
        {children}
        <button onClick={onClose} className="btn-ghost mt-4 px-3 py-2 text-xs">Cancel</button>
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
    <div className="px-4 py-6 md:px-8 md:py-8 space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Portfolio Studio</h1>
          <p className="page-subtitle">Create portfolios, manage holdings, and review sector exposure.</p>
        </div>
        <button onClick={() => setShowCreatePortfolio(true)} className="btn-primary px-4 py-2.5 text-sm">
          <Plus size={15} />
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
        <section className="space-y-4">
          {portfolios.map(portfolio => (
            <motion.div
              key={portfolio.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="surface-panel rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-4 md:px-5 md:py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => toggleExpand(portfolio.id)}
                    aria-label={expanded === portfolio.id ? 'Collapse holdings' : 'Expand holdings'}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors"
                  >
                    <ChevronDown
                      size={17}
                      className="transition-transform duration-200"
                      style={{ transform: expanded === portfolio.id ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </button>

                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text-primary)] truncate">{portfolio.name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-1">{portfolio.description || 'No description'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap justify-end">
                  <span className="kpi-value text-base sm:text-lg text-emerald-200">
                    ${Number(portfolio.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <button onClick={() => setShowAddHolding(portfolio.id)} className="btn-ghost px-3 py-1.5 text-xs">
                    <Plus size={13} /> Add Holding
                  </button>
                  <button
                    onClick={() => deletePortfolio(portfolio.id)}
                    aria-label="Delete portfolio"
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-red-200 hover:bg-red-500/15 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              {expanded === portfolio.id && (
                <div className="border-t border-[color:var(--border-subtle)] overflow-x-auto">
                {analytics[portfolio.id] && (() => {
                  const a = analytics[portfolio.id]
                  const pieData = Object.entries(a.sectorAllocation).map(([name, value]) => ({ name, value: Number(value) }))
                  return (
                    <div className="px-5 py-4 border-b border-[color:var(--border-subtle)] space-y-4">
                      <div className="flex flex-wrap items-start gap-6">
                        {pieData.length > 0 && (
                          <div className="w-52 h-52">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={40}
                                  outerRadius={70}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {pieData.map((_, i) => (
                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(v: number | undefined) => v != null ? `${v.toFixed(1)}%` : ''}
                                  contentStyle={{ background: '#1e1e2e', border: '1px solid #333', borderRadius: '8px', fontSize: '12px' }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                        <div className="flex-1 min-w-[200px] space-y-3">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold border ${HHI_STYLE[a.hhiClassification] ?? 'bg-slate-700 text-slate-300 border-slate-500/30'}`}>
                              HHI: {a.hhiIndex.toFixed(0)} — {a.hhiClassification}
                            </span>
                          </div>
                          {pieData.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {pieData.map((entry, i) => (
                                <span key={entry.name} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  {entry.name}: {entry.value.toFixed(1)}%
                                </span>
                              ))}
                            </div>
                          )}
                          {a.concentrationWarnings.length > 0 && (
                            <div className="space-y-1">
                              {a.concentrationWarnings.map((w, i) => (
                                <p key={i} className="text-xs text-amber-400/90 flex items-start gap-1.5">
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
                  <table className="w-full text-sm min-w-[760px]">
                    <thead>
                      <tr className="bg-slate-900/35 text-[var(--text-muted)] text-xs border-b border-[color:var(--border-subtle)]">
                        <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.08em]">Symbol</th>
                        <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.08em]">Company</th>
                        <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Qty</th>
                        <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Avg Cost</th>
                        <th className="px-4 py-3 text-left font-semibold uppercase tracking-[0.08em]">Sector</th>
                        <th className="px-4 py-3 text-right font-semibold uppercase tracking-[0.08em]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-4 text-center text-[var(--text-muted)]">No holdings yet</td>
                        </tr>
                      ) : (
                        portfolio.holdings.map((holding, idx) => (
                          <tr
                            key={holding.id}
                            className={`border-b border-[color:var(--border-subtle)] hover:bg-white/5 transition-colors ${idx % 2 === 1 ? 'bg-slate-900/15' : ''}`}
                          >
                            <td className="px-4 py-3 font-data font-bold text-amber-100">{holding.symbol}</td>
                            <td className="px-4 py-3 text-[var(--text-secondary)]">{holding.companyName || '-'}</td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-data tabular-nums">{holding.quantity}</td>
                            <td className="px-4 py-3 text-right text-[var(--text-secondary)] font-data tabular-nums">${Number(holding.averageCost).toFixed(2)}</td>
                            <td className="px-4 py-3"><SectorBadge sector={holding.sector} /></td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => deleteHolding(portfolio.id, holding.id)}
                                aria-label={`Delete holding ${holding.symbol}`}
                                className="h-7 w-7 rounded-md inline-flex items-center justify-center text-[var(--text-muted)] hover:text-red-200 hover:bg-red-500/15 transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))
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
            <button onClick={createPortfolio} className="btn-primary w-full py-2.5 text-sm">Create</button>
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
                  <span className="field-input flex-1 py-2 text-amber-200 font-data font-bold">
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
              className="btn-primary w-full py-2.5 text-sm disabled:opacity-40"
            >
              Add Holding
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
