'use client';

import { useEffect } from 'react';
import { SWRConfig } from 'swr';
import { AuthProvider } from '@/context/AuthContext';
import { I18nProvider } from '@/context/I18nProvider';
import { ensureLocalToken } from '@/lib/auth/local-login';
import { getApiBaseUrl } from '@/lib/api-base-url';
import Toast from '@/components/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Prime the in-memory token cache so `authHeaders()` (sync) can return
    // a Bearer header for callers that bypass apiFetch's async path. Under
    // Tauri this also runs the F-3 legacy-localStorage → keychain shim.
    void ensureLocalToken(getApiBaseUrl());
  }, []);

  return (
    <SWRConfig
      value={{
        dedupingInterval: 2000,
        revalidateOnFocus: false,
        errorRetryCount: 2,
        errorRetryInterval: 1500,
      }}
    >
      <I18nProvider>
        <AuthProvider>
          <Toast />
          {children}
        </AuthProvider>
      </I18nProvider>
    </SWRConfig>
  );
}
