'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { User, Mail, Lock, AlertCircle } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useI18n } from '../hooks/useI18n'
import { register as apiRegister } from '../api/auth'
import AuthShell from '../components/AuthShell'

export default function RegisterPage() {
  const { login } = useAuth()
  const { t } = useI18n()
  const router = useRouter()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const FIELD_CONFIG = {
    username: {
      type: 'text' as const,
      icon: User,
      label: t('register.username'),
      autoComplete: 'username',
    },
    email: {
      type: 'email' as const,
      icon: Mail,
      label: t('register.email'),
      autoComplete: 'email',
    },
    password: {
      type: 'password' as const,
      icon: Lock,
      label: t('register.password'),
      autoComplete: 'new-password',
    },
  } as const

  type FormKey = keyof typeof FIELD_CONFIG

  const set = (k: FormKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiRegister(form.username, form.email, form.password)
      login(res)
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      heading={t('register.heading')}
      subheading={t('register.subheading')}
      footer={(
        <p>
          {t('register.haveAccount')}{' '}
          <Link href="/login" className="font-semibold text-blue-400 hover:text-blue-300 transition-colors">
            {t('register.signIn')}
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {(Object.keys(FIELD_CONFIG) as FormKey[]).map(field => {
          const { type, icon: Icon, label, autoComplete } = FIELD_CONFIG[field]
          return (
            <div key={field}>
              <label htmlFor={`register-${field}`} className="field-label">{label}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
                  <Icon size={15} aria-hidden="true" />
                </span>
                <input
                  id={`register-${field}`}
                  type={type}
                  autoComplete={autoComplete}
                  className="field-input pl-9"
                  value={form[field]}
                  onChange={set(field)}
                  required
                />
              </div>
            </div>
          )
        })}

        <p className="text-xs text-white/40">
          {t('register.passwordHint')}
        </p>

        {error && (
          <div
            className="rounded border border-red-300/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200 flex items-center gap-2"
            role="alert"
          >
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-sm">
          {loading ? t('register.submitting') : t('register.submit')}
        </button>
      </form>
    </AuthShell>
  )
}
