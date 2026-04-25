import { Toaster } from 'sonner';

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
          border: '1px solid var(--border-strong)',
          color: 'var(--text-primary)',
          fontSize: '0.8rem',
          borderRadius: '4px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        },
      }}
    />
  );
}
