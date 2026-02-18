import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

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
