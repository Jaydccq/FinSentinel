import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Mail, Lock, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { register as apiRegister } from '../api/auth'
import AuthShell from '../components/AuthShell'

const FIELD_CONFIG = {
  username: {
    type: 'text' as const,
    icon: User,
    label: 'Username',
    autoComplete: 'username',
  },
  email: {
    type: 'email' as const,
    icon: Mail,
    label: 'Email Address',
    autoComplete: 'email',
  },
  password: {
    type: 'password' as const,
    icon: Lock,
    label: 'Password',
    autoComplete: 'new-password',
  },
} as const

type FormKey = keyof typeof FIELD_CONFIG

export default function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: FormKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiRegister(form.username, form.email, form.password)
      login(res)
      navigate('/dashboard')
    } catch {
      setError('Registration failed. Username may already exist.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      heading="Create Account"
      subheading="Set up your workspace and start monitoring portfolio risk."
      footer={(
        <p>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-amber-200 hover:text-amber-100 transition-colors">
            Sign in
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

        {error && (
          <div
            className="rounded-xl border border-red-300/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200 flex items-center gap-2"
            role="alert"
          >
            <AlertCircle size={15} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 text-sm">
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>
    </AuthShell>
  )
}
