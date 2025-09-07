import { FormEvent, useState } from 'react'
import { http } from '../api/http'
import { Field } from '../components/Field'

export default function CreateUser() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMsg(null); setError(null); setPending(true)
    try {
      const { data } = await http.post('/create', { email })
      setMsg('Temporary password created and sent (response shown below for dev).')
      console.log('Create response', data)
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Create failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{marginTop:0}}>Create User</h2>
        <form onSubmit={onSubmit} className="grid" style={{gap: 12}}>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
          </Field>
          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}
          <button className="btn" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create'}</button>
        </form>
        <p className="muted" style={{marginTop:10}}>This calls <code>/create</code>. In production, the temp password should be delivered via email.</p>
      </div>
    </div>
  )
}
