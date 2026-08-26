import { FormEvent, useEffect, useState } from 'react';
import { Field } from '../components/Field';
import { createEmployeeUser } from '../api/users';
import { fetchPrimaryProviders, type Provider } from '../api/employee';

export default function CreateEmployee() {
  const [email, setEmail] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState<Provider[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDoctorsLoading(true);
      try {
        const providers = await fetchPrimaryProviders();
        if (!cancelled) {
          setDoctors(
            providers.slice().sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      } catch {
        if (!cancelled) {
          setError('Unable to load doctors. Please refresh and try again.');
        }
      } finally {
        if (!cancelled) setDoctorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    setError(null);
    setPending(true);
    try {
      const payload: { email: string; doctorId?: number } = {
        email: email.trim().toLowerCase(),
      };
      if (doctorId) {
        payload.doctorId = Number(doctorId);
      }
      await createEmployeeUser(payload.email, payload.doctorId);
      setMsg('Temporary password created and sent (response shown below for dev).');
      setEmail('');
      setDoctorId('');
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Create failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ maxWidth: 520, margin: '30px auto' }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Create Employee</h2>
        <form onSubmit={onSubmit} className="grid" style={{ gap: 12 }}>
          <Field label="Employee email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Attach to doctor (optional)">
            <select
              className="input"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              disabled={doctorsLoading}
            >
              <option value="">
                {doctorsLoading ? 'Loading doctors…' : 'No doctor selected'}
              </option>
              {doctors.map((doctor) => (
                <option key={String(doctor.id)} value={String(doctor.id)}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </Field>
          {error && <div className="danger">{error}</div>}
          {msg && <div className="pill">{msg}</div>}
          <button className="btn" type="submit" disabled={pending || doctorsLoading}>
            {pending ? 'Creating…' : 'Create'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 10 }}>
          Creates an employee user when the email matches an active employee record.
          Optionally links the user to a doctor.
        </p>
      </div>
    </div>
  );
}
