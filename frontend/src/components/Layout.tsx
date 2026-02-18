import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, MessageSquare, Briefcase, BarChart2,
  FileText, FileDown, LogOut, Menu, X, Shield
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/analysis', label: 'Analysis', icon: BarChart2 },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: FileDown },
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
      <div className="px-4 py-5 border-b border-gray-800/60">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
          <p
            className="text-lg font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent"
          >
            FinSentinel
          </p>
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5 pl-[26px]">{user?.username}</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-2 py-4 space-y-0.5" aria-label="Main navigation">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
                isActive
                  ? 'border-l-[3px] border-blue-500 bg-blue-500/10 text-blue-400 pl-[9px]'
                  : 'border-l-[3px] border-transparent text-gray-400 hover:bg-gray-800/50 hover:text-gray-100 pl-[9px]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={isActive ? 18 : 16} aria-hidden="true" />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout button */}
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-5 py-4 w-full text-sm text-gray-500 border-t border-gray-800/60 transition-all duration-200 hover:bg-red-500/10 hover:text-red-400"
        aria-label="Log out"
      >
        <LogOut size={16} aria-hidden="true" /> Logout
      </button>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Mobile header */}
      <div
        className="fixed top-0 left-0 right-0 z-30 flex items-center h-14 px-4 border-b border-gray-800/60 md:hidden"
        style={{
          background: 'linear-gradient(to bottom, rgb(17 24 39), rgb(3 7 18))',
        }}
      >
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          className="text-gray-400 hover:text-gray-100 transition-colors"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2 ml-3">
          <Shield size={16} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
          <p
            className="text-lg font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent"
          >
            FinSentinel
          </p>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — mobile: slide-over; desktop: fixed */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-56 flex flex-col border-r border-gray-800/60
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          background: 'linear-gradient(to bottom, rgb(17 24 39), rgb(3 7 18))',
        }}
        aria-label="Sidebar"
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-3 text-gray-500 hover:text-gray-100 transition-colors md:hidden"
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
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
