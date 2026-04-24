import { useSyncExternalStore, type ReactNode } from 'react'
import { AuthContext, type AuthUser } from './auth'
import { resolveBase } from '@/api/client'

const AUTH_USER_STORAGE_KEY = 'auth_user'
const LEGACY_JWT_STORAGE_KEY = 'jwt_token'
const AUTH_USER_CHANGED_EVENT = 'finsentinel-auth-user-changed'

function readStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(AUTH_USER_STORAGE_KEY)
  if (!stored) return null
  try {
    localStorage.removeItem(LEGACY_JWT_STORAGE_KEY)
    return JSON.parse(stored) as AuthUser
  } catch {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY)
    return null
  }
}

function subscribeStoredUser(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_USER_STORAGE_KEY) onStoreChange()
  }
  const onLocalChange = () => onStoreChange()

  window.addEventListener('storage', onStorage)
  window.addEventListener(AUTH_USER_CHANGED_EVENT, onLocalChange)

  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(AUTH_USER_CHANGED_EVENT, onLocalChange)
  }
}

function emitStoredUserChange(): void {
  window.dispatchEvent(new Event(AUTH_USER_CHANGED_EVENT))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useSyncExternalStore(subscribeStoredUser, readStoredUser, () => null)

  const login = (u: AuthUser) => {
    localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(u))
    emitStoredUserChange()
  }
  const logout = () => {
    localStorage.removeItem(AUTH_USER_STORAGE_KEY)
    emitStoredUserChange()
    fetch(`${resolveBase()}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
