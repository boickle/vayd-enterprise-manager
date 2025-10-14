// src/pages/MyDayToggle.tsx
import { useState } from 'react';
import DoctorDay, { type DoctorDayProps } from './DoctorDay';
import DoctorDayVisual from './DoctorDayVisual';

type Mode = 'list' | 'visual';

export default function MyDayToggle(props: DoctorDayProps) {
  const [mode, setMode] = useState<Mode>('list');

  return (
    <div className="dd-section">
      {/* Toggle header */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>My Day</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              View:
            </span>
            <div
              role="tablist"
              aria-label="View toggle"
              style={{
                display: 'flex',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <button
                role="tab"
                aria-selected={mode === 'list'}
                onClick={() => setMode('list')}
                className={mode === 'list' ? 'btn' : 'btn btn--ghost'}
                style={{ borderRadius: 0, padding: '6px 10px' }}
              >
                List
              </button>
              <button
                role="tab"
                aria-selected={mode === 'visual'}
                onClick={() => setMode('visual')}
                className={mode === 'visual' ? 'btn' : 'btn btn--ghost'}
                style={{ borderRadius: 0, padding: '6px 10px' }}
              >
                Visual
              </button>
            </div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          Switch between the standard list and a time-scaled visual layout.
        </p>
      </div>

      {/* Body */}
      {mode === 'list' ? <DoctorDay {...props} /> : <DoctorDayVisual {...props} />}
    </div>
  );
}
