import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, type AuthUser } from './auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Initial state is always null so SSR/prerender HTML matches the first
  // client render (prevents hydration mismatch). localStorage is read in
  // the effect below, which fires after hydration.
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem('auth_user')
    if (!stored) return
    try {
      localStorage.removeItem('jwt_token')
      setUser(JSON.parse(stored) as AuthUser)
    } catch {
      localStorage.removeItem('auth_user')
    }
  }, [])

  useEffect(() => {
    if (user) {
      localStorage.setItem('auth_user', JSON.stringify(user))
    } else {
      localStorage.removeItem('auth_user')
    }
  }, [user])

  const login = (u: AuthUser) => setUser(u)
  const logout = () => {
    setUser(null)
    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
