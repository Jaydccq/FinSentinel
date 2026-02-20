import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { register as apiRegister } from '../api/auth'
import { Shield, User, Mail, Lock, AlertCircle } from 'lucide-react'

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
    } catch (err) {
      setError('Registration failed. Username may already exist.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-zinc-950 flex items-center justify-center overflow-hidden">
      {/* Subtle radial glow background */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 55% at 80% 30%, rgba(196,163,90,0.05) 0%, transparent 60%),
            radial-gradient(ellipse 65% 55% at 15% 65%, rgba(196,163,90,0.04) 0%, transparent 55%),
            radial-gradient(ellipse 80% 60% at 50% 90%, rgba(196,163,90,0.03) 0%, transparent 60%)
          `,
          animation: 'meshDriftReg 20s ease-in-out infinite alternate',
        }}
      />

      <style>{`
        @keyframes meshDriftReg {
          0%   { transform: scale(1) translate(0px, 0px); }
          50%  { transform: scale(1.02) translate(6px, -5px); }
          100% { transform: scale(1.01) translate(-4px, 6px); }
        }
        .input-glow-reg:focus {
          outline: none;
          border-color: rgba(196,163,90,0.5);
          box-shadow: 0 0 0 3px rgba(196,163,90,0.10);
        }
      `}</style>

      {/* Card */}
      <div
        className="relative z-10 w-full max-w-sm mx-4 rounded-2xl p-8"
        style={{
          background: '#18181b',
          border: '0.5px solid rgba(63,63,70,0.5)',
        }}
      >
        {/* Logo area */}
        <div className="flex flex-col items-center mb-10">
          <div className="flex items-center gap-2.5 mb-2">
            <Shield size={20} className="text-amber-400/80" aria-hidden="true" />
            <h1 className="text-2xl font-display text-amber-400 tracking-tight">
              FinSentinel
            </h1>
          </div>
          <p className="text-xs font-medium tracking-widest uppercase text-zinc-600">
            AI-Powered Risk Intelligence
          </p>

          <p className="mt-4 text-sm font-semibold text-zinc-300">
            Create your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {(Object.keys(FIELD_CONFIG) as FormKey[]).map(field => {
            const { type, icon: Icon, label, autoComplete } = FIELD_CONFIG[field]
            return (
              <div key={field}>
                <label
                  htmlFor={`register-${field}`}
                  className="block text-xs font-semibold tracking-wide mb-1.5 text-zinc-400"
                >
                  {label}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-600">
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <input
                    id={`register-${field}`}
                    type={type}
                    autoComplete={autoComplete}
                    className="input-glow-reg w-full rounded-lg py-2.5 pl-9 pr-3 text-sm text-stone-50 transition-all duration-200"
                    style={{
                      background: '#27272a',
                      border: '0.5px solid rgba(63,63,70,0.5)',
                    }}
                    value={form[field]}
                    onChange={set(field)}
                    required
                  />
                </div>
              </div>
            )
          })}

          {/* Error state */}
          {error && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
              role="alert"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '0.5px solid rgba(239,68,68,0.25)',
                color: '#f87171',
              }}
            >
              <AlertCircle size={14} aria-hidden="true" className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg py-2.5 text-sm font-semibold bg-amber-600 hover:bg-amber-500 text-zinc-950 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        {/* Footer link */}
        <p className="mt-8 text-center text-xs text-zinc-600">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-amber-400/80 hover:text-amber-400 hover:underline transition-all duration-200"
          >
            Sign In
          </Link>
        </p>
      </div>
    </div>
  )
}
