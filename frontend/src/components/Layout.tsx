import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard,
  MessageSquare,
  Briefcase,
  BarChart2,
  FileText,
  FileDown,
  Newspaper,
  LogOut,
  Menu,
  X,
  Shield,
  ChevronRight,
  UserCircle2,
  Settings,
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Advisor Chat', icon: MessageSquare },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/analysis', label: 'Risk Analysis', icon: BarChart2 },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: FileDown },
  { to: '/news', label: 'News Feed', icon: Newspaper },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function routeMeta(pathname: string) {
  if (pathname.startsWith('/stock/')) {
    const ticker = pathname.split('/').at(-1)?.toUpperCase() ?? 'Ticker'
    return {
      title: `${ticker} Snapshot`,
      subtitle: 'Price profile, daily movement, and market context',
    }
  }

  const map: Record<string, { title: string; subtitle: string }> = {
    '/dashboard': { title: 'Control Room', subtitle: 'Portfolio pulse and market breadth at a glance' },
    '/chat': { title: 'Advisor Chat', subtitle: 'Conversational risk and compliance intelligence' },
    '/portfolio': { title: 'Portfolio Studio', subtitle: 'Manage positions, weights, and sectors with precision' },
    '/analysis': { title: 'Risk Analysis', subtitle: 'Structured assessment with factor-level breakdown' },
    '/documents': { title: 'Documents', subtitle: 'Upload, parse, and manage financial source files' },
    '/reports': { title: 'Reports', subtitle: 'Generate and export investor-ready deliverables' },
    '/news': { title: 'News Feed', subtitle: 'Live headlines that affect your holdings' },
    '/settings': { title: 'Settings', subtitle: 'Account preferences and watchlist management' },
  }

  return map[pathname] ?? { title: 'FinSentinel', subtitle: 'AI-powered investment risk intelligence platform' }
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const meta = useMemo(() => routeMeta(location.pathname), [location.pathname])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const sidebarContent = (
    <>
      <div className="px-5 py-5 border-b border-[color:var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-[#1d1302] flex items-center justify-center shadow-lg shadow-amber-600/25">
            <Shield size={18} aria-hidden="true" />
          </div>
          <div>
            <p className="font-display text-2xl leading-none text-[var(--text-primary)]">FinSentinel</p>
            <p className="mt-1 text-[11px] tracking-[0.11em] uppercase text-[var(--text-muted)]">Risk Intelligence</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1.5" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all duration-200 ${
                isActive
                  ? 'border-amber-300/25 bg-amber-400/10 text-amber-100'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 hover:border-[color:var(--border-subtle)]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                    isActive ? 'bg-amber-400/20 text-amber-200' : 'bg-slate-700/30 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
                  }`}
                >
                  <Icon size={16} aria-hidden="true" />
                </span>
                <span className="text-sm font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-3">
        <div className="surface-panel rounded-xl px-3 py-2.5 mb-2">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <UserCircle2 size={15} aria-hidden="true" />
            <p className="text-xs font-medium truncate">{user?.username}</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full btn-ghost px-3 py-2.5 text-sm"
          aria-label="Log out"
        >
          <LogOut size={15} aria-hidden="true" />
          Logout
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -right-20 top-28 h-80 w-80 rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex min-h-screen">
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          style={{ display: sidebarOpen ? 'block' : 'none' }}
        />

        <aside
          className={`
            fixed inset-y-0 left-0 z-50 w-72 flex flex-col glass-panel border-r border-[color:var(--border-subtle)]
            transform transition-transform duration-250 ease-out md:relative md:translate-x-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          aria-label="Sidebar"
        >
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute top-3 right-3 h-8 w-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors md:hidden"
            aria-label="Close menu"
          >
            <X size={16} aria-hidden="true" />
          </button>
          {sidebarContent}
        </aside>

        <div className="flex-1 min-w-0">
          <header className="sticky top-0 z-30 px-4 pt-4 md:px-8">
            <div className="glass-panel rounded-2xl px-4 py-3 md:px-5 md:py-3.5 flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="h-9 w-9 rounded-lg flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors md:hidden"
                aria-label="Open menu"
              >
                <Menu size={18} aria-hidden="true" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.11em] text-[var(--text-muted)] mb-1">
                  <span>Workspace</span>
                  <ChevronRight size={12} aria-hidden="true" />
                  <span>{meta.title}</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] truncate">{meta.subtitle}</p>
              </div>

              <div className="hidden sm:flex status-chip text-[var(--text-secondary)] bg-cyan-500/10 border-cyan-400/25">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                Live data
              </div>
            </div>
          </header>

          <main className="px-4 pb-6 md:px-8 md:pb-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="mx-auto max-w-[1500px]"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  )
}
