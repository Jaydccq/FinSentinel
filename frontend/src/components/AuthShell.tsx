import type { ReactNode } from 'react'
import { Shield, ChevronRight } from 'lucide-react'

interface AuthShellProps {
  heading: string
  subheading: string
  eyebrow?: string
  children: ReactNode
  footer: ReactNode
}

export default function AuthShell({
  heading,
  subheading,
  eyebrow = 'AI-Powered Risk Intelligence',
  children,
  footer,
}: AuthShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <section className="glass-panel rounded border-[color:var(--border-subtle)] p-5 sm:p-6 lg:p-7">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded bg-blue-500/15 text-blue-400 flex items-center justify-center">
              <Shield size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-semibold text-xl tracking-tight leading-none">FinSentinel</h1>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{eyebrow}</p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-blue-400">Secure Finance Workspace</p>
              <h2 className="mt-3 text-2xl font-semibold leading-[0.95] text-[var(--text-primary)]">
                Trade smart.
                <br />
                Manage risk faster.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--text-secondary)]">
                Unified portfolio monitoring, compliance checks, and AI advisory designed for modern investment teams.
              </p>
            </div>

            <div className="space-y-3">
              {["Cross-source market intelligence", "Structured risk assessment in seconds", "SEC-aware policy guardrails"].map((item) => (
                <div key={item} className="surface-panel rounded px-3.5 py-2.5 text-sm text-[var(--text-secondary)] flex items-center gap-2.5">
                  <ChevronRight size={14} className="text-blue-400" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded border-[color:var(--border-subtle)] p-5 sm:p-6 lg:p-7 flex flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-400">Account Access</p>
            <h2 className="mt-2 page-title">{heading}</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{subheading}</p>
          </div>

          <div className="mt-7">{children}</div>

          <div className="mt-7 text-xs text-[var(--text-muted)]">{footer}</div>
        </section>
      </div>
    </div>
  )
}
