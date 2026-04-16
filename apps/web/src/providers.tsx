'use client'

import { useEffect } from 'react'
import { AuthProvider } from '@/context/AuthContext'
import { I18nProvider } from '@/context/I18nProvider'
import { ensureLocalToken } from '@/lib/auth/local-login'
import Toast from '@/components/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Prime the auth cache so `authHeaders()` (sync) returns a Bearer
    // token for subsequent API calls (news/documents/analysis/okx use it
    // directly without going through apiFetch's async path).
    void ensureLocalToken()
  }, [])

  return (
    <I18nProvider>
      <AuthProvider>
        <Toast />
        {children}
      </AuthProvider>
    </I18nProvider>
  )
}
