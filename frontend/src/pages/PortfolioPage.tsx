import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-gray-900 rounded-xl border border-gray-700 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold text-gray-100 mb-4">{title}</h2>
        {children}
        <button onClick={onClose} className="mt-4 text-gray-500 hover:text-gray-300 text-sm">Cancel</button>
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
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Portfolio</h1>
          <p className="text-gray-500 text-sm mt-1">Manage your investment portfolios and holdings</p>
        </div>
        <button
          onClick={() => setShowCreatePortfolio(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New Portfolio
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : portfolios.length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400">No portfolios yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {portfolios.map(p => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-gray-900 rounded-xl border border-gray-800"
            >
              {/* Portfolio header */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-4">
                  <button onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                    {expanded === p.id ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </button>
                  <div>
                    <p className="font-semibold text-gray-100">{p.name}</p>
                    <p className="text-gray-500 text-xs">{p.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-green-400 font-bold">
                    ${Number(p.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <button
                    onClick={() => setShowAddHolding(p.id)}
                    className="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1"
                  >
                    <Plus size={14} /> Add Holding
                  </button>
                  <button onClick={() => deletePortfolio(p.id)} className="text-gray-600 hover:text-red-400">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Holdings table */}
              {expanded === p.id && (
                <div className="border-t border-gray-800 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 text-xs border-b border-gray-800">
                        <th className="px-5 py-3 text-left">Symbol</th>
                        <th className="px-5 py-3 text-left">Company</th>
                        <th className="px-5 py-3 text-right">Qty</th>
                        <th className="px-5 py-3 text-right">Avg Cost</th>
                        <th className="px-5 py-3 text-left">Sector</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.holdings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-5 py-4 text-gray-600 text-center">No holdings yet</td>
                        </tr>
                      ) : (
                        p.holdings.map(h => (
                          <tr key={h.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                            <td className="px-5 py-3 font-mono font-bold text-blue-400">{h.symbol}</td>
                            <td className="px-5 py-3 text-gray-300">{h.companyName || '—'}</td>
                            <td className="px-5 py-3 text-right text-gray-300">{h.quantity}</td>
                            <td className="px-5 py-3 text-right text-gray-300">${Number(h.averageCost).toFixed(2)}</td>
                            <td className="px-5 py-3 text-gray-500">{h.sector || '—'}</td>
                            <td className="px-5 py-3 text-right">
                              <button onClick={() => deleteHolding(p.id, h.id)} className="text-gray-600 hover:text-red-400">
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
            <button onClick={createPortfolio} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-medium">
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
            <button onClick={() => addHolding(showAddHolding)} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-medium">
              Add Holding
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
