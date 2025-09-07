import { NavLink, Route, Routes, useNavigate, Navigate } from 'react-router-dom'
import LoginPage from './pages/Login'
import Routing from './pages/Routing'
import CreateUser from './pages/CreateUser'
import RequestReset from './pages/RequestReset'
import ResetPass from './pages/ResetPass'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { useAuth } from './auth/useAuth'

export default function App() {
  const { token, logout, userEmail } = useAuth()
  const nav = useNavigate()
  return (
    <div>
      <header className="navbar">
        <div className="brand">VAYD Enterprise Manager</div>
        <nav className="row" style={{gap: 16}}>
          <NavLink to="/routing">Routing</NavLink>
        </nav>
        <div className="spacer" />
        {token ? (
          <div className="row">
            <span className="muted">{userEmail ? `Signed in as ${userEmail}` : 'Signed in'}</span>
            <button className="btn secondary" onClick={()=>{logout(); nav('/login')}}>Log out</button>
          </div>
        ) : (
          <NavLink to="/login" className="btn">Log in</NavLink>
        )}
      </header>
      <main className="container">
        <Routes>
          {/* Root: go straight to login unless authenticated */}
          <Route path="/" element={ token ? <Navigate to="/routing" replace /> : <Navigate to="/login" replace /> } />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/create" element={<CreateUser />} />
          <Route path="/requestreset" element={<RequestReset />} />
          <Route path="/resetpass" element={<ResetPass />} />
          <Route path="/routing" element={<ProtectedRoute><Routing /></ProtectedRoute>} />
          <Route path="*" element={<div className="container"><p>Not found</p></div>} />
        </Routes>
      </main>
    </div>
  )
}
