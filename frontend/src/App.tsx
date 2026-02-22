import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Toast from './components/Toast'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'

// Lazy page imports — filled in later tasks
import { lazy, Suspense } from 'react'
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const NewsPage = lazy(() => import('./pages/NewsPage'))
const StockDetailPage = lazy(() => import('./pages/StockDetailPage'))

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full text-gray-500">
      Loading...
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toast />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Suspense fallback={<LoadingFallback />}><DashboardPage /></Suspense>} />
              <Route path="/chat" element={<Suspense fallback={<LoadingFallback />}><ChatPage /></Suspense>} />
              <Route path="/portfolio" element={<Suspense fallback={<LoadingFallback />}><PortfolioPage /></Suspense>} />
              <Route path="/analysis" element={<Suspense fallback={<LoadingFallback />}><AnalysisPage /></Suspense>} />
              <Route path="/documents" element={<Suspense fallback={<LoadingFallback />}><DocumentsPage /></Suspense>} />
              <Route path="/reports" element={<Suspense fallback={<LoadingFallback />}><ReportsPage /></Suspense>} />
              <Route path="/news" element={<Suspense fallback={<LoadingFallback />}><NewsPage /></Suspense>} />
              <Route path="/stock/:ticker" element={<Suspense fallback={<LoadingFallback />}><StockDetailPage /></Suspense>} />
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
