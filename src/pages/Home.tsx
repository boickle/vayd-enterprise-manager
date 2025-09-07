import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="hero">
      <div>
        <h1>Bring calm, efficient routing to your mobile vet teams.</h1>
        <p className="muted">
          Log in and optimize schedules with drive-time aware suggestions.
          This tool pairs beautifully with your VAYD operations.
        </p>
        <div className="row" style={{gap:12, marginTop:10}}>
          <Link to="/routing" className="btn">Open Routing</Link>
          <a className="btn secondary" href="https://www.vetatyourdoor.com/" target="_blank" rel="noreferrer">Visit VAYD</a>
        </div>
      </div>
      <div className="card">
        <div className="row" style={{gap:10, marginBottom:8}}>
          <span className="pill">Low-stress look & feel</span>
          <span className="pill">Friendly UI</span>
        </div>
        <p className="muted">Inspired by Vet At Your Door’s brand — soft greens, rounded cards, and warm, welcoming typography.</p>
        <ul>
          <li>Secure login with bearer token</li>
          <li>Protected routes</li>
          <li>Drive-time suggestions viewer</li>
        </ul>
      </div>
    </div>
  )
}
