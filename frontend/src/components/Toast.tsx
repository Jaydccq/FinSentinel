import { Toaster } from 'sonner'

export default function Toast() {
  return (
    <Toaster
      theme="dark"
      position="bottom-right"
      richColors
      toastOptions={{
        className: 'font-sans',
        style: {
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-primary)',
          fontSize: '0.85rem',
        },
      }}
    />
  )
}
