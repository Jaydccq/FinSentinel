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
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-4 h-[24rem] w-[24rem] rounded-full bg-cyan-400/14 blur-3xl" />
        <div className="absolute -right-20 top-24 h-[22rem] w-[22rem] rounded-full bg-amber-400/16 blur-3xl" />
        <div className="absolute left-[28%] bottom-[-120px] h-[20rem] w-[20rem] rounded-full bg-blue-500/16 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8">
        <section className="glass-panel rounded-3xl border-[color:var(--border-subtle)] p-7 sm:p-9 lg:p-10">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-[#1d1302] flex items-center justify-center shadow-lg shadow-amber-600/30">
              <Shield size={20} aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-4xl leading-none tracking-tight">FinSentinel</h1>
              <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)]">{eyebrow}</p>
            </div>
          </div>

          <div className="mt-10 space-y-7">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200/80">Secure Finance Workspace</p>
              <h2 className="mt-3 font-display text-5xl leading-[0.95] text-[var(--text-primary)]">
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
                <div key={item} className="surface-panel rounded-xl px-3.5 py-2.5 text-sm text-[var(--text-secondary)] flex items-center gap-2.5">
                  <ChevronRight size={14} className="text-cyan-300" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-3xl border-[color:var(--border-subtle)] p-6 sm:p-8 lg:p-9 flex flex-col">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-amber-200/80">Account Access</p>
            <h2 className="mt-2 page-title text-[2.2rem] sm:text-[2.5rem]">{heading}</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{subheading}</p>
          </div>

          <div className="mt-7">{children}</div>

          <div className="mt-7 text-xs text-[var(--text-muted)]">{footer}</div>
        </section>
      </div>
    </div>
  )
}
