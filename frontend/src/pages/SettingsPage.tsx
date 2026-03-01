import { useState, useEffect } from 'react'
import { Plus, X, Settings as SettingsIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import LanguageToggle from '../components/LanguageToggle'

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
  const { t } = useI18n()
  const [watchlist, setWatchlist] = useState<string[]>(loadWatchlist)
  const [ticker, setTicker] = useState('')

  useEffect(() => { saveWatchlist(watchlist) }, [watchlist])

  const addTicker = () => {
    const nextTicker = ticker.trim().toUpperCase()
    if (!nextTicker) return
    if (watchlist.includes(nextTicker)) {
      toast.error(t('settings.toast.exists', { ticker: nextTicker }))
      return
    }
    setWatchlist(prev => [...prev, nextTicker])
    setTicker('')
    toast.success(t('settings.toast.added', { ticker: nextTicker }))
  }

  const removeTicker = (nextTicker: string) => {
    setWatchlist(prev => prev.filter(x => x !== nextTicker))
    toast.success(t('settings.toast.removed', { ticker: nextTicker }))
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-4 space-y-4">
      <section className="glass-panel rounded p-3 md:p-4">
        <div className="flex items-center gap-3 mb-1">
          <SettingsIcon size={18} className="text-blue-400" />
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
        <p className="page-subtitle">{t('settings.subtitle')}</p>
      </section>

      <section className="glass-panel rounded p-3 md:p-4 space-y-3">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t('settings.language')}</h2>
        <p className="text-xs text-[var(--text-muted)]">{t('settings.languageDesc')}</p>
        <LanguageToggle />
      </section>

      <section className="glass-panel rounded p-3 md:p-4 space-y-3">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t('settings.account')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">{t('settings.username')}</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{user?.username ?? '-'}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-muted)] mb-1">{t('settings.email')}</p>
            <p className="text-sm text-[var(--text-primary)] font-medium">{user?.email ?? '-'}</p>
          </div>
        </div>
      </section>

      <section className="glass-panel rounded p-3 md:p-4 space-y-3">
        <h2 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{t('settings.watchlist')}</h2>
        <p className="text-xs text-[var(--text-muted)]">
          {t('settings.watchlistDesc')}
        </p>

        <div className="flex gap-2">
          <input
            className="field-input flex-1"
            placeholder={t('settings.tickerPlaceholder')}
            value={ticker}
            onChange={e => setTicker(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTicker() }}
          />
          <button onClick={addTicker} className="btn-primary px-4 py-2 text-sm">
            <Plus size={14} /> {t('settings.add')}
          </button>
        </div>

        {watchlist.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-3 text-center">{t('settings.emptyWatchlist')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {watchlist.map(currentTicker => (
              <span
                key={currentTicker}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-500/10 border border-blue-400/20 text-blue-200 text-xs font-medium"
              >
                {currentTicker}
                <button
                  onClick={() => removeTicker(currentTicker)}
                  aria-label={t('settings.removeAria', { ticker: currentTicker })}
                  className="h-3.5 w-3.5 flex items-center justify-center hover:text-blue-100 transition-colors"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
