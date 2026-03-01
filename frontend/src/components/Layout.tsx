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
  TrendingUp,
  Bot,
  Bitcoin,
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Advisor Chat', icon: MessageSquare },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/analysis', label: 'Risk Analysis', icon: BarChart2 },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: FileDown },
  { to: '/trading', label: 'Trading', icon: TrendingUp },
  { to: '/crypto', label: 'Crypto Trading', icon: Bitcoin },
  { to: '/news', label: 'News Feed', icon: Newspaper },
  { to: '/autonomy', label: 'Autonomy', icon: Bot },
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
    '/trading': { title: 'Trading Desk', subtitle: 'Stage, commit, and execute trades with git-like workflow' },
    '/crypto': { title: 'Crypto Trading', subtitle: 'OKX account, positions, funding rates, and AI analysis' },
    '/news': { title: 'News Feed', subtitle: 'Live headlines that affect your holdings' },
    '/autonomy': { title: 'Agent Autonomy', subtitle: 'Scheduled tasks, heartbeat monitoring, and event timeline' },
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
      {/* Logo */}
      <div className="px-4 py-4 border-b border-[color:var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-blue-500 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-lg leading-none tracking-tight text-[var(--text-primary)]">FinSentinel</p>
            <p className="mt-0.5 text-[10px] tracking-[0.1em] uppercase text-[var(--text-muted)]">Risk Intelligence</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-2.5 px-3 py-2 rounded text-sm transition-colors duration-150 border-l-2 ${
                isActive
                  ? 'border-blue-500 bg-blue-500/10 text-[var(--text-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/4'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={15}
                  aria-hidden="true"
                  className={isActive ? 'text-blue-400' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}
                />
                <span className="font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div className="px-2 pb-3 border-t border-[color:var(--border-subtle)] pt-2">
        <div className="flex items-center gap-2 px-3 py-2 text-[var(--text-muted)]">
          <UserCircle2 size={14} aria-hidden="true" />
          <p className="text-xs font-medium truncate">{user?.username}</p>
        </div>

        <button
          onClick={handleLogout}
          className="w-full btn-ghost px-3 py-2 text-sm"
          aria-label="Log out"
        >
          <LogOut size={14} aria-hidden="true" />
          Logout
        </button>
      </div>
    </>
  )

  return (
    <div className="app-shell text-[var(--text-primary)]">
      <div className="relative z-10 flex min-h-screen">
        {/* Mobile overlay */}
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
          style={{ display: sidebarOpen ? 'block' : 'none' }}
        />

        {/* Sidebar */}
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
            aria-label="Close menu"
          >
            <X size={15} aria-hidden="true" />
          </button>
          {sidebarContent}
        </aside>

        {/* Content area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <header className="sticky top-0 z-30 border-b border-[color:var(--border-subtle)] bg-[var(--bg-panel)]">
            <div className="flex items-center gap-3 px-4 py-2.5 md:px-6">
              <button
                onClick={() => setSidebarOpen(true)}
                className="h-8 w-8 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/10 transition-colors md:hidden"
                aria-label="Open menu"
              >
                <Menu size={16} aria-hidden="true" />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] mb-0.5">
                  <span>Workspace</span>
                  <ChevronRight size={11} aria-hidden="true" />
                  <span>{meta.title}</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{meta.subtitle}</p>
              </div>

              <div className="hidden sm:flex status-chip text-[var(--text-secondary)] bg-blue-500/10 border-blue-500/25">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                Live data
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="px-4 pb-4 md:px-6 md:pb-6 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
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
