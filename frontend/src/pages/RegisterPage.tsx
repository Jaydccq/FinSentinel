import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { register as apiRegister } from '../api/auth'

export default function RegisterPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ username: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 rounded-xl p-8 w-full max-w-sm border border-gray-800">
        <h1 className="text-2xl font-bold text-blue-400 mb-6">Create Account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(['username', 'email', 'password'] as const).map(field => (
            <div key={field}>
              <label htmlFor={`register-${field}`} className="block text-sm text-gray-400 mb-1 capitalize">{field}</label>
              <input
                id={`register-${field}`}
                type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-blue-500"
                value={form[field]}
                onChange={set(field)}
                required
              />
            </div>
          ))}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating...' : 'Create Account'}
          </button>
        </form>
        <p className="text-gray-500 text-sm mt-4 text-center">
          Have an account?{' '}
          <Link to="/login" className="text-blue-400 hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  )
}
