# Phase 7: React Risk Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a professional React 18 + TypeScript + Vite + Tailwind CSS 4 single-page app at `/frontend` with JWT auth, SSE streaming chat, Portfolio CRUD, market data, document upload, PDF download, and risk radar charts.

**Architecture:** Single Vite app at `/frontend`. React Router v6 for client-side routing. A thin `src/api/` client layer wraps all fetch calls (handles JWT header injection + JSON parse). Pages are plain React components. Tailwind CSS 4 for styling. No Redux — `useState`/`useContext` only. Auth state stored in `localStorage` + a `AuthContext`.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Tailwind CSS 4, React Router v6, Recharts 2, Framer Motion 11, `lucide-react` icons.

---

## Backend API Reference (already built)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register → `{token, username, email}` |
| POST | `/api/auth/login` | No | Login → `{token, username, email}` |
| GET | `/api/portfolios` | JWT | List portfolios |
| POST | `/api/portfolios` | JWT | Create portfolio |
| GET | `/api/portfolios/{id}` | JWT | Get single |
| PUT | `/api/portfolios/{id}` | JWT | Update |
| DELETE | `/api/portfolios/{id}` | JWT | Delete |
| POST | `/api/portfolios/{id}/holdings` | JWT | Add holding |
| PUT | `/api/portfolios/{id}/holdings/{hid}` | JWT | Update holding |
| DELETE | `/api/portfolios/{id}/holdings/{hid}` | JWT | Delete holding |
| POST | `/api/chat/stream` | JWT | SSE stream (EventSource-style) |
| POST | `/api/chat/assess` | JWT | Synchronous risk report |
| GET | `/api/chat/sessions/{sessionId}` | JWT | Chat history |
| GET | `/api/market/quote/{ticker}` | No | Market quote |
| GET | `/api/market/history/{ticker}?days=30` | No | OHLCV history |
| POST | `/api/documents` (multipart) | JWT | Upload doc |
| GET | `/api/documents` | JWT | List docs |
| GET | `/api/reports/{id}/pdf` | JWT | Download PDF |

**Base URL**: `http://localhost:8080` (Spring Boot dev server)

**JWT header**: `Authorization: Bearer <token>`

**SSE note**: The backend `/api/chat/stream` is a `POST` endpoint returning `text/event-stream`. Because the native `EventSource` API only supports GET, use `fetch()` with streaming body reader. Events arrive as: `event: message\ndata: {"content":"...","sessionId":"..."}\n\n` and terminate with `event: done\ndata: [DONE]\n\n`.

---

## Task 1: Vite + React + TypeScript + Tailwind scaffold

**Files:**
- Create: `frontend/` (entire directory via npm)
- Modify: `frontend/vite.config.ts` (proxy to backend)
- Modify: `frontend/src/index.css` (Tailwind directives)
- Modify: `frontend/package.json`

### Step 1: Scaffold the project

```bash
cd /Users/hongxichen/Desktop/FinSentinel
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
npm install -D tailwindcss@4 @tailwindcss/vite
npm install react-router-dom@6 recharts framer-motion lucide-react
```

### Step 2: Configure Tailwind CSS 4

Tailwind CSS 4 uses a Vite plugin (no `tailwind.config.js` needed). Edit `frontend/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      }
    }
  }
})
```

Replace `frontend/src/index.css` contents with:

```css
@import "tailwindcss";
```

### Step 3: Verify dev server starts

```bash
cd /Users/hongxichen/Desktop/FinSentinel/frontend && npm run dev
```

Expected: Vite server starts on `http://localhost:5173`, no errors.
Ctrl+C to stop.

### Step 4: Commit

```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/
git commit -m "feat(frontend): scaffold Vite + React + TypeScript + Tailwind 4"
```

---

## Task 2: API client layer + AuthContext

**Files:**
- Create: `frontend/src/api/client.ts` — base fetch wrapper
- Create: `frontend/src/api/auth.ts` — register/login calls
- Create: `frontend/src/api/portfolio.ts` — portfolio + holding CRUD
- Create: `frontend/src/api/market.ts` — market quote/history
- Create: `frontend/src/api/documents.ts` — upload/list docs
- Create: `frontend/src/api/reports.ts` — PDF download
- Create: `frontend/src/api/chat.ts` — SSE streaming + assess
- Create: `frontend/src/context/AuthContext.tsx` — JWT auth state

### Step 1: Create `frontend/src/api/client.ts`

```typescript
const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('jwt_token')
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  // Handle 204 No Content
  if (res.status === 204) return undefined as T
  return res.json()
}

export { BASE, authHeaders }
```

### Step 2: Create `frontend/src/api/auth.ts`

```typescript
import { apiFetch } from './client'

export interface AuthResponse {
  token: string
  username: string
  email: string
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function register(
  username: string,
  email: string,
  password: string
): Promise<AuthResponse> {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, email, password }),
  })
}
```

### Step 3: Create `frontend/src/api/portfolio.ts`

```typescript
import { apiFetch } from './client'

export interface HoldingResponse {
  id: string
  symbol: string
  companyName: string
  quantity: number
  averageCost: number
  currentPrice: number | null
  sector: string
}

export interface PortfolioResponse {
  id: string
  name: string
  description: string
  totalValue: number
  holdings: HoldingResponse[]
  createdAt: string
}

export interface PortfolioRequest {
  name: string
  description?: string
}

export interface HoldingRequest {
  symbol: string
  companyName?: string
  quantity: number
  averageCost: number
  sector?: string
}

export const portfolioApi = {
  list: () => apiFetch<PortfolioResponse[]>('/portfolios'),
  get: (id: string) => apiFetch<PortfolioResponse>(`/portfolios/${id}`),
  create: (data: PortfolioRequest) =>
    apiFetch<PortfolioResponse>('/portfolios', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: PortfolioRequest) =>
    apiFetch<PortfolioResponse>(`/portfolios/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiFetch<void>(`/portfolios/${id}`, { method: 'DELETE' }),

  addHolding: (portfolioId: string, data: HoldingRequest) =>
    apiFetch<HoldingResponse>(`/portfolios/${portfolioId}/holdings`, {
      method: 'POST', body: JSON.stringify(data),
    }),
  updateHolding: (portfolioId: string, holdingId: string, data: HoldingRequest) =>
    apiFetch<HoldingResponse>(`/portfolios/${portfolioId}/holdings/${holdingId}`, {
      method: 'PUT', body: JSON.stringify(data),
    }),
  deleteHolding: (portfolioId: string, holdingId: string) =>
    apiFetch<void>(`/portfolios/${portfolioId}/holdings/${holdingId}`, { method: 'DELETE' }),
}
```

### Step 4: Create `frontend/src/api/market.ts`

```typescript
import { apiFetch } from './client'

export interface QuoteData {
  ticker: string
  close: number
  open: number
  high: number
  low: number
  volume: number
  timestamp: number
}

export const marketApi = {
  quote: (ticker: string) => apiFetch<QuoteData>(`/market/quote/${ticker}`),
  history: (ticker: string, days = 30) =>
    apiFetch<Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>>(
      `/market/history/${ticker}?days=${days}`
    ),
}
```

### Step 5: Create `frontend/src/api/documents.ts`

```typescript
import { BASE, authHeaders } from './client'

export interface DocumentResponse {
  id: string
  fileName: string
  docType: string
  status: string
  sector: string | null
  regionId: string
  fileSize: number
  chunkCount: number | null
  createdAt: string
}

export const documentsApi = {
  list: async (): Promise<DocumentResponse[]> => {
    const res = await fetch(`${BASE}/documents`, {
      headers: { ...authHeaders() },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },

  upload: async (
    file: File,
    docType: string,
    sector?: string
  ): Promise<DocumentResponse> => {
    const form = new FormData()
    form.append('file', file)
    form.append('docType', docType)
    if (sector) form.append('sector', sector)
    form.append('regionId', 'US')

    const res = await fetch(`${BASE}/documents`, {
      method: 'POST',
      headers: { ...authHeaders() }, // NO Content-Type header — browser sets multipart boundary
      body: form,
    })
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  },
}
```

### Step 6: Create `frontend/src/api/reports.ts`

```typescript
import { BASE, authHeaders } from './client'

export async function downloadPdf(reportId: string): Promise<void> {
  const res = await fetch(`${BASE}/reports/${reportId}/pdf`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(`${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `risk-report-${reportId}.pdf`
  a.click()
  URL.revokeObjectURL(url)
}
```

### Step 7: Create `frontend/src/api/chat.ts`

```typescript
import { BASE, authHeaders } from './client'
import { apiFetch } from './client'

export interface RiskFactor {
  category: string
  score: number
  description: string
}

export interface ComplianceNote {
  disclaimer: string
  regulatoryFramework: string
  isCompliant: boolean
}

export interface RiskReport {
  riskScore: number
  riskLevel: string
  summary: string
  factors: RiskFactor[]
  actionableAdvice: string[]
  complianceNote: ComplianceNote
}

export interface ChatMessage {
  id: string
  sessionId: string
  role: string
  content: string
  createdAt: string
}

export const chatApi = {
  assess: (message: string, portfolioId?: string, sessionId?: string): Promise<RiskReport> =>
    apiFetch('/chat/assess', {
      method: 'POST',
      body: JSON.stringify({ message, sessionId, portfolioId }),
    }),

  history: (sessionId: string): Promise<ChatMessage[]> =>
    apiFetch(`/chat/sessions/${sessionId}`),

  /**
   * POST /api/chat/stream — returns a ReadableStream of SSE chunks.
   * The caller must read the stream and handle 'message' and 'done' events.
   */
  stream: async (
    message: string,
    portfolioId: string | undefined,
    sessionId: string | undefined,
    onChunk: (text: string, sessionId: string) => void,
    onDone: () => void,
    onError: (err: string) => void
  ): Promise<void> => {
    const url = portfolioId
      ? `${BASE}/chat/stream?portfolioId=${portfolioId}`
      : `${BASE}/chat/stream`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(),
      },
      body: JSON.stringify({ message, sessionId }),
    })

    if (!res.ok) {
      onError(`HTTP ${res.status}`)
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      let eventName = ''
      for (const line of lines) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (eventName === 'done') {
            onDone()
          } else if (eventName === 'error') {
            try { onError(JSON.parse(data).message) } catch { onError(data) }
          } else if (eventName === 'message') {
            try {
              const parsed = JSON.parse(data)
              onChunk(parsed.content ?? '', parsed.sessionId ?? '')
            } catch { /* ignore malformed */ }
          }
        } else if (line === '') {
          eventName = ''
        }
      }
    }
  },
}
```

### Step 8: Create `frontend/src/context/AuthContext.tsx`

```tsx
import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface AuthUser {
  token: string
  username: string
  email: string
}

interface AuthContextValue {
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem('auth_user')
    return stored ? JSON.parse(stored) : null
  })

  useEffect(() => {
    if (user) {
      localStorage.setItem('auth_user', JSON.stringify(user))
      localStorage.setItem('jwt_token', user.token)
    } else {
      localStorage.removeItem('auth_user')
      localStorage.removeItem('jwt_token')
    }
  }, [user])

  const login = (u: AuthUser) => setUser(u)
  const logout = () => setUser(null)

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
```

### Step 9: Verify TypeScript compiles

```bash
cd /Users/hongxichen/Desktop/FinSentinel/frontend && npx tsc --noEmit
```
Expected: no errors.

### Step 10: Commit

```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/api/ frontend/src/context/
git commit -m "feat(frontend): add API client layer and AuthContext"
```

---

## Task 3: App shell — Router + layout + Login/Register pages

**Files:**
- Create: `frontend/src/components/Layout.tsx` — sidebar nav + outlet
- Create: `frontend/src/components/ProtectedRoute.tsx` — redirect to /login if no auth
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/pages/RegisterPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

### Step 1: Create `frontend/src/components/ProtectedRoute.tsx`

```tsx
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute() {
  const { user } = useAuth()
  return user ? <Outlet /> : <Navigate to="/login" replace />
}
```

### Step 2: Create `frontend/src/components/Layout.tsx`

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, MessageSquare, Briefcase, BarChart2,
  FileText, FileDown, LogOut
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

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <aside className="w-56 flex flex-col bg-gray-900 border-r border-gray-800">
        <div className="px-4 py-5 border-b border-gray-800">
          <p className="text-lg font-bold text-blue-400">FinSentinel</p>
          <p className="text-xs text-gray-500 truncate">{user?.username}</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
```

### Step 3: Create `frontend/src/pages/LoginPage.tsx`

```tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { login as apiLogin } from '../api/auth'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiLogin(username, password)
      login(res)
      navigate('/dashboard')
    } catch (err) {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl p-8 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-blue-400 mb-2">FinSentinel</h1>
        <p className="text-gray-400 text-sm mb-6">AI Investment Risk Platform</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-gray-500 text-sm mt-4 text-center">
          No account?{' '}
          <Link to="/register" className="text-blue-400 hover:underline">Register</Link>
        </p>
      </div>
    </div>
  )
}
```

### Step 4: Create `frontend/src/pages/RegisterPage.tsx`

```tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { register as apiRegister } from '../api/auth'

export default function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiRegister(form.username, form.email, form.password)
      login(res)
      navigate('/dashboard')
    } catch (err) {
      setError('Registration failed. Username may already exist.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl p-8 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-blue-400 mb-6">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(['username', 'email', 'password'] as const).map(field => (
            <div key={field}>
              <label className="block text-sm text-gray-400 mb-1 capitalize">{field}</label>
              <input
                type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
                value={form[field]}
                onChange={set(field)}
                required
              />
            </div>
          ))}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <p className="text-gray-500 text-sm mt-4 text-center">
          Have an account?{' '}
          <Link to="/login" className="text-blue-400 hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
```

### Step 5: Rewrite `frontend/src/App.tsx`

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
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
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

### Step 6: Update `frontend/src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

### Step 7: Create stub pages (so App.tsx lazy imports don't fail)

Create these 6 stub files — they'll be replaced in later tasks:

`frontend/src/pages/DashboardPage.tsx`:
```tsx
export default function DashboardPage() { return <div className="p-8 text-gray-400">Dashboard — coming soon</div> }
```

`frontend/src/pages/ChatPage.tsx`:
```tsx
export default function ChatPage() { return <div className="p-8 text-gray-400">Chat — coming soon</div> }
```

`frontend/src/pages/PortfolioPage.tsx`:
```tsx
export default function PortfolioPage() { return <div className="p-8 text-gray-400">Portfolio — coming soon</div> }
```

`frontend/src/pages/AnalysisPage.tsx`:
```tsx
export default function AnalysisPage() { return <div className="p-8 text-gray-400">Analysis — coming soon</div> }
```

`frontend/src/pages/DocumentsPage.tsx`:
```tsx
export default function DocumentsPage() { return <div className="p-8 text-gray-400">Documents — coming soon</div> }
```

`frontend/src/pages/ReportsPage.tsx`:
```tsx
export default function ReportsPage() { return <div className="p-8 text-gray-400">Reports — coming soon</div> }
```

### Step 8: Verify TypeScript + build

```bash
cd /Users/hongxichen/Desktop/FinSentinel/frontend
npx tsc --noEmit && npm run build
```
Expected: BUILD successful, no TS errors.

### Step 9: Commit

```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/
git commit -m "feat(frontend): app shell with router, layout sidebar, login/register pages"
```

---

## Task 4: Dashboard page

**File:** `frontend/src/pages/DashboardPage.tsx`

Shows the user's portfolios as cards with total value and a quick risk score if available. Uses market data for a few tickers.

```tsx
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { marketApi, type QuoteData } from '../api/market'
import { TrendingUp, TrendingDown, Briefcase, DollarSign } from 'lucide-react'
import { Link } from 'react-router-dom'

const WATCH_TICKERS = ['AAPL', 'MSFT', 'NVDA', 'TSLA']

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gray-900 rounded-xl p-5 border border-gray-800"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-gray-400 text-sm">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <p className="text-2xl font-bold text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </motion.div>
  )
}

export default function DashboardPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    portfolioApi.list().then(setPortfolios).finally(() => setLoading(false))
    WATCH_TICKERS.forEach(t =>
      marketApi.quote(t).then(q => setQuotes(prev => ({ ...prev, [t]: q }))).catch(() => {})
    )
  }, [])

  const totalValue = portfolios.reduce((s, p) => s + Number(p.totalValue), 0)
  const totalHoldings = portfolios.reduce((s, p) => s + p.holdings.length, 0)

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Portfolio overview & market watchlist</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Total AUM"
          value={`$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          color="text-green-400"
        />
        <StatCard label="Portfolios" value={String(portfolios.length)} icon={Briefcase} color="text-blue-400" />
        <StatCard label="Holdings" value={String(totalHoldings)} icon={TrendingUp} color="text-purple-400" />
      </div>

      {/* Portfolio cards */}
      <section>
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Your Portfolios</h2>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : portfolios.length === 0 ? (
          <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-8 text-center">
            <p className="text-gray-400">No portfolios yet.</p>
            <Link to="/portfolio" className="text-blue-400 text-sm hover:underline mt-2 inline-block">
              Create your first portfolio →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {portfolios.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-blue-700 transition-colors"
              >
                <p className="font-semibold text-gray-100 truncate">{p.name}</p>
                <p className="text-gray-500 text-xs truncate mt-0.5">{p.description || 'No description'}</p>
                <p className="text-xl font-bold text-green-400 mt-3">
                  ${Number(p.totalValue).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </p>
                <p className="text-gray-500 text-xs mt-1">{p.holdings.length} holdings</p>
              </motion.div>
            ))}
          </div>
        )}
      </section>

      {/* Market watchlist */}
      <section>
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Market Watchlist</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {WATCH_TICKERS.map(ticker => {
            const q = quotes[ticker]
            const change = q ? ((q.close - q.open) / q.open) * 100 : null
            return (
              <div key={ticker} className="bg-gray-900 rounded-xl p-4 border border-gray-800">
                <p className="font-mono font-bold text-gray-100">{ticker}</p>
                {q ? (
                  <>
                    <p className="text-lg font-bold mt-1">${q.close.toFixed(2)}</p>
                    <p className={`text-xs flex items-center gap-1 mt-0.5 ${change! >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {change! >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {change!.toFixed(2)}%
                    </p>
                  </>
                ) : (
                  <p className="text-gray-600 text-sm mt-1">Loading…</p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/DashboardPage.tsx
git commit -m "feat(frontend): dashboard page with portfolio cards and market watchlist"
```

---

## Task 5: Chat page — SSE streaming typewriter

**File:** `frontend/src/pages/ChatPage.tsx`

```tsx
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User } from 'lucide-react'
import { chatApi } from '../api/chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const msg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setStreaming(true)

    // Add a streaming placeholder
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }])

    await chatApi.stream(
      msg,
      undefined,
      sessionId,
      (chunk, sid) => {
        if (!sessionId) setSessionId(sid)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last.streaming) last.content += chunk
          return copy
        })
      },
      () => {
        setStreaming(false)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last.streaming) last.streaming = false
          return copy
        })
      },
      (err) => {
        setStreaming(false)
        setMessages(prev => {
          const copy = [...prev]
          const last = copy[copy.length - 1]
          if (last.streaming) {
            last.content = `Error: ${err}`
            last.streaming = false
          }
          return copy
        })
      }
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900">
        <h1 className="text-lg font-semibold text-gray-100">AI Risk Advisor</h1>
        <p className="text-xs text-gray-500">Powered by FinSentinel Agent — SEC Compliant</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-600 pt-16">
            <Bot size={40} className="mx-auto mb-3 text-gray-700" />
            <p>Ask me about portfolio risk, market conditions, or SEC compliance.</p>
          </div>
        )}
        <AnimatePresence>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot size={14} />
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-gray-800 text-gray-100 rounded-bl-sm'
                }`}
              >
                {m.content}
                {m.streaming && (
                  <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse" />
                )}
              </div>
              {m.role === 'user' && (
                <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0 mt-1">
                  <User size={14} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-gray-800 bg-gray-900">
        <div className="flex gap-3">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-gray-100 text-sm focus:outline-none focus:border-blue-500 disabled:opacity-50"
            placeholder="Ask about risk, portfolio, SEC regulations..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat(frontend): chat page with SSE streaming typewriter effect"
```

---

## Task 6: Portfolio page — CRUD + holdings table

**File:** `frontend/src/pages/PortfolioPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Edit3, ChevronDown, ChevronUp } from 'lucide-react'
import { portfolioApi, type PortfolioResponse, type HoldingResponse } from '../api/portfolio'

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

function InputField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <input
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
            <InputField label="Name" value={portForm.name} onChange={v => setPortForm(f => ({ ...f, name: v }))} />
            <InputField label="Description (optional)" value={portForm.description} onChange={v => setPortForm(f => ({ ...f, description: v }))} />
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
            <InputField label="Symbol (e.g. AAPL)" value={holdForm.symbol} onChange={v => setHoldForm(f => ({ ...f, symbol: v }))} />
            <InputField label="Company Name" value={holdForm.companyName} onChange={v => setHoldForm(f => ({ ...f, companyName: v }))} />
            <InputField label="Quantity" value={holdForm.quantity} onChange={v => setHoldForm(f => ({ ...f, quantity: v }))} type="number" />
            <InputField label="Average Cost ($)" value={holdForm.averageCost} onChange={v => setHoldForm(f => ({ ...f, averageCost: v }))} type="number" />
            <InputField label="Sector" value={holdForm.sector} onChange={v => setHoldForm(f => ({ ...f, sector: v }))} />
            <button onClick={() => addHolding(showAddHolding)} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-medium">
              Add Holding
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/PortfolioPage.tsx
git commit -m "feat(frontend): portfolio page with CRUD and holdings table"
```

---

## Task 7: Analysis page — Recharts radar chart

**File:** `frontend/src/pages/AnalysisPage.tsx`

Run a risk assessment and render the `RiskFactor[]` as a radar chart.

```tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip
} from 'recharts'
import { chatApi, type RiskReport } from '../api/chat'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { useEffect } from 'react'
import { ShieldAlert, ShieldCheck } from 'lucide-react'

const LEVEL_COLOR: Record<string, string> = {
  LOW: 'text-green-400',
  MEDIUM: 'text-yellow-400',
  HIGH: 'text-orange-400',
  CRITICAL: 'text-red-400',
}

export default function AnalysisPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [query, setQuery] = useState('Analyze my portfolio risk and provide a full assessment')
  const [report, setReport] = useState<RiskReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    portfolioApi.list().then(ps => {
      setPortfolios(ps)
      if (ps.length > 0) setSelectedId(ps[0].id)
    })
  }, [])

  const runAssessment = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await chatApi.assess(query, selectedId || undefined)
      setReport(r)
    } catch (e) {
      setError('Assessment failed. Ensure the backend is running.')
    } finally {
      setLoading(false)
    }
  }

  const radarData = report?.factors?.map(f => ({ subject: f.category, score: f.score })) ?? []

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Risk Analysis</h1>
        <p className="text-gray-500 text-sm mt-1">AI-powered structured risk assessment with radar visualization</p>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
        <div className="flex gap-4 flex-wrap">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-sm text-gray-400 mb-1">Portfolio</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">No portfolio (general)</option>
              {portfolios.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[300px]">
            <label className="block text-sm text-gray-400 mb-1">Assessment Query</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={runAssessment}
          disabled={loading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          {loading ? 'Analyzing...' : 'Run Assessment'}
        </button>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>

      {report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          {/* Score banner */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 flex items-center gap-6">
            <div>
              {report.riskLevel === 'LOW' || report.riskLevel === 'MEDIUM'
                ? <ShieldCheck size={48} className="text-green-400" />
                : <ShieldAlert size={48} className="text-red-400" />
              }
            </div>
            <div>
              <p className="text-gray-400 text-sm">Risk Score</p>
              <p className={`text-5xl font-bold ${LEVEL_COLOR[report.riskLevel] ?? 'text-gray-100'}`}>
                {report.riskScore}<span className="text-2xl text-gray-500">/100</span>
              </p>
              <p className={`text-lg font-semibold mt-1 ${LEVEL_COLOR[report.riskLevel] ?? 'text-gray-100'}`}>
                {report.riskLevel}
              </p>
            </div>
            <div className="flex-1 border-l border-gray-700 pl-6">
              <p className="text-gray-300 text-sm leading-relaxed">{report.summary}</p>
            </div>
          </div>

          {/* Radar chart */}
          {radarData.length > 0 && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
              <h2 className="text-lg font-semibold text-gray-200 mb-4">Risk Factor Radar</h2>
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <Radar
                    name="Risk Score"
                    dataKey="score"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.3}
                  />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
                    labelStyle={{ color: '#d1d5db' }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Advice */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <h2 className="text-lg font-semibold text-gray-200 mb-3">Actionable Recommendations</h2>
            <ol className="space-y-2">
              {report.actionableAdvice?.map((a, i) => (
                <li key={i} className="flex gap-3 text-gray-300 text-sm">
                  <span className="text-blue-400 font-bold flex-shrink-0">{i + 1}.</span>
                  {a}
                </li>
              ))}
            </ol>
          </div>

          {/* Compliance */}
          {report.complianceNote && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">
                {report.complianceNote.regulatoryFramework} Compliance Notice
              </p>
              <p className="text-gray-500 text-xs">{report.complianceNote.disclaimer}</p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  )
}
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/AnalysisPage.tsx
git commit -m "feat(frontend): analysis page with risk assessment and Recharts radar chart"
```

---

## Task 8: Documents page — upload + list

**File:** `frontend/src/pages/DocumentsPage.tsx`

```tsx
import { useEffect, useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import { documentsApi, type DocumentResponse } from '../api/documents'

const DOC_TYPES = ['REGULATION', 'RESEARCH', 'NEWS', 'EARNINGS', 'OTHER']

function StatusIcon({ status }: { status: string }) {
  if (status === 'PROCESSED') return <CheckCircle size={14} className="text-green-400" />
  if (status === 'PENDING') return <Clock size={14} className="text-yellow-400" />
  return <AlertCircle size={14} className="text-red-400" />
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState('REGULATION')
  const [sector, setSector] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    documentsApi.list().then(setDocs).finally(() => setLoading(false))

  useEffect(() => { refresh() }, [])

  const upload = async (file: File) => {
    setUploading(true)
    try {
      await documentsApi.upload(file, docType, sector || undefined)
      refresh()
    } catch (e) {
      alert('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) upload(f)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) upload(f)
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Documents</h1>
        <p className="text-gray-500 text-sm mt-1">Upload regulatory filings, research reports, and news for RAG analysis</p>
      </div>

      {/* Upload area */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-200">Upload Document</h2>

        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Document Type</label>
            <select
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
              value={docType}
              onChange={e => setDocType(e.target.value)}
            >
              {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Sector (optional)</label>
            <input
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 w-40"
              placeholder="e.g. Technology"
              value={sector}
              onChange={e => setSector(e.target.value)}
            />
          </div>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-900/10' : 'border-gray-700 hover:border-gray-500'
          }`}
        >
          <Upload size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400 text-sm">
            {uploading ? 'Uploading...' : 'Drop a file here or click to browse'}
          </p>
          <p className="text-gray-600 text-xs mt-1">PDF, DOCX, TXT supported</p>
          <input ref={fileRef} type="file" className="hidden" onChange={onFileChange} accept=".pdf,.docx,.txt,.md" />
        </div>
      </div>

      {/* Document list */}
      <div>
        <h2 className="text-base font-semibold text-gray-200 mb-3">
          Uploaded Documents ({docs.length})
        </h2>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : docs.length === 0 ? (
          <p className="text-gray-600">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {docs.map((d, i) => (
              <motion.div
                key={d.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-3 flex items-center gap-4"
              >
                <FileText size={18} className="text-blue-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 text-sm font-medium truncate">{d.fileName}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {d.docType} · {formatSize(d.fileSize)} · {d.regionId}
                    {d.sector ? ` · ${d.sector}` : ''}
                    {d.chunkCount != null ? ` · ${d.chunkCount} chunks` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <StatusIcon status={d.status} />
                  {d.status}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/DocumentsPage.tsx
git commit -m "feat(frontend): documents page with drag-drop upload and document list"
```

---

## Task 9: Reports page — PDF download

**File:** `frontend/src/pages/ReportsPage.tsx`

Fetches portfolios, lets user pick one, lists associated reports via the `/api/portfolios/{id}` endpoint (reports are stored on portfolios). Downloads PDF via the existing `GET /api/reports/{id}/pdf` endpoint.

**Note:** The backend does not have a `GET /api/reports?portfolioId=...` list endpoint. However, `RiskReportRepository.findByPortfolioIdOrderByCreatedAtDesc(UUID)` exists. We need a simple list endpoint. Add it to `PortfolioController` as a nested resource: `GET /api/portfolios/{id}/reports`.

### Step 1: Add report list endpoint to backend

Add to `src/main/java/com/example/finsentinel/controller/PortfolioController.java`:

```java
// Add these imports at the top:
import com.example.finsentinel.dto.risk.RiskReport;
import com.example.finsentinel.mapper.RiskReportMapper;
import com.example.finsentinel.repository.RiskReportRepository;
import java.util.List;

// Add to the class body (alongside existing @Mock injections via @RequiredArgsConstructor):
// Note: also add RiskReportRepository and RiskReportMapper to the @RequiredArgsConstructor fields
```

Actually — to keep it minimal and avoid modifying PortfolioController, add a new `GET /api/portfolios/{id}/reports` endpoint by adding to `PortfolioController.java`:

In `PortfolioController.java`, add these two new fields to the constructor (already uses `@RequiredArgsConstructor` so just declare the fields):

```java
private final com.example.finsentinel.repository.RiskReportRepository riskReportRepository;
private final com.example.finsentinel.mapper.RiskReportMapper riskReportMapper;
```

And add this method:

```java
@GetMapping("/{id}/reports")
public ResponseEntity<List<RiskReport>> listReports(
        @PathVariable UUID id,
        @AuthenticationPrincipal UserDetails userDetails) {
    // Verify portfolio ownership
    portfolioService.getById(id, resolveUserId(userDetails));
    return ResponseEntity.ok(
        riskReportRepository.findByPortfolioIdOrderByCreatedAtDesc(id)
            .stream().map(riskReportMapper::toDto).toList()
    );
}
```

**File to modify:** `src/main/java/com/example/finsentinel/controller/PortfolioController.java`

Add the two private fields and the new `@GetMapping` method. Do NOT change any existing methods.

### Step 2: Update `frontend/src/api/portfolio.ts`

Add to the `portfolioApi` object:

```typescript
listReports: (portfolioId: string) =>
  apiFetch<import('../api/chat').RiskReport[]>(`/portfolios/${portfolioId}/reports`),
```

### Step 3: Create `frontend/src/pages/ReportsPage.tsx`

```tsx
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileDown, ShieldAlert, ShieldCheck, Calendar } from 'lucide-react'
import { portfolioApi, type PortfolioResponse } from '../api/portfolio'
import { type RiskReport } from '../api/chat'
import { downloadPdf } from '../api/reports'

const LEVEL_COLOR: Record<string, string> = {
  LOW: 'text-green-400 bg-green-900/20 border-green-800',
  MEDIUM: 'text-yellow-400 bg-yellow-900/20 border-yellow-800',
  HIGH: 'text-orange-400 bg-orange-900/20 border-orange-800',
  CRITICAL: 'text-red-400 bg-red-900/20 border-red-800',
}

// Extended to include id — the backend RiskReport DTO doesn't have id,
// but we need it to download. We'll type-cast from the API response.
interface ReportWithId extends RiskReport {
  id?: string
}

export default function ReportsPage() {
  const [portfolios, setPortfolios] = useState<PortfolioResponse[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [reports, setReports] = useState<ReportWithId[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    portfolioApi.list().then(ps => {
      setPortfolios(ps)
      if (ps.length > 0) setSelectedId(ps[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    // @ts-expect-error: listReports may not exist on type yet
    portfolioApi.listReports(selectedId)
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false))
  }, [selectedId])

  const handleDownload = async (reportId: string) => {
    if (!reportId) return
    setDownloading(reportId)
    try {
      await downloadPdf(reportId)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Risk Reports</h1>
        <p className="text-gray-500 text-sm mt-1">Download PDF risk assessment reports for your portfolios</p>
      </div>

      {/* Portfolio selector */}
      <div className="flex items-center gap-3">
        <label className="text-gray-400 text-sm">Portfolio:</label>
        <select
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          {portfolios.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* Reports list */}
      {loading ? (
        <p className="text-gray-500">Loading reports...</p>
      ) : reports.length === 0 ? (
        <div className="bg-gray-900 border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <p className="text-gray-400">No risk reports yet for this portfolio.</p>
          <p className="text-gray-600 text-sm mt-2">Run an assessment on the Analysis page to generate a report.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((r: any, i) => (
            <motion.div
              key={r.id ?? i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-gray-900 rounded-xl border border-gray-800 p-5 flex items-center gap-5"
            >
              <div>
                {r.riskLevel === 'LOW' || r.riskLevel === 'MEDIUM'
                  ? <ShieldCheck size={32} className="text-green-400" />
                  : <ShieldAlert size={32} className="text-red-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${LEVEL_COLOR[r.riskLevel] ?? 'text-gray-400'}`}>
                    {r.riskLevel}
                  </span>
                  <span className="text-gray-100 font-bold text-lg">{r.riskScore}/100</span>
                </div>
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{r.summary}</p>
                {r.createdAt && (
                  <p className="text-gray-600 text-xs flex items-center gap-1 mt-1">
                    <Calendar size={11} /> {new Date(r.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
              {r.id && (
                <button
                  onClick={() => handleDownload(r.id)}
                  disabled={downloading === r.id}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0"
                >
                  <FileDown size={16} />
                  {downloading === r.id ? 'Downloading...' : 'PDF'}
                </button>
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
```

### Step 4: Build frontend to verify no TS errors

```bash
cd /Users/hongxichen/Desktop/FinSentinel/frontend && npm run build
```
Expected: BUILD successful.

### Step 5: Commit

```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/pages/ReportsPage.tsx \
        frontend/src/api/portfolio.ts \
        src/main/java/com/example/finsentinel/controller/PortfolioController.java
git commit -m "feat(frontend): reports page with PDF download; add GET /api/portfolios/{id}/reports"
```

---

## Task 10: Framer Motion page transitions + final polish

**Files:**
- Modify: `frontend/src/components/Layout.tsx` — wrap `<Outlet>` in `AnimatePresence` + `motion.div`
- Modify: `frontend/src/index.css` — global scrollbar styling
- Verify full build passes

### Step 1: Add page transition wrapper to Layout.tsx

Replace the `<main>` section in `Layout.tsx`:

```tsx
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'

// Inside Layout():
const location = useLocation()

// Replace the <main> block:
<main className="flex-1 overflow-y-auto">
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
```

### Step 2: Custom scrollbar styling in `frontend/src/index.css`

```css
@import "tailwindcss";

* {
  scrollbar-width: thin;
  scrollbar-color: #374151 transparent;
}
*::-webkit-scrollbar { width: 6px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
```

### Step 3: Final build verification

```bash
cd /Users/hongxichen/Desktop/FinSentinel/frontend && npm run build
```
Expected: BUILD successful, no errors.

### Step 4: Commit + push

```bash
cd /Users/hongxichen/Desktop/FinSentinel
git add frontend/src/components/Layout.tsx frontend/src/index.css
git commit -m "feat(frontend): Framer Motion page transitions and scrollbar polish"
bash /Users/hongxichen/.claude/skills/git-pushing/scripts/smart_commit.sh
```

---

## Task 11: Update task_plan.md + mark Phase 7 complete

Edit `task_plan.md` Phase 7 section to mark all tasks complete, then update the Status section.

```markdown
## Phase 7: Frontend — React Risk Dashboard ✅ COMPLETE

| Task | Owner | Status |
|------|-------|--------|
| 7.1 React + TS + Vite + Tailwind 4 | 🤖 | ✅ `frontend/` scaffolded with @tailwindcss/vite plugin, dev proxy to :8080 |
| 7.2 Sidebar layout + React Router v6 | 🤖 | ✅ Layout.tsx sidebar + ProtectedRoute + 6 routes |
| 7.3 Dashboard page | 🤖 | ✅ Portfolio cards, AUM stat, market watchlist (AAPL/MSFT/NVDA/TSLA) |
| 7.4 Chat page (SSE streaming) | 🤖 | ✅ Typewriter effect via fetch stream reader, session persistence |
| 7.5 Portfolio page (CRUD) | 🤖 | ✅ Create/delete portfolios + add/delete holdings, collapsible table |
| 7.6 Analysis page (Recharts radar) | 🤖 | ✅ Risk assessment form + RadarChart + compliance notice |
| 7.7 Documents page | 🤖 | ✅ Drag-drop upload + document list with status icons |
| 7.8 Reports page (PDF download) | 🤖 | ✅ List reports by portfolio + one-click PDF download |
| 7.9 Framer Motion animations | 🤖 | ✅ Page enter/exit transitions + per-card animations |
```

Commit:
```bash
cd /Users/hongxichen/Desktop/FinSentinel
# task_plan.md is gitignored, so just record completion in the plan doc
git add docs/plans/
git commit -m "docs: mark Phase 7 frontend complete"
bash /Users/hongxichen/.claude/skills/git-pushing/scripts/smart_commit.sh
```

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `frontend/` | Entire Vite + React app |
| `frontend/src/api/client.ts` | Base fetch wrapper with JWT injection |
| `frontend/src/api/auth.ts` | Login/register |
| `frontend/src/api/portfolio.ts` | Portfolio + holding CRUD + report list |
| `frontend/src/api/market.ts` | Market quote/history |
| `frontend/src/api/documents.ts` | Document upload/list |
| `frontend/src/api/reports.ts` | PDF download trigger |
| `frontend/src/api/chat.ts` | SSE stream reader + assess |
| `frontend/src/context/AuthContext.tsx` | JWT auth state + localStorage |
| `frontend/src/components/Layout.tsx` | Sidebar nav + page transitions |
| `frontend/src/components/ProtectedRoute.tsx` | Auth guard |
| `frontend/src/pages/LoginPage.tsx` | Login form |
| `frontend/src/pages/RegisterPage.tsx` | Register form |
| `frontend/src/pages/DashboardPage.tsx` | Portfolio cards + market watchlist |
| `frontend/src/pages/ChatPage.tsx` | SSE streaming chat |
| `frontend/src/pages/PortfolioPage.tsx` | Portfolio CRUD + holdings table |
| `frontend/src/pages/AnalysisPage.tsx` | Risk assessment + radar chart |
| `frontend/src/pages/DocumentsPage.tsx` | Doc upload + list |
| `frontend/src/pages/ReportsPage.tsx` | PDF download |
| `src/main/java/.../controller/PortfolioController.java` | Add `GET /api/portfolios/{id}/reports` |
