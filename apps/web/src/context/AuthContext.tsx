import { useState, useEffect, type ReactNode } from 'react'
import { AuthContext, type AuthUser } from './auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = localStorage.getItem('auth_user')
    if (!stored) return null
    try {
      localStorage.removeItem('jwt_token')
      return JSON.parse(stored) as AuthUser
    } catch {
      localStorage.removeItem('auth_user')
      return null
    }
  })

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
