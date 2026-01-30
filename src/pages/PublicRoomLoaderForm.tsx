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
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);

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
        
        // Initialize form data with existing values
        if (responseData?.patients) {
          const initialFormData: Record<string, any> = {};
          responseData.patients.forEach((patient: any, idx: number) => {
            const petKey = `pet${idx}`;
            initialFormData[`${petKey}_appointmentReason`] = patient.appointmentReason || '';
            initialFormData[`${petKey}_generalWellbeing`] = '';
            initialFormData[`${petKey}_outdoorAccess`] = '';
            initialFormData[`${petKey}_specificConcerns`] = '';
            initialFormData[`${petKey}_newPatientBehavior`] = '';
            initialFormData[`${petKey}_feeding`] = '';
            initialFormData[`${petKey}_foodAllergies`] = '';
            initialFormData[`${petKey}_foodAllergiesDetails`] = '';
            initialFormData[`${petKey}_carePlanLooksRight`] = '';
            initialFormData[`${petKey}_lymeBooster`] = '';
            initialFormData[`${petKey}_rabiesPreference`] = '';
            initialFormData[`${petKey}_felvVaccine`] = '';
          });
          setFormData(initialFormData);
        }
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

  function formatTime(dateStr: string | null | undefined): string {
    if (!dateStr) return 'N/A';
    try {
      return DateTime.fromISO(dateStr).toFormat('h:mm a');
    } catch {
      return dateStr;
    }
  }

  function handleInputChange(key: string, value: any) {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function handleSubmit() {
    if (!token) return;
    
    setSubmitting(true);
    try {
      await http.post(`/public/room-loader/form/submit?token=${encodeURIComponent(token)}`, {
        formData,
      });
      alert('Form submitted successfully!');
      // Could redirect or show success message
    } catch (err: any) {
      console.error('Error submitting form:', err);
      alert('Failed to submit form. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Loading room loader form...</h2>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2 style={{ color: '#dc3545' }}>Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <h2>No data available</h2>
      </div>
    );
  }

  const patients = data.patients || [];
  const firstPatient = patients[0];
  // Appointments are at the top level of the response
  const appointments = data.appointments || [];
  const firstAppt = appointments[0];

  // Get doctor name from appointment
  const doctorName = firstAppt?.primaryProvider?.firstName && firstAppt?.primaryProvider?.lastName
    ? `${firstAppt.primaryProvider.title || 'Dr.'} ${firstAppt.primaryProvider.firstName} ${firstAppt.primaryProvider.lastName}`
    : 'Dr. ____';

  // Get appointment type
  const appointmentType = firstAppt?.appointmentType?.prettyName || firstAppt?.appointmentType?.name || 'appointment';

  const petNames = patients.map((p: any) => p.patientName || 'your pet').join(' and ');
  const appointmentDate = firstAppt?.appointmentStart ? formatDate(firstAppt.appointmentStart) : '____';
  const arrivalWindowStart = firstPatient?.arrivalWindow?.start ? formatTime(firstPatient.arrivalWindow.start) : '____';
  const arrivalWindowEnd = firstPatient?.arrivalWindow?.end ? formatTime(firstPatient.arrivalWindow.end) : '____';
  const appointmentReason = firstPatient?.appointmentReason || '';

  // Get recommended items (reminders + added items)
  const recommendedItems: any[] = [];
  patients.forEach((patient: any) => {
    if (patient.reminders && Array.isArray(patient.reminders)) {
      patient.reminders.forEach((reminder: any) => {
        if (reminder.item) {
          recommendedItems.push({
            name: reminder.item.name,
            price: reminder.item.price,
            quantity: reminder.quantity || 1,
            type: reminder.itemType,
          });
        }
      });
    }
    if (patient.addedItems && Array.isArray(patient.addedItems)) {
      patient.addedItems.forEach((item: any) => {
        recommendedItems.push({
          name: item.name,
          price: item.price,
          quantity: item.quantity || 1,
          type: item.itemType,
        });
      });
    }
  });

  // Check if cat and age conditions
  const isCat = firstPatient?.species?.toLowerCase().includes('cat') || firstPatient?.speciesEntity?.name?.toLowerCase().includes('cat');
  const isUnderOneYear = firstPatient?.dob ? 
    DateTime.now().diff(DateTime.fromISO(firstPatient.dob), 'years').years < 1 : false;

  return (
    <div style={{ 
      padding: '40px 20px', 
      maxWidth: '800px', 
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#fafafa',
      minHeight: '100vh'
    }}>
      {/* Page 1 - Check-in Form */}
      {currentPage === 1 && (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          position: 'relative'
        }}>
          {/* Page Header */}
          <div style={{ 
            position: 'absolute', 
            top: '20px', 
            right: '20px', 
            fontSize: '14px', 
            color: '#666' 
          }}>
            PAGE 1
          </div>

          {/* Header Section */}
          <div style={{ marginBottom: '30px' }}>
            <h1 style={{ 
              fontSize: '24px', 
              fontWeight: 600, 
              marginBottom: '20px',
              color: '#333'
            }}>
              Time to Check-in for your appt!
            </h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '15px' }}>
              <strong>{doctorName}</strong> is looking forward to <strong>{petNames}</strong>'s <strong>{appointmentType}</strong> on <strong>{appointmentDate}</strong> with Window <strong>{arrivalWindowStart}</strong> to <strong>{arrivalWindowEnd}</strong>
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555', marginBottom: '20px' }}>
              To best prepare for your appt, please answer some questions for us.
            </p>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555' }}>
              In the spirit of transparent pricing, we will give you an estimate of costs before your visit.
            </p>
          </div>

          {/* Pet Sections */}
          {patients.map((patient: any, petIdx: number) => {
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            const isCatPatient = patient.species?.toLowerCase().includes('cat') || patient.speciesEntity?.name?.toLowerCase().includes('cat');
            const isNewPatient = !patient.dob || DateTime.now().diff(DateTime.fromISO(patient.dob || DateTime.now().toISO()), 'years').years < 0.5;

            return (
              <div key={petIdx} style={{ marginBottom: '40px' }}>
                <div style={{ 
                  display: 'inline-block',
                  padding: '4px 12px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '4px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  fontWeight: 600
                }}>
                  {petName}
                </div>

                {/* Reason for Appointment */}
                <div style={{ marginBottom: '25px' }}>
                  <p style={{ fontSize: '16px', marginBottom: '10px', fontWeight: 500 }}>
                    You told us that you wanted the following addressed at our appointment: <strong>{patient.appointmentReason || '(RL-APPT-REASON)'}</strong>
                  </p>
                  <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                    Could you expand on that at all?
                  </p>
                  <textarea
                    value={formData[`${petKey}_appointmentReason`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_appointmentReason`, e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '100px',
                      padding: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                    placeholder="Please provide more details..."
                  />
                </div>

                {/* General Well-being */}
                <div style={{ marginBottom: '25px' }}>
                  <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                    Let us know how <strong>{petName}</strong> is doing otherwise:
                  </p>
                  <textarea
                    value={formData[`${petKey}_generalWellbeing`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_generalWellbeing`, e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                    placeholder="How is your pet doing?"
                  />
                </div>

                {/* Cat-Only Section */}
                {isCatPatient && (
                  <div style={{ marginBottom: '25px' }}>
                    <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '10px', color: '#666' }}>
                      (CAT ONLY)
                    </p>
                    <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                      Does <strong>{petName}</strong> go outdoors at all or live with another cat that goes outdoors?
                    </p>
                    <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_outdoorAccess`}
                          value="yes"
                          checked={formData[`${petKey}_outdoorAccess`] === 'yes'}
                          onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_outdoorAccess`}
                          value="no"
                          checked={formData[`${petKey}_outdoorAccess`] === 'no'}
                          onChange={(e) => handleInputChange(`${petKey}_outdoorAccess`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        No
                      </label>
                    </div>
                  </div>
                )}

                {/* Specific Concerns */}
                <div style={{ marginBottom: '25px' }}>
                  <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                    Any other specific concerns that you want to address for <strong>{petName}</strong> at this visit?
                  </p>
                  <textarea
                    value={formData[`${petKey}_specificConcerns`] || ''}
                    onChange={(e) => handleInputChange(`${petKey}_specificConcerns`, e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                    placeholder="Any other concerns?"
                  />
                </div>

                {/* New Patient Section */}
                {isNewPatient && (
                  <div style={{ marginBottom: '25px' }}>
                    <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '10px' }}>
                      IF NEW PATIENT
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      Since we haven't met <strong>{petName}</strong> before, it is helpful to know a bit about <strong>{petName}</strong>'s behavior. Please know it isn't to judge! Rather, it is aligned with our Fear Free™ methodology, to help us prepare best so that you + <strong>{petName}</strong> are most comfortable.
                    </p>
                    <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                      Can you describe <strong>{petName}</strong>'s behavior at home, behavior around strangers, and behavior at a typical veterinary office?
                    </p>
                    <textarea
                      value={formData[`${petKey}_newPatientBehavior`] || ''}
                      onChange={(e) => handleInputChange(`${petKey}_newPatientBehavior`, e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '120px',
                        padding: '12px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontFamily: 'inherit',
                        resize: 'vertical'
                      }}
                      placeholder="Describe your pet's behavior..."
                    />
                  </div>
                )}

                {/* Feeding Question (if new patient) */}
                {isNewPatient && (
                  <div style={{ marginBottom: '25px' }}>
                    <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                      What are you feeding <strong>{petName}</strong>? Include brand, amt, & frequency if possible.
                    </p>
                    <textarea
                      value={formData[`${petKey}_feeding`] || ''}
                      onChange={(e) => handleInputChange(`${petKey}_feeding`, e.target.value)}
                      style={{
                        width: '100%',
                        minHeight: '80px',
                        padding: '12px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontFamily: 'inherit',
                        resize: 'vertical'
                      }}
                      placeholder="What are you feeding your pet?"
                    />
                  </div>
                )}

                {/* Food Allergies */}
                {isNewPatient && (
                  <div style={{ marginBottom: '25px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                      <p style={{ fontSize: '16px', margin: 0 }}>
                        Do <strong>YOU</strong> or <strong>{petName}</strong> have any food allergies? (we like to bribe!)
                      </p>
                      <div style={{ fontSize: '14px', color: '#666', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>
                        Y/N
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '20px', marginBottom: '15px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_foodAllergies`}
                          value="yes"
                          checked={formData[`${petKey}_foodAllergies`] === 'yes'}
                          onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_foodAllergies`}
                          value="no"
                          checked={formData[`${petKey}_foodAllergies`] === 'no'}
                          onChange={(e) => handleInputChange(`${petKey}_foodAllergies`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        No
                      </label>
                    </div>
                    {formData[`${petKey}_foodAllergies`] === 'yes' && (
                      <div>
                        <p style={{ fontSize: '16px', marginBottom: '10px' }}>
                          If yes, what are they?
                        </p>
                        <textarea
                          value={formData[`${petKey}_foodAllergiesDetails`] || ''}
                          onChange={(e) => handleInputChange(`${petKey}_foodAllergiesDetails`, e.target.value)}
                          style={{
                            width: '100%',
                            minHeight: '80px',
                            padding: '12px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '14px',
                            fontFamily: 'inherit',
                            resize: 'vertical'
                          }}
                          placeholder="Please describe the food allergies..."
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
            <div></div>
            <button
              onClick={() => setCurrentPage(2)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              Continue to Care Plan →
            </button>
          </div>
        </div>
      )}

      {/* Page 2 - Veterinary Care Plan */}
      {currentPage === 2 && (
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          position: 'relative'
        }}>
          {/* Page Header */}
          <div style={{ 
            position: 'absolute', 
            top: '20px', 
            right: '20px', 
            fontSize: '14px', 
            color: '#666' 
          }}>
            PAGE 2
          </div>

          {/* Header */}
          <div style={{ marginBottom: '30px' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '15px', color: '#333' }}>
              Veterinary Care Plan
            </h1>
            <p style={{ fontSize: '16px', lineHeight: '1.6', color: '#555' }}>
              The following items are recommended:
            </p>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '10px', fontStyle: 'italic' }}>
              ✓ Include trip fee (only on one animal) and type of exam based on appt type.
            </p>
            <p style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
              Include optional vx as follows:
            </p>
          </div>

          {/* Recommended Items List */}
          <div style={{ marginBottom: '30px' }}>
            {recommendedItems.length > 0 ? (
              <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '15px' }}>
                {recommendedItems.map((item, idx) => (
                  <div key={idx} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '10px 0',
                    borderBottom: idx < recommendedItems.length - 1 ? '1px solid #eee' : 'none'
                  }}>
                    <input
                      type="checkbox"
                      defaultChecked={true}
                      style={{ marginRight: '12px', width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '16px' }}>{item.name}</span>
                      {item.quantity > 1 && (
                        <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>
                          (Qty: {item.quantity})
                        </span>
                      )}
                      {item.price != null && item.price !== '' && (
                        <span style={{ fontSize: '14px', color: '#666', marginLeft: '8px' }}>
                          - ${Number(item.price).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#666', fontStyle: 'italic' }}>No recommended items at this time.</p>
            )}
          </div>

          {/* Does this look right? */}
          <div style={{ marginBottom: '30px' }}>
            <p style={{ fontSize: '16px', marginBottom: '15px' }}>
              Does this look right?
            </p>
            <div style={{ display: 'flex', gap: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="carePlanLooksRight"
                  value="yes"
                  checked={formData[`pet0_carePlanLooksRight`] === 'yes'}
                  onChange={(e) => handleInputChange(`pet0_carePlanLooksRight`, e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                Yes
              </label>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="carePlanLooksRight"
                  value="no"
                  checked={formData[`pet0_carePlanLooksRight`] === 'no'}
                  onChange={(e) => handleInputChange(`pet0_carePlanLooksRight`, e.target.value)}
                  style={{ marginRight: '8px' }}
                />
                No
              </label>
            </div>
          </div>

          {/* Optional Vaccines */}
          {patients.map((patient: any, petIdx: number) => {
            const petKey = `pet${petIdx}`;
            const petName = patient.patientName || `Pet ${petIdx + 1}`;
            const isCatPatient = patient.species?.toLowerCase().includes('cat') || patient.speciesEntity?.name?.toLowerCase().includes('cat');
            const isUnderOneYear = patient.dob ? 
              DateTime.now().diff(DateTime.fromISO(patient.dob), 'years').years < 1 : false;
            const outdoorAccess = formData[`${petKey}_outdoorAccess`] === 'yes';

            return (
              <div key={petIdx} style={{ marginBottom: '30px' }}>
                <div style={{ 
                  display: 'inline-block',
                  padding: '4px 12px',
                  backgroundColor: '#f0f0f0',
                  borderRadius: '4px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  fontWeight: 600
                }}>
                  {petName}
                </div>

                {/* Lyme Vaccine */}
                {patient.vaccines?.lyme && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If due for Lyme AND HAS NEVER GOTTEN ONE BEFORE (including if they got regular Lyme), we are excited to let you know that we now offer a more protective Lyme Vaccine. To ensure full protection, we recommend a booster 3-4 weeks after your appt. Do you want us to schedule you a booster appt?
                    </p>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_lymeBooster`}
                          value="yes"
                          checked={formData[`${petKey}_lymeBooster`] === 'yes'}
                          onChange={(e) => handleInputChange(`${petKey}_lymeBooster`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        Yes
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_lymeBooster`}
                          value="no"
                          checked={formData[`${petKey}_lymeBooster`] === 'no'}
                          onChange={(e) => handleInputChange(`${petKey}_lymeBooster`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        No
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name={`${petKey}_lymeBooster`}
                          value="unsure"
                          checked={formData[`${petKey}_lymeBooster`] === 'unsure'}
                          onChange={(e) => handleInputChange(`${petKey}_lymeBooster`, e.target.value)}
                          style={{ marginRight: '8px' }}
                        />
                        I'm not sure
                      </label>
                    </div>
                  </div>
                )}

                {/* Rabies Vaccine (Cats only) */}
                {isCatPatient && patient.vaccines?.rabies && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If not a member AND due for rabies AND a cat: we offer two rabies vaccines - a one year or three year - which would you prefer?
                    </p>
                    <div style={{ marginLeft: '20px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="1year"
                            checked={formData[`${petKey}_rabiesPreference`] === '1year'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Purevax Rabies 1 year (Price)
                        </label>
                      </div>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="3year"
                            checked={formData[`${petKey}_rabiesPreference`] === '3year'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Purevax Rabies 3 year (Price)
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_rabiesPreference`}
                            value="no"
                            checked={formData[`${petKey}_rabiesPreference`] === 'no'}
                            onChange={(e) => handleInputChange(`${petKey}_rabiesPreference`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No thank you, I do not want a rabies vx administered to my cat.
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* FELV Vaccine */}
                {isCatPatient && (isUnderOneYear || outdoorAccess) && (
                  <div style={{ marginBottom: '25px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      If a cat AND (&lt; 1 yr old OR answered yes to outdoor question)
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      FELV, or feline leukemia virus, is a contagious and potentially fatal virus spread through close contact between cats, like grooming or sharing food and water bowls.
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      Based on veterinary guidelines, FELV is now considered a core vaccine for all kittens under one year old, regardless of whether they live indoors or outdoors. We also highly recommend it for any adult cats who go outside or live with cats who do.
                    </p>
                    <p style={{ fontSize: '16px', lineHeight: '1.6', marginBottom: '15px', color: '#555' }}>
                      Do you want us to give the FELV vaccine to <strong>{petName}</strong>? This would be the first of two. The second would be given 3-4 weeks later.
                    </p>
                    <div style={{ marginLeft: '20px' }}>
                      <div style={{ marginBottom: '10px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="yes"
                            checked={formData[`${petKey}_felvVaccine`] === 'yes'}
                            onChange={(e) => handleInputChange(`${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          Yes (price)
                        </label>
                      </div>
                      <div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`${petKey}_felvVaccine`}
                            value="no"
                            checked={formData[`${petKey}_felvVaccine`] === 'no'}
                            onChange={(e) => handleInputChange(`${petKey}_felvVaccine`, e.target.value)}
                            style={{ marginRight: '8px' }}
                          />
                          No thank you.
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Navigation */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', paddingTop: '20px', borderTop: '1px solid #ddd' }}>
            <button
              onClick={() => setCurrentPage(1)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f5f5f5',
                color: '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: '12px 24px',
                backgroundColor: submitting ? '#ccc' : '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                fontWeight: 500,
                cursor: submitting ? 'not-allowed' : 'pointer'
              }}
            >
              {submitting ? 'Submitting...' : 'Submit Form'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
