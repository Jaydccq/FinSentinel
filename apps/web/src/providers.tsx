'use client'

import { AuthProvider } from '@/context/AuthContext'
import { I18nProvider } from '@/context/I18nProvider'
import Toast from '@/components/Toast'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        <Toast />
        {children}
      </AuthProvider>
    </I18nProvider>
  )
}
