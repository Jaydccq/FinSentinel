import { createContext } from 'react'

export interface AuthUser {
  token: string
  username: string
  email: string
}

export interface AuthContextValue {
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
