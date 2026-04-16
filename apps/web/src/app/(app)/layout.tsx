import { Suspense } from 'react'
import Layout from '@/components/Layout'

// Layout reads useSearchParams() to surface the current ticker on
// /stock. In `output: 'export'` that hook triggers Next's
// missing-suspense-bailout check on every prerendered page. Wrapping
// here shields every (app) route without plumbing props case-by-case.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Layout>{children}</Layout>
    </Suspense>
  )
}
