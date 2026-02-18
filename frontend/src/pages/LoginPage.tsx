import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { login as apiLogin } from '../api/auth'
import { Shield, User, Lock, AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await apiLogin(username, password)
      login(res)
      navigate('/dashboard')
    } catch (err) {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-gray-950 flex items-center justify-center overflow-hidden">
      {/* Animated gradient mesh background */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse 80% 60% at 20% 40%, rgba(59,130,246,0.12) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 80% 70%, rgba(16,185,129,0.08) 0%, transparent 55%),
            radial-gradient(ellipse 70% 70% at 50% 10%, rgba(59,130,246,0.06) 0%, transparent 60%)
          `,
          animation: 'meshDrift 14s ease-in-out infinite alternate',
        }}
      />

      {/* Subtle grid overlay */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(59,130,246,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(59,130,246,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
        }}
      />

      <style>{`
        @keyframes meshDrift {
          0%   { transform: scale(1) translate(0px, 0px); }
          33%  { transform: scale(1.04) translate(-12px, 8px); }
          66%  { transform: scale(0.97) translate(10px, -6px); }
          100% { transform: scale(1.02) translate(-6px, 12px); }
        }
        @keyframes subtlePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.15), 0 25px 60px rgba(0,0,0,0.6); }
          50%       { box-shadow: 0 0 40px 8px rgba(59,130,246,0.08), 0 25px 60px rgba(0,0,0,0.6); }
        }
        .card-glow {
          animation: subtlePulse 6s ease-in-out infinite;
        }
        .btn-gradient {
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
          transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .btn-gradient:hover:not(:disabled) {
          transform: scale(1.025);
          box-shadow: 0 0 24px rgba(59,130,246,0.45);
          filter: brightness(1.1);
        }
        .btn-gradient:active:not(:disabled) {
          transform: scale(0.99);
        }
        .input-glow:focus {
          outline: none;
          border-color: rgba(59,130,246,0.7);
          box-shadow: 0 0 0 3px rgba(59,130,246,0.18);
        }
      `}</style>

      {/* Glass morphism card */}
      <div
        className="card-glow relative z-10 w-full max-w-sm mx-4 rounded-2xl border p-8"
        style={{
          background: 'rgba(17,24,39,0.82)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderColor: 'rgba(75,85,99,0.4)',
        }}
      >
        {/* Logo area */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2.5 mb-1.5">
            <div
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)',
                borderRadius: '8px',
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                boxShadow: '0 0 16px rgba(59,130,246,0.35)',
              }}
            >
              <Shield size={20} color="#ffffff" strokeWidth={2.5} aria-hidden="true" />
            </div>
            <h1
              className="text-2xl font-bold tracking-tight"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #10b981 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              FinSentinel
            </h1>
          </div>
          <p className="text-xs font-medium tracking-widest uppercase" style={{ color: 'rgba(156,163,175,0.75)' }}>
            AI-Powered Risk Intelligence
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username field */}
          <div>
            <label htmlFor="login-username" className="block text-xs font-semibold tracking-wide mb-1.5" style={{ color: '#9ca3af' }}>
              Username
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6b7280' }}>
                <User size={15} aria-hidden="true" />
              </span>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                className="input-glow w-full rounded-lg py-2.5 pl-9 pr-3 text-sm text-gray-100 transition-all duration-150"
                style={{
                  background: 'rgba(31,41,55,0.8)',
                  border: '1px solid rgba(75,85,99,0.5)',
                }}
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Password field */}
          <div>
            <label htmlFor="login-password" className="block text-xs font-semibold tracking-wide mb-1.5" style={{ color: '#9ca3af' }}>
              Password
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#6b7280' }}>
                <Lock size={15} aria-hidden="true" />
              </span>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                className="input-glow w-full rounded-lg py-2.5 pl-9 pr-3 text-sm text-gray-100 transition-all duration-150"
                style={{
                  background: 'rgba(31,41,55,0.8)',
                  border: '1px solid rgba(75,85,99,0.5)',
                }}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
              role="alert"
              style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
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
            className="btn-gradient w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ marginTop: '4px' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {/* Footer link */}
        <p className="mt-6 text-center text-xs" style={{ color: 'rgba(107,114,128,0.9)' }}>
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="font-medium transition-all duration-150"
            style={{ color: '#60a5fa' }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.color = '#93c5fd'
              ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.color = '#60a5fa'
              ;(e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none'
            }}
          >
            Register
          </Link>
        </p>
      </div>
    </div>
  )
}
