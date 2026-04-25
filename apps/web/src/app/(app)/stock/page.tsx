'use client';

import { Suspense } from 'react';
import StockDetailPage from '@/views/StockDetailPage';

// Single-segment static route so `output: 'export'` can ship a single
// /stock/index.html. The ticker arrives as a `?ticker=...` search param
// and is read client-side inside StockDetailPage via useSearchParams().
// Suspense boundary is required by Next 16 whenever useSearchParams is
// used in a statically-exported page.

export default function Page() {
  return (
    <Suspense fallback={null}>
      <StockDetailPage />
    </Suspense>
  );
}
