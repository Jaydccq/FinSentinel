import StockDetailPage from '@/views/StockDetailPage'

// Required for `output: 'export'` — Next.js rejects dynamic routes in
// static export mode unless at least one param is provided. We emit a
// single placeholder so the build succeeds; Tauri's webview loads the
// SPA via index.html and the real ticker is resolved at runtime via
// useParams() inside StockDetailPage, so the prerendered placeholder
// HTML is never actually navigated to.
export async function generateStaticParams() {
  return [{ ticker: '_' }]
}

export default function Page() {
  return <StockDetailPage />
}
