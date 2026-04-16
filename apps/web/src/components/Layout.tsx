'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { useI18n } from '../hooks/useI18n'
import LanguageToggle from './LanguageToggle'
import {
  LayoutDashboard,
  MessageSquare,
  Briefcase,
  BarChart2,
  FileText,
  FileDown,
  Newspaper,
  Menu,
  X,
  Shield,
  ChevronRight,
  Settings,
  TrendingUp,
  Bot,
  Bitcoin,
} from 'lucide-react'
import type { MessageKey } from '../i18n/messages'

const NAV = [
  { to: '/dashboard', labelKey: 'layout.nav.dashboard', icon: LayoutDashboard },
  { to: '/chat', labelKey: 'layout.nav.chat', icon: MessageSquare },
  { to: '/portfolio', labelKey: 'layout.nav.portfolio', icon: Briefcase },
  { to: '/analysis', labelKey: 'layout.nav.analysis', icon: BarChart2 },
  { to: '/documents', labelKey: 'layout.nav.documents', icon: FileText },
  { to: '/reports', labelKey: 'layout.nav.reports', icon: FileDown },
  { to: '/trading', labelKey: 'layout.nav.trading', icon: TrendingUp },
  { to: '/crypto', labelKey: 'layout.nav.crypto', icon: Bitcoin },
  { to: '/news', labelKey: 'layout.nav.news', icon: Newspaper },
  { to: '/autonomy', labelKey: 'layout.nav.autonomy', icon: Bot },
  { to: '/settings', labelKey: 'layout.nav.settings', icon: Settings },
] as const

function routeMeta(pathname: string, searchTicker: string | null): {
  titleKey: MessageKey
  subtitleKey: MessageKey
  params?: Record<string, string>
} {
  if (pathname === '/stock') {
    const ticker = searchTicker?.toUpperCase() ?? 'Ticker'
    return {
      titleKey: 'layout.meta.stockSnapshot.title',
      subtitleKey: 'layout.meta.stockSnapshot.subtitle',
      params: { ticker },
    }
  }

  const map: Record<string, { titleKey: MessageKey; subtitleKey: MessageKey }> = {
    '/dashboard': { titleKey: 'layout.meta.dashboard.title', subtitleKey: 'layout.meta.dashboard.subtitle' },
    '/chat': { titleKey: 'layout.meta.chat.title', subtitleKey: 'layout.meta.chat.subtitle' },
    '/portfolio': { titleKey: 'layout.meta.portfolio.title', subtitleKey: 'layout.meta.portfolio.subtitle' },
    '/analysis': { titleKey: 'layout.meta.analysis.title', subtitleKey: 'layout.meta.analysis.subtitle' },
    '/documents': { titleKey: 'layout.meta.documents.title', subtitleKey: 'layout.meta.documents.subtitle' },
    '/reports': { titleKey: 'layout.meta.reports.title', subtitleKey: 'layout.meta.reports.subtitle' },
    '/trading': { titleKey: 'layout.meta.trading.title', subtitleKey: 'layout.meta.trading.subtitle' },
    '/crypto': { titleKey: 'layout.meta.crypto.title', subtitleKey: 'layout.meta.crypto.subtitle' },
    '/news': { titleKey: 'layout.meta.news.title', subtitleKey: 'layout.meta.news.subtitle' },
    '/autonomy': { titleKey: 'layout.meta.autonomy.title', subtitleKey: 'layout.meta.autonomy.subtitle' },
    '/settings': { titleKey: 'layout.meta.settings.title', subtitleKey: 'layout.meta.settings.subtitle' },
  }

  return map[pathname] ?? {
    titleKey: 'layout.meta.default.title',
    subtitleKey: 'layout.meta.default.subtitle',
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tickerParam = searchParams.get('ticker')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const meta = useMemo(
    () => routeMeta(pathname, tickerParam),
    [pathname, tickerParam],
  )

  const sidebarContent = (
    <>
      <div className="px-4 py-4 border-b border-[color:var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-blue-500 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-lg leading-none tracking-tight text-[var(--text-primary)]">FinSentinel</p>
            <p className="mt-0.5 text-[10px] tracking-[0.1em] uppercase text-[var(--text-muted)]">{t('layout.sidebar.riskIntelligence')}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5" aria-label={t('layout.sidebar.mainNavigation')}>
        {NAV.map(({ to, labelKey, icon: Icon }) => {
          const isActive = pathname === to || pathname.startsWith(to + '/')
          return (
            <Link
              key={to}
              href={to}
              onClick={() => setSidebarOpen(false)}
              className={`group flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors duration-150 border-l-2 ${
                isActive
                  ? 'border-blue-500 bg-blue-500/10 text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/4'
              }`}
            >
              <Icon
                size={15}
                aria-hidden="true"
                className={isActive ? 'text-blue-400' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}
              />
              <span className="font-medium">{t(labelKey)}</span>
            </Link>
          )
        })}
      </nav>

      <div className="px-2 pb-3 border-t border-[color:var(--border-subtle)] pt-2">
        <LanguageToggle />
      </div>
    </>
  )

  return (
    <div className="app-shell text-[var(--text-primary)]">
      <div className="relative z-10 flex min-h-screen">
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          style={{ display: sidebarOpen ? 'block' : 'none' }}
        />

        <aside
          className={`
            fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-[var(--bg-panel)] border-r border-[color:var(--border-subtle)]
            transform transition-transform duration-250 ease-out md:relative md:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          aria-label="Sidebar"
        >
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-3 right-3 h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors md:hidden"
            aria-label={t('layout.menu.close')}
          >
            <X size={15} aria-hidden="true" />
          </button>
          {sidebarContent}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="sticky top-0 z-30 border-b border-[color:var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
              <button
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors md:hidden"
                aria-label={t('layout.menu.open')}
              >
                <Menu size={16} aria-hidden="true" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] mb-0.5">
                  <span>{t('layout.header.workspace')}</span>
                  <ChevronRight size={11} aria-hidden="true" />
                  <span>{t(meta.titleKey, meta.params)}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{t(meta.subtitleKey)}</p>
              </div>

              <LanguageToggle compact />

              <div className="hidden md:flex status-chip text-[var(--text-secondary)] bg-blue-500/10 border-blue-500/25">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                {t('layout.header.liveData')}
              </div>
            </div>
          </header>

          <main className="px-4 pb-4 md:px-6 md:pb-6 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="mx-auto max-w-[1500px]"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  )
}
