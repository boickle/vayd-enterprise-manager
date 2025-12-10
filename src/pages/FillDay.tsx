// src/pages/FillDay.tsx
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { useNavigate } from 'react-router-dom';
import { http } from '../api/http';
import { fetchFillDayCandidates, type FillDayCandidate, type FillDayRequest, type FillDayResponse, type FillDayStats } from '../api/routing';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { useAuth } from '../auth/useAuth';
import { PreviewMyDayModal, type PreviewMyDayOption } from '../components/PreviewMyDayModal';
import { evetClientLink, evetPatientLink } from '../utils/evet';

export default function FillDayPage() {
  const { userEmail } = useAuth();
  const navigate = useNavigate();

  // Doctor selection
  const [doctorQuery, setDoctorQuery] = useState('');
  const [allProviders, setAllProviders] = useState<Provider[]>([]);
  const [doctorResults, setDoctorResults] = useState<Provider[]>([]);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const [doctorActiveIdx, setDoctorActiveIdx] = useState(-1);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>('');
  const [selectedDoctorName, setSelectedDoctorName] = useState<string>('');

  // Date selection
  const [targetDate, setTargetDate] = useState<string>(
    DateTime.local().toISODate() || ''
  );

  // Options
  const [ignoreEmergencyBlocks, setIgnoreEmergencyBlocks] = useState(true);

  // Results
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<FillDayCandidate[]>([]);
  const [stats, setStats] = useState<FillDayStats | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // SMS sending state
  const [sendingSms, setSendingSms] = useState<Record<number, boolean>>({});
  const [smsError, setSmsError] = useState<Record<number, string | null>>({});
  const [smsSuccess, setSmsSuccess] = useState<Record<number, boolean>>({});
  
  // SMS confirmation modal state
  const [smsModalOpen, setSmsModalOpen] = useState(false);
  const [pendingSmsCandidate, setPendingSmsCandidate] = useState<FillDayCandidate | null>(null);
  const [smsMessagePreview, setSmsMessagePreview] = useState<string>('');
  const [sendWithOverride, setSendWithOverride] = useState(false);

  // Check if we're in production
  // Vite provides:
  // - import.meta.env.PROD (boolean) - true when building with 'vite build' (default mode=production)
  // - import.meta.env.MODE (string) - 'development', 'production', or custom mode set via --mode flag
  // - Custom VITE_IS_PROD env variable (must be set in .env file or build environment)
  // 
  // To show the "Send to Actual Client" button on QA/staging:
  // - Build with: npm run build -- --mode qa (or --mode staging, --mode development)
  // - Or set VITE_IS_PROD=false in .env file or build environment
  const viteIsProd = import.meta.env.VITE_IS_PROD === 'true';
  const viteProd = import.meta.env.PROD === true;
  const viteMode = import.meta.env.MODE;
  const isProductionMode = viteMode === 'production';
  
  // Consider it production if:
  // 1. VITE_IS_PROD is explicitly set to 'true', OR
  // 2. MODE is explicitly 'production' (most reliable check)
  // Note: We don't check PROD boolean alone because it can be inconsistent with custom modes
  const isProd = viteIsProd || isProductionMode;
  
  // Debug logging - always log to help debug QA issues
  console.log('[FillDay] Environment check:', {
    VITE_IS_PROD: import.meta.env.VITE_IS_PROD,
    PROD: import.meta.env.PROD,
    MODE: import.meta.env.MODE,
    viteIsProd,
    viteProd,
    isProductionMode,
    finalIsProd: isProd,
  });

  // Preview My Day Modal
  const [myDayOpen, setMyDayOpen] = useState(false);
  const [previewOpt, setPreviewOpt] = useState<PreviewMyDayOption | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<FillDayCandidate | null>(null);
  const [doctorIdByPims, setDoctorIdByPims] = useState<Record<string, string>>({});

  // Load providers
  useEffect(() => {
    let alive = true;
    if (!userEmail) return;
    (async () => {
      try {
        const providers = await fetchPrimaryProviders();
        if (alive) {
          setAllProviders(providers);
        }
      } catch (e: any) {
        if (alive) {
          setError(e?.message || 'Failed to load providers');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [userEmail]);

  // Filter doctors based on query
  useEffect(() => {
    if (!doctorQuery.trim()) {
      setDoctorResults([]);
      return;
    }
    const query = doctorQuery.toLowerCase();
    const filtered = allProviders.filter((d) =>
      d.name.toLowerCase().includes(query)
    );
    setDoctorResults(filtered);
  }, [doctorQuery, allProviders]);

  // Fetch candidates
  async function handleFetchCandidates() {
    if (!selectedDoctorId || !targetDate) {
      setError('Please select a doctor and date');
      return;
    }

    setLoading(true);
    setError(null);
    setCandidates([]);
    setStats(null);
    setMessage(null);

    try {
      const request: FillDayRequest = {
        doctorId: selectedDoctorId,
        targetDate,
        ignoreEmergencyBlocks,
        // Always include overtime (120 min, afterHoursOk)
        returnToDepot: 'afterHoursOk' as const,
        tailOvertimeMinutes: 120 as const,
      };

      const response = await fetchFillDayCandidates(request);
      setCandidates(response.candidates);
      setStats(response.stats);
      if (response.message) {
        setMessage(response.message);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Failed to fetch candidates');
    } finally {
      setLoading(false);
    }
  }

  // Format time
  function formatTime(iso: string): string {
    return DateTime.fromISO(iso).toLocaleString(DateTime.TIME_SIMPLE);
  }

  // Format date
  function formatDate(dateStr: string): string {
    const dt = DateTime.fromISO(dateStr);
    if (!dt.isValid) {
      return dateStr;
    }
    return dt.toFormat('EEE, MMM dd, yyyy');
  }

  // Calculate age from DOB (returns just the number for compact display)
  function calculateAge(dob: string): number | null {
    const dobDate = DateTime.fromISO(dob);
    if (!dobDate.isValid) {
      return null;
    }
    const now = DateTime.now();
    const ageInYears = Math.floor(now.diff(dobDate, 'years').years);
    return ageInYears >= 0 ? ageInYears : null;
  }

  // Format patient info in compact format: "15 yo Burmese (Feline) 25 lbs"
  function formatPatientInfo(patient: any): string {
    const parts: string[] = [];
    
    if (patient?.dob) {
      const age = calculateAge(patient.dob);
      if (age !== null) {
        parts.push(`${age} yo`);
      }
    }
    
    if (patient?.breed) {
      parts.push(patient.breed);
    }
    
    if (patient?.species) {
      parts.push(`(${patient.species})`);
    }
    
    if (patient?.weight) {
      parts.push(`${patient.weight} lbs`);
    }
    
    return parts.join(' ');
  }

  // Format SMS message
  function formatSmsMessage(candidate: FillDayCandidate): string {
    const proposedTime = formatTime(candidate.proposedStartIso);
    const proposedDate = formatDate(candidate.proposedStartIso);
    const arrivalWindowStart = formatTime(candidate.arrivalWindow.start);
    const arrivalWindowEnd = formatTime(candidate.arrivalWindow.end);
    
    // Group reminders by pet name using nested reminders structure
    const remindersByPet = new Map<string, string[]>();
    
    // Use the new structure: each patient has its own reminders array
    if (candidate.patients && candidate.patients.length > 0) {
      candidate.patients.forEach((patient) => {
        const petName = patient.name;
        if (patient.reminders && patient.reminders.length > 0) {
          const reminderDescriptions = patient.reminders.map(r => r.description);
          remindersByPet.set(petName, reminderDescriptions);
        }
      });
    } else {
      // Fallback to old structure if patients array not available
      candidate.patientNames.forEach((petName) => {
        if (!remindersByPet.has(petName)) {
          remindersByPet.set(petName, []);
        }
      });
      
      // Match reminders to pets using old logic
      candidate.reminders.forEach((reminder) => {
        const reminderIdx = candidate.reminderIds.findIndex(id => id === reminder.id);
        
        if (reminderIdx >= 0 && reminderIdx < candidate.patientIds.length) {
          const petName = candidate.patientNames[reminderIdx] || candidate.patientName;
          if (remindersByPet.has(petName)) {
            remindersByPet.get(petName)!.push(reminder.description);
          }
        } else if (candidate.patientNames.length > 0) {
          const firstPetName = candidate.patientNames[0] || candidate.patientName;
          if (remindersByPet.has(firstPetName)) {
            remindersByPet.get(firstPetName)!.push(reminder.description);
          }
        }
      });
    }
    
    // Build consolidated reminders list: "Pet:\n- reminder1\n- reminder2"
    const remindersList = Array.from(remindersByPet.entries())
      .filter(([_, reminders]) => reminders.length > 0) // Only include pets with reminders
      .map(([petName, reminders]) => {
        const reminderLines = reminders.map(reminder => `- ${reminder}`).join('\n');
        return `${petName}:\n${reminderLines}`;
      })
      .join('\n\n');

    // Use first pet name for the booking reference
    const firstPetName = candidate.patientNames[0] || candidate.patientName;

    return `Hi ${candidate.clientName.split(' ')[0]},

We have availability to see your pet for their overdue reminders:

${remindersList}

We would arrive on

${proposedDate} at ${proposedTime} with an arrival window between ${arrivalWindowStart} - ${arrivalWindowEnd}.

This spot is also being offered to other clients. If you'd like to book it for ${firstPetName}, please let us know as soon as possible by texting us or call us back here. Thanks, Vet At Your Door`;
  }

  // Handle opening SMS confirmation modal
  function handleOpenSmsModal(candidate: FillDayCandidate, withOverride: boolean = false) {
    try {
      console.log('Opening SMS modal for candidate:', candidate);
      const message = formatSmsMessage(candidate);
      console.log('Formatted message:', message);
      setSmsMessagePreview(message);
      setPendingSmsCandidate(candidate);
      setSendWithOverride(withOverride);
      setSmsModalOpen(true);
      console.log('Modal state set to open, smsModalOpen should be true');
    } catch (error) {
      console.error('Error opening SMS modal:', error);
      setError('Failed to open SMS modal: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Handle closing SMS confirmation modal
  function handleCloseSmsModal() {
    setSmsModalOpen(false);
    setPendingSmsCandidate(null);
    setSmsMessagePreview('');
    setSendWithOverride(false);
  }

  // Handle sending SMS to client (after approval)
  async function handleSendSms(candidate: FillDayCandidate, overrideNonProd: boolean = false, customMessage?: string) {
    const clientId = candidate.clientId;
    setSendingSms((prev) => ({ ...prev, [clientId]: true }));
    setSmsError((prev) => ({ ...prev, [clientId]: null }));
    setSmsSuccess((prev) => ({ ...prev, [clientId]: false }));

    try {
      // Use custom message if provided (from modal), otherwise use formatted message
      const smsMessage = customMessage || formatSmsMessage(candidate);

      const payload: { message: string; overrideNonProd?: boolean } = {
        message: smsMessage,
      };

      if (overrideNonProd) {
        payload.overrideNonProd = true;
      }

      await http.post(`/sms/client/${clientId}`, payload);

      setSmsSuccess((prev) => ({ ...prev, [clientId]: true }));
      handleCloseSmsModal();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSmsSuccess((prev) => {
          const updated = { ...prev };
          delete updated[clientId];
          return updated;
        });
      }, 3000);
    } catch (e: any) {
      const errorMsg = e?.response?.data?.message || e?.message || 'Failed to send text message';
      setSmsError((prev) => ({ ...prev, [clientId]: errorMsg }));
    } finally {
      setSendingSms((prev) => {
        const updated = { ...prev };
        delete updated[clientId];
        return updated;
      });
    }
  }

  // Handle approve and send
  function handleApproveAndSend() {
    if (pendingSmsCandidate) {
      // Use the current message preview (which may have been edited)
      handleSendSms(pendingSmsCandidate, sendWithOverride, smsMessagePreview);
    }
  }

  // Handle Preview My Day - open modal
  async function handlePreviewMyDay(candidate: FillDayCandidate) {
    // Extract date from proposedStartIso (more reliable than parsing URL)
    const proposedDate = DateTime.fromISO(candidate.proposedStartIso);
    if (!proposedDate.isValid) {
      setError('Invalid proposed start time');
      return;
    }
    const dateStr = proposedDate.toISODate();
    if (!dateStr) {
      setError('Could not extract date from proposed start time');
      return;
    }

    // Parse the myDayPreviewLink to extract doctor ID
    // Format: /appointments/doctor/7840?date=2025-12-10
    const linkMatch = candidate.myDayPreviewLink.match(/\/appointments\/doctor\/(\d+)/);
    if (!linkMatch) {
      setError('Could not parse doctor ID from preview link');
      return;
    }

    const doctorPimsId = linkMatch[1];

    // Resolve internal doctor ID from pimsId
    let internalId: string | undefined = doctorIdByPims[doctorPimsId];

    if (!internalId) {
      try {
        const { data } = await http.get(`/employees/pims/${encodeURIComponent(doctorPimsId)}`);
        const emp = Array.isArray(data) ? data[0] : data;
        const resolvedId =
          (emp?.id != null ? String(emp.id) : undefined) ??
          (emp?.employee?.id != null ? String(emp.employee.id) : undefined);

        if (resolvedId) {
          internalId = resolvedId;
          setDoctorIdByPims((m) => ({ ...m, [doctorPimsId]: resolvedId }));
        }
      } catch (e: any) {
        setError('Could not resolve doctor ID: ' + (e?.message || 'Unknown error'));
        return;
      }
    }

    if (!internalId) {
      setError('Could not resolve doctor ID');
      return;
    }

    // Find doctor name from selected doctor or providers list
    const doctor = allProviders.find((p) => {
      const pimsId = p.pimsId ? String(p.pimsId) : String(p.id);
      return pimsId === doctorPimsId;
    });
    const doctorName = doctor?.name || selectedDoctorName || 'Doctor';

    // Calculate service minutes from requiredDuration
    const serviceMinutes = Math.round(candidate.requiredDuration / 60);

    // Set up preview option - match EXACTLY how Routing.tsx does it
    // holeIndex is 1-based from backend (first hole = 1), convert to 0-based for array insertion
    const insertionIndex = candidate.holeIndex != null ? Math.max(0, candidate.holeIndex - 1) : 0;
    
    // Ensure date is in YYYY-MM-DD format (no time component)
    // Use toISODate() to ensure proper format that DoctorDay expects
    const normalizedDate = proposedDate.toISODate() || dateStr.split('T')[0];
    
    // Verify the date is exactly YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      setError('Invalid date format: ' + normalizedDate);
      return;
    }
    
    // Create option EXACTLY like Routing.tsx does - match the Winner/UnifiedOption structure
    // Routing spreads the entire Winner object, so we need to include all available fields
    const option: PreviewMyDayOption & { clientName?: string; currentDriveSeconds?: number } = {
      date: normalizedDate,
      insertionIndex: insertionIndex,
      suggestedStartIso: candidate.proposedStartIso,
      doctorPimsId: internalId, // INTERNAL id (already resolved, like Routing does)
      doctorName: doctorName,
      projectedDriveSeconds: candidate.addedDriveSeconds,
      currentDriveSeconds: candidate.addedDriveSeconds, // FillDay uses addedDriveSeconds for both
      clientName: candidate.clientName, // Pass client name so virtual appointment shows correct name
      // Note: Optional fields like workStartLocal, effectiveEndLocal, bookedServiceSeconds
      // are not available from FillDayCandidate, but DoctorDay will work without them
    };

    // Debug logging - compare with Routing.tsx structure
    if (import.meta.env.DEV) {
      console.log('Fill Day Preview Options (matching Routing.tsx structure):', {
        date: normalizedDate,
        insertionIndex,
        suggestedStartIso: candidate.proposedStartIso,
        doctorPimsId: internalId, // INTERNAL id
        doctorName: doctorName,
        projectedDriveSeconds: candidate.addedDriveSeconds,
        currentDriveSeconds: candidate.addedDriveSeconds,
        clientName: candidate.clientName,
        clientId: candidate.clientId,
        address: candidate.address?.fullAddress || 
          [candidate.address?.address1, candidate.address?.city, candidate.address?.state, candidate.address?.zipcode]
            .filter(Boolean)
            .join(', '),
      });
    }

    setPreviewOpt(option);
    setPreviewCandidate(candidate);
    setMyDayOpen(true);
  }

  function closeMyDay() {
    setMyDayOpen(false);
    setPreviewOpt(null);
    setPreviewCandidate(null);
  }

  // Debug: Log modal state changes
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('SMS Modal State:', { smsModalOpen, hasCandidate: !!pendingSmsCandidate });
    }
  }, [smsModalOpen, pendingSmsCandidate]);

  return (
    <div className="container" style={{ padding: '24px', maxWidth: 1400 }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 700 }}>
          Schedule Loader
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          Find patients with overdue reminders to fill scheduling holes
        </p>
      </div>

      {/* Controls */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'grid', gap: '20px' }}>
          {/* Doctor Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Doctor / One Team
            </label>
            <div ref={doctorBoxRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={doctorQuery}
                onChange={(e) => {
                  setDoctorQuery(e.target.value);
                  setShowDoctorDropdown(true);
                }}
                onFocus={() => setShowDoctorDropdown(true)}
                placeholder="Search for doctor..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #ccc',
                  borderRadius: '8px',
                  fontSize: '16px',
                }}
              />
              {showDoctorDropdown && doctorResults.length > 0 && (
                <ul
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    background: '#fff',
                    border: '1px solid #ccc',
                    borderRadius: '8px',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    zIndex: 1000,
                  }}
                >
                  {doctorResults.map((d, i) => {
                    const selected = i === doctorActiveIdx;
                    // Use pimsId if available, otherwise fall back to id
                    const pimsId = d.pimsId ? String(d.pimsId) : String(d.id);
                    return (
                      <li key={pimsId} role="presentation" style={{ padding: 0 }}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // Use pimsId if available, otherwise fall back to id
                            const doctorPimsId = d.pimsId ? String(d.pimsId) : String(d.id);
                            setSelectedDoctorId(doctorPimsId);
                            setSelectedDoctorName(d.name);
                            setDoctorQuery(d.name);
                            setShowDoctorDropdown(false);
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '10px 12px',
                            background: selected ? '#f0f7f4' : 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            borderRadius: 0,
                          }}
                        >
                          {d.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {selectedDoctorName && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: '#4FB128' }}>
                Selected: <strong>{selectedDoctorName}</strong>
              </div>
            )}
          </div>

          {/* Date Selection */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
              Target Date
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid #ccc',
                borderRadius: '8px',
                fontSize: '16px',
              }}
            />
          </div>

          {/* Options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={ignoreEmergencyBlocks}
                onChange={(e) => setIgnoreEmergencyBlocks(e.target.checked)}
              />
              <span>Ignore Reserve Blocks</span>
            </label>
          </div>

          {/* Fetch Button */}
          <button
            onClick={handleFetchCandidates}
            disabled={loading || !selectedDoctorId || !targetDate}
            style={{
              padding: '12px 24px',
              background: loading || !selectedDoctorId || !targetDate ? '#ccc' : '#4FB128',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 600,
              cursor: loading || !selectedDoctorId || !targetDate ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Loading...' : 'Find Candidates'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '16px',
            border: '1px solid #dc2626',
            borderRadius: '8px',
            background: '#fef2f2',
            color: '#dc2626',
            marginBottom: '24px',
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div
          style={{
            padding: '16px',
            background: '#f0f7f4',
            borderRadius: '8px',
            marginBottom: '24px',
            display: 'flex',
            gap: '24px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>Holes Found:</strong> {stats.holesFound}
          </div>
          <div>
            <strong>Candidates Evaluated:</strong> {stats.candidatesEvaluated}
          </div>
          <div>
            <strong>Shortlist Size:</strong> {stats.shortlistSize}
          </div>
          <div>
            <strong>Final Results:</strong> {stats.finalResults}
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div
          style={{
            padding: '16px',
            background: '#fef2f2',
            borderRadius: '8px',
            marginBottom: '24px',
            color: '#dc2626',
          }}
        >
          {message}
        </div>
      )}

      {/* Candidates List */}
      {candidates.length === 0 && !loading && !error && stats && (
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
            No candidates found to fill scheduling holes.
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <div style={{ display: 'grid', gap: '24px' }}>
          {candidates.map((candidate, idx) => (
            <div
              key={`${candidate.clientId}-${candidate.holeIndex}-${idx}`}
              style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            >
              {/* Client Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #e5e7eb' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    {(() => {
                      const clientPimsId = (candidate.client as any)?.pimsId || (candidate as any)?.clientPimsId;
                      const clientHref = clientPimsId ? evetClientLink(clientPimsId) : undefined;
                      return clientHref ? (
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                          <a
                            href={clientHref}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none' }}
                            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            {candidate.clientName}
                          </a>
                        </h3>
                      ) : (
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                          {candidate.clientName}
                        </h3>
                      );
                    })()}
                    {candidate.client?.alerts && (
                      <div style={{
                        padding: '4px 8px',
                        background: '#fef3c7',
                        border: '1px solid #fbbf24',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#92400e',
                        fontWeight: 600,
                      }}>
                        ⚠️ {candidate.client.alerts}
                      </div>
                    )}
                  </div>
                  {candidate.address?.fullAddress && (
                    <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                      {candidate.address.fullAddress}
                    </div>
                  )}
                  {candidate.petCount > 0 && (
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      <strong>{candidate.petCount}</strong> {candidate.petCount === 1 ? 'pet' : 'pets'} with overdue reminders
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', marginLeft: '16px' }}>
                  <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                    Hole #{candidate.holeIndex}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#4FB128' }}>
                    Score: {candidate.finalScore.toFixed(1)}
                  </div>
                </div>
              </div>

              {/* Pets and Reminders */}
              <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600, color: '#111827' }}>
                  Pets & Overdue Reminders
                </h4>
                <div style={{ display: 'grid', gap: '12px' }}>
                  {candidate.patientNames.map((petName, petIdx) => {
                    const patientId = candidate.patientIds[petIdx];
                    // Get full patient object if available
                    const patient = candidate.patients?.[petIdx];
                    
                    // Get reminders directly from patient object (new structure)
                    // Fallback to candidate.reminders if patient.reminders not available
                    const reminderToShow = patient?.reminders && patient.reminders.length > 0
                      ? patient.reminders
                      : candidate.reminders.filter((reminder) => {
                          // Fallback: try to match by reminderIds if patient.reminders not available
                          const reminderIdx = candidate.reminderIds.findIndex(id => id === reminder.id);
                          if (candidate.patientIds.length === 1) {
                            return petIdx === 0;
                          }
                          return reminderIdx === petIdx || (reminderIdx < 0 && petIdx === 0);
                        });
                    
                    return (
                      <div
                        key={`${patientId}-${petIdx}`}
                        style={{
                          padding: '16px',
                          background: '#fef2f2',
                          border: '1px solid #fecaca',
                          borderRadius: '8px',
                        }}
                      >
                        {/* Patient Name and Info */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                            {(() => {
                              const patientPimsId = patient?.pimsId || (patient as any)?.pimsId;
                              const patientHref = patientPimsId ? evetPatientLink(patientPimsId) : undefined;
                              return patientHref ? (
                                <div style={{ fontWeight: 600, fontSize: '18px', color: '#111827' }}>
                                  <a
                                    href={patientHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: 'inherit', textDecoration: 'none' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                                  >
                                    {petName}
                                  </a>
                                </div>
                              ) : (
                                <div style={{ fontWeight: 600, fontSize: '18px', color: '#111827' }}>
                                  {petName}
                                </div>
                              );
                            })()}
                            {patient && formatPatientInfo(patient) && (
                              <div style={{ fontSize: '14px', color: '#6b7280' }}>
                                {formatPatientInfo(patient)}
                              </div>
                            )}
                          </div>
                          
                          {/* Patient Alerts */}
                          {patient?.alerts && (
                            <div style={{
                              padding: '4px 8px',
                              background: '#fef3c7',
                              border: '1px solid #fbbf24',
                              borderRadius: '4px',
                              fontSize: '12px',
                              color: '#92400e',
                              fontWeight: 600,
                              marginBottom: '8px',
                            }}>
                              ⚠️ {patient.alerts}
                            </div>
                          )}
                        </div>
                        
                        {/* Reminders */}
                        {reminderToShow.length > 0 && (
                          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #fecaca' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Overdue Reminders:
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {reminderToShow.map((reminder) => {
                                const dueDateFormatted = reminder.dueDate
                                  ? (() => {
                                      const dt = DateTime.fromISO(reminder.dueDate);
                                      return dt.isValid ? dt.toFormat('MMM dd, yyyy') : reminder.dueDate;
                                    })()
                                  : null;
                                return (
                                  <div key={reminder.id} style={{ fontSize: '14px', color: '#111827', paddingLeft: '8px' }}>
                                    • {reminder.description}
                                    {dueDateFormatted && (
                                      <span style={{ color: '#6b7280', marginLeft: '8px' }}>
                                        (Due: {dueDateFormatted})
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Proposed Time</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {formatTime(candidate.proposedStartIso)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Arrival Window</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {formatTime(candidate.arrivalWindow.start)} - {formatTime(candidate.arrivalWindow.end)}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Added Drive Time</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {candidate.addedDriveMinutes} minutes
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Duration</div>
                  <div style={{ fontSize: '16px', fontWeight: 600 }}>
                    {Math.round(candidate.requiredDuration / 60)} minutes
                  </div>
                </div>
              </div>

              {/* SMS Status Messages */}
              {smsError[candidate.clientId] && (
                <div
                  style={{
                    padding: '12px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#dc2626',
                    fontSize: '14px',
                    marginBottom: '12px',
                  }}
                >
                  <strong>Error:</strong> {smsError[candidate.clientId]}
                </div>
              )}
              {smsSuccess[candidate.clientId] && (
                <div
                  style={{
                    padding: '12px',
                    background: '#ecfdf5',
                    border: '1px solid #4FB128',
                    borderRadius: '8px',
                    color: '#4FB128',
                    fontSize: '14px',
                    marginBottom: '12px',
                    fontWeight: 600,
                  }}
                >
                  ✓ Text message sent successfully!
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Button clicked for candidate:', candidate.clientId);
                    handleOpenSmsModal(candidate, false);
                  }}
                  disabled={sendingSms[candidate.clientId]}
                  style={{
                    padding: '10px 20px',
                    background: sendingSms[candidate.clientId] ? '#ccc' : '#4FB128',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: sendingSms[candidate.clientId] ? 'not-allowed' : 'pointer',
                  }}
                >
                  {sendingSms[candidate.clientId] ? 'Sending...' : 'Send Text To Client'}
                </button>
                {!isProd && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Button clicked for candidate (override):', candidate.clientId);
                      handleOpenSmsModal(candidate, true);
                    }}
                    disabled={sendingSms[candidate.clientId]}
                    style={{
                      padding: '10px 20px',
                      background: sendingSms[candidate.clientId] ? '#ccc' : '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: sendingSms[candidate.clientId] ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {sendingSms[candidate.clientId] ? 'Sending...' : 'Send to Actual Client'}
                  </button>
                )}
                <button
                  onClick={() => handlePreviewMyDay(candidate)}
                  style={{
                    padding: '10px 20px',
                    background: '#fff',
                    color: '#4FB128',
                    border: '2px solid #4FB128',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Preview My Day
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SMS Confirmation Modal */}
      {smsModalOpen && pendingSmsCandidate && typeof document !== 'undefined' && document.body && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          onClick={handleCloseSmsModal}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(600px, 90vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '24px',
              borderRadius: '12px',
              background: '#fff',
            }}
          >
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>
                Confirm Send Text Message
              </h3>
              <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>
                Review the message before sending to {pendingSmsCandidate.clientName}
              </p>
              {sendWithOverride && (
                <p style={{ margin: '8px 0 0', color: '#f59e0b', fontSize: '14px', fontWeight: 600 }}>
                  ⚠️ This will send to the actual client (overrideNonProd: true)
                </p>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                Message:
              </label>
              <textarea
                value={smsMessagePreview}
                onChange={(e) => setSmsMessagePreview(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: '200px',
                  padding: '12px',
                  background: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: '#111827',
                  resize: 'vertical',
                  whiteSpace: 'pre-wrap',
                }}
                placeholder="Enter your message here..."
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={handleCloseSmsModal}
                disabled={sendingSms[pendingSmsCandidate.clientId]}
                style={{
                  padding: '10px 20px',
                  background: '#fff',
                  color: '#6b7280',
                  border: '2px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: sendingSms[pendingSmsCandidate.clientId] ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleApproveAndSend}
                disabled={sendingSms[pendingSmsCandidate.clientId]}
                style={{
                  padding: '10px 20px',
                  background: sendingSms[pendingSmsCandidate.clientId] ? '#ccc' : '#4FB128',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: sendingSms[pendingSmsCandidate.clientId] ? 'not-allowed' : 'pointer',
                }}
              >
                {sendingSms[pendingSmsCandidate.clientId] ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Preview My Day Modal */}
      {myDayOpen && previewOpt && previewCandidate && (
        <PreviewMyDayModal
          key={`fill-day-preview-${previewOpt.date}-${previewOpt.doctorPimsId}-${previewOpt.suggestedStartIso}`}
          option={previewOpt}
          onClose={closeMyDay}
          serviceMinutes={Math.max(1, Math.round(previewCandidate.requiredDuration / 60))}
          newApptMeta={{
            // Match EXACTLY what Routing.tsx passes - only these 4 fields
            clientId: String(previewCandidate.clientId),
            address: previewCandidate.address?.fullAddress || 
              [previewCandidate.address?.address1, previewCandidate.address?.city, previewCandidate.address?.state, previewCandidate.address?.zipcode]
                .filter(Boolean)
                .join(', '),
            // Use coordinates from client object if available - this prevents borrowing coordinates
            // from existing appointments and ensures the virtual appointment is unique
            lat: previewCandidate.client?.lat != null && Number.isFinite(previewCandidate.client.lat) ? previewCandidate.client.lat : undefined,
            lon: previewCandidate.client?.lon != null && Number.isFinite(previewCandidate.client.lon) ? previewCandidate.client.lon : undefined,
            // Note: PreviewMyDayModal will split the address to extract city/state/zip
          }}
        />
      )}
    </div>
  );
}

