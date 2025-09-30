// src/pages/ClientPortal.tsx
import { useAuth } from '../auth/useAuth';

export default function ClientPortal() {
  const { userEmail } = useAuth() as any;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: 20 }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>Welcome to the Client Portal</h1>
        <p className="muted">
          This is your dedicated space to view appointments, messages, and updates from your
          veterinary team.
        </p>

        <div style={{ marginTop: 20 }}>
          <p>
            You are signed in as <strong>{userEmail}</strong>
          </p>
        </div>

        <div style={{ marginTop: 30 }}>
          <button className="btn">View Appointments</button>
          <button className="btn secondary" style={{ marginLeft: 12 }}>
            Messages
          </button>
        </div>
      </div>
    </div>
  );
}
