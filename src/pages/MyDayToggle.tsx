// src/pages/MyDayToggle.tsx
import { useState, useRef } from 'react';
import DoctorDay, { type DoctorDayProps } from './DoctorDay';
import DoctorDayVisual from './DoctorDayVisual';

type Mode = 'list' | 'visual';

export default function MyDayToggle(props: DoctorDayProps) {
  const [mode, setMode] = useState<Mode>('list');
  // Track the selected doctor ID from each view
  const listDoctorIdRef = useRef<string>(props.initialDoctorId || '');
  const visualDoctorIdRef = useRef<string>(props.initialDoctorId || '');
  // Track the selected date from each view
  const listDateRef = useRef<string>(props.initialDate || '');
  const visualDateRef = useRef<string>(props.initialDate || '');

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
                onClick={() => {
                  // Before switching, try to capture current selection from visual
                  if (mode === 'visual') {
                    const visualSelect = document.querySelector('#vdd-doc') as HTMLSelectElement;
                    if (visualSelect) {
                      visualDoctorIdRef.current = visualSelect.value;
                    }
                    const visualDate = document.querySelector('#vdd-date') as HTMLInputElement;
                    if (visualDate) {
                      visualDateRef.current = visualDate.value;
                    }
                  }
                  setMode('list');
                }}
                className={mode === 'list' ? 'btn' : 'btn btn--ghost'}
                style={{ borderRadius: 0, padding: '6px 10px' }}
              >
                List
              </button>
              <button
                role="tab"
                aria-selected={mode === 'visual'}
                onClick={() => {
                  // Before switching, try to capture current selection from list
                  if (mode === 'list') {
                    const listSelect = document.querySelector('#dd-doctor') as HTMLSelectElement;
                    if (listSelect) {
                      listDoctorIdRef.current = listSelect.value;
                    }
                    const listDate = document.querySelector('#dd-date') as HTMLInputElement;
                    if (listDate) {
                      listDateRef.current = listDate.value;
                    }
                  }
                  setMode('visual');
                }}
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
      {mode === 'list' ? (
        <DoctorDay
          key={`list-${visualDoctorIdRef.current || props.initialDoctorId || 'none'}-${visualDateRef.current || props.initialDate || 'none'}`}
          {...props}
          initialDoctorId={visualDoctorIdRef.current || props.initialDoctorId}
          initialDate={visualDateRef.current || props.initialDate}
        />
      ) : (
        <DoctorDayVisual
          key={`visual-${listDoctorIdRef.current || props.initialDoctorId || 'none'}-${listDateRef.current || props.initialDate || 'none'}`}
          {...props}
          initialDoctorId={listDoctorIdRef.current || props.initialDoctorId}
          initialDate={listDateRef.current || props.initialDate}
        />
      )}
    </div>
  );
}
