import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'

// Sector badge color map — add more sectors as needed
const SECTOR_COLORS: Record<string, string> = {
  Technology:     'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Healthcare:     'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Finance:        'bg-violet-500/15 text-violet-300 border-violet-500/30',
  Energy:         'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Real Estate':  'bg-rose-500/15 text-rose-300 border-rose-500/30',
  Consumer:       'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  Industrials:    'bg-orange-500/15 text-orange-300 border-orange-500/30',
  Utilities:      'bg-teal-500/15 text-teal-300 border-teal-500/30',
  Materials:      'bg-lime-500/15 text-lime-300 border-lime-500/30',
  Communication:  'bg-sky-500/15 text-sky-300 border-sky-500/30',
}

function sectorClass(sector?: string | null) {
  if (!sector) return ''
  return SECTOR_COLORS[sector] ?? 'bg-gray-700/50 text-gray-300 border-gray-600/50'
}

function SectorBadge({ sector }: { sector?: string | null }) {
  if (!sector) return <span className="text-gray-600">—</span>
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${sectorClass(sector)}`}>
      {sector}
    </span>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="bg-gray-900/90 backdrop-blur-md rounded-xl border border-gray-700/50 p-6 w-full max-w-md shadow-2xl shadow-black/40"
      >
        <h2 className="text-lg font-semibold text-gray-100 mb-4">{title}</h2>
        {children}
        <button
          onClick={onClose}
          className="mt-4 text-gray-500 hover:text-gray-300 text-sm transition-colors"
        >
          Cancel
        </button>
      </motion.div>
    </div>
  )
}

function InputField({ id, label, value, onChange, type = 'text' }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500 transition-colors"
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

  const refresh = () => portfolioApi.list().then(setPortfolios).finally(() => setLoading(false))
  useEffect(() => { refresh() }, [])

  const createPortfolio = async () => {
    await portfolioApi.create({ name: portForm.name, description: portForm.description })
    setShowCreatePortfolio(false)
    setPortForm({ name: '', description: '' })
    refresh()
  }

  const deletePortfolio = async (id: string) => {
    if (!confirm('Delete this portfolio?')) return
    await portfolioApi.delete(id)
    refresh()
  }

  const addHolding = async (portfolioId: string) => {
    await portfolioApi.addHolding(portfolioId, {
      symbol: holdForm.symbol,
      companyName: holdForm.companyName || undefined,
      quantity: Number(holdForm.quantity),
      averageCost: Number(holdForm.averageCost),
      sector: holdForm.sector || undefined,
    })
    setShowAddHolding(null)
    setHoldForm({ symbol: '', companyName: '', quantity: '', averageCost: '', sector: '' })
    refresh()
  }

  const deleteHolding = async (portfolioId: string, holdingId: string) => {
    await portfolioApi.deleteHolding(portfolioId, holdingId)
    refresh()
  }

  return (
    <div className="p-8 space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Portfolio</h1>
          {/* Gradient underline bar decoration */}
          <div className="mt-1.5 h-0.5 w-24 rounded-full bg-gradient-to-r from-blue-500 to-transparent" />
          <p className="text-gray-500 text-sm mt-2">Manage your investment portfolios and holdings</p>
        </div>
        <button
          onClick={() => setShowCreatePortfolio(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:scale-105 active:scale-95 shadow-lg shadow-blue-900/30"
        >
          <Plus size={16} /> New Portfolio
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading portfolios...</p>
      ) : portfolios.length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400">No portfolios yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {portfolios.map(p => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-900 rounded-xl border border-gray-700/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-900/20"
            >
              {/* Portfolio header */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                    aria-label={expanded === p.id ? 'Collapse holdings' : 'Expand holdings'}
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    <ChevronDown
                      size={18}
                      className="transition-transform duration-200"
                      style={{ transform: expanded === p.id ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </button>
                  <div>
                    <p className="font-semibold text-gray-100">{p.name}</p>
                    <p className="text-gray-500 text-xs">{p.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-green-400 font-bold text-lg tabular-nums">
                    ${Number(p.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <button
                    onClick={() => setShowAddHolding(p.id)}
                    className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1 transition-colors"
                  >
                    <Plus size={14} /> Add Holding
                  </button>
                  <button
                    onClick={() => deletePortfolio(p.id)}
                    aria-label="Delete portfolio"
                    className="p-1.5 rounded-md text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Holdings table */}
              {expanded === p.id && (
                <div className="border-t border-gray-800 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-800/50 text-gray-500 text-xs border-b border-gray-800">
                        <th className="px-5 py-3 text-left font-semibold tracking-wide">Symbol</th>
                        <th className="px-5 py-3 text-left font-semibold tracking-wide">Company</th>
                        <th className="px-5 py-3 text-right font-semibold tracking-wide">Qty</th>
                        <th className="px-5 py-3 text-right font-semibold tracking-wide">Avg Cost</th>
                        <th className="px-5 py-3 text-left font-semibold tracking-wide">Sector</th>
                        <th className="px-5 py-3 text-right font-semibold tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.holdings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-4 text-gray-600 text-center">No holdings yet</td>
                        </tr>
                      ) : (
                        p.holdings.map((h, idx) => (
                          <tr
                            key={h.id}
                            className={`border-b border-gray-800/50 hover:bg-gray-800/40 transition-colors ${idx % 2 === 1 ? 'even:bg-gray-800/30' : ''}`}
                          >
                            <td className="px-5 py-3 font-mono font-bold text-blue-400">{h.symbol}</td>
                            <td className="px-5 py-3 text-gray-300">{h.companyName || '—'}</td>
                            <td className="px-5 py-3 text-right text-gray-300 tabular-nums">{h.quantity}</td>
                            <td className="px-5 py-3 text-right text-gray-300 tabular-nums">${Number(h.averageCost).toFixed(2)}</td>
                            <td className="px-5 py-3">
                              <SectorBadge sector={h.sector} />
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                onClick={() => deleteHolding(p.id, h.id)}
                                aria-label={`Delete holding ${h.symbol}`}
                                className="p-1 rounded-md text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
                              >
                                <Trash2 size={14} />
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
        </div>
      )}

      {/* Create Portfolio Modal */}
      {showCreatePortfolio && (
        <Modal title="New Portfolio" onClose={() => setShowCreatePortfolio(false)}>
          <div className="space-y-3">
            <InputField id="port-name" label="Name" value={portForm.name} onChange={v => setPortForm(f => ({ ...f, name: v }))} />
            <InputField id="port-desc" label="Description (optional)" value={portForm.description} onChange={v => setPortForm(f => ({ ...f, description: v }))} />
            <button
              onClick={createPortfolio}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white py-2 rounded-lg font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Add Holding Modal */}
      {showAddHolding && (
        <Modal title="Add Holding" onClose={() => setShowAddHolding(null)}>
          <div className="space-y-3">
            <InputField id="hold-symbol" label="Symbol (e.g. AAPL)" value={holdForm.symbol} onChange={v => setHoldForm(f => ({ ...f, symbol: v }))} />
            <InputField id="hold-company" label="Company Name" value={holdForm.companyName} onChange={v => setHoldForm(f => ({ ...f, companyName: v }))} />
            <InputField id="hold-qty" label="Quantity" value={holdForm.quantity} onChange={v => setHoldForm(f => ({ ...f, quantity: v }))} type="number" />
            <InputField id="hold-cost" label="Average Cost ($)" value={holdForm.averageCost} onChange={v => setHoldForm(f => ({ ...f, averageCost: v }))} type="number" />
            <InputField id="hold-sector" label="Sector" value={holdForm.sector} onChange={v => setHoldForm(f => ({ ...f, sector: v }))} />
            <button
              onClick={() => addHolding(showAddHolding)}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white py-2 rounded-lg font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            >
              Add Holding
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
