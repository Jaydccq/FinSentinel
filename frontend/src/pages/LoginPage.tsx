import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { User, Lock, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { login as apiLogin } from '../api/auth'
import AuthShell from '../components/AuthShell'

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
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      heading="Sign In"
      subheading="Continue to your command center and track exposure in real time."
      footer={(
        <p>
          Don&apos;t have an account?{' '}
          <Link to="/register" className="font-semibold text-amber-200 hover:text-amber-100 transition-colors">
            Create one
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="login-username" className="field-label">Username</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
              <User size={15} aria-hidden="true" />
            </span>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              className="field-input pl-9"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="login-password" className="field-label">Password</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none">
              <Lock size={15} aria-hidden="true" />
            </span>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              className="field-input pl-9"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
        </div>

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
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </AuthShell>
  )
}
