import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, MessageSquare, Briefcase, BarChart2,
  FileText, FileDown, Newspaper, LogOut, Menu, X, Shield
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/analysis', label: 'Analysis', icon: BarChart2 },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: FileDown },
  { to: '/news', label: 'News', icon: Newspaper },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const sidebarContent = (
    <>
      {/* Logo area */}
      <div className="px-5 py-6 border-b border-zinc-800/50">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-amber-400/80 flex-shrink-0" aria-hidden="true" />
          <p className="text-xl font-display text-amber-400 tracking-tight">
            FinSentinel
          </p>
        </div>
        <p className="text-xs text-zinc-600 truncate mt-1 pl-[26px]">{user?.username}</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-5 space-y-0.5" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 ${
                isActive
                  ? 'border-l-[2px] border-amber-500 bg-amber-500/5 text-amber-400 pl-[10px]'
                  : 'border-l-[2px] border-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-stone-50 pl-[10px]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={isActive ? 17 : 16} aria-hidden="true" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout button */}
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-6 py-4 w-full text-sm text-zinc-600 border-t border-zinc-800/50 transition-all duration-200 hover:bg-red-500/8 hover:text-red-400"
        aria-label="Log out"
      >
        <LogOut size={16} aria-hidden="true" /> Logout
      </button>
    </>
  )

  return (
    <div className="flex h-screen bg-zinc-950 text-stone-50">
      {/* Mobile header */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center h-14 px-4 border-b border-zinc-800/50 bg-zinc-950 md:hidden"
      >
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="text-zinc-500 hover:text-stone-50 transition-colors"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2 ml-3">
          <Shield size={16} className="text-amber-400/80 flex-shrink-0" aria-hidden="true" />
          <p className="text-lg font-display text-amber-400">
            FinSentinel
          </p>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-56 flex flex-col border-r border-zinc-800/50
          bg-zinc-950 transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Sidebar"
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-5 right-3 text-zinc-600 hover:text-stone-50 transition-colors md:hidden"
          aria-label="Close menu"
        >
          <X size={18} aria-hidden="true" />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
