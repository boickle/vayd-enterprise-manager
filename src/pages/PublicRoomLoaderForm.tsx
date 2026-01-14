// src/pages/PublicRoomLoaderForm.tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { http } from '../api/http';
import { DateTime } from 'luxon';

export default function PublicRoomLoaderForm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing token parameter');
      setLoading(false);
      return;
    }

    async function fetchRoomLoaderData() {
      try {
        setLoading(true);
        setError(null);
        const { data: responseData } = await http.get(`/public/room-loader/form?token=${encodeURIComponent(token)}`);
        setData(responseData);
      } catch (err: any) {
        console.error('Error fetching room loader form data:', err);
        setError(err?.response?.data?.message || err?.message || 'Failed to load room loader form');
      } finally {
        setLoading(false);
      }
    }

    fetchRoomLoaderData();
  }, [token]);

  function formatDate(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy');
    } catch {
      return dateStr;
    }
  }

  function formatDateTime(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('MMM dd, yyyy hh:mm a');
    } catch {
      return dateStr;
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Loading room loader form...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2 style={{ color: '#dc3545' }}>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>No data available</h2>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>Room Loader Form</h1>
      
      {/* Display all data from the API response */}
      <div style={{ marginTop: '30px' }}>
        <h2>Form Data</h2>
        <pre style={{ 
          backgroundColor: '#f5f5f5', 
          padding: '20px', 
          borderRadius: '4px', 
          overflow: 'auto',
          fontSize: '12px',
          lineHeight: '1.5'
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>

      {/* If data has a structured format, display it nicely */}
      {data && typeof data === 'object' && (
        <div style={{ marginTop: '30px' }}>
          <h2>Structured Information</h2>
          
          {data.roomLoaderId && (
            <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
              <h3>Room Loader Information</h3>
              <p><strong>Room Loader ID:</strong> {data.roomLoaderId}</p>
              {data.practiceId && <p><strong>Practice ID:</strong> {data.practiceId}</p>}
              {data.practiceName && <p><strong>Practice Name:</strong> {data.practiceName}</p>}
              {data.sentStatus && <p><strong>Sent Status:</strong> {data.sentStatus}</p>}
              {data.dueStatus && <p><strong>Due Status:</strong> {data.dueStatus}</p>}
            </div>
          )}

          {data.patients && Array.isArray(data.patients) && data.patients.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <h3>Patients ({data.patients.length})</h3>
              {data.patients.map((patient: any, index: number) => (
                <div 
                  key={patient.patientId || index} 
                  style={{ 
                    marginBottom: '30px', 
                    padding: '20px', 
                    backgroundColor: '#fff', 
                    border: '1px solid #ddd', 
                    borderRadius: '4px' 
                  }}
                >
                  <h4>Patient {index + 1}: {patient.patientName || 'Unknown'}</h4>
                  
                  {patient.clientName && (
                    <p><strong>Client:</strong> {patient.clientName}</p>
                  )}
                  
                  {patient.appointmentIds && patient.appointmentIds.length > 0 && (
                    <p><strong>Appointment IDs:</strong> {patient.appointmentIds.join(', ')}</p>
                  )}
                  
                  {patient.appointmentReason && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Appointment Reason:</strong></p>
                      <p style={{ padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
                        {patient.appointmentReason}
                      </p>
                    </div>
                  )}
                  
                  {patient.arrivalWindow && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Window of Arrival:</strong></p>
                      <p>
                        {formatDateTime(patient.arrivalWindow.start)} - {formatDateTime(patient.arrivalWindow.end)}
                      </p>
                    </div>
                  )}
                  
                  {patient.questions && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Questions:</strong></p>
                      <ul>
                        <li>Mobility: {patient.questions.mobility === null ? 'Not answered' : patient.questions.mobility ? 'Yes' : 'No'}</li>
                        <li>Lab Work: {patient.questions.labWork === null ? 'Not answered' : patient.questions.labWork ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>
                  )}
                  
                  {patient.reminders && patient.reminders.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Reminders ({patient.reminders.length}):</strong></p>
                      <ul>
                        {patient.reminders.map((reminder: any, rIdx: number) => (
                          <li key={rIdx} style={{ marginBottom: '10px' }}>
                            <div>{reminder.reminderText}</div>
                            {reminder.item && (
                              <div style={{ marginLeft: '20px', fontSize: '14px', color: '#666' }}>
                                Matched Item: {reminder.item.name} 
                                {reminder.item.price !== null && ` - $${Number(reminder.item.price).toFixed(2)}`}
                                {reminder.quantity > 1 && ` (Qty: ${reminder.quantity})`}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {patient.addedItems && patient.addedItems.length > 0 && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Added Items ({patient.addedItems.length}):</strong></p>
                      <ul>
                        {patient.addedItems.map((item: any, aIdx: number) => (
                          <li key={aIdx}>
                            {item.name}
                            {item.price !== null && ` - $${Number(item.price).toFixed(2)}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {patient.vaccines && (
                    <div style={{ marginTop: '10px' }}>
                      <p><strong>Vaccines:</strong></p>
                      <ul>
                        <li>FeLV: {patient.vaccines.felv ? 'Yes' : 'No'}</li>
                        <li>Lepto: {patient.vaccines.lepto ? 'Yes' : 'No'}</li>
                        <li>Lyme: {patient.vaccines.lyme ? 'Yes' : 'No'}</li>
                        <li>Bordatella: {patient.vaccines.bordatella ? 'Yes' : 'No'}</li>
                        <li>Sharps: {patient.vaccines.sharps ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

