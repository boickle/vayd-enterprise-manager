import React, { useEffect, useState } from 'react';
import {
  fetchOverdueReminders,
  type OverdueReminderItem,
} from '../api/notifications';

export default function SlotFillerPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverdueReminderItem[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchOverdueReminders();
        if (!alive) return;
        setData(response.data || []);
        setCount(response.count || 0);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.response?.data?.message || e?.message || 'Failed to load overdue reminders');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatTime = (timeStr: string) => {
    try {
      const [hours, minutes] = timeStr.split(':');
      const hour = parseInt(hours, 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minutes} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '40px 24px', textAlign: 'center' }}>
        <p className="muted">Loading overdue reminders...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ padding: '40px 24px' }}>
        <div
          style={{
            padding: '16px',
            border: '1px solid #dc2626',
            borderRadius: '8px',
            background: '#fef2f2',
            color: '#dc2626',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '24px', maxWidth: 1400 }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 700 }}>
          Slot Filler
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          {count} {count === 1 ? 'client has' : 'clients have'} overdue reminders with available time slots
        </p>
      </div>

      {data.length === 0 ? (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            background: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
          }}
        >
          <p className="muted" style={{ margin: 0, fontSize: '16px' }}>
            No overdue reminders with available time slots found.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '24px' }}>
          {data.map((item, idx) => (
            <div
              key={idx}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            >
              {/* Client Header */}
              <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                  <div>
                    <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>
                      {item.client.firstName} {item.client.lastName}
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '14px', color: '#6b7280' }}>
                      <div>
                        <strong>Address:</strong> {item.client.fullAddress || `${item.client.address1}${item.client.address2 ? `, ${item.client.address2}` : ''}, ${item.client.city}, ${item.client.state} ${item.client.zipcode}`}
                      </div>
                      <div>
                        <strong>Phone:</strong>{' '}
                        <a href={`tel:${item.client.phone1}`} style={{ color: '#4FB128', textDecoration: 'none' }}>
                          {item.client.phone1}
                        </a>
                      </div>
                      <div>
                        <strong>Email:</strong>{' '}
                        <a href={`mailto:${item.client.email}`} style={{ color: '#4FB128', textDecoration: 'none' }}>
                          {item.client.email}
                        </a>
                      </div>
                      {item.primaryProvider && (
                        <div>
                          <strong>Primary Provider:</strong> {item.primaryProvider.fullName}
                        </div>
                      )}
                      {item.receptionistEmail && (
                        <div>
                          <strong>Receptionist:</strong>{' '}
                          <a href={`mailto:${item.receptionistEmail}`} style={{ color: '#4FB128', textDecoration: 'none' }}>
                            {item.receptionistEmail}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Reminders */}
              {item.reminders.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                    Overdue Reminders ({item.reminders.length})
                  </h3>
                  <div style={{ display: 'grid', gap: '8px' }}>
                    {item.reminders.map((reminder, rIdx) => (
                      <div
                        key={rIdx}
                        style={{
                          padding: '12px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '6px',
                          fontSize: '14px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                              {reminder.patient.name}
                            </div>
                            <div style={{ color: '#6b7280' }}>{reminder.description}</div>
                          </div>
                          <div style={{ color: '#dc2626', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Due: {formatDate(reminder.dueDate)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Time Slots */}
              {item.timeSlots.length > 0 ? (
                <div>
                  <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                    Available Time Slots ({item.timeSlots.length})
                  </h3>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                      gap: '12px',
                    }}
                  >
                    {item.timeSlots.map((slot, sIdx) => (
                      <div
                        key={sIdx}
                        style={{
                          padding: '16px',
                          background: '#ecfdf5',
                          border: '2px solid #4FB128',
                          borderRadius: '8px',
                          textAlign: 'center',
                        }}
                      >
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '4px' }}>
                          {formatDate(slot.date)}
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: '#4FB128', marginBottom: '4px' }}>
                          {formatTime(slot.time)}
                        </div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {slot.doctorName}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    padding: '16px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '6px',
                    textAlign: 'center',
                    color: '#dc2626',
                    fontWeight: 600,
                  }}
                >
                  No available time slots
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

