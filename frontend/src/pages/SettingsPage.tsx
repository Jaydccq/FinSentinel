import { useState, useEffect } from 'react'
import { Plus, X, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../context/AuthContext'

const WATCHLIST_KEY = 'finsentinel_watchlist'

function loadWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveWatchlist(tickers: string[]) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(tickers))
}

export default function SettingsPage() {
  const { user } = useAuth()
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist)
  const [ticker, setTicker] = useState('')

  useEffect(() => { saveWatchlist(watchlist) }, [watchlist])

  const addTicker = () => {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    if (watchlist.includes(t)) {
      toast.error(`${t} is already in your watchlist.`)
      return
    }
    setWatchlist(prev => [...prev, t])
    setTicker('')
    toast.success(`${t} added to watchlist.`)
  }

  const removeTicker = (t: string) => {
    setWatchlist(prev => prev.filter(x => x !== t))
    toast.success(`${t} removed from watchlist.`)
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8 space-y-6">
      <section className="glass-panel rounded-3xl p-6 md:p-8">
        <div className="flex items-center gap-3 mb-1">
          <SettingsIcon size={20} className="text-amber-400" />
          <h1 className="page-title">Settings</h1>
        </div>
        <p className="page-subtitle">Manage your account and preferences.</p>
      </section>

      {/* Account Info */}
      <section className="glass-panel rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Account</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">Username</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{user?.username ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">Email</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{user?.email ?? '-'}</p>
          </div>
        </div>
      </section>

      {/* Watchlist */}
      <section className="glass-panel rounded-2xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Watchlist</h2>
        <p className="text-xs text-[var(--text-muted)]">
          Track tickers you're interested in. Saved locally in your browser.
        </p>

        <div className="flex gap-2">
          <input
            className="field-input flex-1"
            placeholder="Enter ticker (e.g. AAPL)"
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button onClick={addTicker} className="btn-primary px-4 py-2 text-sm">
            <Plus size={15} /> Add
          </button>
        </div>

        {watchlist.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-4 text-center">No tickers in your watchlist yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {watchlist.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-400/20 text-amber-100 text-sm font-medium"
              >
                {t}
                <button
                  onClick={() => removeTicker(t)}
                  aria-label={`Remove ${t}`}
                  className="h-4 w-4 rounded-full flex items-center justify-center hover:bg-amber-400/20 transition-colors"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
