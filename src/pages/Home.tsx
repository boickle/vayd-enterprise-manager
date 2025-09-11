// src/pages/Home.tsx
import { Link } from 'react-router-dom'
import type { AppPage } from '../app-pages'
import AppTabs from '../components/AppTabs'

export default function Home({ pages = [] as AppPage[] }) {
  return (
    <div>
      {/* Inline tabs as part of the home feel (optional; header already shows tabs) */}
      <AppTabs pages={pages} />

      <div className="hero">
        <div>
          <h1>Welcome back 👋</h1>
          <p className="muted">
            Pick a section to get started. Your access determines which tabs you see.
          </p>
          <div className="row" style={{ gap:12, marginTop:10 }}>
            {pages.map(p => (
              <Link key={p.path} to={p.path} className="btn">{p.label}</Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="row" style={{ gap:10, marginBottom:8 }}>
            <span className="pill">Protected routes</span>
            <span className="pill">Role-aware tabs</span>
          </div>
          <p className="muted">
            You can tune visibility via permissions/claims on the user.
          </p>
          <ul>
            <li>Secure login with bearer token</li>
            <li>Drive-time routing tools</li>
            <li>Scales as you add more sections</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
