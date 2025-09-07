import { createContext, useContext, useMemo, useState } from 'react'
import { http, setToken } from '../api/http'

const MOCK = (import.meta.env.VITE_MOCK_AUTH === '1')

type AuthContextType = {
  token: string | null
  userEmail: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}
const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokenState, setTokenState] = useState<string | null>(() => sessionStorage.getItem('vayd_token'))
  const [email, setEmail] = useState<string | null>(() => sessionStorage.getItem('vayd_email'))
  setToken(tokenState)

  async function login(email: string, password: string) {
    if (MOCK) {
      if (!email || !password) throw new Error('Missing credentials')
      const fakeToken = 'mock.' + Math.random().toString(36).slice(2)
      sessionStorage.setItem('vayd_token', fakeToken)
      sessionStorage.setItem('vayd_email', email)
      setTokenState(fakeToken)
      setEmail(email)
      return
    }
    const { data } = await http.post('/auth/login', { email, password })
    if (!data?.token) throw new Error('Invalid login response')
    sessionStorage.setItem('vayd_token', data.token)
    sessionStorage.setItem('vayd_email', email)
    setTokenState(data.token)
    setEmail(email)
  }
  function logout() {
    sessionStorage.removeItem('vayd_token')
    sessionStorage.removeItem('vayd_email')
    setTokenState(null)
    setEmail(null)
    setToken(null)
  }

  const value = useMemo(() => ({
    token: tokenState, userEmail: email, login, logout
  }), [tokenState, email])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
