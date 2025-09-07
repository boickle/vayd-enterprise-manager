import { FormEvent, useState } from 'react'
import { http } from '../api/http'
import { Field } from '../components/Field'

export default function RequestReset() {
  const [email, setEmail] = useState('')
  const [serverToken, setServerToken] = useState<string | null>(null) // dev convenience
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setError(null); setPending(true); setServerToken(null)
    try {
      const { data } = await http.post('/requestreset', { email })
      setMsg('If this user exists, a reset email has been sent.')
      if (data?.token) setServerToken(String(data.token)) // show for dev/testing
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Request failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{marginTop:0}}>Request Password Reset</h2>
        <form onSubmit={onSubmit} className="grid" style={{gap: 12}}>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          </Field>
          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}
          {serverToken && (
            <div className="card" style={{marginTop:8}}>
              <div className="label">Dev Token (from /requestreset response)</div>
              <code style={{wordBreak:'break-all'}}>{serverToken}</code>
            </div>
          )}
          <button className="btn" type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset email'}</button>
        </form>
        <p className="muted" style={{marginTop:10}}>This calls <code>/requestreset</code>. In production, users follow the email link containing the temporary reset token.</p>
      </div>
    </div>
  )
}
