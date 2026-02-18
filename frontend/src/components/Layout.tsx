import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, MessageSquare, Briefcase, BarChart2,
  FileText, FileDown, LogOut, Menu, X
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
      <div className="px-4 py-5 border-b border-gray-800">
        <p className="text-lg font-bold text-blue-400">FinSentinel</p>
        <p className="text-xs text-gray-500 truncate">{user?.username}</p>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-5 py-4 text-sm text-gray-500 hover:text-red-400 border-t border-gray-800 transition-colors"
      >
        <LogOut size={16} /> Logout
      </button>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center h-14 px-4 bg-gray-900 border-b border-gray-800 md:hidden">
        <button onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <p className="ml-3 text-lg font-bold text-blue-400">FinSentinel</p>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — mobile: slide-over; desktop: fixed */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-gray-900 border-r border-gray-800
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-3 text-gray-500 hover:text-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
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
