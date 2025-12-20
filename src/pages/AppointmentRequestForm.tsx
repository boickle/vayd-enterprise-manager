// src/pages/AppointmentRequestForm.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { http } from '../api/http';
import { fetchClientPets, type Pet } from '../api/clientPortal';
import { fetchPrimaryProviders, fetchVeterinarians, type Provider } from '../api/employee';
import { validateAddress } from '../api/geo';
import { DateTime } from 'luxon';
import {
  checkEmail,
  fetchPublicProviders,
  fetchPublicVeterinarians,
  fetchAvailability,
  type PublicProvider,
  type AvailabilityResponse,
} from '../api/publicAppointments';

type FormData = {
  // Intro page
  email: string;
  fullName: {
    first: string;
    last: string;
    middle?: string;
    prefix?: string;
    suffix?: string;
  };
  haveUsedServicesBefore: 'Yes' | 'No' | '';
  selectedPetIds: string[]; // Array of selected pet IDs
  
  // New Client Info
  phoneNumbers: string;
  physicalAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  mailingAddressSame: 'Yes, it is different.' | 'No, it is the same.' | '';
  mailingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  otherPersonsOnAccount?: string;
  condoApartmentInfo?: string;
  petInfo: string; // Name, Species, Age, Spayed/Neutered, Breed, Color, Weight
  previousVeterinaryPractices?: string;
  okayToContactPreviousVets?: 'Yes' | 'No' | '';
  petBehaviorAtPreviousVisits?: string;
  preferredDoctor?: string;
  lookingForEuthanasia?: 'Yes' | 'No' | '';
  needsCalmingMedications?: 'Yes' | 'No' | '';
  hasCalmingMedications?: 'Yes' | 'No' | '';
  needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | '';
  
  // Existing Client Info
  bestPhoneNumber?: string;
  whatPets?: string;
  previousVeterinaryHospitals?: string;
  preferredDoctorExisting?: string;
  lookingForEuthanasiaExisting?: 'Yes' | 'No' | '';
  movedSinceLastVisit?: 'Yes' | 'No' | '';
  newPhysicalAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  differentMailingAddress?: 'Yes' | 'No' | '';
  newMailingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  hadVetCareElsewhere?: 'Yes' | 'No' | '';
  mayWeAskForRecords?: 'Yes' | 'No' | '';
  haveWeSeenPetBefore?: 'Yes' | 'No' | '';
  newPetInfo?: string;
  previousVeterinaryPracticesExisting?: string;
  okayToContactPreviousVetsExisting?: 'Yes' | 'No' | '';
  petBehaviorAtPreviousVisitsExisting?: string;
  canWeText?: 'Yes' | 'No' | '';
  
  // Euthanasia
  euthanasiaReason?: string;
  beenToVetLastThreeMonths?: string;
  interestedInOtherOptions?: string;
  serviceArea?: 'Kennebunk / Greater Portland / Augusta Area' | 'Maine High Peaks Area' | '';
  urgency?: string;
  preferredDateTime?: string;
  selectedDateTimeSlots?: Record<string, number>; // Map of slot ISO to preference number (1, 2, 3) for euthanasia
  noneOfWorkForMe?: boolean; // For euthanasia
  aftercarePreference?: string;
  
  // Request Visit
  serviceAreaVisit?: 'Kennebunk / Greater Portland / Augusta Area' | 'Maine High Peaks Area' | '';
  visitDetails?: string;
  needsUrgentScheduling?: 'Yes' | 'No' | ''; // Needs to be seen in 24-48 hours
  preferredDateTimeVisit?: string;
  selectedDateTimeSlotsVisit?: Record<string, number>; // Map of slot ISO to preference number (1, 2, 3) for visit
  noneOfWorkForMeVisit?: boolean; // For visit
  
  // Other Info
  howDidYouHearAboutUs?: string;
  anythingElse?: string;
};

type Page = 
  | 'intro'
  | 'new-client'
  | 'existing-client'
  | 'euthanasia-intro'
  | 'euthanasia-service-area'
  | 'euthanasia-portland'
  | 'euthanasia-high-peaks'
  | 'euthanasia-continued'
  | 'request-visit-continued'
  | 'success';

export default function AppointmentRequestForm() {
  const navigate = useNavigate();
  const { token, userEmail } = useAuth() as any;
  const isLoggedIn = !!token;
  
  const [currentPage, setCurrentPage] = useState<Page>('intro');
  const [pets, setPets] = useState<Pet[]>([]);
  const [petAlerts, setPetAlerts] = useState<Map<string, string | null>>(new Map()); // Map of pet ID to alerts
  const [providers, setProviders] = useState<Provider[]>([]);
  const [publicProviders, setPublicProviders] = useState<PublicProvider[]>([]);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [primaryProviderName, setPrimaryProviderName] = useState<string | null>(null);
  const [emailCheckResult, setEmailCheckResult] = useState<{ exists: boolean; hasAccount: boolean } | null>(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const [practiceId] = useState(1); // Default practice ID, could be made configurable
  
  const [formData, setFormData] = useState<FormData>({
    email: '',
    fullName: { first: '', last: '' },
    haveUsedServicesBefore: '',
    selectedPetIds: [],
    phoneNumbers: '',
    physicalAddress: {
      line1: '',
      city: '',
      state: '',
      zip: '',
      country: '',
    },
    mailingAddressSame: '',
    petInfo: '',
    lookingForEuthanasia: '',
    lookingForEuthanasiaExisting: '',
    movedSinceLastVisit: '',
    differentMailingAddress: '',
    hadVetCareElsewhere: '',
    mayWeAskForRecords: '',
    haveWeSeenPetBefore: '',
    okayToContactPreviousVets: '',
    okayToContactPreviousVetsExisting: '',
    canWeText: '',
    serviceArea: '',
    serviceAreaVisit: '',
    interestedInOtherOptions: '',
    aftercarePreference: '',
    selectedDateTimeSlots: {},
    selectedDateTimeSlotsVisit: {},
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [recommendedSlots, setRecommendedSlots] = useState<Array<{ date: string; time: string; display: string; iso: string }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [serviceMinutesUsed, setServiceMinutesUsed] = useState<number | null>(null); // Service minutes used for routing request
  const [showExistingClientModal, setShowExistingClientModal] = useState(false); // Modal for existing client notification
  const [emailCheckForModal, setEmailCheckForModal] = useState<{ exists: boolean; hasAccount: boolean } | null>(null); // Store email check result for modal

  // Handle responsive layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Find available appointment slots
  const findAvailableSlots = async () => {
    const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
    if (!selectedDoctor || selectedDoctor === 'I have no preference') {
      console.log('[AppointmentForm] No doctor selected');
      setRecommendedSlots([]);
      return;
    }

    // Extract doctor ID from provider name
    const doctorName = selectedDoctor.replace('Dr. ', '').trim();
    // Use publicProviders for new clients, providers for logged-in clients
    const providerList = isLoggedIn ? providers : (publicProviders.length > 0 ? publicProviders.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email || '',
      pimsId: p.id,
    })) : providers);
    
    let doctor = providerList.find(p => p.name === doctorName || `Dr. ${p.name}` === selectedDoctor);
    
    // Try fuzzy matching if exact match fails
    if (!doctor) {
      doctor = providerList.find(p => 
        p.name.toLowerCase().includes(doctorName.toLowerCase()) ||
        doctorName.toLowerCase().includes(p.name.toLowerCase())
      );
    }
    
    if (!doctor) {
      console.log('[AppointmentForm] Doctor not found:', selectedDoctor, 'Available providers:', providers.map(p => p.name));
      setRecommendedSlots([]);
      return;
    }

    // Use pimsId if available, otherwise use id
    const doctorId = doctor.pimsId ? String(doctor.pimsId) : String(doctor.id);
    console.log('[AppointmentForm] Finding slots for doctor:', doctor.name, 'ID:', doctor.id, 'pimsId:', doctor.pimsId, 'using:', doctorId);

    setLoadingSlots(true);
    try {
      // Get address from form data
      const address = formData.physicalAddress?.line1 || formData.newPhysicalAddress?.line1;
      const city = formData.physicalAddress?.city || formData.newPhysicalAddress?.city;
      const state = formData.physicalAddress?.state || formData.newPhysicalAddress?.state;
      const zip = formData.physicalAddress?.zip || formData.newPhysicalAddress?.zip;
      
      // Build full address string
      const addressParts = [address, city, state, zip].filter(Boolean);
      const fullAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined;
      
      // Get coordinates - try to validate address if we have one
      let lat: number | undefined;
      let lon: number | undefined;
      let validatedAddress: string | undefined = fullAddress;
      
      if (fullAddress) {
        try {
          const validation = await validateAddress(fullAddress, { minLevel: 'street' });
          if (validation.ok) {
            lat = validation.result.lat;
            lon = validation.result.lon;
            validatedAddress = validation.result.address;
            console.log('[AppointmentForm] Validated address:', validatedAddress, 'lat:', lat, 'lon:', lon);
          } else {
            console.warn('[AppointmentForm] Address validation failed:', validation.message);
          }
        } catch (err) {
          console.warn('[AppointmentForm] Address validation error:', err);
        }
      }
      
      // If we don't have coordinates, we can still try the routing API but it may not work as well
      if (!lat || !lon) {
        console.warn('[AppointmentForm] No coordinates available, routing may not work optimally');
      }

      // Calculate date range (next 6 weeks = 42 days)
      const today = DateTime.now();
      const startDate = today.plus({ days: 1 }).toISODate(); // Start from tomorrow
      const numDays = 42;

      if (!startDate) {
        console.error('[AppointmentForm] Failed to calculate start date');
        setRecommendedSlots([]);
        return;
      }

      // Calculate service minutes based on number of selected pets
      // First pet: 40 minutes, each additional pet: +20 minutes
      const numPets = isLoggedIn && formData.selectedPetIds.length > 0 
        ? formData.selectedPetIds.length 
        : 1; // Default to 1 pet if not logged in or no pets selected
      const serviceMinutes = 40 + (Math.max(0, numPets - 1) * 20);
      
      // Store the service minutes used for routing request
      setServiceMinutesUsed(serviceMinutes);
      
      console.log('[AppointmentForm] Calculating service minutes:', {
        numPets,
        serviceMinutes,
        selectedPetIds: formData.selectedPetIds,
        isLoggedIn,
      });

      // Use public availability API for new clients, routing v2 for logged-in clients
      let data: any;
      
      if (isLoggedIn) {
        // Build routing v2 request payload for logged-in clients
        const payload: any = {
          doctorId,
          startDate,
          numDays,
          newAppt: {
            serviceMinutes,
            ...(lat && lon ? { lat, lon } : {}),
            ...(validatedAddress ? { address: validatedAddress } : {}),
          },
        };

        console.log('[AppointmentForm] Calling /routing/v2 with payload:', payload);
        const response = await http.post('/routing/v2', payload);
        data = response.data;
        console.log('[AppointmentForm] Routing v2 response:', data);
      } else {
        // Use public availability API for new clients
        // Always include doctorId when a doctor is selected
        const availabilityRequest: any = {
          practiceId,
          startDate,
          numDays,
          serviceMinutes,
          address: validatedAddress || fullAddress || '',
          allowOtherDoctors: false,
        };
        
        // Always include doctorId when a doctor is selected (we're already past the check that ensures doctor exists)
        if (doctorId) {
          // Convert to number if it's a numeric string, otherwise keep as string
          availabilityRequest.doctorId = isNaN(Number(doctorId)) ? doctorId : Number(doctorId);
        }

        console.log('[AppointmentForm] Calling /public/appointments/availability with payload:', availabilityRequest);
        const availabilityResponse = await fetchAvailability(availabilityRequest);
        console.log('[AppointmentForm] Availability response:', availabilityResponse);
        
        // Convert availability response to routing-like format
        data = {
          slots: availabilityResponse.slots || [],
          winner: availabilityResponse.winner,
          alternates: availabilityResponse.alternates || [],
        };
      }

      // Helper function to round time to nearest 5 minutes
      const roundToNearest5Minutes = (dt: DateTime): DateTime => {
        const minutes = dt.minute;
        const roundedMinutes = Math.round(minutes / 5) * 5;
        return dt.set({ minute: roundedMinutes, second: 0, millisecond: 0 });
      };

      // Extract slots from response
      const slots: Array<{ date: string; time: string; display: string; iso: string }> = [];
      
      // Handle both routing v2 format and public availability format
      const winner = data?.winner;
      const alternates = data?.alternates || [];
      const slotsArray = data?.slots || [];
      
      // If we have a slots array (from public API), use that
      if (Array.isArray(slotsArray) && slotsArray.length > 0) {
        for (const slot of slotsArray.slice(0, 3)) {
          if (slot.iso || slot.date) {
            const slotDt = slot.iso 
              ? roundToNearest5Minutes(DateTime.fromISO(slot.iso))
              : DateTime.fromISO(`${slot.date}T${slot.time || '12:00'}`);
            slots.push({
              date: slot.date || slotDt.toISODate() || '',
              time: slot.time || slotDt.toFormat('HH:mm'),
              display: slot.display || `${slotDt.toFormat('EEE, MMM d')} at ${slotDt.toFormat('h:mm a')}`,
              iso: slot.iso || slotDt.toISO() || '',
            });
          }
        }
      } else {
        // Handle routing v2 format (winner + alternates)
        // Add winner if available
        if (winner?.suggestedStartIso || winner?.iso) {
          const winnerIso = winner.suggestedStartIso || winner.iso;
          const winnerDt = roundToNearest5Minutes(DateTime.fromISO(winnerIso));
          slots.push({
            date: winner.date || winnerDt.toISODate() || '',
            time: winner.time || winnerDt.toFormat('HH:mm'),
            display: winner.display || `${winnerDt.toFormat('EEE, MMM d')} at ${winnerDt.toFormat('h:mm a')}`,
            iso: winnerIso,
          });
        }
        
        // Add alternates (limit to 2 more to have max 3 total)
        if (Array.isArray(alternates)) {
          for (const alt of alternates.slice(0, 2)) {
            if (alt?.suggestedStartIso || alt?.iso) {
              const altIso = alt.suggestedStartIso || alt.iso;
              const altDt = roundToNearest5Minutes(DateTime.fromISO(altIso));
              slots.push({
                date: alt.date || altDt.toISODate() || '',
                time: alt.time || altDt.toFormat('HH:mm'),
                display: alt.display || `${altDt.toFormat('EEE, MMM d')} at ${altDt.toFormat('h:mm a')}`,
                iso: altIso,
              });
            }
          }
        }
      }

      console.log('[AppointmentForm] Found slots:', slots.length);
      // Limit to top 3 slots
      setRecommendedSlots(slots.slice(0, 3));
    } catch (error) {
      console.error('[AppointmentForm] Failed to find available slots:', error);
      setRecommendedSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Load recommended slots when doctor is selected and we're on date/time page
  // Also reload when selected pets change (to recalculate service minutes)
  useEffect(() => {
    const isDateTimePage = currentPage === 'request-visit-continued' || currentPage === 'euthanasia-continued';
    const hasDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
    
    console.log('[AppointmentForm] useEffect check:', {
      isDateTimePage,
      hasDoctor,
      currentPage,
      providersLength: providers.length,
      preferredDoctorExisting: formData.preferredDoctorExisting,
      preferredDoctor: formData.preferredDoctor,
      selectedPetIds: formData.selectedPetIds,
      needsUrgentScheduling: formData.needsUrgentScheduling,
    });
    
    // For request-visit-continued, only do routing if explicitly answered "No" (needsUrgentScheduling === 'No')
    // For euthanasia-continued, always do routing
    const shouldDoRouting = 
      isDateTimePage && 
      hasDoctor && 
      providers.length > 0 &&
      (currentPage === 'euthanasia-continued' || formData.needsUrgentScheduling === 'No');
    
    if (shouldDoRouting) {
      console.log('[AppointmentForm] Calling findAvailableSlots');
      findAvailableSlots();
    } else if (currentPage === 'request-visit-continued') {
      // For request-visit-continued, clear slots if urgent, not answered, or not ready
      if (formData.needsUrgentScheduling === 'Yes' || !formData.needsUrgentScheduling) {
        setRecommendedSlots([]);
      }
    } else if (!isDateTimePage || !hasDoctor) {
      // Don't clear slots if we're submitting (we need them for submission)
      // Only clear if we're going to a completely different flow
      if (currentPage !== 'success') {
        setRecommendedSlots([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, formData.preferredDoctorExisting, formData.preferredDoctor, providers.length, formData.selectedPetIds.length, formData.needsUrgentScheduling]);

  // Check email when entered (for new clients)
  useEffect(() => {
    if (isLoggedIn) return; // Skip if logged in
    if (!formData.email || formData.email.trim().length < 3) {
      setEmailCheckResult(null);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      setEmailCheckResult(null);
      return;
    }

    let alive = true;
    const timeoutId = setTimeout(async () => {
      setCheckingEmail(true);
      try {
        const result = await checkEmail(formData.email.trim(), practiceId);
        if (!alive) return;
        setEmailCheckResult(result);
        
        // If email exists and has account, show message (will be displayed in UI)
        if (result.exists && result.hasAccount) {
          console.log('[AppointmentForm] Email has account, user should login');
        }
      } catch (error) {
        console.error('[AppointmentForm] Failed to check email:', error);
        if (!alive) return;
        setEmailCheckResult(null);
      } finally {
        if (alive) setCheckingEmail(false);
      }
    }, 500); // Debounce 500ms

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [formData.email, isLoggedIn, practiceId]);

  // Load veterinarians for new clients (using public veterinarians endpoint)
  // Only fetch when address is valid (has line1, city, state, zip)
  useEffect(() => {
    if (isLoggedIn) return; // Skip if logged in (will use regular veterinarians)

    // Check if address is valid (all required fields filled)
    const hasValidAddress = 
      formData.physicalAddress?.line1?.trim() &&
      formData.physicalAddress?.city?.trim() &&
      formData.physicalAddress?.state?.trim() &&
      formData.physicalAddress?.zip?.trim();

    // Don't fetch if address is not valid
    if (!hasValidAddress) {
      setPublicProviders([]);
      setProviders([]);
      return;
    }

    let alive = true;
    (async () => {
      try {
        // Build address string from form data
        const addressParts = [
          formData.physicalAddress?.line1,
          formData.physicalAddress?.city,
          formData.physicalAddress?.state,
          formData.physicalAddress?.zip,
        ].filter(Boolean);
        const address = addressParts.join(', ');
        
        const publicVeterinariansData = await fetchPublicVeterinarians(practiceId, address);
        if (!alive) return;
        
        setPublicProviders(publicVeterinariansData);
        
        // Also set providers for compatibility with existing code
        setProviders(publicVeterinariansData.map(v => ({
          id: v.id,
          name: v.name,
          email: v.email || '',
          pimsId: v.id,
        })));
      } catch (error) {
        console.error('[AppointmentForm] Failed to load public veterinarians:', error);
        setPublicProviders([]);
        setProviders([]);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isLoggedIn, practiceId, formData.physicalAddress?.line1, formData.physicalAddress?.city, formData.physicalAddress?.state, formData.physicalAddress?.zip]);

  // Load client data if logged in
  useEffect(() => {
    if (!isLoggedIn) return;

    let alive = true;
    (async () => {
      setLoadingClientData(true);
      try {
        // Build address string from form data if available
        // For existing clients, check if they moved and use new address, otherwise use existing address
        const addressParts = formData.movedSinceLastVisit === 'Yes' && formData.newPhysicalAddress
          ? [
              formData.newPhysicalAddress.line1,
              formData.newPhysicalAddress.city,
              formData.newPhysicalAddress.state,
              formData.newPhysicalAddress.zip,
            ]
          : [
              formData.physicalAddress?.line1,
              formData.physicalAddress?.city,
              formData.physicalAddress?.state,
              formData.physicalAddress?.zip,
            ];
        const address = addressParts.filter(Boolean).length > 0 ? addressParts.filter(Boolean).join(', ') : undefined;
        
        // Fetch pets and veterinarians in parallel
        const [petsData, providersData] = await Promise.all([
          fetchClientPets(),
          fetchVeterinarians(address),
        ]);

        if (!alive) return;

        setPets(petsData);
        setProviders(providersData);

        // Fetch patient alerts for each pet
        const alertsMap = new Map<string, string | null>();
        await Promise.all(
          petsData.map(async (pet) => {
            try {
              // Get alerts from /patients/pims/:id endpoint
              const pimsId = pet.id;
              if (pimsId) {
                const { data } = await http.get(`/patients/pims/${encodeURIComponent(pimsId)}`);
                // Alerts is a text field (string or null) on the patient object
                const alerts = data?.alerts ?? data?.patient?.alerts ?? null;
                alertsMap.set(pet.id, alerts && typeof alerts === 'string' ? alerts : null);
              }
            } catch (err) {
              // If fetch fails, continue without alerts for this pet
              console.warn(`Failed to fetch alerts for pet ${pet.id}:`, err);
              alertsMap.set(pet.id, null);
            }
          })
        );
        setPetAlerts(alertsMap);

        // Extract client info from pets/appointments
        // Try to get primary provider from pets
        const primaryProvider = petsData.find(p => p.primaryProviderName)?.primaryProviderName || null;
        setPrimaryProviderName(primaryProvider);

        // Pre-populate form with user email
        if (userEmail) {
          setFormData(prev => ({ ...prev, email: userEmail }));
        }

        // Set haveUsedServicesBefore to Yes since they're logged in
        setFormData(prev => ({ ...prev, haveUsedServicesBefore: 'Yes' }));

        // Set default doctor to primary provider if found
        if (primaryProvider && providersData.length > 0) {
          const providerMatch = providersData.find(p => 
            p.name === primaryProvider || 
            p.name.includes(primaryProvider) ||
            primaryProvider.includes(p.name) ||
            `Dr. ${p.name}` === primaryProvider ||
            p.name.toLowerCase().includes(primaryProvider.toLowerCase()) ||
            primaryProvider.toLowerCase().includes(p.name.toLowerCase())
          );
          if (providerMatch) {
            setFormData(prev => ({ 
              ...prev, 
              preferredDoctorExisting: `Dr. ${providerMatch.name}` 
            }));
          }
        }

        // Try to get client info from appointments
        try {
          const { data: apptsData } = await http.get('/appointments/client');
          const appts = Array.isArray(apptsData) ? apptsData : (apptsData?.appointments ?? apptsData ?? []);
          
          if (appts.length > 0) {
            const firstAppt = appts[0];
            const client = firstAppt?.client || firstAppt?.Client;
            
            if (client) {
              // Extract phone number from various possible fields
              const rawPhoneNumber = 
                client.phone1 ||
                client.phone || 
                client.secondPhone || 
                client.phoneNumber || 
                client.phone_number ||
                client.primaryPhone ||
                client.primary_phone ||
                client.mobilePhone ||
                client.mobile_phone ||
                undefined;
              
              // Normalize phone number: remove +1 prefix if present
              const phoneNumber = rawPhoneNumber 
                ? String(rawPhoneNumber).replace(/^\+1\s*/, '').trim()
                : undefined;
              
              // Pre-populate name if available
              setFormData(prev => ({
                ...prev,
                fullName: {
                  ...prev.fullName,
                  first: client.firstName || client.first_name || prev.fullName.first,
                  last: client.lastName || client.last_name || prev.fullName.last,
                },
                bestPhoneNumber: phoneNumber || prev.bestPhoneNumber,
                physicalAddress: {
                  ...prev.physicalAddress,
                  line1: client.address1 || client.address_1 || prev.physicalAddress?.line1 || '',
                  line2: client.address2 || client.address_2 || prev.physicalAddress?.line2 || undefined,
                  city: client.city || prev.physicalAddress?.city || '',
                  state: client.state || prev.physicalAddress?.state || '',
                  zip: client.zip ? String(client.zip) : (prev.physicalAddress?.zip || ''),
                  country: prev.physicalAddress?.country || 'United States',
                },
                newPhysicalAddress: {
                  ...prev.newPhysicalAddress,
                  line1: client.address1 || client.address_1 || prev.newPhysicalAddress?.line1 || '',
                  line2: client.address2 || client.address_2 || prev.newPhysicalAddress?.line2 || undefined,
                  city: client.city || prev.newPhysicalAddress?.city || '',
                  state: client.state || prev.newPhysicalAddress?.state || '',
                  zip: client.zip ? String(client.zip) : (prev.newPhysicalAddress?.zip || ''),
                  country: prev.newPhysicalAddress?.country || 'United States',
                },
              }));
            }
          }
        } catch (err) {
          console.warn('Failed to fetch client info from appointments:', err);
        }

        // Skip intro page and go directly to existing client form
        setCurrentPage('existing-client');
      } catch (error: any) {
        console.error('Failed to load client data:', error);
      } finally {
        if (alive) setLoadingClientData(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoggedIn, 
    userEmail,
    formData.movedSinceLastVisit,
    formData.physicalAddress?.line1,
    formData.physicalAddress?.city,
    formData.physicalAddress?.state,
    formData.physicalAddress?.zip,
    formData.newPhysicalAddress?.line1,
    formData.newPhysicalAddress?.city,
    formData.newPhysicalAddress?.state,
    formData.newPhysicalAddress?.zip,
  ]);

  const updateFormData = (field: keyof FormData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const updateNestedFormData = (field: keyof FormData, nestedField: string, value: any) => {
    setFormData(prev => {
      const current = prev[field] as any;
      return {
        ...prev,
        [field]: {
          ...current,
          [nestedField]: value,
        },
      };
    });
  };

  const validatePage = (page: Page): boolean => {
    const newErrors: Record<string, string> = {};

    switch (page) {
      case 'intro':
        // Skip validation if user is logged in (they won't see this page)
        if (!isLoggedIn) {
          if (!formData.email.trim()) newErrors.email = 'Email is required';
          if (!formData.fullName.first.trim()) newErrors['fullName.first'] = 'First name is required';
          if (!formData.fullName.last.trim()) newErrors['fullName.last'] = 'Last name is required';
          if (!formData.haveUsedServicesBefore) newErrors.haveUsedServicesBefore = 'Please select an option';
        }
        break;
      case 'new-client':
        // Only validate new client page if user is not logged in
        if (!isLoggedIn) {
        if (!formData.phoneNumbers.trim()) newErrors.phoneNumbers = 'Phone numbers are required';
        if (!formData.physicalAddress.line1.trim()) newErrors['physicalAddress.line1'] = 'Street address is required';
        if (!formData.physicalAddress.city.trim()) newErrors['physicalAddress.city'] = 'City is required';
        if (!formData.physicalAddress.state.trim()) newErrors['physicalAddress.state'] = 'State is required';
        if (!formData.physicalAddress.zip.trim()) newErrors['physicalAddress.zip'] = 'Zip code is required';
        if (!formData.petInfo.trim()) newErrors.petInfo = 'Pet information is required';
        if (!formData.previousVeterinaryPractices?.trim()) newErrors.previousVeterinaryPractices = 'Previous veterinary practices are required';
          if (!formData.petBehaviorAtPreviousVisits?.trim()) newErrors.petBehaviorAtPreviousVisits = 'Pet behavior information is required';
          if (!formData.preferredDoctor) newErrors.preferredDoctor = 'Please select a preferred doctor';
          if (!formData.lookingForEuthanasia) newErrors.lookingForEuthanasia = 'Please select an option';
        }
        break;
      case 'existing-client':
        if (!formData.bestPhoneNumber?.trim()) newErrors.bestPhoneNumber = 'Phone number is required';
        if (isLoggedIn) {
          if (formData.selectedPetIds.length === 0) newErrors.selectedPetIds = 'Please select at least one pet';
        } else {
          if (!formData.whatPets?.trim()) newErrors.whatPets = 'Pet information is required';
        }
        if (!formData.preferredDoctorExisting) newErrors.preferredDoctorExisting = 'Please select a preferred doctor';
        if (!formData.lookingForEuthanasiaExisting) newErrors.lookingForEuthanasiaExisting = 'Please select an option';
        break;
      case 'euthanasia-intro':
        if (!formData.euthanasiaReason?.trim()) newErrors.euthanasiaReason = 'Please let us know what is going on with your pet';
        if (!formData.beenToVetLastThreeMonths?.trim()) newErrors.beenToVetLastThreeMonths = 'Please let us know if your pet has been to the veterinarian in the last three months';
        if (!formData.interestedInOtherOptions) newErrors.interestedInOtherOptions = 'Please select an option';
        break;
      case 'euthanasia-continued':
        // Require manual date/time entry (client liaisons will handle scheduling)
        if (!formData.preferredDateTime?.trim()) newErrors.preferredDateTime = 'Please enter your preferred date and time';
        if (!formData.aftercarePreference) newErrors.aftercarePreference = 'Please select an aftercare preference';
        break;
      case 'request-visit-continued':
        if (!formData.visitDetails?.trim()) {
          newErrors.visitDetails = 'Please provide details about the services you need';
        }
        if (!formData.needsUrgentScheduling) {
          newErrors.needsUrgentScheduling = 'Please select whether this is urgent';
        }
        // If not urgent and slots are available, require selections or "none work" option; otherwise allow manual entry
        if (formData.needsUrgentScheduling === 'No') {
          if (recommendedSlots.length > 0) {
            const selectedCount = Object.keys(formData.selectedDateTimeSlotsVisit || {}).length;
            if (selectedCount === 0 && !formData.noneOfWorkForMeVisit) {
              newErrors.selectedDateTimeSlotsVisit = 'Please select your preferred times or indicate that none of these work for you';
            }
          } else if (!loadingSlots) {
            if (!formData.preferredDateTimeVisit?.trim()) {
              newErrors.preferredDateTimeVisit = 'Please enter your preferred date and time';
            }
          }
        }
        break;
      // Add more validation as needed
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (!validatePage(currentPage)) {
      return;
    }

    // Determine next page based on current page and form data
    switch (currentPage) {
      case 'intro':
        // This should only happen if user is not logged in
        if (!isLoggedIn) {
          if (formData.haveUsedServicesBefore === 'Yes') {
            setCurrentPage('existing-client');
          } else {
            // For new clients, check if email already exists
            if (formData.email.trim()) {
              try {
                setCheckingEmail(true);
                const result = await checkEmail(formData.email.trim(), practiceId);
                if (result.exists) {
                  // Email exists (with or without account) - show modal
                  setEmailCheckForModal(result);
                  setShowExistingClientModal(true);
                  setCheckingEmail(false);
                  return;
                }
              } catch (err) {
                console.error('Error checking email:', err);
                // Continue with form if check fails
              } finally {
                setCheckingEmail(false);
              }
            }
            setCurrentPage('new-client');
          }
        }
        break;
      case 'new-client':
        if (formData.lookingForEuthanasia === 'Yes') {
          setCurrentPage('euthanasia-intro');
        } else {
          setCurrentPage('request-visit-continued');
        }
        break;
      case 'existing-client':
        if (formData.lookingForEuthanasiaExisting === 'Yes') {
          setCurrentPage('euthanasia-intro');
        } else {
          setCurrentPage('request-visit-continued');
        }
        break;
      case 'euthanasia-intro':
        setCurrentPage('euthanasia-service-area');
        break;
      case 'euthanasia-service-area':
        if (formData.serviceArea === 'Kennebunk / Greater Portland / Augusta Area') {
          setCurrentPage('euthanasia-portland');
        } else if (formData.serviceArea === 'Maine High Peaks Area') {
          setCurrentPage('euthanasia-high-peaks');
        }
        break;
      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        setCurrentPage('euthanasia-continued');
        break;
      case 'euthanasia-continued':
        handleSubmit();
        break;
      case 'request-visit-continued':
        handleSubmit();
        break;
    }
  };

  const handleBack = () => {
    switch (currentPage) {
      case 'existing-client':
      case 'new-client':
        setCurrentPage('intro');
        break;
      case 'euthanasia-intro':
        if (formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client');
        } else {
          setCurrentPage('new-client');
        }
        break;
      case 'euthanasia-service-area':
        setCurrentPage('euthanasia-intro');
        break;
      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        setCurrentPage('euthanasia-service-area');
        break;
      case 'euthanasia-continued':
        if (formData.serviceArea === 'Kennebunk / Greater Portland / Augusta Area') {
          setCurrentPage('euthanasia-portland');
        } else {
          setCurrentPage('euthanasia-high-peaks');
        }
        break;
      case 'request-visit-continued':
        if (formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client');
        } else {
          setCurrentPage('new-client');
        }
        break;
    }
  };

  const handleSubmit = async () => {
    if (!validatePage(currentPage)) {
      return;
    }

    setSubmitting(true);
    try {
      // Determine appointment type
      const isEuthanasia = formData.lookingForEuthanasia === 'Yes' || formData.lookingForEuthanasiaExisting === 'Yes';
      const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
      
      // Build selected date/time preferences from slots
      const buildDateTimePreferences = (slots: Record<string, number>) => {
        if (!slots || Object.keys(slots).length === 0) {
          console.log('[AppointmentForm] No slots selected');
          return null;
        }
        
        console.log('[AppointmentForm] Building preferences from slots:', slots);
        console.log('[AppointmentForm] Available recommendedSlots:', recommendedSlots);
        
        const preferences: Array<{ preference: number; dateTime: string; display: string }> = [];
        Object.entries(slots).forEach(([iso, preference]) => {
          const slot = recommendedSlots.find(s => s.iso === iso);
          if (slot) {
            preferences.push({
              preference,
              dateTime: iso,
              display: slot.display,
            });
          } else {
            // If slot not found in recommendedSlots, still include it with the ISO as display
            // This can happen if recommendedSlots were cleared or changed
            console.warn('[AppointmentForm] Slot not found in recommendedSlots:', iso);
            preferences.push({
              preference,
              dateTime: iso,
              display: iso, // Fallback to ISO if slot not found
            });
          }
        });
        // Sort by preference number
        preferences.sort((a, b) => a.preference - b.preference);
        console.log('[AppointmentForm] Built preferences:', preferences);
        return preferences.length > 0 ? preferences : null;
      };

      // Prepare comprehensive submission payload
      const submissionData: any = {
        // Client Information
        clientType: isExistingClient ? 'existing' : 'new',
        isLoggedIn: isLoggedIn,
        email: formData.email || userEmail || '',
        fullName: {
          first: formData.fullName?.first || '',
          last: formData.fullName?.last || '',
          middle: formData.fullName?.middle || undefined,
          prefix: formData.fullName?.prefix || undefined,
          suffix: formData.fullName?.suffix || undefined,
        },
        
        // Contact Information
        phoneNumber: formData.bestPhoneNumber || formData.phoneNumbers || '',
        canWeText: formData.canWeText || undefined,
        
        // Address Information
        physicalAddress: (() => {
          // Existing client who moved - use new address
          if (isExistingClient && formData.movedSinceLastVisit === 'Yes' && formData.newPhysicalAddress) {
            return {
              line1: formData.newPhysicalAddress.line1 || '',
              line2: formData.newPhysicalAddress.line2 || undefined,
              city: formData.newPhysicalAddress.city || '',
              state: formData.newPhysicalAddress.state || '',
              zip: formData.newPhysicalAddress.zip || '',
              country: formData.newPhysicalAddress.country || 'US',
            };
          }
          // Existing client who hasn't moved - use existing address from formData
          if (isExistingClient && formData.movedSinceLastVisit !== 'Yes' && formData.physicalAddress) {
            return {
              line1: formData.physicalAddress.line1 || '',
              line2: formData.physicalAddress.line2 || undefined,
              city: formData.physicalAddress.city || '',
              state: formData.physicalAddress.state || '',
              zip: formData.physicalAddress.zip || '',
              country: formData.physicalAddress.country || 'US',
            };
          }
          // New client - use address from form
          if (!isExistingClient && formData.physicalAddress) {
            return {
              line1: formData.physicalAddress.line1 || '',
              line2: formData.physicalAddress.line2 || undefined,
              city: formData.physicalAddress.city || '',
              state: formData.physicalAddress.state || '',
              zip: formData.physicalAddress.zip || '',
              country: formData.physicalAddress.country || 'US',
            };
          }
          return undefined;
        })(),
        
        mailingAddress: isExistingClient && formData.differentMailingAddress === 'Yes' && formData.newMailingAddress
          ? {
              line1: formData.newMailingAddress.line1 || '',
              line2: formData.newMailingAddress.line2 || undefined,
              city: formData.newMailingAddress.city || '',
              state: formData.newMailingAddress.state || '',
              zip: formData.newMailingAddress.zip || '',
              country: formData.newMailingAddress.country || 'US',
            }
          : !isExistingClient && formData.mailingAddressSame === 'No, it is the same.' && formData.mailingAddress
          ? {
              line1: formData.mailingAddress.line1 || '',
              line2: formData.mailingAddress.line2 || undefined,
              city: formData.mailingAddress.city || '',
              state: formData.mailingAddress.state || '',
              zip: formData.mailingAddress.zip || '',
              country: formData.mailingAddress.country || 'US',
            }
          : undefined,
        
        // Pet/Patient Information
        pets: isLoggedIn && formData.selectedPetIds.length > 0
          ? pets.filter(p => formData.selectedPetIds.includes(p.id)).map(p => ({
              id: p.id,
              dbId: p.dbId,
              clientId: p.clientId,
              name: p.name,
              species: p.species,
              breed: p.breed,
              dob: p.dob,
              subscription: p.subscription,
              primaryProviderName: p.primaryProviderName,
              photoUrl: p.photoUrl,
              wellnessPlans: p.wellnessPlans,
              alerts: petAlerts.get(p.id) ?? null,
            }))
          : undefined,
        
        // Pet information for non-logged-in users
        petInfoText: !isLoggedIn ? formData.whatPets || formData.petInfo : undefined,
        newPetInfo: formData.newPetInfo || undefined,
        
        // All pets data (for logged-in users, include all pets even if not selected)
        allPets: isLoggedIn && pets.length > 0
          ? pets.map(p => ({
              id: p.id,
              dbId: p.dbId,
              clientId: p.clientId,
              name: p.name,
              species: p.species,
              breed: p.breed,
              dob: p.dob,
              subscription: p.subscription,
              primaryProviderName: p.primaryProviderName,
              photoUrl: p.photoUrl,
              wellnessPlans: p.wellnessPlans,
              alerts: petAlerts.get(p.id) ?? null,
              isSelected: formData.selectedPetIds.includes(p.id),
            }))
          : undefined,
        otherPersonsOnAccount: formData.otherPersonsOnAccount || undefined,
        condoApartmentInfo: formData.condoApartmentInfo || undefined,
        
        // Veterinary History
        previousVeterinaryPractices: formData.previousVeterinaryPractices || formData.previousVeterinaryPracticesExisting || undefined,
        previousVeterinaryHospitals: formData.previousVeterinaryHospitals || undefined,
        okayToContactPreviousVets: formData.okayToContactPreviousVets || formData.okayToContactPreviousVetsExisting || undefined,
        hadVetCareElsewhere: formData.hadVetCareElsewhere || undefined,
        mayWeAskForRecords: formData.mayWeAskForRecords || undefined,
        petBehaviorAtPreviousVisits: formData.petBehaviorAtPreviousVisits || formData.petBehaviorAtPreviousVisitsExisting || undefined,
        
        // Pet Behavior & Handling
        needsCalmingMedications: formData.needsCalmingMedications || undefined,
        hasCalmingMedications: formData.hasCalmingMedications || undefined,
        needsMuzzleOrSpecialHandling: formData.needsMuzzleOrSpecialHandling || undefined,
        
        // Appointment Details
        appointmentType: isEuthanasia ? 'euthanasia' : 'regular_visit',
        preferredDoctor: formData.preferredDoctorExisting || formData.preferredDoctor || undefined,
        serviceArea: formData.serviceArea || formData.serviceAreaVisit || undefined,
        
        // Euthanasia Specific Fields
        ...(isEuthanasia ? {
          euthanasiaReason: formData.euthanasiaReason || undefined,
          beenToVetLastThreeMonths: formData.beenToVetLastThreeMonths || undefined,
          interestedInOtherOptions: formData.interestedInOtherOptions || undefined,
          urgency: formData.urgency || undefined,
          preferredDateTime: formData.preferredDateTime || undefined,
          selectedDateTimePreferences: (() => {
            const prefs = buildDateTimePreferences(formData.selectedDateTimeSlots || {});
            console.log('[AppointmentForm] Euthanasia selectedDateTimePreferences:', prefs);
            return prefs;
          })(),
          noneOfWorkForMe: formData.noneOfWorkForMe || false,
          aftercarePreference: formData.aftercarePreference || undefined,
          // Include service minutes if times were selected from the list
          ...(Object.keys(formData.selectedDateTimeSlots || {}).length > 0 && serviceMinutesUsed !== null ? {
            serviceMinutes: serviceMinutesUsed,
          } : {}),
        } : {}),
        
        // Regular Visit Specific Fields
        ...(!isEuthanasia ? {
          visitDetails: formData.visitDetails || undefined,
          needsUrgentScheduling: formData.needsUrgentScheduling || undefined,
          preferredDateTime: formData.preferredDateTimeVisit || undefined,
          selectedDateTimePreferences: (() => {
            const prefs = buildDateTimePreferences(formData.selectedDateTimeSlotsVisit || {});
            console.log('[AppointmentForm] Regular visit selectedDateTimePreferences:', prefs);
            return prefs;
          })(),
          noneOfWorkForMe: formData.noneOfWorkForMeVisit || false,
          // Include service minutes if times were selected from the list
          ...(Object.keys(formData.selectedDateTimeSlotsVisit || {}).length > 0 && serviceMinutesUsed !== null ? {
            serviceMinutes: serviceMinutesUsed,
          } : {}),
        } : {}),
        
        // Additional Information
        howDidYouHearAboutUs: formData.howDidYouHearAboutUs || undefined,
        anythingElse: formData.anythingElse || undefined,
        
        // Metadata
        submittedAt: new Date().toISOString(),
        formFlow: {
          startedAsLoggedIn: isLoggedIn,
          startedAsExistingClient: formData.haveUsedServicesBefore === 'Yes',
        },
      };
      
      // Remove undefined values to clean up payload
      const cleanPayload = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(cleanPayload);
        } else if (obj !== null && typeof obj === 'object') {
          const cleaned: any = {};
          Object.keys(obj).forEach(key => {
            const value = cleanPayload(obj[key]);
            if (value !== undefined) {
              cleaned[key] = value;
            }
          });
          return cleaned;
        }
        return obj;
      };
      
      const finalPayload = cleanPayload(submissionData);
      
      // Log the payload for debugging
      console.log('Form submission payload:', JSON.stringify(finalPayload, null, 2));
      
      // Send to API endpoint
      await http.post('/public/appointments/form', finalPayload);
      
      setCurrentPage('success');
    } catch (error: any) {
      setErrors({ submit: error?.response?.data?.message || 'Failed to submit form. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'intro':
        // Don't show intro page if user is logged in
        if (isLoggedIn) {
          return null;
        }
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <img
                src="https://www.jotform.com/uploads/vaydreception/form_files/55557353ac186960fd3022dfd922a80a.65cd143777c237.29151156.jpeg"
                alt="Vet At Your Door"
                style={{ maxWidth: '200px', height: 'auto', marginBottom: '20px' }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Vet At Your Door Appointment Request
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Thanks so much for contacting us! Please fill out this form and we will get back to you shortly!
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Email <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                placeholder="example@example.com"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.email ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
              {checkingEmail && (
                <div style={{ color: '#6b7280', fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>
                  Checking email...
                </div>
              )}
              {emailCheckResult?.exists && emailCheckResult?.hasAccount && !checkingEmail && (
                <div style={{
                  marginTop: '12px',
                  padding: '12px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fbbf24',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: '#92400e',
                }}>
                  <strong>This email already has an account.</strong> Please{' '}
                  <a
                    href="/login"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/login');
                    }}
                    style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    log in
                  </a>
                  {' '}to your account before creating an appointment.
                </div>
              )}
              {errors.email && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.email}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is your Full Name? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <input
                    type="text"
                    value={formData.fullName.first}
                    onChange={(e) => updateNestedFormData('fullName', 'first', e.target.value)}
                    placeholder="First Name"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: `1px solid ${errors['fullName.first'] ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                    }}
                  />
                  {errors['fullName.first'] && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors['fullName.first']}</div>}
                </div>
                <div>
                  <input
                    type="text"
                    value={formData.fullName.last}
                    onChange={(e) => updateNestedFormData('fullName', 'last', e.target.value)}
                    placeholder="Last Name"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: `1px solid ${errors['fullName.last'] ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                    }}
                  />
                  {errors['fullName.last'] && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors['fullName.last']}</div>}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Have you used Vet At Your Door's services before? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.haveUsedServicesBefore === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.haveUsedServicesBefore === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="haveUsedServicesBefore"
                      value={option}
                      checked={formData.haveUsedServicesBefore === option}
                      onChange={(e) => updateFormData('haveUsedServicesBefore', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              {errors.haveUsedServicesBefore && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.haveUsedServicesBefore}</div>}
            </div>
          </div>
        );

      case 'new-client':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                New Client Information
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Please enter the fields below so we can gather everything we need to set you up in our system
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is/are your best phone numbers? Please state if each number can receive texts. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.phoneNumbers || ''}
                onChange={(e) => updateFormData('phoneNumbers', e.target.value)}
                rows={3}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.phoneNumbers ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.phoneNumbers && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.phoneNumbers}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is your full physical address (where we should show up)? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={formData.physicalAddress?.line1 || ''}
                onChange={(e) => updateNestedFormData('physicalAddress', 'line1', e.target.value)}
                placeholder="Street Address"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors['physicalAddress.line1'] ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  marginBottom: '12px',
                }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                <input
                  type="text"
                  value={formData.physicalAddress?.city || ''}
                  onChange={(e) => updateNestedFormData('physicalAddress', 'city', e.target.value)}
                  placeholder="City"
                  style={{
                    padding: '12px',
                    border: `1px solid ${errors['physicalAddress.city'] ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
                <input
                  type="text"
                  value={formData.physicalAddress?.state || ''}
                  onChange={(e) => updateNestedFormData('physicalAddress', 'state', e.target.value)}
                  placeholder="State"
                  style={{
                    padding: '12px',
                    border: `1px solid ${errors['physicalAddress.state'] ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
                <input
                  type="text"
                  value={formData.physicalAddress?.zip || ''}
                  onChange={(e) => updateNestedFormData('physicalAddress', 'zip', e.target.value)}
                  placeholder="Zip"
                  style={{
                    padding: '12px',
                    border: `1px solid ${errors['physicalAddress.zip'] ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Is your mailing address different from your physical address?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes, it is different.', 'No, it is the same.'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.mailingAddressSame === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.mailingAddressSame === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="mailingAddressSame"
                      value={option}
                      checked={formData.mailingAddressSame === option}
                      onChange={(e) => updateFormData('mailingAddressSame', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.mailingAddressSame === 'Yes, it is different.' && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Please enter your MAILING address here.
                </label>
                <input
                  type="text"
                  value={formData.mailingAddress?.line1 || ''}
                  onChange={(e) => updateNestedFormData('mailingAddress', 'line1', e.target.value)}
                  placeholder="Street Address"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                    marginBottom: '12px',
                  }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                  <input
                    type="text"
                    value={formData.mailingAddress?.city || ''}
                    onChange={(e) => updateNestedFormData('mailingAddress', 'city', e.target.value)}
                    placeholder="City"
                    style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="text"
                    value={formData.mailingAddress?.state || ''}
                    onChange={(e) => updateNestedFormData('mailingAddress', 'state', e.target.value)}
                    placeholder="State"
                    style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                  />
                  <input
                    type="text"
                    value={formData.mailingAddress?.zip || ''}
                    onChange={(e) => updateNestedFormData('mailingAddress', 'zip', e.target.value)}
                    placeholder="Zip"
                    style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                  />
                </div>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Please list any other person you'd like on the account:
              </label>
              <input
                type="text"
                value={formData.otherPersonsOnAccount || ''}
                onChange={(e) => updateFormData('otherPersonsOnAccount', e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                If you live in a condo or apartment building, what is the number? Is there anything special we need to know about entering the building?
              </label>
              <input
                type="text"
                value={formData.condoApartmentInfo || ''}
                onChange={(e) => updateFormData('condoApartmentInfo', e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                For EACH pet we are seeing, please give us the following information: Name, Species, Age, Spayed/Neutered, Breed, Color, Approximate Weight. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.petInfo || ''}
                onChange={(e) => updateFormData('petInfo', e.target.value)}
                rows={5}
                placeholder="Pet 1: Name, Species, Age..."
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.petInfo ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.petInfo && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.petInfo}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What veterinary practice(s) did you use previously for your pet(s)? Include any specialists please. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.previousVeterinaryPractices || ''}
                onChange={(e) => updateFormData('previousVeterinaryPractices', e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.previousVeterinaryPractices ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.previousVeterinaryPractices && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.previousVeterinaryPractices}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Is it okay if we contact them to get records?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.okayToContactPreviousVets === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.okayToContactPreviousVets === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="okayToContactPreviousVets"
                      value={option}
                      checked={formData.okayToContactPreviousVets === option}
                      onChange={(e) => updateFormData('okayToContactPreviousVets', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                How did your pet behave at previous veterinary visits (if any)? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.petBehaviorAtPreviousVisits || ''}
                onChange={(e) => updateFormData('petBehaviorAtPreviousVisits', e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.petBehaviorAtPreviousVisits ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.petBehaviorAtPreviousVisits && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.petBehaviorAtPreviousVisits}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Has any pet that we are seeing needed calming medications at a previous veterinary visit?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.needsCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.needsCalmingMedications === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="needsCalmingMedications"
                      value={option}
                      checked={formData.needsCalmingMedications === option}
                      onChange={(e) => updateFormData('needsCalmingMedications', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.needsCalmingMedications === 'Yes' && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Do you have these medications on hand?
                </label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {['Yes', 'No'].map((option) => (
                    <label
                      key={option}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.hasCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.hasCalmingMedications === option ? '#f0fdf4' : '#fff',
                        flex: 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="hasCalmingMedications"
                        value={option}
                        checked={formData.hasCalmingMedications === option}
                        onChange={(e) => updateFormData('hasCalmingMedications', e.target.value)}
                        style={{ margin: 0 }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Has any pet that we are seeing needed a muzzle or other special handling at a previous veterinary visit (please know this is not meant to judge - it is just so we can best prepare!)?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.needsMuzzleOrSpecialHandling === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.needsMuzzleOrSpecialHandling === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="needsMuzzleOrSpecialHandling"
                      value={option}
                      checked={formData.needsMuzzleOrSpecialHandling === option}
                      onChange={(e) => updateFormData('needsMuzzleOrSpecialHandling', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Do you have a preferred doctor? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              {(() => {
                // Check if address is valid for new clients
                const hasValidAddress = isLoggedIn || (
                  formData.physicalAddress?.line1?.trim() &&
                  formData.physicalAddress?.city?.trim() &&
                  formData.physicalAddress?.state?.trim() &&
                  formData.physicalAddress?.zip?.trim()
                );
                const isDisabled = !isLoggedIn && !hasValidAddress;
                
                return (
                  <>
                    <select
                      value={formData.preferredDoctor || ''}
                      onChange={(e) => updateFormData('preferredDoctor', e.target.value)}
                      disabled={isDisabled}
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: `1px solid ${errors.preferredDoctor ? '#ef4444' : '#d1d5db'}`,
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: isDisabled ? '#f3f4f6' : '#fff',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        opacity: isDisabled ? 0.6 : 1,
                      }}
                    >
                      <option value="">
                        {isDisabled 
                          ? 'Please enter your address above first...' 
                          : 'Select a doctor...'}
                      </option>
                      {!isDisabled && (
                        <>
                          <option value="I have no preference">I have no preference</option>
                          {providers.map((provider) => {
                            // Check if name already starts with "Dr." to avoid duplication
                            const providerName = provider.name.startsWith('Dr. ') 
                              ? provider.name 
                              : `Dr. ${provider.name}`;
                            return (
                              <option key={provider.id} value={providerName}>
                                {providerName}
                              </option>
                            );
                          })}
                        </>
                      )}
                    </select>
                    {isDisabled && (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                        Please enter your complete address (street, city, state, zip) above to see available doctors.
                      </div>
                    )}
                    {errors.preferredDoctor && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.preferredDoctor}</div>}
                  </>
                );
              })()}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Are you looking for euthanasia services for your pet? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.lookingForEuthanasia === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.lookingForEuthanasia === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="lookingForEuthanasia"
                      value={option}
                      checked={formData.lookingForEuthanasia === option}
                      onChange={(e) => updateFormData('lookingForEuthanasia', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              {errors.lookingForEuthanasia && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.lookingForEuthanasia}</div>}
            </div>
          </div>
        );

      case 'existing-client':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Request an Appointment
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Thanks so much for reaching out and for your dedication to and support of Vet At Your Door!
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is the best number to reach you? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="tel"
                value={formData.bestPhoneNumber || ''}
                onChange={(e) => {
                  // Normalize phone number: remove +1 prefix if present
                  const normalized = e.target.value.replace(/^\+1\s*/, '').trim();
                  updateFormData('bestPhoneNumber', normalized);
                }}
                placeholder="(207) 555-1234"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.bestPhoneNumber ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
              {errors.bestPhoneNumber && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.bestPhoneNumber}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Can we text this number above?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.canWeText === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.canWeText === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="canWeText"
                      value={option}
                      checked={formData.canWeText === option}
                      onChange={(e) => updateFormData('canWeText', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What pet(s) would you like the appointment for? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              {isLoggedIn && pets.length > 0 ? (
                <div style={{ 
                  border: `1px solid ${errors.selectedPetIds ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  padding: '4px',
                  backgroundColor: '#f9fafb',
                }}>
                  {pets.map((pet) => (
                    <label
                      key={pet.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '4px 6px',
                        cursor: 'pointer',
                        borderRadius: '6px',
                        backgroundColor: formData.selectedPetIds.includes(pet.id) ? '#f0fdf4' : 'transparent',
                        border: `1px solid ${formData.selectedPetIds.includes(pet.id) ? '#10b981' : 'transparent'}`,
                        marginBottom: '2px',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formData.selectedPetIds.includes(pet.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateFormData('selectedPetIds', [...formData.selectedPetIds, pet.id]);
                          } else {
                            updateFormData('selectedPetIds', formData.selectedPetIds.filter(id => id !== pet.id));
                          }
                        }}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1, fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                        {pet.name}
                      </div>
                    </label>
                  ))}
                  {formData.selectedPetIds.length === 0 && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                      Please select at least one pet
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="text"
                  value={formData.whatPets || ''}
                  onChange={(e) => updateFormData('whatPets', e.target.value)}
                  placeholder="Enter pet name(s)"
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: `1px solid ${errors.whatPets ? '#ef4444' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
              )}
              {errors.whatPets && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.whatPets}</div>}
              {errors.selectedPetIds && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.selectedPetIds}</div>}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Have you moved since the last time we saw you?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.movedSinceLastVisit === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.movedSinceLastVisit === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="movedSinceLastVisit"
                      value={option}
                      checked={formData.movedSinceLastVisit === option}
                      onChange={(e) => updateFormData('movedSinceLastVisit', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.movedSinceLastVisit === 'Yes' && (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please put your new PHYSICAL address here.
                  </label>
                  <input
                    type="text"
                    value={formData.newPhysicalAddress?.line1 || ''}
                    onChange={(e) => updateNestedFormData('newPhysicalAddress', 'line1', e.target.value)}
                    placeholder="Street Address"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      marginBottom: '12px',
                    }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.city || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'city', e.target.value)}
                      placeholder="City"
                      style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                    />
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.state || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'state', e.target.value)}
                      placeholder="State"
                      style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                    />
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.zip || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'zip', e.target.value)}
                      placeholder="Zip"
                      style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Do you have a different mailing address than your physical address above?
                  </label>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    {['Yes', 'No'].map((option) => (
                      <label
                        key={option}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          cursor: 'pointer',
                          padding: '12px',
                          border: `1px solid ${formData.differentMailingAddress === option ? '#10b981' : '#d1d5db'}`,
                          borderRadius: '8px',
                          backgroundColor: formData.differentMailingAddress === option ? '#f0fdf4' : '#fff',
                          flex: 1,
                        }}
                      >
                        <input
                          type="radio"
                          name="differentMailingAddress"
                          value={option}
                          checked={formData.differentMailingAddress === option}
                          onChange={(e) => updateFormData('differentMailingAddress', e.target.value)}
                          style={{ margin: 0 }}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {formData.differentMailingAddress === 'Yes' && (
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                      Please enter your new MAILING address
                    </label>
                    <input
                      type="text"
                      value={formData.newMailingAddress?.line1 || ''}
                      onChange={(e) => updateNestedFormData('newMailingAddress', 'line1', e.target.value)}
                      placeholder="Street Address"
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px',
                        marginBottom: '12px',
                      }}
                    />
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                      <input
                        type="text"
                        value={formData.newMailingAddress?.city || ''}
                        onChange={(e) => updateNestedFormData('newMailingAddress', 'city', e.target.value)}
                        placeholder="City"
                        style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                      />
                      <input
                        type="text"
                        value={formData.newMailingAddress?.state || ''}
                        onChange={(e) => updateNestedFormData('newMailingAddress', 'state', e.target.value)}
                        placeholder="State"
                        style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                      />
                      <input
                        type="text"
                        value={formData.newMailingAddress?.zip || ''}
                        onChange={(e) => updateNestedFormData('newMailingAddress', 'zip', e.target.value)}
                        placeholder="Zip"
                        style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Did your pet(s) get veterinary care from another hospital (e.g. specialists, emergency, etc.) since the last time we saw your pet(s)?
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.hadVetCareElsewhere === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.hadVetCareElsewhere === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="hadVetCareElsewhere"
                      value={option}
                      checked={formData.hadVetCareElsewhere === option}
                      onChange={(e) => updateFormData('hadVetCareElsewhere', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>

            {formData.hadVetCareElsewhere === 'Yes' && (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please let us know which veterinary hospitals you went to.
                  </label>
                  <textarea
                    value={formData.previousVeterinaryHospitals || ''}
                    onChange={(e) => updateFormData('previousVeterinaryHospitals', e.target.value)}
                    rows={4}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  />
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    May we ask for records from the above hospitals?
                  </label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {['Yes', 'No'].map((option) => (
                    <label
                      key={option}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.mayWeAskForRecords === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.mayWeAskForRecords === option ? '#f0fdf4' : '#fff',
                        flex: 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="mayWeAskForRecords"
                        value={option}
                        checked={formData.mayWeAskForRecords === option}
                        onChange={(e) => updateFormData('mayWeAskForRecords', e.target.value)}
                        style={{ margin: 0 }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
              </>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Do you have a preferred doctor? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <select
                value={formData.preferredDoctorExisting || ''}
                onChange={(e) => updateFormData('preferredDoctorExisting', e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.preferredDoctorExisting ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              >
                <option value="">Select a doctor...</option>
                <option value="I have no preference">I have no preference</option>
                {providers.map((provider) => {
                  const providerName = `Dr. ${provider.name}`;
                  return (
                    <option key={provider.id} value={providerName}>
                      {providerName}
                    </option>
                  );
                })}
                <option value="Whomever I saw last time (I don't remember their name)">
                  Whomever I saw last time (I don't remember their name)
                </option>
              </select>
              {errors.preferredDoctorExisting && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.preferredDoctorExisting}</div>}
            </div>
            

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Are you looking for euthanasia for your pet? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.lookingForEuthanasiaExisting === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.lookingForEuthanasiaExisting === option ? '#f0fdf4' : '#fff',
                      flex: 1,
                    }}
                  >
                    <input
                      type="radio"
                      name="lookingForEuthanasiaExisting"
                      value={option}
                      checked={formData.lookingForEuthanasiaExisting === option}
                      onChange={(e) => updateFormData('lookingForEuthanasiaExisting', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
              {errors.lookingForEuthanasiaExisting && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.lookingForEuthanasiaExisting}</div>}
            </div>
          </div>
        );

      case 'euthanasia-intro':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Thank you for reaching out to us. We imagine this is a very difficult time for you and we are honored to help you through it. Please fill out the questions below and we will get back to you as soon as possible.
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Let us know what is going on with your pet that has brought you to this difficult decision. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.euthanasiaReason || ''}
                onChange={(e) => updateFormData('euthanasiaReason', e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.euthanasiaReason ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.euthanasiaReason && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.euthanasiaReason}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Has your pet been to the veterinarian for these issues in the last three months (it's ok if not - this just helps us schedule correctly)? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                value={formData.beenToVetLastThreeMonths || ''}
                onChange={(e) => updateFormData('beenToVetLastThreeMonths', e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${errors.beenToVetLastThreeMonths ? '#ef4444' : '#d1d5db'}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                }}
              />
              {errors.beenToVetLastThreeMonths && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.beenToVetLastThreeMonths}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Are you interested in pursuing other options other than euthanasia? We absolutely do not judge your decision - we are here for you - we just want to be sure we schedule an appointment that addresses all of your and your pet's needs. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'No. While this is very difficult, I have made my decision. I don\'t wish to pursue further discussion about my decision or investigate other options at this point.',
                  'Yes. I am interested in speaking with the doctor about other options that may help.',
                  'I\'m not sure.',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.interestedInOtherOptions === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.interestedInOtherOptions === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="interestedInOtherOptions"
                      value={option}
                      checked={formData.interestedInOtherOptions === option}
                      onChange={(e) => updateFormData('interestedInOtherOptions', e.target.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.interestedInOtherOptions && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.interestedInOtherOptions}
                </div>
              )}
            </div>
          </div>
        );

      case 'euthanasia-service-area':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Service Area
              </h1>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Which of our service areas do you need services in? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'Kennebunk / Greater Portland / Augusta Area',
                  'Maine High Peaks Area',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.serviceArea === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.serviceArea === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="serviceArea"
                      value={option}
                      checked={formData.serviceArea === option}
                      onChange={(e) => updateFormData('serviceArea', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia
              </h1>
              <div style={{ 
                backgroundColor: '#fef3c7', 
                border: '1px solid #fbbf24', 
                borderRadius: '8px', 
                padding: '16px', 
                marginBottom: '20px',
                textAlign: 'left',
              }}>
                <p style={{ fontWeight: 600, marginBottom: '8px' }}>❗An important note about emergent euthanasias:❗</p>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  We offer euthanasias during our normal business hours of 8:00am-5:00pm. We ALSO offer extended euthanasia hours of 5:00-7:00pm on most Mondays through Thursdays unless noted on the website.
                </p>
                <p style={{ fontSize: '14px', marginBottom: '8px' }}>
                  If you are contacting us during our normal or extended euthanasia hours and you need help urgently, please choose the "My pet is in immediate distress" option below.
                </p>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                How urgently do you need the euthanasia performed? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'My pet is in immediate distress (I need help now / within a few hours)',
                  'The procedure is not urgent / my pet can wait a few days.',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.urgency === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.urgency === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="urgency"
                      value={option}
                      checked={formData.urgency === option}
                      onChange={(e) => updateFormData('urgency', e.target.value)}
                      style={{ marginTop: '2px' }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'euthanasia-continued':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Euthanasia (Continued)
              </h1>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is your preferred date/time for the euthanasia? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Please enter your preferred date and time: <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  value={formData.preferredDateTime || ''}
                  onChange={(e) => updateFormData('preferredDateTime', e.target.value)}
                  rows={4}
                  placeholder="Enter your preferred date and time here..."
                  style={{
                    width: '100%',
                      padding: '12px',
                    border: errors.preferredDateTime ? '1px solid #ef4444' : '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
                {errors.preferredDateTime && (
                  <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                    {errors.preferredDateTime}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Please let us know your aftercare preference. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[
                  'I will handle my pet\'s remains (e.g. bury at home)',
                  'Private Cremation (Cremation WITH return of ashes)',
                  'Burial At Sea (Cremation WITHOUT return of ashes)',
                  'I am not sure yet.',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.aftercarePreference === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.aftercarePreference === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="aftercarePreference"
                      value={option}
                      checked={formData.aftercarePreference === option}
                      onChange={(e) => updateFormData('aftercarePreference', e.target.value)}
                      style={{ margin: 0 }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'request-visit-continued':
        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Request Visit (Continued)
              </h1>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Give us more details about the veterinary services you need. <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={formData.visitDetails || ''}
                onChange={(e) => updateFormData('visitDetails', e.target.value)}
                rows={5}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: errors.visitDetails ? '1px solid #ef4444' : '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
              {errors.visitDetails && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.visitDetails}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Is this a patient that needs to be seen in the next 24-48 hours? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['Yes', 'No'].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '12px',
                      border: `1px solid ${formData.needsUrgentScheduling === option ? '#10b981' : '#d1d5db'}`,
                      borderRadius: '8px',
                      backgroundColor: formData.needsUrgentScheduling === option ? '#f0fdf4' : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="needsUrgentScheduling"
                      value={option}
                      checked={formData.needsUrgentScheduling === option}
                      onChange={(e) => {
                        updateFormData('needsUrgentScheduling', e.target.value);
                        // Clear slots when changing urgency status
                        setRecommendedSlots([]);
                      }}
                      style={{ margin: 0 }}
                    />
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.needsUrgentScheduling && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.needsUrgentScheduling}
                </div>
              )}
            </div>

            {formData.needsUrgentScheduling === 'Yes' && (
              <div style={{ 
                marginBottom: '20px', 
                padding: '16px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #10b981',
                borderRadius: '8px',
                fontSize: '14px',
                color: '#065f46',
              }}>
                Once you submit the form, a Client Liaison will be in touch with you shortly about available times.
              </div>
            )}

            {formData.needsUrgentScheduling === 'No' && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                What is your preferred date and time? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              
              {recommendedSlots.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '12px' }}>
                    Please select your preferred available times (in order of preference): <span style={{ color: '#ef4444' }}>*</span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '12px',
                    marginBottom: '12px',
                  }}>
                    {recommendedSlots.map((slot, slotIdx) => {
                      const preference = (formData.selectedDateTimeSlotsVisit || {})[slot.iso];
                      const isSelected = preference !== undefined;
                      return (
                        <label
                          key={slotIdx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            cursor: 'pointer',
                            padding: '12px',
                            border: `1px solid ${isSelected ? '#10b981' : '#d1d5db'}`,
                            borderRadius: '8px',
                            backgroundColor: isSelected ? '#f0fdf4' : '#fff',
                            transition: 'all 0.2s',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              const current = formData.selectedDateTimeSlotsVisit || {};
                              if (e.target.checked) {
                                // Clear "none work" if selecting a time
                                if (formData.noneOfWorkForMeVisit) {
                                  updateFormData('noneOfWorkForMeVisit', false);
                                }
                                // Assign next available preference number
                                const existingPreferences = Object.values(current);
                                const nextPreference = existingPreferences.length > 0 
                                  ? Math.max(...existingPreferences) + 1 
                                  : 1;
                                updateFormData('selectedDateTimeSlotsVisit', { ...current, [slot.iso]: nextPreference });
                              } else {
                                const { [slot.iso]: removed, ...rest } = current;
                                // Renumber remaining preferences
                                const renumbered: Record<string, number> = {};
                                Object.entries(rest).forEach(([iso, pref]) => {
                                  renumbered[iso] = pref > removed ? pref - 1 : pref;
                                });
                                updateFormData('selectedDateTimeSlotsVisit', renumbered);
                              }
                            }}
                            style={{ margin: 0, cursor: 'pointer' }}
                          />
                          <span style={{ fontSize: '14px', flex: 1 }}>{slot.display}</span>
                          {isSelected && (
                            <span style={{ 
                              fontSize: '12px', 
                              fontWeight: 600, 
                              color: '#10b981',
                              backgroundColor: '#d1fae5',
                              padding: '4px 8px',
                              borderRadius: '4px',
                            }}>
                              Preference {preference}
                            </span>
                          )}
                        </label>
                      );
                    })}
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.noneOfWorkForMeVisit ? '#ef4444' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.noneOfWorkForMeVisit ? '#fee2e2' : '#fff',
                        transition: 'all 0.2s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={formData.noneOfWorkForMeVisit || false}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Clear all selections when "none work" is checked
                            updateFormData('selectedDateTimeSlotsVisit', {});
                            updateFormData('noneOfWorkForMeVisit', true);
                          } else {
                            updateFormData('noneOfWorkForMeVisit', false);
                          }
                        }}
                        style={{ margin: 0, cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '14px', flex: 1, color: formData.noneOfWorkForMeVisit ? '#991b1b' : '#374151' }}>
                        None of these work for me
                      </span>
                    </label>
                    {formData.noneOfWorkForMeVisit && (
                      <div style={{ 
                        marginTop: '8px', 
                        marginLeft: '32px',
                        fontSize: '13px', 
                        color: '#6b7280', 
                        fontStyle: 'italic' 
                      }}>
                        We will be in touch with some more times.
                      </div>
                    )}
                  </div>
                  {errors.selectedDateTimeSlotsVisit && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                      {errors.selectedDateTimeSlotsVisit}
                    </div>
                  )}
                </div>
              )}
              
              {loadingSlots && (
                <div style={{ 
                  marginBottom: '20px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px',
                  padding: '16px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #10b981',
                  borderRadius: '8px',
                }}>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    border: '3px solid #d1fae5',
                    borderTop: '3px solid #10b981',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ fontSize: '14px', color: '#065f46', fontWeight: 500 }}>
                    Finding available times for {formData.preferredDoctorExisting || formData.preferredDoctor}...
                  </span>
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                </div>
              )}
              
              {!loadingSlots && recommendedSlots.length === 0 && (formData.preferredDoctorExisting || formData.preferredDoctor) && (
                <div style={{ 
                  marginBottom: '12px', 
                  padding: '12px',
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fbbf24',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#92400e',
                }}>
                  No available time slots found in the next 6 weeks. Please contact us directly to schedule your appointment.
                </div>
              )}
              
              {recommendedSlots.length === 0 && !loadingSlots && (
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please enter your preferred date and time: <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.preferredDateTimeVisit || ''}
                    onChange={(e) => updateFormData('preferredDateTimeVisit', e.target.value)}
                    placeholder="Enter your preferred date and time here..."
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: errors.preferredDateTimeVisit ? '1px solid #ef4444' : '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                    }}
                  />
                  {errors.preferredDateTimeVisit && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                      {errors.preferredDateTimeVisit}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Only show "How did you hear about us" for new clients */}
            {(!isLoggedIn && formData.haveUsedServicesBefore === 'No') && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  How did you hear about us?
                </label>
                <input
                  type="text"
                  value={formData.howDidYouHearAboutUs || ''}
                  onChange={(e) => updateFormData('howDidYouHearAboutUs', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Anything else you want us to know?
              </label>
              <textarea
                value={formData.anythingElse || ''}
                onChange={(e) => updateFormData('anythingElse', e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>
        );

      default:
        return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Page: {currentPage} - Implementation in progress...</div>;
    }
  };

  if (currentPage === 'success') {
    return (
      <div style={{ maxWidth: '800px', margin: '40px auto', padding: '0 16px' }}>
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '40px',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>✓</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '12px' }}>
            Thank You!
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '32px' }}>
            Your appointment request has been submitted successfully. We'll get back to you shortly!
          </p>
          <button
            onClick={() => navigate('/client-portal')}
            style={{
              padding: '12px 24px',
              backgroundColor: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Return to Portal
          </button>
        </div>
      </div>
    );
  }

  // Determine progress steps based on flow
  const getProgressSteps = (): Array<{ id: Page; label: string }> => {
    const steps: Array<{ id: Page; label: string }> = [];
    
    // Intro step (only for non-logged-in users who haven't completed it)
    if (!isLoggedIn && (currentPage === 'intro' || !formData.haveUsedServicesBefore)) {
      steps.push({ id: 'intro', label: 'Introduction' });
    }
    
    // Client information step
    if (isLoggedIn) {
      steps.push({ id: 'existing-client', label: 'Request an Appointment' });
    } else if (formData.haveUsedServicesBefore === 'Yes' || currentPage === 'existing-client') {
      steps.push({ id: 'existing-client', label: 'Request an Appointment' });
    } else if (formData.haveUsedServicesBefore === 'No' || currentPage === 'new-client') {
      steps.push({ id: 'new-client', label: 'New Client Information' });
    }
    
    // Determine which flow based on current page or form data
    const isEuthanasia = 
      formData.lookingForEuthanasia === 'Yes' || 
      formData.lookingForEuthanasiaExisting === 'Yes' ||
      currentPage.startsWith('euthanasia');
    
    const isRequestVisit = 
      currentPage.startsWith('request-visit') ||
      (formData.lookingForEuthanasia === 'No' && formData.lookingForEuthanasiaExisting === 'No' && 
       !currentPage.startsWith('euthanasia') && currentPage !== 'intro' && 
       currentPage !== 'new-client' && currentPage !== 'existing-client');
    
    if (isEuthanasia) {
      steps.push({ id: 'euthanasia-intro', label: 'Euthanasia Details' });
      steps.push({ id: 'euthanasia-service-area', label: 'Service Area' });
      steps.push({ id: 'euthanasia-continued', label: 'Euthanasia Preferences' });
    } else if (isRequestVisit || (!isEuthanasia && currentPage.startsWith('request-visit'))) {
      steps.push({ id: 'request-visit-continued', label: 'Visit Details' });
    }
    
    
    return steps;
  };

  const progressSteps = getProgressSteps();
  
  const getStepStatus = (stepId: Page): 'completed' | 'current' | 'upcoming' => {
    const mainCurrentPage = getMainStepId(currentPage);
    const currentIndex = progressSteps.findIndex(s => s.id === mainCurrentPage);
    const stepIndex = progressSteps.findIndex(s => s.id === stepId);
    
    if (stepIndex === -1) return 'upcoming';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'current';
    return 'upcoming';
  };

  // Map page variations to main step IDs for progress tracking
  const getMainStepId = (page: Page): Page => {
    if (page === 'euthanasia-portland' || page === 'euthanasia-high-peaks') {
      return 'euthanasia-service-area';
    }
    return page;
  };

  const renderProgressIndicator = () => {
    if ((currentPage as Page) === 'success') return null;
    
    return (
      <div style={{
        width: isMobile ? '100%' : '220px',
        padding: '24px',
        backgroundColor: '#f9fafb',
        borderRadius: '12px',
        borderRight: isMobile ? 'none' : '1px solid #e5e7eb',
        borderBottom: isMobile ? '1px solid #e5e7eb' : 'none',
        marginBottom: isMobile ? '0' : '0',
        flexShrink: 0,
      }}>
        <h3 style={{
          fontSize: '14px',
          fontWeight: 700,
          color: '#111827',
          marginBottom: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Progress
        </h3>
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}>
          {progressSteps.map((step, index) => {
            const status = getStepStatus(step.id);
            const isCompleted = status === 'completed';
            const isCurrent = status === 'current';
            
            return (
              <li
                key={step.id}
                style={{
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <div style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  border: `2px solid ${isCurrent ? '#10b981' : isCompleted ? '#10b981' : '#d1d5db'}`,
                  backgroundColor: isCurrent ? '#10b981' : isCompleted ? '#10b981' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px',
                }}>
                  {isCompleted && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M10 3L4.5 8.5L2 6"
                        stroke="white"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <div style={{
                  flex: 1,
                  fontSize: '14px',
                  color: isCurrent ? '#10b981' : isCompleted ? '#6b7280' : '#9ca3af',
                  fontWeight: isCurrent ? 600 : isCompleted ? 500 : 400,
                }}>
                  {step.label}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  if (loadingClientData) {
    return (
      <div style={{ maxWidth: '1200px', margin: '40px auto', padding: '0 16px' }}>
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          padding: '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '18px', color: '#6b7280' }}>Loading your information...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '40px auto', padding: '0 16px' }}>
      {/* Mobile Progress Indicator - Top */}
      {isMobile && (
        <div style={{ marginBottom: '24px' }}>
          {renderProgressIndicator()}
        </div>
      )}
      
      <div style={{
        display: 'flex',
        gap: '24px',
        alignItems: 'flex-start',
        flexDirection: isMobile ? 'column' : 'row',
      }}>
        {/* Progress Indicator - Left Side (Desktop) */}
        {!isMobile && renderProgressIndicator()}
        
        {/* Form Content - Right Side */}
        <div style={{
          flex: 1,
          background: '#fff',
          borderRadius: '12px',
          padding: isMobile ? '24px' : '40px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          minWidth: 0, // Prevent flex item from overflowing
          width: '100%',
        }}>
          {renderPage()}
        
        {errors.submit && (
          <div style={{
            marginTop: '20px',
            padding: '12px',
            backgroundColor: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
            fontSize: '14px',
          }}>
            {errors.submit}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '32px', gap: '12px' }}>
          {currentPage !== 'intro' && (
            <button
              type="button"
              onClick={handleBack}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Previous
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={handleNext}
            disabled={submitting}
            style={{
              padding: '12px 24px',
              backgroundColor: '#10b981',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? 'Submitting...' : (currentPage === 'request-visit-continued' || currentPage === 'euthanasia-continued') ? 'Submit' : 'Next'}
          </button>
        </div>
        </div>
      </div>

      {/* Existing Client Modal */}
      {showExistingClientModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowExistingClientModal(false)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '16px' }}>
              {emailCheckForModal?.hasAccount ? 'Account Already Exists' : 'Email Already on File'}
            </h2>
            <p style={{ fontSize: '16px', color: '#374151', marginBottom: '24px', lineHeight: '1.5' }}>
              {emailCheckForModal?.hasAccount ? (
                <>
                  We found an account associated with <strong>{formData.email}</strong>. Please log in to your account to request an appointment.
                </>
              ) : (
                <>
                  We found <strong>{formData.email}</strong> in our system. Please log in to your account or create an account to request an appointment.
                </>
              )}
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => {
                  setShowExistingClientModal(false);
                  setEmailCheckForModal(null);
                }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              {emailCheckForModal?.hasAccount ? (
                <a
                  href="/login"
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Go to Login
                </a>
              ) : (
                <a
                  href="/create-client"
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#10b981',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Create Account
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

