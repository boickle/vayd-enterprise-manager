// src/pages/AppointmentRequestForm.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { http } from '../api/http';
import { fetchClientPets, type Pet, fetchClientInfo } from '../api/clientPortal';
import { fetchPrimaryProviders, fetchVeterinarians, type Provider } from '../api/employee';
import { validateAddress } from '../api/geo';
import { DateTime } from 'luxon';
import {
  checkEmail,
  fetchPublicProviders,
  fetchPublicVeterinarians,
  fetchAvailability,
  fetchAppointmentTypes,
  type PublicProvider,
  type AvailabilityResponse,
  type AppointmentType,
} from '../api/publicAppointments';
import { trackEvent } from '../utils/analytics';

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
  petSpecificData?: Record<string, {
    needsToday?: string; // Single selected need (wellness exam, not feeling well, etc.)
    needsTodayDetails?: string; // Details/reason for the selected need
    // Euthanasia-specific fields (for end-of-life option)
    euthanasiaReason?: string;
    beenToVetLastThreeMonths?: string;
    interestedInOtherOptions?: 'Yes' | 'No' | '';
    aftercarePreference?: string;
  }>; // Per-pet data keyed by pet ID
  howSoon?: 'Emergent – today' | 'Urgent – within 24–48 hours' | 'Soon – sometime this week' | 'In 3–4 weeks' | 'Flexible – within the next month' | 'Routine – in about 3 months' | 'Planned – in about 6 months' | 'Future – in about 12 months' | ''; // How soon all pets need to be seen
  
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
  petInfo: string; // Name, Species, Age, Spayed/Neutered, Breed, Color, Weight (legacy, kept for backward compatibility)
  newClientPets?: Array<{
    id: string; // Unique ID for this pet
    name: string;
    species?: string;
    speciesId?: number; // ID of selected species for breed lookup
    otherSpecies?: string; // Custom species name when "Other" is selected
    age?: string;
    spayedNeutered?: string;
    sex?: string;
    breed?: string;
    breedId?: number; // ID of selected breed
    color?: string;
    weight?: string;
    behaviorAtPreviousVisits?: string;
    needsCalmingMedications?: 'Yes' | 'No' | '';
    hasCalmingMedications?: 'Yes' | 'No' | '';
    needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | '';
  }>;
  existingClientNewPets?: Array<{
    id: string; // Unique ID for this pet
    name: string;
    species?: string;
    speciesId?: number; // ID of selected species for breed lookup
    otherSpecies?: string; // Custom species name when "Other" is selected
    age?: string;
    spayedNeutered?: string;
    sex?: string;
    breed?: string;
    breedId?: number; // ID of selected breed
    color?: string;
    weight?: string;
    behaviorAtPreviousVisits?: string;
    needsCalmingMedications?: 'Yes' | 'No' | '';
    hasCalmingMedications?: 'Yes' | 'No' | '';
    needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | '';
  }>;
  previousVeterinaryPractices?: string;
  okayToContactPreviousVets?: 'Yes' | 'No' | '';
  petBehaviorAtPreviousVisits?: string; // Legacy field
  preferredDoctor?: string;
  lookingForEuthanasia?: 'Yes' | 'No' | '';
  needsCalmingMedications?: 'Yes' | 'No' | ''; // Legacy field
  hasCalmingMedications?: 'Yes' | 'No' | ''; // Legacy field
  needsMuzzleOrSpecialHandling?: 'Yes' | 'No' | ''; // Legacy field
  
  // Existing Client Info
  bestPhoneNumber?: string;
  whatPets?: string;
  previousVeterinaryHospitals?: string;
  preferredDoctorExisting?: string;
  lookingForEuthanasiaExisting?: 'Yes' | 'No' | '';
  isThisTheAddressWhereWeWillCome?: 'Yes' | 'No' | '';
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
  membershipInterest?: 'Pay as you go' | 'Membership' | "I'm not sure yet";
};

type Page = 
  | 'intro'
  | 'new-client'
  | 'new-client-pet-info'
  | 'existing-client'
  | 'existing-client-pets'
  | 'euthanasia-intro'
  | 'euthanasia-service-area'
  | 'euthanasia-portland'
  | 'euthanasia-high-peaks'
  | 'euthanasia-continued'
  | 'request-visit-continued'
  | 'success';

export default function AppointmentRequestForm() {
  const navigate = useNavigate();
  const { token, userEmail, userId } = useAuth() as any;
  const isLoggedIn = !!token;
  
  const [currentPage, setCurrentPage] = useState<Page>('intro');
  const [pets, setPets] = useState<Pet[]>([]);
  const [petAlerts, setPetAlerts] = useState<Map<string, string | null>>(new Map()); // Map of pet ID to alerts
  const [providers, setProviders] = useState<Provider[]>([]);
  const [publicProviders, setPublicProviders] = useState<PublicProvider[]>([]);
  // Store raw veterinarian data (with appointmentTypes) for filtering
  const [rawVeterinarians, setRawVeterinarians] = useState<any[]>([]);
  const [rawPublicVeterinarians, setRawPublicVeterinarians] = useState<any[]>([]);
  const [loadingClientData, setLoadingClientData] = useState(false);
  const [loadingVeterinarians, setLoadingVeterinarians] = useState(false); // Always false initially - never blocks render
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [loadingAppointmentTypes, setLoadingAppointmentTypes] = useState(false);
  const [primaryProviderName, setPrimaryProviderName] = useState<string | null>(null);
  const [originalAddress, setOriginalAddress] = useState<FormData['physicalAddress'] | null>(null);
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
    newClientPets: [],
    existingClientNewPets: [],
    lookingForEuthanasia: '',
    lookingForEuthanasiaExisting: '',
    isThisTheAddressWhereWeWillCome: '',
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
  const lastCheckedAddressRef = useRef<string>(''); // Track last checked address to avoid duplicate zone checks
  const clientLocationRef = useRef<{ lat?: number; lon?: number; address?: string }>({}); // Store client location for veterinarian lookup
  const [speciesList, setSpeciesList] = useState<Array<{ id: number; name: string; prettyName?: string; showInUi?: boolean }>>([]); // List of available species
  const [breedsBySpecies, setBreedsBySpecies] = useState<Record<number, Array<{ id: number; name: string }>>>({}); // Breeds keyed by species ID
  const [loadingSpecies, setLoadingSpecies] = useState(false);
  const [loadingBreeds, setLoadingBreeds] = useState<Record<number, boolean>>({}); // Loading state per species
  const [breedSearchTerms, setBreedSearchTerms] = useState<Record<string, string>>({}); // Search terms for breed dropdowns, keyed by pet ID
  const [breedDropdownOpen, setBreedDropdownOpen] = useState<Record<string, boolean>>({}); // Track which breed dropdowns are open, keyed by pet ID
  const [clientLocationReady, setClientLocationReady] = useState(false); // Track when client location is available for veterinarian fetch

  // Handle responsive layout
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Get appointment type by name
  const getAppointmentTypeByName = (name: string): AppointmentType | undefined => {
    return appointmentTypes.find(type => type.name === name);
  };

  // Check if an appointment type is euthanasia by its name
  const isEuthanasiaAppointmentType = (appointmentTypeName: string): boolean => {
    return appointmentTypeName === 'Euthanasia';
  };

  // Helper to check if appointment type name matches common patterns (for placeholders)
  const matchesAppointmentTypeName = (appointmentTypeName: string, patterns: string[]): boolean => {
    const type = getAppointmentTypeByName(appointmentTypeName);
    if (!type) return false;
    const nameLower = type.name.toLowerCase();
    const prettyNameLower = type.prettyName.toLowerCase();
    return patterns.some(pattern => 
      nameLower.includes(pattern.toLowerCase()) || 
      prettyNameLower.includes(pattern.toLowerCase())
    );
  };

  // Get appointment type options for the form
  // Returns array of objects with name and prettyName, sorted to show euthanasia last if present
  // Filters by newPatientAllowed for new patients
  const getAppointmentTypeOptions = (): Array<{ name: string; prettyName: string }> => {
    if (loadingAppointmentTypes || appointmentTypes.length === 0) {
      return []; // Return empty array while loading
    }
    
    // Determine if this is a new patient
    // New patient = not logged in AND haven't used services before
    const isNewPatient = !isLoggedIn && formData.haveUsedServicesBefore !== 'Yes';
    
    // Filter appointment types based on newPatientAllowed for new patients
    // This is a safeguard in case the API didn't filter correctly
    let filteredTypes = appointmentTypes;
    if (isNewPatient) {
      // For new patients, only show appointment types where newPatientAllowed is true
      filteredTypes = appointmentTypes.filter(type => type.newPatientAllowed === true);
    }
    
    // Map to objects with name and prettyName, and sort so euthanasia appears last
    const options = filteredTypes.map(type => ({
      name: type.name,
      prettyName: type.prettyName || type.name,
    }));
    const euthanasiaIndex = options.findIndex(opt => isEuthanasiaAppointmentType(opt.name));
    
    if (euthanasiaIndex !== -1) {
      // Move euthanasia to the end
      const euthanasia = options[euthanasiaIndex];
      const others = options.filter((_, idx) => idx !== euthanasiaIndex);
      return [...others, euthanasia];
    }
    
    return options;
  };

  // Get all selected appointment type names from the form
  // Returns a Set of unique appointment type names (not prettyNames) selected across all pets
  const getSelectedAppointmentTypes = (): Set<string> => {
    const selectedTypes = new Set<string>();
    
    // Check selectedPetIds (existing pets)
    if (formData.selectedPetIds && formData.petSpecificData) {
      formData.selectedPetIds.forEach(petId => {
        const petData = formData.petSpecificData?.[petId];
        if (petData?.needsToday) {
          // needsToday now stores the appointment type name, not prettyName
          selectedTypes.add(petData.needsToday);
        }
      });
    }
    
    // Check newClientPets
    if (formData.newClientPets && formData.petSpecificData) {
      formData.newClientPets.forEach(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        if (petData?.needsToday) {
          selectedTypes.add(petData.needsToday);
        }
      });
    }
    
    // Check existingClientNewPets
    if (formData.existingClientNewPets && formData.petSpecificData) {
      formData.existingClientNewPets.forEach(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        if (petData?.needsToday) {
          selectedTypes.add(petData.needsToday);
        }
      });
    }
    
    return selectedTypes;
  };

  // Filter veterinarians to only include those who accept ALL selected appointment types
  // Takes raw veterinarian data and filters based on appointment type names (not prettyNames)
  const filterVeterinariansByAppointmentTypes = (veterinarians: any[]): any[] => {
    const selectedTypes = getSelectedAppointmentTypes();
    
    // If no appointment types are selected yet, return all veterinarians
    if (selectedTypes.size === 0) {
      return veterinarians;
    }
    
    return veterinarians.filter((vet) => {
      // Get all appointment type names that this veterinarian accepts
      const vetAppointmentTypes = new Set<string>();
      if (vet.appointmentTypes && Array.isArray(vet.appointmentTypes)) {
        vet.appointmentTypes.forEach((aptType: any) => {
          // Use the name field, not prettyName (selectedTypes contains appointment type names)
          if (aptType.name) {
            vetAppointmentTypes.add(aptType.name);
          }
        });
      }
      
      // Check if veterinarian accepts ALL selected appointment types
      // Only include veterinarians who have all selected types in their appointmentTypes array
      for (const selectedType of selectedTypes) {
        if (!vetAppointmentTypes.has(selectedType)) {
          return false; // This veterinarian doesn't accept this appointment type
        }
      }
      
      return true; // Veterinarian accepts all selected appointment types
    });
  };

  // Convert raw veterinarian data to PublicProvider format
  const mapRawVeterinarianToPublicProvider = (vet: any): PublicProvider => {
    const id = vet.id ?? vet.pimsId ?? vet.employeeId;
    
    // Build name from title, firstName, lastName, and designation
    const nameParts: string[] = [];
    if (vet.title) nameParts.push(vet.title);
    if (vet.firstName) nameParts.push(vet.firstName);
    if (vet.lastName) nameParts.push(vet.lastName);
    if (vet.designation) nameParts.push(vet.designation);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ')
      : (`${vet.firstName || ''} ${vet.lastName || ''}`.trim() || `Veterinarian ${id ?? ''}`);
    
    return {
      id: id,
      name: name,
      email: vet?.email,
    };
  };

  // Convert raw veterinarian data to Provider format
  const mapRawVeterinarianToProvider = (vet: any): Provider => {
    const pimsId = vet.pimsId ? String(vet.pimsId) : null;
    const id = vet.id ?? vet.pimsId;
    
    // Build name from firstName, middleName, lastName
    const nameParts: string[] = [];
    if (vet.firstName) nameParts.push(vet.firstName);
    if (vet.middleName || vet.middleInitial) {
      const middle = vet.middleInitial || (vet.middleName ? vet.middleName.charAt(0).toUpperCase() : '');
      if (middle) nameParts.push(middle);
    }
    if (vet.lastName) nameParts.push(vet.lastName);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ').trim()
      : (vet.name || `Provider ${id ?? ''}`);
    
    return {
      id: id,
      pimsId: pimsId || String(id),
      email: vet?.email || '',
      name: name,
      dailyRevenueGoal: vet?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: vet?.bonusRevenueGoal ?? null,
      dailyPointGoal: vet?.dailyPointGoal ?? null,
      weeklyPointGoal: vet?.weeklyPointGoal ?? null,
    };
  };

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
      
      // Get coordinates - try to validate address if we have one (only for logged-in clients)
      let lat: number | undefined;
      let lon: number | undefined;
      let validatedAddress: string | undefined = fullAddress;
      
      // Only do geocoding for logged-in clients (skip for new clients)
      if (fullAddress && isLoggedIn) {
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

      // Calculate date range based on howSoon selection using day offsets from today
      // All ranges are inclusive and based on today = day 0
      const today = DateTime.now();
      let startDate: string | null = null;
      let numDays: number = 0;
      
      if (formData.howSoon) {
        switch (formData.howSoon) {
          case 'Emergent – today':
            // Do not auto-search - handled manually by CL
            setRecommendedSlots([]);
            setLoadingSlots(false);
            return;
          case 'Urgent – within 24–48 hours':
            // Do not auto-search - handled manually by CL
            setRecommendedSlots([]);
            setLoadingSlots(false);
            return;
          case 'Soon – sometime this week':
            // Search window: Start: +1 days, End: +7 days
            startDate = today.plus({ days: 1 }).toISODate();
            numDays = 7; // +1 to +7 inclusive = 7 days
            break;
          case 'In 3–4 weeks':
            // Search window: Start: +21 days, End: +35 days
            startDate = today.plus({ days: 21 }).toISODate();
            numDays = 15; // +21 to +35 inclusive = 15 days
            break;
          case 'Flexible – within the next month':
            // Search window: Start: +4 days, End: +42 days (about 6 weeks)
            startDate = today.plus({ days: 4 }).toISODate();
            numDays = 39; // +4 to +42 inclusive = 39 days
            break;
          case 'Routine – in about 3 months':
            // Search window: Start: +75 days (2.5 months), End: +105 days (3.5 months)
            startDate = today.plus({ days: 75 }).toISODate();
            numDays = 31; // +75 to +105 inclusive = 31 days
            break;
          case 'Planned – in about 6 months':
            // Search window: Start: +135 days (4.5 months), End: +165 days (5.5 months)
            startDate = today.plus({ days: 135 }).toISODate();
            numDays = 31; // +135 to +165 inclusive = 31 days
            break;
          case 'Future – in about 12 months':
            // Search window: Start: +345 days (11.5 months), End: +365 days (12 months)
            startDate = today.plus({ days: 345 }).toISODate();
            numDays = 21; // +345 to +365 inclusive = 21 days
            break;
          default:
            // Default fallback
            startDate = today.plus({ days: 1 }).toISODate();
            numDays = 42;
        }
      } else {
        // Default fallback if no selection
        startDate = today.plus({ days: 1 }).toISODate();
        numDays = 42;
      }

      if (!startDate) {
        console.error('[AppointmentForm] Failed to calculate start date');
        setRecommendedSlots([]);
        return;
      }

      // Calculate service minutes based on number of selected pets
      // First pet: 40 minutes, each additional pet: +20 minutes
      const numPets = isLoggedIn && formData.selectedPetIds.length > 0 
        ? formData.selectedPetIds.length 
        : (formData.newClientPets && formData.newClientPets.length > 0 
          ? formData.newClientPets.length 
          : 1); // Default to 1 pet if not logged in or no pets selected
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
        // Combine winner and alternates, filter by score, then take top 3
        const allOptions: any[] = [];
        
        // Add winner if available
        if (winner?.suggestedStartIso || winner?.iso) {
          allOptions.push(winner);
        }
        
        // Add all alternates
        if (Array.isArray(alternates)) {
          allOptions.push(...alternates);
        }
        
        // Filter out items with score > 160, then take top 3
        const filteredOptions = allOptions
          .filter(opt => {
            const score = opt?.score;
            // Include if score is undefined, null, or <= 160
            return score == null || score <= 160;
          })
          .slice(0, 3);
        
        // Process filtered options into slots
        for (const opt of filteredOptions) {
          if (opt?.suggestedStartIso || opt?.iso) {
            const optIso = opt.suggestedStartIso || opt.iso;
            const optDt = roundToNearest5Minutes(DateTime.fromISO(optIso));
            slots.push({
              date: opt.date || optDt.toISODate() || '',
              time: opt.time || optDt.toFormat('HH:mm'),
              display: opt.display || `${optDt.toFormat('EEE, MMM d')} at ${optDt.toFormat('h:mm a')}`,
              iso: optIso,
            });
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
    
    // Check if any pet is selected for euthanasia (existing or new client pets)
    const hasEuthanasiaPet = 
      (formData.selectedPetIds?.some(petId => {
        const petData = formData.petSpecificData?.[petId];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false) ||
      (formData.newClientPets?.some(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false);
    
    console.log('[AppointmentForm] useEffect check:', {
      isDateTimePage,
      hasDoctor,
      currentPage,
      providersLength: providers.length,
      preferredDoctorExisting: formData.preferredDoctorExisting,
      preferredDoctor: formData.preferredDoctor,
      selectedPetIds: formData.selectedPetIds,
      needsUrgentScheduling: formData.needsUrgentScheduling,
      hasEuthanasiaPet,
    });
    
    // For request-visit-continued, do routing automatically if:
    // - howSoon is NOT Emergent/Urgent (automatically search for slots)
    // - For Emergent/Urgent, show banner (no routing needed, client liaison will contact)
    // - Skip routing if euthanasia pet is selected (no slots shown)
    // For euthanasia-continued, skip routing (no slots shown, just text field)
    const isUrgentTimeframe = formData.howSoon === 'Emergent – today' || formData.howSoon === 'Urgent – within 24–48 hours';
    const isNotUrgentTimeframe = formData.howSoon && formData.howSoon !== 'Emergent – today' && formData.howSoon !== 'Urgent – within 24–48 hours';
    const shouldDoRouting = 
      isDateTimePage && 
      hasDoctor && 
      providers.length > 0 &&
      !hasEuthanasiaPet && // Don't do routing if euthanasia pet is selected
      currentPage === 'request-visit-continued' && // Only do routing on request-visit-continued (not euthanasia-continued)
      isNotUrgentTimeframe; // Only if not urgent/emergent
    
    if (shouldDoRouting) {
      console.log('[AppointmentForm] Calling findAvailableSlots');
      findAvailableSlots();
    } else if (!isDateTimePage || !hasDoctor) {
      // Don't clear slots if we're submitting (we need them for submission)
      // Only clear if we're going to a completely different flow
      if (currentPage !== 'success') {
        setRecommendedSlots([]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, formData.preferredDoctorExisting, formData.preferredDoctor, providers.length, formData.selectedPetIds.length, formData.howSoon, formData.petSpecificData, formData.newClientPets]);

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

  // Track page views for analytics
  useEffect(() => {
    const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
    const clientType = isExistingClient ? 'existing' : 'new';
    
    // Map page names to user-friendly step names
    const getStepName = (page: Page): string => {
      switch (page) {
        case 'intro':
          return 'Introduction';
        case 'new-client':
          return 'New Client Information';
        case 'new-client-pet-info':
          return 'Pet Information';
        case 'existing-client':
          return 'Existing Client Information';
        case 'existing-client-pets':
          return 'Select Pet(s)';
        case 'euthanasia-intro':
          return 'Euthanasia Details';
        case 'euthanasia-service-area':
          return 'Service Area Selection';
        case 'euthanasia-portland':
          return 'Euthanasia Scheduling (Portland)';
        case 'euthanasia-high-peaks':
          return 'Euthanasia Scheduling (High Peaks)';
        case 'euthanasia-continued':
          return 'Euthanasia Appointment Time';
        case 'request-visit-continued':
          return 'Appointment Time Selection';
        case 'success':
          return 'Success';
        default:
          return page;
      }
    };

    trackEvent('appointment_form_step_viewed', {
      step: currentPage,
      step_name: getStepName(currentPage),
      client_type: clientType,
      is_logged_in: isLoggedIn,
    });
  }, [currentPage, isLoggedIn, formData.haveUsedServicesBefore]);

  // Warn users when they try to use browser back button
  useEffect(() => {
    // Only show warning if not on intro page and not on success page
    // Works for both new client and existing client flows
    if (currentPage === 'intro' || currentPage === 'success') {
      return;
    }

    let isHandlingPopState = false;

    // Add a state to history so we can detect back button
    // Always push a new state when page changes to ensure we can detect back navigation
    // Initialize immediately and also set up after a brief delay to catch any navigation
    const currentState = window.history.state;
    if (!currentState?.formPage || currentState.formPage !== currentPage) {
      window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
    }
    
    // Also set up a delayed check to ensure state is set (handles rapid page changes)
    const timeoutId = setTimeout(() => {
      const state = window.history.state;
      if (!state?.formPage || state.formPage !== currentPage) {
        window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
      }
    }, 100);

    const handlePopState = (event: PopStateEvent) => {
      // Prevent infinite loops
      if (isHandlingPopState) {
        return;
      }

      // Check if this is a back navigation from our form
      // Show warning for any back navigation when not on intro or success pages
      const state = event.state;
      const isFormPage = (currentPage as Page) !== 'intro' && (currentPage as Page) !== 'success';
      const hasPreventBack = state?.preventBack === true;
      const isNavigatingAway = !state || state.formPage !== currentPage;
      
      if (isFormPage && (hasPreventBack || isNavigatingAway)) {
        isHandlingPopState = true;
        
        // Show warning dialog
        const message = "You will lose your data if you go back using the browser's back button. Please use the 'Previous' button in the bottom left to go back to the previous page.";
        const userWantsToLeave = window.confirm(message);
        
        if (!userWantsToLeave) {
          // User cancelled - push the current state back to prevent navigation
          // This effectively cancels the back button press
          window.history.pushState({ formPage: currentPage, preventBack: true }, '', window.location.href);
        } else {
          // User confirmed - navigate back one more step since the browser already navigated
          // to our pushed state (same URL), we need to go back further to the actual previous route
          window.history.back();
        }
        
        setTimeout(() => {
          isHandlingPopState = false;
        }, 100);
      }
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [currentPage]);

  // Load veterinarians for new clients (using public veterinarians endpoint)
  // Only fetch when address is valid (has line1, city, state, zip)
  useEffect(() => {
    if (isLoggedIn) return; // Skip if logged in (will use regular veterinarians)

    // Defer execution to ensure it doesn't block initial render
    let debounceTimeoutId: NodeJS.Timeout | null = null;
    const deferTimeoutId = setTimeout(() => {
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
        setRawPublicVeterinarians([]);
        setLoadingVeterinarians(false);
        setErrors(prev => {
          const next = { ...prev };
          delete next.zoneNotServiced;
          return next;
        });
        lastCheckedAddressRef.current = ''; // Reset last checked address when address is incomplete
        return;
      }

      // Build address string from form data
      const addressParts = [
        formData.physicalAddress?.line1,
        formData.physicalAddress?.city,
        formData.physicalAddress?.state,
        formData.physicalAddress?.zip,
      ].filter(Boolean);
      const address = addressParts.join(', ');

      // Only proceed if address has changed from last check
      if (lastCheckedAddressRef.current === address) {
        return; // Address hasn't changed, skip
      }

      // Debounce: wait 500ms after user stops typing before checking zone
      debounceTimeoutId = setTimeout(() => {
        let alive = true;
        (async () => {
          // Double-check address hasn't changed during debounce
          const currentAddressParts = [
            formData.physicalAddress?.line1,
            formData.physicalAddress?.city,
            formData.physicalAddress?.state,
            formData.physicalAddress?.zip,
          ].filter(Boolean);
          const currentAddress = currentAddressParts.join(', ');
          
          if (lastCheckedAddressRef.current === currentAddress) {
            return; // Address changed during debounce, skip
          }

          setLoadingVeterinarians(true);
          try {
            // Check zone before fetching veterinarians
            try {
              await http.get(`/public/appointments/find-zone-by-address?address=${encodeURIComponent(currentAddress)}`);
              // Zone exists, clear any previous error
              if (alive) {
                setErrors(prev => {
                  const next = { ...prev };
                  delete next.zoneNotServiced;
                  return next;
                });
                lastCheckedAddressRef.current = currentAddress; // Update last checked address
              }
            } catch (zoneError: any) {
              if (zoneError?.response?.status === 404) {
                // Zone not serviced - set error and don't fetch veterinarians
                if (alive) {
                  setErrors(prev => ({ ...prev, zoneNotServiced: "We're sorry we don't serve your area at this time. Please check back with us periodically to see if we have changed our service area at www.vetatyourdoor.com/service-area." }));
                  setPublicProviders([]);
                  setProviders([]);
                  setRawPublicVeterinarians([]);
                  setLoadingVeterinarians(false);
                  lastCheckedAddressRef.current = currentAddress; // Update last checked address even on error
                }
                return;
              }
              // For other errors, log but continue with veterinarian fetch
              console.warn('[AppointmentForm] Zone check failed:', zoneError);
              if (alive) {
                lastCheckedAddressRef.current = currentAddress; // Update last checked address even on error
              }
            }
            
            if (!alive) return;
            
            // Fetch raw veterinarian data directly from API to get appointmentTypes
            const params: any = { practiceId };
            if (currentAddress) {
              params.address = currentAddress;
            }
            const { data } = await http.get('/public/appointments/veterinarians', { params });
            const rawVeterinarians: any[] = Array.isArray(data) ? data : (data?.items ?? data?.veterinarians ?? []);
            
            if (!alive) return;
            
            // Filter by acceptingNewPatients first (existing logic)
            const filteredByNewPatients = rawVeterinarians.filter((v) => {
              if (!v.weeklySchedules || !Array.isArray(v.weeklySchedules)) {
                return true; // Backwards compatibility
              }
              const hasNonAcceptingZone = v.weeklySchedules.some((schedule: any) => {
                if (!schedule.zones || !Array.isArray(schedule.zones)) {
                  return false;
                }
                return schedule.zones.some((zone: any) => zone.acceptingNewPatients === false);
              });
              return !hasNonAcceptingZone;
            });
            
            // Store raw data
            setRawPublicVeterinarians(filteredByNewPatients);
            
            // Filter by appointment types
            const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByNewPatients);
            
            // Convert to PublicProvider format
            const publicVeterinariansData = filteredByAppointmentTypes.map(mapRawVeterinarianToPublicProvider);
            
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
            if (alive) {
              setPublicProviders([]);
              setProviders([]);
              setRawPublicVeterinarians([]);
            }
          } finally {
            if (alive) {
              setLoadingVeterinarians(false);
            }
          }
        })();
      }, 500); // 500ms debounce
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      clearTimeout(deferTimeoutId);
      if (debounceTimeoutId) {
        clearTimeout(debounceTimeoutId);
      }
    };
  }, [isLoggedIn, practiceId, formData.physicalAddress?.line1, formData.physicalAddress?.city, formData.physicalAddress?.state, formData.physicalAddress?.zip]);

  // Load client data if logged in
  useEffect(() => {
    if (!isLoggedIn) return;

    // Defer execution to ensure it doesn't block initial render
    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingClientData(true);
        
        try {
          // Always fetch pets first
          const petsData = await fetchClientPets();

        if (!alive) return;

        setPets(petsData);

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

        // Try to get client info from appointments first, then fallback to direct client fetch
        let clientAddress: string | undefined = undefined;
        let clientLat: number | undefined = undefined;
        let clientLon: number | undefined = undefined;
        let client: any = null;
        
        try {
          const { data: apptsData } = await http.get('/appointments/client');
          const appts = Array.isArray(apptsData) ? apptsData : (apptsData?.appointments ?? apptsData ?? []);
          
          if (appts.length > 0) {
            const firstAppt = appts[0];
            client = firstAppt?.client || firstAppt?.Client;
          }
        } catch (err) {
          console.warn('Failed to fetch client info from appointments:', err);
        }
        
        // If no client data from appointments, fetch directly from /clients/:id
        if (!client && userId) {
          try {
            client = await fetchClientInfo(userId);
          } catch (err) {
            console.warn('Failed to fetch client info directly:', err);
          }
        }
        
        if (client) {
          // Extract lat/lon if available
          if (client.lat != null && client.lon != null) {
            const lat = typeof client.lat === 'string' ? parseFloat(client.lat) : client.lat;
            const lon = typeof client.lon === 'string' ? parseFloat(client.lon) : client.lon;
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              clientLat = lat;
              clientLon = lon;
            }
          }
          
          // Build address string from client data for veterinarian lookup (only if no lat/lon)
          if (!clientLat || !clientLon) {
            const addressParts = [
              client.address1 || client.address_1,
              client.city,
              client.state,
              client.zip ? String(client.zip) : undefined,
            ].filter(Boolean);
            if (addressParts.length >= 3) {
              clientAddress = addressParts.join(', ');
            }
          }
          
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
          setFormData(prev => {
            // If user hasn't moved (or selected "No"), restore physicalAddress from client data
            // If user has moved (selected "Yes"), don't overwrite the cleared address
            const shouldRestoreAddress = prev.isThisTheAddressWhereWeWillCome !== 'No';
            
            // Build new address from client data
            const newAddress = shouldRestoreAddress ? {
              line1: client.address1 || client.address_1 || prev.physicalAddress?.line1 || '',
              line2: client.address2 || client.address_2 || prev.physicalAddress?.line2 || undefined,
              city: client.city || prev.physicalAddress?.city || '',
              state: client.state || prev.physicalAddress?.state || '',
              zip: client.zip ? String(client.zip) : (prev.physicalAddress?.zip || ''),
              country: prev.physicalAddress?.country || 'United States',
            } : prev.physicalAddress;
            
            // Only update if address actually changed to avoid infinite loops
            const addressChanged = shouldRestoreAddress && (
              newAddress.line1 !== prev.physicalAddress?.line1 ||
              newAddress.city !== prev.physicalAddress?.city ||
              newAddress.state !== prev.physicalAddress?.state ||
              newAddress.zip !== prev.physicalAddress?.zip
            );
            
            // Only update if something actually changed
            if (!addressChanged && 
                (client.firstName || client.first_name) === prev.fullName.first &&
                (client.lastName || client.last_name) === prev.fullName.last &&
                phoneNumber === prev.bestPhoneNumber) {
              return prev; // No changes needed
            }
            
            // Store original address if we don't have it yet and we're setting it from client data
            if (!originalAddress && shouldRestoreAddress && newAddress.line1) {
              setOriginalAddress(newAddress);
            }
            
            return {
              ...prev,
              fullName: {
                ...prev.fullName,
                first: client.firstName || client.first_name || prev.fullName.first,
                last: client.lastName || client.last_name || prev.fullName.last,
              },
              bestPhoneNumber: phoneNumber || prev.bestPhoneNumber,
              physicalAddress: newAddress,
              // Only clear newPhysicalAddress if explicitly set to "No"
              newPhysicalAddress: prev.isThisTheAddressWhereWeWillCome === 'Yes' ? undefined : prev.newPhysicalAddress,
            };
          });
        }

        // Store client location for later use in veterinarian lookup
        if (!alive) return;
        clientLocationRef.current = {
          lat: clientLat,
          lon: clientLon,
          address: clientAddress,
        };
        
        // Mark client location as ready (triggers separate veterinarian fetch)
        if (clientLat || clientLon || clientAddress) {
          setClientLocationReady(true);
        }

        // Skip intro page and go directly to existing client form
        setCurrentPage('existing-client');
      } catch (error: any) {
        console.error('Failed to load client data:', error);
        if (alive) {
          setLoadingVeterinarians(false);
        }
      } finally {
        if (alive) setLoadingClientData(false);
      }
      })();
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoggedIn, 
    userEmail,
  ]);

  // Handle new address changes for existing clients with debouncing
  useEffect(() => {
    if (!isLoggedIn) return; // Only for logged-in users
    if (formData.isThisTheAddressWhereWeWillCome !== 'No') return; // Only when entering new address

    // Defer execution to ensure it doesn't block initial render
    let debounceTimeoutId: NodeJS.Timeout | null = null;
    const deferTimeoutId = setTimeout(() => {
      // Check if new address is complete (all required fields filled)
      const hasValidNewAddress = 
        formData.newPhysicalAddress?.line1?.trim() &&
        formData.newPhysicalAddress?.city?.trim() &&
        formData.newPhysicalAddress?.state?.trim() &&
        formData.newPhysicalAddress?.zip?.trim();

      // Don't fetch if address is not complete
      if (!hasValidNewAddress || !formData.newPhysicalAddress) {
      // Clear providers and errors if address is incomplete
      setProviders([]);
      setRawVeterinarians([]);
      setLoadingVeterinarians(false);
      setErrors(prev => {
        const next = { ...prev };
        delete next.zoneNotServiced;
        return next;
      });
      lastCheckedAddressRef.current = ''; // Reset last checked address when address is incomplete
      return;
      }

      // Build address string from form data
      // At this point, we know newPhysicalAddress is defined due to the check above
      const addressParts = [
        formData.newPhysicalAddress.line1,
        formData.newPhysicalAddress.city,
        formData.newPhysicalAddress.state,
        formData.newPhysicalAddress.zip,
      ].filter(Boolean);
      const address = addressParts.join(', ');

      // Only proceed if address has changed from last check
      if (lastCheckedAddressRef.current === address) {
        return; // Address hasn't changed, skip
      }

      // Debounce: wait 500ms after user stops typing before making requests
      debounceTimeoutId = setTimeout(() => {
      let alive = true;
      (async () => {
        // Double-check address hasn't changed during debounce
        const currentAddressParts = [
          formData.newPhysicalAddress?.line1,
          formData.newPhysicalAddress?.city,
          formData.newPhysicalAddress?.state,
          formData.newPhysicalAddress?.zip,
        ].filter(Boolean);
        const currentAddress = currentAddressParts.join(', ');
        
        if (lastCheckedAddressRef.current === currentAddress) {
          return; // Address changed during debounce, skip
        }

        setLoadingVeterinarians(true);
        try {
          // Check zone before fetching veterinarians
          try {
            await http.get(`/public/appointments/find-zone-by-address?address=${encodeURIComponent(currentAddress)}`);
            // Zone exists, clear any previous error
            if (alive) {
              setErrors(prev => {
                const next = { ...prev };
                delete next.zoneNotServiced;
                return next;
              });
              lastCheckedAddressRef.current = currentAddress; // Update last checked address
            }
          } catch (zoneError: any) {
            if (zoneError?.response?.status === 404) {
              // Zone not serviced - set error and don't fetch veterinarians
              if (alive) {
                setErrors(prev => ({ ...prev, zoneNotServiced: "We're sorry we don't serve your area at this time. Please check back with us periodically to see if we have changed our service area at www.vetatyourdoor.com/service-area." }));
                setProviders([]);
                setLoadingVeterinarians(false);
                lastCheckedAddressRef.current = currentAddress; // Update last checked address even on error
              }
              return;
            }
            // For other errors, log but continue with veterinarian fetch
            console.warn('[AppointmentForm] Zone check failed:', zoneError);
            if (alive) {
              lastCheckedAddressRef.current = currentAddress; // Update last checked address even on error
            }
          }
          
          if (!alive) return;
          
          // Fetch raw veterinarian data directly from API to get appointmentTypes
          const params: any = {};
          if (currentAddress) {
            params.address = currentAddress;
          }
          const { data } = await http.get('/employees/veterinarians', { params });
          const rawVeterinarians: any[] = Array.isArray(data) ? data : [];
          
          if (!alive) return;
          
          // Filter by isActive
          const filteredByActive = rawVeterinarians.filter((v) => v.isActive !== false);
          
          // Store raw data
          setRawVeterinarians(filteredByActive);
          
          // Filter by appointment types
          const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByActive);
          
          // Convert to Provider format
          const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
          
          setProviders(providersData);
          setLoadingVeterinarians(false);
          } catch (err) {
            console.error('Failed to fetch veterinarians:', err);
            if (alive) {
              setProviders([]);
              setRawVeterinarians([]);
              setLoadingVeterinarians(false);
            }
          }
      })();

      return () => {
        alive = false;
      };
      }, 500); // 500ms debounce
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      clearTimeout(deferTimeoutId);
      if (debounceTimeoutId) {
        clearTimeout(debounceTimeoutId);
      }
    };
  }, [
    isLoggedIn,
    formData.isThisTheAddressWhereWeWillCome,
    formData.newPhysicalAddress?.line1,
    formData.newPhysicalAddress?.city,
    formData.newPhysicalAddress?.state,
    formData.newPhysicalAddress?.zip,
  ]);

  // Fetch veterinarians for logged-in users when client location becomes available
  // This runs completely independently and non-blocking after client data is loaded
  useEffect(() => {
    if (!isLoggedIn) return;
    if (!clientLocationReady) return;
    // Only fetch if using original address (not a new address)
    if (formData.isThisTheAddressWhereWeWillCome === 'No') return;
    
    const { lat, lon, address } = clientLocationRef.current;
    // Don't fetch if no location available
    if (!lat && !lon && !address) return;
    
    // Defer execution to ensure it doesn't block render - use longer delay to ensure everything is loaded first
    let alive = true;
    const timeoutId = setTimeout(() => {
      // Fire and forget - completely async, non-blocking
      (async () => {
        try {
          setLoadingVeterinarians(true);
          // Clear any zone error when using address on file
          setErrors(prev => {
            const next = { ...prev };
            delete next.zoneNotServiced;
            return next;
          });
          
          if (!alive) return;
          
          // Fetch raw veterinarian data directly from API to get appointmentTypes
          const params: any = {};
          if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
            params.lat = lat;
            params.lon = lon;
          } else if (address) {
            params.address = address;
          }
          
          const { data } = await http.get('/employees/veterinarians', { params });
          const rawVeterinarians: any[] = Array.isArray(data) ? data : [];
          
          if (!alive) return;
          
          // Filter by isActive
          const filteredByActive = rawVeterinarians.filter((v) => v.isActive !== false);
          
          // Store raw data
          setRawVeterinarians(filteredByActive);
          
          // Filter by appointment types
          const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(filteredByActive);
          
          // Convert to Provider format
          const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
          
          if (!alive) return;
          
          setProviders(providersData);
          setLoadingVeterinarians(false);
        } catch (err) {
          console.error('Failed to fetch veterinarians:', err);
          if (alive) {
            setProviders([]);
            setRawVeterinarians([]);
            setLoadingVeterinarians(false);
          }
        }
      })();
    }, 300); // Delay to ensure client data loading and page navigation complete first

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [
    isLoggedIn,
    clientLocationReady,
    formData.isThisTheAddressWhereWeWillCome,
  ]);

  // Fetch species list on mount
  useEffect(() => {
    // Defer execution to ensure it doesn't block initial render
    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingSpecies(true);
        try {
          const response = await http.get(`/public/species-breeds?practiceId=${practiceId}`);
          if (!alive) return;
          const species = Array.isArray(response.data?.species) ? response.data.species : [];
          // Filter to only show species with showInUi === true and include prettyName
          setSpeciesList(
            species
              .filter((s: any) => s.showInUi !== false) // Only show species where showInUi is true (or undefined, defaulting to true)
              .map((s: any) => ({ 
                id: s.id, 
                name: s.name,
                prettyName: s.prettyName || s.name, // Use prettyName if available, fallback to name
                showInUi: s.showInUi 
              }))
          );
        } catch (error) {
          console.error('[AppointmentForm] Failed to load species:', error);
          if (alive) {
            setSpeciesList([]);
          }
        } finally {
          if (alive) {
            setLoadingSpecies(false);
          }
        }
      })();
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [practiceId]);

  // Fetch appointment types on mount and when new patient status changes
  useEffect(() => {
    // Defer execution to ensure it doesn't block initial render
    let alive = true;
    const timeoutId = setTimeout(() => {
      (async () => {
        setLoadingAppointmentTypes(true);
        try {
          // Determine if this is a new patient
          // New patient = not logged in AND haven't used services before
          const isNewPatient = !isLoggedIn && formData.haveUsedServicesBefore !== 'Yes';
          
          // Use authenticated endpoint for logged-in users, public endpoint for others
          // Always filter to showInApptRequestForm=true since we only want types that appear in the form
          // For new patients, also filter by newPatientAllowed=true
          const types = await fetchAppointmentTypes(
            practiceId,
            true, // showInApptRequestForm
            isNewPatient ? true : undefined, // newPatientAllowed for new patients only
            isLoggedIn
          );
          if (!alive) return;
          // The API already filters, but we ensure showInApptRequestForm is true as a safeguard
          setAppointmentTypes(
            types.filter((type) => type.showInApptRequestForm === true)
          );
        } catch (error) {
          console.error('[AppointmentForm] Failed to load appointment types:', error);
          if (alive) {
            setAppointmentTypes([]);
          }
        } finally {
          if (alive) {
            setLoadingAppointmentTypes(false);
          }
        }
      })();
    }, 0); // Defer to next tick to avoid blocking initial render

    return () => {
      alive = false;
      clearTimeout(timeoutId);
    };
  }, [practiceId, isLoggedIn, formData.haveUsedServicesBefore]);

  // Re-filter veterinarians when appointment types change
  useEffect(() => {
    // Only re-filter if we have raw data already loaded
    // Re-filter public veterinarians for new clients
    if (rawPublicVeterinarians.length > 0 && !isLoggedIn) {
      const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(rawPublicVeterinarians);
      
      const publicVeterinariansData = filteredByAppointmentTypes.map(mapRawVeterinarianToPublicProvider);
      
      setPublicProviders(publicVeterinariansData);
      setProviders(publicVeterinariansData.map(v => ({
        id: v.id,
        name: v.name,
        email: v.email || '',
        pimsId: v.id,
      })));
    }
    
    // Re-filter veterinarians for logged-in clients
    if (rawVeterinarians.length > 0 && isLoggedIn) {
      const filteredByAppointmentTypes = filterVeterinariansByAppointmentTypes(rawVeterinarians);
      
      const providersData = filteredByAppointmentTypes.map(mapRawVeterinarianToProvider);
      setProviders(providersData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formData.petSpecificData,
    formData.selectedPetIds,
    formData.newClientPets,
    formData.existingClientNewPets,
    rawVeterinarians,
    rawPublicVeterinarians,
    isLoggedIn,
  ]);

  // Fetch breeds when species is selected for any pet
  useEffect(() => {
    // Check all pets (both newClientPets and existingClientNewPets) for selected species
    const allPets = [
      ...(formData.newClientPets || []),
      ...(formData.existingClientNewPets || [])
    ];
    
    const speciesToFetch = new Set<number>();
    allPets.forEach(pet => {
      if (pet.speciesId && !breedsBySpecies.hasOwnProperty(pet.speciesId) && !loadingBreeds[pet.speciesId]) {
        speciesToFetch.add(pet.speciesId);
      }
    });

    if (speciesToFetch.size === 0) return;

    let alive = true;
    (async () => {
      // Fetch breeds for all species in parallel
      const fetchPromises = Array.from(speciesToFetch).map(async (speciesId) => {
        setLoadingBreeds(prev => ({ ...prev, [speciesId]: true }));
        try {
          const response = await http.get(`/public/species-breeds?practiceId=${practiceId}&speciesId=${speciesId}`);
          if (!alive) return;
          console.log(`[AppointmentForm] Breeds response for species ${speciesId}:`, response.data);
          const breeds = Array.isArray(response.data?.breeds) ? response.data.breeds : [];
          console.log(`[AppointmentForm] Processed breeds for species ${speciesId}:`, breeds.map((b: any) => ({ id: b.id, name: b.name })));
          if (alive) {
            setBreedsBySpecies(prev => ({
              ...prev,
              [speciesId]: breeds.map((b: any) => ({ id: b.id, name: b.name }))
            }));
          }
        } catch (error) {
          console.error(`[AppointmentForm] Failed to load breeds for species ${speciesId}:`, error);
        } finally {
          if (alive) {
            setLoadingBreeds(prev => ({ ...prev, [speciesId]: false }));
          }
        }
      });
      
      await Promise.all(fetchPromises);
    })();

    return () => {
      alive = false;
    };
  }, [practiceId, formData.newClientPets, formData.existingClientNewPets]);

  const updateFormData = (field: keyof FormData, value: any) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // When "No" is selected for isThisTheAddressWhereWeWillCome, clear physicalAddress and providers
      // (Reversed logic: "No" means they need a new address)
      if (field === 'isThisTheAddressWhereWeWillCome' && value === 'No') {
        // Store the original address before clearing it (if not already stored)
        if (!originalAddress && prev.physicalAddress && (prev.physicalAddress.line1 || prev.physicalAddress.city)) {
          setOriginalAddress(prev.physicalAddress);
        }
        updated.physicalAddress = {
          line1: '',
          city: '',
          state: '',
          zip: '',
          country: '',
        };
        // Clear providers since we need new address to fetch them
        setProviders([]);
        setPublicProviders([]);
        // Clear preferred doctor selection
        updated.preferredDoctorExisting = '';
      }
      
      // When "Yes" is selected for isThisTheAddressWhereWeWillCome, restore original address and clear newPhysicalAddress
      // (Reversed logic: "Yes" means they're using the existing address)
      if (field === 'isThisTheAddressWhereWeWillCome' && value === 'Yes') {
        // Restore the original address if we have it stored
        if (originalAddress) {
          updated.physicalAddress = originalAddress;
        }
        updated.newPhysicalAddress = undefined;
      }
      
      return updated;
    });
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
          if (!formData.phoneNumbers.trim()) newErrors.phoneNumbers = 'Phone number is required';
          if (!formData.canWeText) newErrors.canWeText = 'Please select whether we can text this number';
        }
        break;
      case 'new-client':
        // Only validate new client page if user is not logged in
        if (!isLoggedIn) {
        if (!formData.physicalAddress.line1.trim()) newErrors['physicalAddress.line1'] = 'Street address is required';
        if (!formData.physicalAddress.city.trim()) newErrors['physicalAddress.city'] = 'City is required';
        if (!formData.physicalAddress.state.trim()) newErrors['physicalAddress.state'] = 'State is required';
        if (!formData.physicalAddress.zip.trim()) newErrors['physicalAddress.zip'] = 'Zip code is required';
        if (errors.zoneNotServiced) newErrors.zoneNotServiced = errors.zoneNotServiced;
        if (!formData.previousVeterinaryPractices?.trim()) newErrors.previousVeterinaryPractices = 'Previous veterinary practices are required';
        // Doctor selection moved to request-visit-continued page
        }
        break;
      case 'new-client-pet-info':
        // Only validate new client pet info page if user is not logged in
        if (!isLoggedIn) {
          if (!formData.newClientPets || formData.newClientPets.length === 0) {
            newErrors.newClientPets = 'Please add at least one pet';
          } else {
            formData.newClientPets.forEach((pet) => {
              if (!pet.name?.trim()) {
                newErrors[`newClientPet.${pet.id}.name`] = 'Pet name is required';
              }
              // Check species - either speciesId or otherSpecies (if "Other" is selected)
              const selectedSpecies = speciesList.find(s => s.id === pet.speciesId);
              if (!pet.speciesId) {
                newErrors[`newClientPet.${pet.id}.species`] = 'Species is required';
              } else if (selectedSpecies?.name === 'Other' && !pet.otherSpecies?.trim()) {
                newErrors[`newClientPet.${pet.id}.otherSpecies`] = 'Please specify the species name';
              }
              if (!pet.age?.trim()) {
                newErrors[`newClientPet.${pet.id}.age`] = 'Age/DOB is required';
              }
              if (!pet.spayedNeutered?.trim()) {
                newErrors[`newClientPet.${pet.id}.spayedNeutered`] = 'Spayed/Neutered is required';
              }
              if (!pet.sex?.trim()) {
                newErrors[`newClientPet.${pet.id}.sex`] = 'Sex is required';
              }
              if (!pet.breed?.trim()) {
                newErrors[`newClientPet.${pet.id}.breed`] = 'Breed is required';
              }
              if (!pet.color?.trim()) {
                newErrors[`newClientPet.${pet.id}.color`] = 'Color is required';
              }
              if (!pet.weight?.trim()) {
                newErrors[`newClientPet.${pet.id}.weight`] = 'Weight is required';
              }
              if (!pet.needsCalmingMedications) {
                newErrors[`newClientPet.${pet.id}.needsCalmingMedications`] = 'Please answer whether your pet has needed calming medications';
              }
              if (pet.needsCalmingMedications === 'Yes' && !pet.hasCalmingMedications) {
                newErrors[`newClientPet.${pet.id}.hasCalmingMedications`] = 'Please answer whether you have these medications on hand';
              }
              if (!pet.needsMuzzleOrSpecialHandling) {
                newErrors[`newClientPet.${pet.id}.needsMuzzleOrSpecialHandling`] = 'Please answer whether your pet has needed a muzzle or special handling';
              }
              // Validate appointment type
              const petData = formData.petSpecificData?.[pet.id];
              if (!petData?.needsToday) {
                newErrors[`needsToday.${pet.id}`] = 'Please select an option for what your pet needs today';
              }
              if (petData?.needsToday) {
                if (petData.needsToday && isEuthanasiaAppointmentType(petData.needsToday)) {
                  if (!petData.euthanasiaReason?.trim()) {
                    newErrors[`euthanasiaReason.${pet.id}`] = 'Please provide details about the reason for this appointment';
                  }
                  if (!petData.beenToVetLastThreeMonths?.trim()) {
                    newErrors[`beenToVetLastThreeMonths.${pet.id}`] = 'Please answer whether your pet has been to the vet in the last three months';
                  }
                  if (!petData.interestedInOtherOptions?.trim()) {
                    newErrors[`interestedInOtherOptions.${pet.id}`] = 'Please select an option';
                  }
                  if (!petData.aftercarePreference?.trim()) {
                    newErrors[`aftercarePreference.${pet.id}`] = 'Please select your preferences for aftercare';
                  }
                } else if (
                                                  (petData.needsToday && matchesAppointmentTypeName(petData.needsToday, ['not feeling well', 'illness', 'Medical Visit'])) ||
                                                  (petData.needsToday && matchesAppointmentTypeName(petData.needsToday, ['recheck', 'follow-up', 'Follow Up']))
                ) {
                  if (!petData.needsTodayDetails?.trim()) {
                    newErrors[`needsTodayDetails.${pet.id}`] = 'Please provide details about the reason for this appointment';
                  }
                }
              }
            });
          }
        }
        // Validate howSoon for all pets (single question)
        if (!formData.howSoon) {
          newErrors.howSoon = 'Please select how soon your pets need to be seen';
        }
        break;
      case 'existing-client':
        if (!formData.bestPhoneNumber?.trim()) newErrors.bestPhoneNumber = 'Phone number is required';
        if (formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)) {
          if (!formData.isThisTheAddressWhereWeWillCome) newErrors.isThisTheAddressWhereWeWillCome = 'Please select an option';
          // If they answered "No", validate new address fields
          if (formData.isThisTheAddressWhereWeWillCome === 'No') {
            if (!formData.newPhysicalAddress?.line1?.trim()) newErrors['newPhysicalAddress.line1'] = 'Street address is required';
            if (!formData.newPhysicalAddress?.city?.trim()) newErrors['newPhysicalAddress.city'] = 'City is required';
            if (!formData.newPhysicalAddress?.state?.trim()) newErrors['newPhysicalAddress.state'] = 'State is required';
            if (!formData.newPhysicalAddress?.zip?.trim()) newErrors['newPhysicalAddress.zip'] = 'Zip code is required';
            if (errors.zoneNotServiced) newErrors.zoneNotServiced = errors.zoneNotServiced;
          }
        }
        // Doctor selection moved to request-visit-continued page
        // Temporarily disabled - question is hidden but logic is preserved
        // if (!formData.lookingForEuthanasiaExisting) newErrors.lookingForEuthanasiaExisting = 'Please select an option';
        break;
      case 'existing-client-pets':
        if (isLoggedIn) {
          if (formData.selectedPetIds.length === 0) {
            newErrors.selectedPetIds = 'Please select at least one pet';
          } else {
            // Validate pet-specific questions for each selected pet
            formData.selectedPetIds.forEach((petId) => {
              const petData = formData.petSpecificData?.[petId];
              if (!petData?.needsToday) {
                newErrors[`needsToday.${petId}`] = 'Please select an option for what your pet needs today';
              }
              // Validate based on selected option
              if (petData?.needsToday) {
                if (petData.needsToday && isEuthanasiaAppointmentType(petData.needsToday)) {
                  // Validate euthanasia fields
                  if (!petData.euthanasiaReason?.trim()) {
                    newErrors[`euthanasiaReason.${petId}`] = 'Please let us know what is going on with your pet';
                  }
                  if (!petData.beenToVetLastThreeMonths?.trim()) {
                    newErrors[`beenToVetLastThreeMonths.${petId}`] = 'Please let us know if your pet has been to the veterinarian in the last three months';
                  }
                  if (!petData.interestedInOtherOptions) {
                    newErrors[`interestedInOtherOptions.${petId}`] = 'Please select an option';
                  }
                  if (!petData.aftercarePreference) {
                    newErrors[`aftercarePreference.${petId}`] = 'Please select your preferences for aftercare';
                  }
                } else {
                  // Require details for other options
                  if (!petData.needsTodayDetails?.trim()) {
                    newErrors[`needsTodayDetails.${petId}`] = 'Please provide details about the reason for this appointment';
                  }
                }
              }
            });
          }
          // Validate new pets added by existing client
          if (formData.existingClientNewPets && formData.existingClientNewPets.length > 0) {
            formData.existingClientNewPets.forEach((pet) => {
              if (!pet.name?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.name`] = 'Pet name is required';
              }
              // Check species - either speciesId or otherSpecies (if "Other" is selected)
              const selectedSpecies = speciesList.find(s => s.id === pet.speciesId);
              if (!pet.speciesId) {
                newErrors[`existingClientNewPet.${pet.id}.species`] = 'Species is required';
              } else if (selectedSpecies?.name === 'Other' && !pet.otherSpecies?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.otherSpecies`] = 'Please specify the species name';
              }
              if (!pet.age?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.age`] = 'Age/DOB is required';
              }
              if (!pet.spayedNeutered?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.spayedNeutered`] = 'Spayed/Neutered is required';
              }
              if (!pet.sex?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.sex`] = 'Sex is required';
              }
              if (!pet.breed?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.breed`] = 'Breed is required';
              }
              if (!pet.color?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.color`] = 'Color is required';
              }
              if (!pet.weight?.trim()) {
                newErrors[`existingClientNewPet.${pet.id}.weight`] = 'Weight is required';
              }
              if (!pet.needsCalmingMedications) {
                newErrors[`existingClientNewPet.${pet.id}.needsCalmingMedications`] = 'Please answer whether your pet has needed calming medications';
              }
              if (pet.needsCalmingMedications === 'Yes' && !pet.hasCalmingMedications) {
                newErrors[`existingClientNewPet.${pet.id}.hasCalmingMedications`] = 'Please answer whether you have these medications on hand';
              }
              if (!pet.needsMuzzleOrSpecialHandling) {
                newErrors[`existingClientNewPet.${pet.id}.needsMuzzleOrSpecialHandling`] = 'Please answer whether your pet has needed a muzzle or special handling';
              }
            });
          }
        } else {
          if (!formData.whatPets?.trim()) newErrors.whatPets = 'Pet information is required';
        }
        // Validate howSoon for all pets (single question)
        if (!formData.howSoon) {
          newErrors.howSoon = 'Please select how soon your pets need to be seen';
        }
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
        // Validate doctor selection
        if (!formData.preferredDoctorExisting && !formData.preferredDoctor) {
          newErrors.preferredDoctorExisting = 'Please select a preferred doctor';
        }
        
        // Check if any pet is selected for euthanasia
        const hasEuthanasiaPet = 
          (formData.selectedPetIds?.some(petId => {
            const petData = formData.petSpecificData?.[petId];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false) ||
          (formData.newClientPets?.some(pet => {
            const petData = formData.petSpecificData?.[pet.id];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false);
        
        const isUrgentTimeframe = formData.howSoon === 'Emergent – today' || formData.howSoon === 'Urgent – within 24–48 hours';
        const isNotUrgentTimeframe = formData.howSoon && !isUrgentTimeframe;
        
        // Validate preferredDateTimeVisit in all scenarios where it's displayed
        if (hasEuthanasiaPet || isUrgentTimeframe || formData.noneOfWorkForMeVisit || (isNotUrgentTimeframe && !loadingSlots && recommendedSlots.length === 0)) {
          if (!formData.preferredDateTimeVisit?.trim()) {
            newErrors.preferredDateTimeVisit = 'Please enter any preferences for days/times for us to visit you';
          }
        }
        
        // If not urgent/emergent and slots are available, require selections or "none work" option
        if (isNotUrgentTimeframe) {
          if (recommendedSlots.length > 0) {
            const selectedCount = Object.keys(formData.selectedDateTimeSlotsVisit || {}).length;
            if (selectedCount === 0 && !formData.noneOfWorkForMeVisit) {
              newErrors.selectedDateTimeSlotsVisit = 'Please select your preferred times or indicate that none of these work for you';
            }
          }
        }
        break;
      // Add more validation as needed
    }

    setErrors(newErrors);
    
    // If there are errors, scroll to the first one
    if (Object.keys(newErrors).length > 0) {
      // Use setTimeout to ensure errors are rendered before scrolling
      setTimeout(() => {
        // Strategy: Find the first input/select/textarea with a red border (error state)
        // The error border color is #ef4444 (rgb(239, 68, 68))
        const allInputs = document.querySelectorAll('input, select, textarea');
        
        for (const input of allInputs) {
          const style = window.getComputedStyle(input);
          const borderColor = style.borderColor;
          
          // Check if border color indicates an error (red)
          // #ef4444 = rgb(239, 68, 68)
          if (borderColor.includes('239, 68, 68') || 
              borderColor.includes('rgb(239, 68, 68)') ||
              borderColor.includes('#ef4444')) {
            // Found the first error field
            input.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Focus if it's a focusable element
            if (input instanceof HTMLInputElement || 
                input instanceof HTMLSelectElement || 
                input instanceof HTMLTextAreaElement) {
              input.focus();
            }
            return;
          }
        }
        
        // Fallback: If no input with error border found, find the first error message div
        const errorMessages = document.querySelectorAll('[style*="color: rgb(239, 68, 68)"], [style*="color: #ef4444"]');
        if (errorMessages.length > 0) {
          const firstError = errorMessages[0] as HTMLElement;
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Try to find and focus the associated input
          const parent = firstError.parentElement;
          if (parent) {
            const input = parent.querySelector('input, select, textarea') as HTMLElement;
            if (input && (input instanceof HTMLInputElement || 
                         input instanceof HTMLSelectElement || 
                         input instanceof HTMLTextAreaElement)) {
              input.focus();
            }
          }
        }
      }, 100);
    }
    
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    if (!validatePage(currentPage)) {
      return;
    }

    const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes';
    const clientType = isExistingClient ? 'existing' : 'new';

    // Determine next page based on current page and form data
    switch (currentPage) {
      case 'intro':
        // This should only happen if user is not logged in
        if (!isLoggedIn) {
          // Always go to new-client page (question removed)
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
          trackEvent('appointment_form_step_completed', {
            step: 'intro',
            step_name: 'Introduction',
            next_step: 'new-client',
            client_type: 'new',
            is_logged_in: false,
          });
        }
        break;
      case 'new-client':
        setCurrentPage('new-client-pet-info');
        trackEvent('appointment_form_step_completed', {
          step: 'new-client',
          step_name: 'New Client Information',
          next_step: 'new-client-pet-info',
          client_type: 'new',
          is_logged_in: false,
        });
        break;
      case 'new-client-pet-info':
        // Always go to request-visit-continued (euthanasia question removed)
        setCurrentPage('request-visit-continued');
        trackEvent('appointment_form_step_completed', {
          step: 'new-client-pet-info',
          step_name: 'Pet Information',
          next_step: 'request-visit-continued',
          client_type: 'new',
          is_logged_in: false,
          pet_count: formData.newClientPets?.length || 0,
        });
        break;
      case 'existing-client':
        setCurrentPage('existing-client-pets');
        trackEvent('appointment_form_step_completed', {
          step: 'existing-client',
          step_name: 'Existing Client Information',
          next_step: 'existing-client-pets',
          client_type: 'existing',
          is_logged_in: isLoggedIn,
        });
        break;
      case 'existing-client-pets':
        if (formData.lookingForEuthanasiaExisting === 'Yes') {
          setCurrentPage('euthanasia-intro');
          trackEvent('appointment_form_step_completed', {
            step: 'existing-client-pets',
            step_name: 'Select Pet(s)',
            next_step: 'euthanasia-intro',
            client_type: 'existing',
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            pet_count: formData.selectedPetIds?.length || 0,
          });
        } else {
          setCurrentPage('request-visit-continued');
          trackEvent('appointment_form_step_completed', {
            step: 'existing-client-pets',
            step_name: 'Select Pet(s)',
            next_step: 'request-visit-continued',
            client_type: 'existing',
            is_logged_in: isLoggedIn,
            appointment_type: 'regular_visit',
            pet_count: formData.selectedPetIds?.length || 0,
          });
        }
        break;
      case 'euthanasia-intro':
        setCurrentPage('euthanasia-service-area');
        trackEvent('appointment_form_step_completed', {
          step: 'euthanasia-intro',
          step_name: 'Euthanasia Details',
          next_step: 'euthanasia-service-area',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'euthanasia',
        });
        break;
      case 'euthanasia-service-area':
        if (formData.serviceArea === 'Kennebunk / Greater Portland / Augusta Area') {
          setCurrentPage('euthanasia-portland');
          trackEvent('appointment_form_step_completed', {
            step: 'euthanasia-service-area',
            step_name: 'Service Area Selection',
            next_step: 'euthanasia-portland',
            client_type: clientType,
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            service_area: 'Kennebunk / Greater Portland / Augusta Area',
          });
        } else if (formData.serviceArea === 'Maine High Peaks Area') {
          setCurrentPage('euthanasia-high-peaks');
          trackEvent('appointment_form_step_completed', {
            step: 'euthanasia-service-area',
            step_name: 'Service Area Selection',
            next_step: 'euthanasia-high-peaks',
            client_type: clientType,
            is_logged_in: isLoggedIn,
            appointment_type: 'euthanasia',
            service_area: 'Maine High Peaks Area',
          });
        }
        break;
      case 'euthanasia-portland':
      case 'euthanasia-high-peaks':
        setCurrentPage('euthanasia-continued');
        trackEvent('appointment_form_step_completed', {
          step: currentPage,
          step_name: currentPage === 'euthanasia-portland' ? 'Euthanasia Scheduling (Portland)' : 'Euthanasia Scheduling (High Peaks)',
          next_step: 'euthanasia-continued',
          client_type: clientType,
          is_logged_in: isLoggedIn,
          appointment_type: 'euthanasia',
        });
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
      case 'new-client-pet-info':
        setCurrentPage('new-client');
        break;
      case 'existing-client-pets':
        setCurrentPage('existing-client');
        break;
      case 'euthanasia-intro':
        if (formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client-pets');
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
        // For existing clients (logged in or haveUsedServicesBefore), go back to pet selection
        if (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') {
          setCurrentPage('existing-client-pets');
        } else {
          // For new clients, go back to pet information page
          setCurrentPage('new-client-pet-info');
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
      // Check old flow (lookingForEuthanasia fields) OR new flow (pet-specific needsToday)
      const hasEuthanasiaPet = 
        (formData.selectedPetIds?.some(petId => {
          const petData = formData.petSpecificData?.[petId];
          return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
        }) || false) ||
        (formData.newClientPets?.some(pet => {
          const petData = formData.petSpecificData?.[pet.id];
          return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
        }) || false);
      
      const isEuthanasia = 
        formData.lookingForEuthanasia === 'Yes' || 
        formData.lookingForEuthanasiaExisting === 'Yes' ||
        hasEuthanasiaPet;
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
          if (isExistingClient && formData.isThisTheAddressWhereWeWillCome === 'No' && formData.newPhysicalAddress) {
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
          if (isExistingClient && formData.isThisTheAddressWhereWeWillCome !== 'No' && formData.physicalAddress) {
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
        
        // Address changed flag - indicates if existing client changed their address
        addressChanged: isExistingClient && formData.isThisTheAddressWhereWeWillCome === 'No' ? true : undefined,
        
        // Pet/Patient Information
        pets: isLoggedIn && formData.selectedPetIds.length > 0
          ? [
              // Existing pets from database
              ...pets.filter(p => formData.selectedPetIds.includes(p.id)).map(p => {
                // Normalize sex value from API format (e.g., "MaleNeutered", "FemaleSpayed") to simple format ("Male", "Female")
                const normalizedSex = p.sex 
                  ? (p.sex.startsWith('Male') ? 'Male' : p.sex.startsWith('Female') ? 'Female' : p.sex)
                  : undefined;
                
                // Determine spayedNeutered based on whether the original sex value contains "Spayed" or "Neutered"
                const spayedNeutered = p.sex && (p.sex.includes('Spayed') || p.sex.includes('Neutered')) ? 'Yes' : 'No';
                
                return {
                  id: p.id,
                  dbId: p.dbId,
                  clientId: p.clientId,
                  name: p.name,
                  species: p.species,
                  breed: p.breed,
                  dob: p.dob,
                  sex: normalizedSex,
                  spayedNeutered: spayedNeutered,
                  subscription: p.subscription,
                  primaryProviderName: p.primaryProviderName,
                  photoUrl: p.photoUrl,
                  wellnessPlans: p.wellnessPlans,
                  alerts: petAlerts.get(p.id) ?? null,
                };
              }),
              // New pets added by existing client (only if selected)
              ...(formData.existingClientNewPets || [])
                .filter(p => formData.selectedPetIds.includes(p.id))
                .map(p => ({
                  id: p.id,
                  name: p.name,
                  species: p.species,
                  age: p.age,
                  spayedNeutered: p.spayedNeutered,
                  sex: p.sex,
                  breed: p.breed,
                  color: p.color,
                  weight: p.weight,
                  behaviorAtPreviousVisits: p.behaviorAtPreviousVisits,
                  needsCalmingMedications: p.needsCalmingMedications,
                  hasCalmingMedications: p.hasCalmingMedications,
                  needsMuzzleOrSpecialHandling: p.needsMuzzleOrSpecialHandling,
                  new: true, // Mark as new pet for existing client
                }))
            ]
          : undefined,
        
        // Pet information for non-logged-in users
        petInfoText: !isLoggedIn && !formData.newClientPets?.length ? (formData.whatPets || formData.petInfo) : undefined,
        newClientPets: formData.newClientPets && formData.newClientPets.length > 0 ? formData.newClientPets : undefined,
        existingClientNewPets: formData.existingClientNewPets && formData.existingClientNewPets.length > 0 ? formData.existingClientNewPets : undefined,
        newPetInfo: formData.newPetInfo || undefined,
        
        // All pets data (for logged-in users, include all pets even if not selected)
        allPets: isLoggedIn
          ? [
              // Existing pets from database
              ...(pets.length > 0 ? pets.map(p => {
                // Normalize sex value from API format (e.g., "MaleNeutered", "FemaleSpayed") to simple format ("Male", "Female")
                const normalizedSex = p.sex 
                  ? (p.sex.startsWith('Male') ? 'Male' : p.sex.startsWith('Female') ? 'Female' : p.sex)
                  : undefined;
                
                // Determine spayedNeutered based on whether the original sex value contains "Spayed" or "Neutered"
                const spayedNeutered = p.sex && (p.sex.includes('Spayed') || p.sex.includes('Neutered')) ? 'Yes' : 'No';
                
                return {
                  id: p.id,
                  dbId: p.dbId,
                  clientId: p.clientId,
                  name: p.name,
                  species: p.species,
                  breed: p.breed,
                  dob: p.dob,
                  sex: normalizedSex,
                  spayedNeutered: spayedNeutered,
                  subscription: p.subscription,
                  primaryProviderName: p.primaryProviderName,
                  photoUrl: p.photoUrl,
                  wellnessPlans: p.wellnessPlans,
                  alerts: petAlerts.get(p.id) ?? null,
                  isSelected: formData.selectedPetIds.includes(p.id),
                };
              }) : []),
              // New pets added by existing client
              ...(formData.existingClientNewPets || []).map(p => ({
                id: p.id,
                name: p.name,
                species: p.species,
                age: p.age,
                spayedNeutered: p.spayedNeutered,
                sex: p.sex,
                breed: p.breed,
                color: p.color,
                weight: p.weight,
                behaviorAtPreviousVisits: p.behaviorAtPreviousVisits,
                needsCalmingMedications: p.needsCalmingMedications,
                hasCalmingMedications: p.hasCalmingMedications,
                needsMuzzleOrSpecialHandling: p.needsMuzzleOrSpecialHandling,
                isSelected: formData.selectedPetIds.includes(p.id),
                new: true, // Mark as new pet for existing client
              }))
            ]
          : undefined,
        otherPersonsOnAccount: formData.otherPersonsOnAccount || undefined,
        condoApartmentInfo: formData.condoApartmentInfo || undefined,
        
        // Veterinary History
        previousVeterinaryPractices: formData.previousVeterinaryPractices || formData.previousVeterinaryPracticesExisting || undefined,
        previousVeterinaryHospitals: formData.previousVeterinaryHospitals || undefined,
        okayToContactPreviousVets: formData.okayToContactPreviousVets || formData.okayToContactPreviousVetsExisting || undefined,
        hadVetCareElsewhere: formData.hadVetCareElsewhere || undefined,
        mayWeAskForRecords: formData.mayWeAskForRecords || undefined,
        
        // Pet Behavior & Handling - keep legacy fields for backward compatibility
        petBehaviorAtPreviousVisits: formData.petBehaviorAtPreviousVisits || formData.petBehaviorAtPreviousVisitsExisting || undefined,
        needsCalmingMedications: formData.needsCalmingMedications || undefined,
        hasCalmingMedications: formData.hasCalmingMedications || undefined,
        needsMuzzleOrSpecialHandling: formData.needsMuzzleOrSpecialHandling || undefined,
        
        // Per-pet data - include in payload for API processing
        petSpecificData: formData.petSpecificData || undefined,
        
        // Appointment Details
        appointmentType: isEuthanasia ? 'euthanasia' : 'regular_visit',
        preferredDoctor: (() => {
          const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
          if (!selectedDoctor || selectedDoctor === 'I have no preference') {
            return undefined;
          }
          return selectedDoctor;
        })(),
        preferredDoctorId: (() => {
          const selectedDoctor = formData.preferredDoctorExisting || formData.preferredDoctor;
          if (!selectedDoctor || selectedDoctor === 'I have no preference') {
            return undefined;
          }
          
          // Extract doctor ID from provider name
          const doctorName = selectedDoctor.replace('Dr. ', '').trim();
          // Use publicProviders for new clients, providers for logged-in clients
          const providerList = isLoggedIn ? providers : (publicProviders.length > 0 ? publicProviders.map(p => ({
            id: p.id,
            name: p.name,
            email: p.email || '',
            pimsId: p.id, // PublicProvider uses id as pimsId
          })) : providers);
          
          let doctor = providerList.find(p => p.name === doctorName || `Dr. ${p.name}` === selectedDoctor);
          
          // Try fuzzy matching if exact match fails
          if (!doctor) {
            doctor = providerList.find(p => 
              p.name.toLowerCase().includes(doctorName.toLowerCase()) ||
              doctorName.toLowerCase().includes(p.name.toLowerCase())
            );
          }
          
          if (doctor) {
            // For existing clients: prefer id (database ID) over pimsId
            // For new clients: publicProviders use id as pimsId, so we use id
            if (doctor.id) {
              return String(doctor.id);
            }
            // Fallback to pimsId only if id is not available
            return doctor.pimsId ? String(doctor.pimsId) : undefined;
          }
          
          return undefined;
        })(),
        serviceArea: formData.serviceArea || formData.serviceAreaVisit || undefined,
        
        // Euthanasia Specific Fields
        ...(isEuthanasia ? {
          euthanasiaReason: formData.euthanasiaReason || undefined,
          beenToVetLastThreeMonths: formData.beenToVetLastThreeMonths || undefined,
          interestedInOtherOptions: formData.interestedInOtherOptions || undefined,
          urgency: formData.urgency || undefined,
          preferredDateTime: (() => {
            // Check preferredDateTimeVisit first (from request-visit-continued page), then preferredDateTime (from euthanasia-continued page)
            const value = formData.preferredDateTimeVisit || formData.preferredDateTime;
            const trimmed = value?.trim();
            return trimmed && trimmed.length > 0 ? trimmed : undefined;
          })(),
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
          preferredDateTime: (() => {
            const trimmed = formData.preferredDateTimeVisit?.trim();
            return trimmed && trimmed.length > 0 ? trimmed : undefined;
          })(),
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
        howSoon: formData.howSoon || undefined,
        howDidYouHearAboutUs: formData.howDidYouHearAboutUs || undefined,
        anythingElse: formData.anythingElse || undefined,
        membershipInterest: formData.membershipInterest || undefined,
        
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
      
      // Debug log for preferredDateTime field
      console.log('[AppointmentForm] DEBUG - isEuthanasia:', isEuthanasia);
      console.log('[AppointmentForm] DEBUG - preferredDateTimeVisit raw value:', formData.preferredDateTimeVisit);
      if (formData.preferredDateTimeVisit) {
        const trimmed = formData.preferredDateTimeVisit.trim();
        console.log('[AppointmentForm] DEBUG - preferredDateTimeVisit trimmed:', trimmed);
        console.log('[AppointmentForm] DEBUG - trimmed length:', trimmed.length);
        console.log('[AppointmentForm] DEBUG - Will be included:', trimmed && trimmed.length > 0 ? trimmed : undefined);
      }
      
      // Log submissionData before cleaning to see if preferredDateTime is there
      console.log('[AppointmentForm] DEBUG - submissionData.preferredDateTime:', submissionData.preferredDateTime);
      console.log('[AppointmentForm] DEBUG - submissionData (before clean):', JSON.stringify(submissionData, null, 2));
      
      const finalPayload = cleanPayload(submissionData);
      
      // Log the payload for debugging
      console.log('[AppointmentForm] DEBUG - finalPayload.preferredDateTime:', finalPayload.preferredDateTime);
      console.log('Form submission payload:', JSON.stringify(finalPayload, null, 2));
      
      // Send to API endpoint
      await http.post('/public/appointments/form', finalPayload);
      
      // Track successful form submission
      const petCount = isLoggedIn 
        ? (formData.selectedPetIds?.length || 0)
        : (formData.newClientPets?.length || 0);
      
      trackEvent('appointment_form_submitted', {
        client_type: isExistingClient ? 'existing' : 'new',
        is_logged_in: isLoggedIn,
        appointment_type: isEuthanasia ? 'euthanasia' : 'regular_visit',
        pet_count: petCount,
        has_preferred_doctor: !!submissionData.preferredDoctor,
        service_area: formData.serviceArea || formData.serviceAreaVisit || undefined,
        has_time_preferences: !!(formData.selectedDateTimeSlots && Object.keys(formData.selectedDateTimeSlots).length > 0) || 
                              !!(formData.selectedDateTimeSlotsVisit && Object.keys(formData.selectedDateTimeSlotsVisit).length > 0),
        how_soon: formData.howSoon || undefined,
        membership_interest: formData.membershipInterest || undefined,
      });
      
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
                <img
                  src="/final_thick_lines_cropped.jpeg"
                  alt="VAYD Scout Logo"
                  style={{
                    height: '60px',
                    width: 'auto',
                    opacity: 0.9,
                    mixBlendMode: 'multiply',
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                <span style={{
                  fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
                  fontWeight: 400,
                  fontSize: '30px',
                  color: '#2c1810',
                  lineHeight: '60px',
                  display: 'flex',
                  alignItems: 'center',
                }}>
                  Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
                </span>
              </div>
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
                  <strong>Looks like you're already one of our clients!</strong> Please{' '}
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
                  {' '}or quickly{' '}
                  <a
                    href="/create-client"
                    onClick={(e) => {
                      e.preventDefault();
                      navigate('/create-client');
                    }}
                    style={{ color: '#d97706', textDecoration: 'underline', fontWeight: 600 }}
                  >
                    create an account
                  </a>
                  {' '}using this email to access our Client Portal and request appointments.
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
                What is your best phone number? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="tel"
                value={formData.phoneNumbers || ''}
                onChange={(e) => updateFormData('phoneNumbers', e.target.value)}
                placeholder="207-555-1234"
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
                Can we text this number? <span style={{ color: '#ef4444' }}>*</span>
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
                    <span style={{ fontSize: '14px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.canWeText && (
                <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                  {errors.canWeText}
                </div>
              )}
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
              {errors.zoneNotServiced && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                  {errors.zoneNotServiced.includes('www.vetatyourdoor.com/service-area') ? (
                    <>
                      {errors.zoneNotServiced.split('www.vetatyourdoor.com/service-area')[0]}
                      <a 
                        href="https://www.vetatyourdoor.com/service-area" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ color: '#3b82f6', textDecoration: 'underline' }}
                      >
                        www.vetatyourdoor.com/service-area
                      </a>
                      {errors.zoneNotServiced.split('www.vetatyourdoor.com/service-area')[1]}
                    </>
                  ) : (
                    errors.zoneNotServiced
                  )}
                </div>
              )}
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

          </div>
        );

      case 'new-client-pet-info': {
        const updatePetSpecificData = (petId: string, field: string, value: any) => {
          setFormData(prev => {
            const petData = prev.petSpecificData || {};
            return {
              ...prev,
              petSpecificData: {
                ...petData,
                [petId]: {
                  ...petData[petId],
                  [field]: value,
                },
              },
            };
          });
        };

        const getPetData = (petId: string) => {
          return formData.petSpecificData?.[petId] || {};
        };

        const addNewClientPet = () => {
          const newPetId = `new-pet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          setFormData(prev => {
            const petData = prev.petSpecificData || {};
            petData[newPetId] = {
              needsToday: '',
              needsTodayDetails: '',
              euthanasiaReason: '',
              beenToVetLastThreeMonths: '',
              interestedInOtherOptions: '',
              aftercarePreference: '',
            };
            return {
              ...prev,
              newClientPets: [
                ...(prev.newClientPets || []),
                {
                  id: newPetId,
                  name: '',
                  species: '',
                  age: '',
                  spayedNeutered: '',
                  sex: '',
                  breed: '',
                  color: '',
                  weight: '',
                  behaviorAtPreviousVisits: '',
                  needsCalmingMedications: '',
                  hasCalmingMedications: '',
                  needsMuzzleOrSpecialHandling: '',
                }
              ],
              petSpecificData: petData,
            };
          });
        };

        const removeNewClientPet = (petId: string) => {
          setFormData(prev => ({
            ...prev,
            newClientPets: (prev.newClientPets || []).filter(p => p.id !== petId)
          }));
        };

        const updateNewClientPet = (petId: string, field: string, value: any) => {
          setFormData(prev => ({
            ...prev,
            newClientPets: (prev.newClientPets || []).map(pet => {
              if (pet.id !== petId) return pet;
              
              // If species is being changed, clear breed and breedId
              if (field === 'speciesId') {
                const selectedSpecies = speciesList.find(s => s.id === Number(value));
                return {
                  ...pet,
                  speciesId: value ? Number(value) : undefined,
                  species: selectedSpecies?.name || '',
                  breed: undefined,
                  breedId: undefined
                };
              }
              
              // If breed is being changed, update breed name
              if (field === 'breedId') {
                const selectedBreed = breedsBySpecies[pet.speciesId || 0]?.find(b => b.id === Number(value));
                return {
                  ...pet,
                  breedId: value ? Number(value) : undefined,
                  breed: selectedBreed?.name || ''
                };
              }
              
              return { ...pet, [field]: value };
            })
          }));
        };

        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Pet Information
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Please provide information about your pet(s)
              </p>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                Your Pet(s) <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ 
                border: `1px solid ${errors.newClientPets ? '#ef4444' : '#d1d5db'}`,
                borderRadius: '8px',
                padding: '8px',
                backgroundColor: '#f9fafb',
              }}>
                {(formData.newClientPets || []).map((pet, index) => (
                  <div key={pet.id} style={{ marginBottom: index < (formData.newClientPets?.length || 0) - 1 ? '16px' : '0' }}>
                    <div style={{
                      padding: '16px',
                      backgroundColor: '#f0fdf4',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      borderLeft: '3px solid #10b981',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', margin: 0 }}>
                          {pet.name || `Pet ${index + 1}`}
                        </h3>
                        <button
                          type="button"
                          onClick={() => removeNewClientPet(pet.id)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                            border: '1px solid #fecaca',
                            borderRadius: '6px',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      {/* Pet Name */}
                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                          Pet Name <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={pet.name || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'name', e.target.value)}
                          placeholder="Enter pet name"
                          style={{
                            width: '100%',
                            padding: '8px',
                            border: `1px solid ${errors[`newClientPet.${pet.id}.name`] ? '#ef4444' : '#d1d5db'}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                          }}
                        />
                        {errors[`newClientPet.${pet.id}.name`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            {errors[`newClientPet.${pet.id}.name`]}
                          </div>
                        )}
                      </div>

                      {/* Species, Age, Spayed/Neutered, Breed, Color, Weight */}
                      <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Species <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <select
                              value={pet.speciesId || ''}
                              onChange={(e) => {
                                const newSpeciesId = e.target.value;
                                updateNewClientPet(pet.id, 'speciesId', newSpeciesId);
                                // Clear breed fields when species changes
                                updateNewClientPet(pet.id, 'breed', '');
                                updateNewClientPet(pet.id, 'breedId', '');
                                setBreedSearchTerms(prev => ({ ...prev, [pet.id]: '' }));
                                setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                              }}
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.species`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                                backgroundColor: '#fff',
                              }}
                            >
                              <option value="">Select species...</option>
                              {loadingSpecies ? (
                                <option disabled>Loading species...</option>
                              ) : (
                                speciesList.map(species => (
                                  <option key={species.id} value={species.id}>
                                    {species.prettyName || species.name}
                                  </option>
                                ))
                              )}
                            </select>
                            {errors[`newClientPet.${pet.id}.species`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.species`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Age/DOB <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={pet.age || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'age', e.target.value)}
                              placeholder="e.g., 5 years"
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.age`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                              }}
                            />
                            {errors[`newClientPet.${pet.id}.age`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.age`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Spayed/Neutered? <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <select
                              value={pet.spayedNeutered || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'spayedNeutered', e.target.value)}
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.spayedNeutered`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                                backgroundColor: '#fff',
                              }}
                            >
                              <option value="">Select...</option>
                              <option value="Yes">Yes</option>
                              <option value="No">No</option>
                            </select>
                            {errors[`newClientPet.${pet.id}.spayedNeutered`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.spayedNeutered`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Sex <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <select
                              value={pet.sex || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'sex', e.target.value)}
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.sex`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                                backgroundColor: '#fff',
                              }}
                            >
                              <option value="">Select...</option>
                              <option value="Male">Male</option>
                              <option value="Female">Female</option>
                            </select>
                            {errors[`newClientPet.${pet.id}.sex`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.sex`]}
                              </div>
                            )}
                          </div>
                          <div style={{ position: 'relative' }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Breed <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            {(() => {
                              // Check if breeds exist for this species
                              const hasBreeds = pet.speciesId && 
                                breedsBySpecies[pet.speciesId] && 
                                breedsBySpecies[pet.speciesId].length > 0;
                              const isLoading = pet.speciesId && loadingBreeds[pet.speciesId];
                              
                              // If no breeds available (and not loading), show simple text input
                              if (pet.speciesId && !isLoading && !hasBreeds) {
                                return (
                                  <input
                                    type="text"
                                    value={pet.breed || ''}
                                    onChange={(e) => updateNewClientPet(pet.id, 'breed', e.target.value)}
                                    placeholder="Enter breed"
                                    style={{
                                      padding: '8px',
                                      border: `1px solid ${errors[`newClientPet.${pet.id}.breed`] ? '#ef4444' : '#d1d5db'}`,
                                      borderRadius: '6px',
                                      fontSize: '14px',
                                      width: '100%',
                                      backgroundColor: '#fff',
                                    }}
                                  />
                                );
                              }
                              
                              // Otherwise, show autocomplete input
                              return (
                                <>
                                  <input
                                    type="text"
                                    value={pet.breed || breedSearchTerms[pet.id] || ''}
                                    onChange={(e) => {
                                      const searchTerm = e.target.value;
                                      setBreedSearchTerms(prev => ({ ...prev, [pet.id]: searchTerm }));
                                      setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: true }));
                                      // Clear selection if user is typing
                                      if (searchTerm !== pet.breed) {
                                        updateNewClientPet(pet.id, 'breedId', '');
                                        updateNewClientPet(pet.id, 'breed', '');
                                      }
                                    }}
                                    onFocus={() => {
                                      if (pet.speciesId) {
                                        setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: true }));
                                      }
                                    }}
                                    onBlur={() => {
                                      // Delay closing to allow click on dropdown item
                                      setTimeout(() => {
                                        setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                                      }, 200);
                                    }}
                                    disabled={!pet.speciesId}
                                    placeholder={!pet.speciesId 
                                      ? 'Select species first...' 
                                      : loadingBreeds[pet.speciesId]
                                      ? 'Loading breeds...'
                                      : 'Type to search breeds...'}
                                    style={{
                                      padding: '8px',
                                      border: `1px solid ${errors[`newClientPet.${pet.id}.breed`] ? '#ef4444' : '#d1d5db'}`,
                                      borderRadius: '6px',
                                      fontSize: '14px',
                                      width: '100%',
                                      backgroundColor: pet.speciesId ? '#fff' : '#f3f4f6',
                                      cursor: pet.speciesId ? 'text' : 'not-allowed',
                                    }}
                                  />
                                  {pet.speciesId && breedDropdownOpen[pet.id] && breedsBySpecies[pet.speciesId] && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '100%',
                                  left: 0,
                                  right: 0,
                                  zIndex: 1000,
                                  backgroundColor: '#fff',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  marginTop: '4px',
                                  maxHeight: '200px',
                                  overflowY: 'auto',
                                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                                }}
                              >
                                {breedsBySpecies[pet.speciesId]
                                  .filter(breed => 
                                    breed.name.toLowerCase().includes((breedSearchTerms[pet.id] || '').toLowerCase())
                                  )
                                  .slice(0, 50) // Limit to 50 results for performance
                                  .map(breed => (
                                    <div
                                      key={breed.id}
                                      onClick={() => {
                                        updateNewClientPet(pet.id, 'breedId', breed.id.toString());
                                        updateNewClientPet(pet.id, 'breed', breed.name);
                                        setBreedSearchTerms(prev => ({ ...prev, [pet.id]: breed.name }));
                                        setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                                      }}
                                      style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        borderBottom: '1px solid #f3f4f6',
                                        backgroundColor: pet.breedId === breed.id ? '#f0fdf4' : '#fff',
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#f9fafb';
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = pet.breedId === breed.id ? '#f0fdf4' : '#fff';
                                      }}
                                    >
                                      {breed.name}
                                    </div>
                                  ))}
                                {breedsBySpecies[pet.speciesId].filter(breed => 
                                  breed.name.toLowerCase().includes((breedSearchTerms[pet.id] || '').toLowerCase())
                                ).length === 0 && (
                                  <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: '14px' }}>
                                    No breeds found
                                  </div>
                                )}
                              </div>
                            )}
                                </>
                              );
                            })()}
                            {errors[`newClientPet.${pet.id}.breed`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.breed`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Color <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={pet.color || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'color', e.target.value)}
                              placeholder="Color"
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.color`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                              }}
                            />
                            {errors[`newClientPet.${pet.id}.color`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.color`]}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                              Approximate Weight (lbs) <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <input
                              type="number"
                              value={pet.weight || ''}
                              onChange={(e) => updateNewClientPet(pet.id, 'weight', e.target.value)}
                              placeholder="e.g., 12"
                              min="0"
                              step="0.1"
                              style={{
                                padding: '8px',
                                border: `1px solid ${errors[`newClientPet.${pet.id}.weight`] ? '#ef4444' : '#d1d5db'}`,
                                borderRadius: '6px',
                                fontSize: '14px',
                                width: '100%',
                              }}
                            />
                            {errors[`newClientPet.${pet.id}.weight`] && (
                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                {errors[`newClientPet.${pet.id}.weight`]}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Pet Behavior */}
                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                          Tell us anything else you want us to know about {pet.name || 'this pet'}:
                        </label>
                        <textarea
                          value={pet.behaviorAtPreviousVisits || ''}
                          onChange={(e) => updateNewClientPet(pet.id, 'behaviorAtPreviousVisits', e.target.value)}
                          rows={3}
                          style={{
                            width: '100%',
                            padding: '8px',
                            border: `1px solid ${errors[`newClientPet.${pet.id}.behaviorAtPreviousVisits`] ? '#ef4444' : '#d1d5db'}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontFamily: 'inherit',
                          }}
                        />
                        {errors[`newClientPet.${pet.id}.behaviorAtPreviousVisits`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            {errors[`newClientPet.${pet.id}.behaviorAtPreviousVisits`]}
                          </div>
                        )}
                      </div>

                      {/* Needs Calming Medications */}
                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                          Has {pet.name || 'this pet'} needed calming medications at a previous veterinary visit? <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          {['Yes', 'No'].map((option) => (
                            <label
                              key={option}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                padding: '8px 12px',
                                border: `1px solid ${pet.needsCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                                borderRadius: '6px',
                                backgroundColor: pet.needsCalmingMedications === option ? '#f0fdf4' : '#fff',
                              }}
                            >
                              <input
                                type="radio"
                                name={`needsCalmingMedications-${pet.id}`}
                                value={option}
                                checked={pet.needsCalmingMedications === option}
                                onChange={(e) => {
                                  updateNewClientPet(pet.id, 'needsCalmingMedications', e.target.value);
                                  if (e.target.value === 'No') {
                                    updateNewClientPet(pet.id, 'hasCalmingMedications', '');
                                  }
                                }}
                                style={{ margin: 0 }}
                              />
                              <span style={{ fontSize: '14px' }}>{option}</span>
                            </label>
                          ))}
                        </div>
                        {errors[`newClientPet.${pet.id}.needsCalmingMedications`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            {errors[`newClientPet.${pet.id}.needsCalmingMedications`]}
                          </div>
                        )}
                      </div>

                      {/* Has Calming Medications */}
                      {pet.needsCalmingMedications === 'Yes' && (
                        <div style={{ marginBottom: '16px' }}>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                            Do you have these medications on hand?
                          </label>
                          <div style={{ display: 'flex', gap: '12px' }}>
                            {['Yes', 'No'].map((option) => (
                              <label
                                key={option}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  cursor: 'pointer',
                                  padding: '8px 12px',
                                  border: `1px solid ${pet.hasCalmingMedications === option ? '#10b981' : '#d1d5db'}`,
                                  borderRadius: '6px',
                                  backgroundColor: pet.hasCalmingMedications === option ? '#f0fdf4' : '#fff',
                                }}
                              >
                                <input
                                  type="radio"
                                  name={`hasCalmingMedications-${pet.id}`}
                                  value={option}
                                  checked={pet.hasCalmingMedications === option}
                                  onChange={(e) => updateNewClientPet(pet.id, 'hasCalmingMedications', e.target.value)}
                                  style={{ margin: 0 }}
                                />
                                <span style={{ fontSize: '14px' }}>{option}</span>
                              </label>
                            ))}
                          </div>
                          {pet.hasCalmingMedications === 'No' && (
                            <div style={{ marginTop: '8px' }}>
                              <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 500 }}>
                                Unfortunately we cannot prescribe medications without having seen {pet.name || 'this pet'}. Please get the prescription from your previous vet so you can administer them prior to {pet.name || 'this pet'}'s first visit with us.
                              </span>
                            </div>
                          )}
                          {errors[`newClientPet.${pet.id}.hasCalmingMedications`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                              {errors[`newClientPet.${pet.id}.hasCalmingMedications`]}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Needs Muzzle or Special Handling */}
                      <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                          Has {pet.name || 'this pet'} needed a muzzle or other special handling at a previous veterinary visit (please know this is not meant to judge - it is just so we can best prepare)? <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          {['Yes', 'No'].map((option) => (
                            <label
                              key={option}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                cursor: 'pointer',
                                padding: '8px 12px',
                                border: `1px solid ${pet.needsMuzzleOrSpecialHandling === option ? '#10b981' : '#d1d5db'}`,
                                borderRadius: '6px',
                                backgroundColor: pet.needsMuzzleOrSpecialHandling === option ? '#f0fdf4' : '#fff',
                              }}
                            >
                              <input
                                type="radio"
                                name={`needsMuzzleOrSpecialHandling-${pet.id}`}
                                value={option}
                                checked={pet.needsMuzzleOrSpecialHandling === option}
                                onChange={(e) => updateNewClientPet(pet.id, 'needsMuzzleOrSpecialHandling', e.target.value)}
                                style={{ margin: 0 }}
                              />
                              <span style={{ fontSize: '14px' }}>{option}</span>
                            </label>
                          ))}
                        </div>
                        {errors[`newClientPet.${pet.id}.needsMuzzleOrSpecialHandling`] && (
                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                            {errors[`newClientPet.${pet.id}.needsMuzzleOrSpecialHandling`]}
                          </div>
                        )}
                      </div>

                      {/* Questions for this pet */}
                      <div style={{
                        marginTop: '8px',
                        padding: '16px',
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        borderLeft: '3px solid #10b981',
                      }}>
                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                          Questions for {pet.name || 'this pet'}
                        </h3>
                        
                        {/* What does your pet need today? */}
                        <div style={{ marginBottom: '4px' }}>
                          <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                            What does {pet.name || 'this pet'} need today? <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          {(() => {
                            const petData = getPetData(pet.id);
                            const appointmentTypeOptions = getAppointmentTypeOptions();
                            
                            // Show loading state if appointment types are still loading
                            if (loadingAppointmentTypes) {
                              return (
                                <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                                  Loading appointment types...
                                </div>
                              );
                            }
                            
                            // If no appointment types available, show fallback
                            if (appointmentTypeOptions.length === 0) {
                              return (
                                <div style={{ padding: '12px', color: '#ef4444', fontSize: '14px' }}>
                                  No appointment types available. Please refresh the page.
                                </div>
                              );
                            }
                            
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {appointmentTypeOptions.map((option) => (
                                  <div key={option.name}>
                                    <label
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        padding: '5px 0',
                                        backgroundColor: 'transparent',
                                        transition: 'all 0.2s ease',
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`needsToday-${pet.id}`}
                                        value={option.name}
                                        checked={petData.needsToday === option.name}
                                        onChange={(e) => {
                                          updatePetSpecificData(pet.id, 'needsToday', e.target.value);
                                          updatePetSpecificData(pet.id, 'needsTodayDetails', '');
                                        }}
                                        style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                                      />
                                      <span style={{ fontSize: '16px', lineHeight: '1.4' }}>{option.prettyName}</span>
                                    </label>
                                    {petData.needsToday === option.name && (
                                      <div style={{ marginLeft: '26px', marginTop: '8px', marginBottom: '8px' }}>
                                        {isEuthanasiaAppointmentType(option.name) ? (
                                          // Euthanasia questions
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Let us know what is going on with {pet.name || 'this pet'} that has brought you to this difficult decision. <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <textarea
                                                value={petData.euthanasiaReason || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'euthanasiaReason', e.target.value)}
                                                rows={5}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`euthanasiaReason.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                  fontFamily: 'inherit',
                                                }}
                                              />
                                              {errors[`euthanasiaReason.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`euthanasiaReason.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Has {pet.name || 'this pet'} been to the veterinarian for these issues in the last three months (it's ok if not - this just helps us schedule correctly)? <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <input
                                                type="text"
                                                value={petData.beenToVetLastThreeMonths || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'beenToVetLastThreeMonths', e.target.value)}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`beenToVetLastThreeMonths.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                }}
                                              />
                                              {errors[`beenToVetLastThreeMonths.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`beenToVetLastThreeMonths.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Are you interested in pursuing other options other than euthanasia? We absolutely do not judge your decision - we are here for you - we just want to be sure we schedule an appointment that addresses all of your and {pet.name || 'this pet'}'s needs. <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {[
                                                  'No. While this is very difficult, I have made my decision. I don\'t wish to pursue further discussion about my decision or investigate other options at this point.',
                                                  'Yes. I am interested in speaking with the doctor about other options that may help.',
                                                  'I\'m not sure.',
                                                ].map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.interestedInOtherOptions === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.interestedInOtherOptions === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`interestedInOtherOptions-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.interestedInOtherOptions === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'interestedInOtherOptions', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`interestedInOtherOptions.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`interestedInOtherOptions.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                What are your preferences for aftercare? <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {[
                                                  'I will handle my pet\'s remains (e.g. bury at home)',
                                                  'Private Cremation (Cremation WITH return of ashes)',
                                                  'Burial At Sea (Cremation WITHOUT return of ashes)',
                                                  'I am not sure yet.',
                                                ].map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.aftercarePreference === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.aftercarePreference === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`aftercarePreference-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.aftercarePreference === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'aftercarePreference', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`aftercarePreference.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`aftercarePreference.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <textarea
                                            value={petData.needsTodayDetails || ''}
                                            onChange={(e) => updatePetSpecificData(pet.id, 'needsTodayDetails', e.target.value)}
                                            placeholder={
                                              matchesAppointmentTypeName(option.name, ['wellness', 'check-up'])
                                                ? `Do you have any specific concerns you want to discuss at the visit?`
                                                : matchesAppointmentTypeName(option.name, ['not feeling well', 'illness', 'Medical Visit'])
                                                ? `Describe what is going on with ${pet.name || 'this pet'}`
                                                : matchesAppointmentTypeName(option.name, ['recheck', 'follow-up', 'Follow Up'])
                                                ? `What are we checking on for ${pet.name || 'this pet'}?`
                                                : 'Please provide details about the reason for this appointment...'
                                            }
                                            rows={3}
                                            style={{
                                              width: '100%',
                                              padding: '8px',
                                              border: `1px solid ${errors[`needsTodayDetails.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                              borderRadius: '6px',
                                              fontSize: '14px',
                                              fontFamily: 'inherit',
                                            }}
                                          />
                                        )}
                                        {errors[`needsTodayDetails.${pet.id}`] && (
                                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                            {errors[`needsTodayDetails.${pet.id}`]}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                          {errors[`needsToday.${pet.id}`] && (
                            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                              {errors[`needsToday.${pet.id}`]}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add Pet Button */}
                <button
                  type="button"
                  onClick={addNewClientPet}
                  style={{
                    width: '100%',
                    padding: '12px',
                    marginTop: '12px',
                    backgroundColor: '#f0fdf4',
                    color: '#10b981',
                    border: '2px dashed #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                >
                  <span>+</span>
                  <span>{formData.newClientPets && formData.newClientPets.length > 0 ? 'Add Another Pet' : 'Add Pet'}</span>
                </button>
              </div>
              {errors.newClientPets && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                  {errors.newClientPets}
                </div>
              )}
            </div>

            {/* How soon do your pets need to be seen? - Single question for all pets */}
            <div style={{ marginTop: '24px', marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                How soon do you need to be seen? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[
                  'Emergent – today',
                  'Urgent – within 24–48 hours',
                  'Soon – sometime this week',
                  'In 3–4 weeks',
                  'Flexible – within the next month',
                  'Routine – in about 3 months',
                  'Planned – in about 6 months',
                  'Future – in about 12 months',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '5px 0',
                      backgroundColor: 'transparent',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="howSoon"
                      value={option}
                      checked={formData.howSoon === option}
                      onChange={(e) => updateFormData('howSoon', e.target.value)}
                      style={{ margin: 0, width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '16px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.howSoon && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                  {errors.howSoon}
                </div>
              )}
            </div>
          </div>
        );
        break;
      }

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

            {/* Display address on file - show if we have address data or original address */}
            {(() => {
              const addressToShow = formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)
                ? formData.physicalAddress
                : originalAddress;
              
              return addressToShow && (addressToShow.line1 || addressToShow.city || addressToShow.state || addressToShow.zip) ? (
                <div style={{ marginBottom: '20px' }}>
                  <div style={{
                    padding: '12px',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px',
                    color: '#374151',
                    lineHeight: '1.5',
                  }}>
                    {addressToShow.line1 && <div>{addressToShow.line1}</div>}
                    {addressToShow.line2 && <div>{addressToShow.line2}</div>}
                    {(addressToShow.city || addressToShow.state || addressToShow.zip) && (
                      <div>
                        {[addressToShow.city, addressToShow.state, addressToShow.zip]
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : null;
            })()}

            {/* Is this the address where we will come to see you? */}
            {(() => {
              const addressToCheck = formData.physicalAddress && (formData.physicalAddress.line1 || formData.physicalAddress.city || formData.physicalAddress.state || formData.physicalAddress.zip)
                ? formData.physicalAddress
                : originalAddress;
              
              return addressToCheck && (addressToCheck.line1 || addressToCheck.city || addressToCheck.state || addressToCheck.zip);
            })() && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Is this the address where we will come to see you? <span style={{ color: '#ef4444' }}>*</span>
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
                        border: `1px solid ${formData.isThisTheAddressWhereWeWillCome === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.isThisTheAddressWhereWeWillCome === option ? '#f0fdf4' : '#fff',
                        flex: 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="isThisTheAddressWhereWeWillCome"
                        value={option}
                        checked={formData.isThisTheAddressWhereWeWillCome === option}
                        onChange={(e) => updateFormData('isThisTheAddressWhereWeWillCome', e.target.value)}
                        style={{ margin: 0 }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                {errors.isThisTheAddressWhereWeWillCome && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>{errors.isThisTheAddressWhereWeWillCome}</div>}
              </div>
            )}

            {/* Show new address fields if they answered "No" to "Is this the address where we will come to see you?" */}
            {formData.isThisTheAddressWhereWeWillCome === 'No' && (
              <>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please let us know where we will meet you.
                  </label>
                  <input
                    type="text"
                    value={formData.newPhysicalAddress?.line1 || ''}
                    onChange={(e) => updateNestedFormData('newPhysicalAddress', 'line1', e.target.value)}
                    placeholder="Street Address"
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: `1px solid ${errors['newPhysicalAddress.line1'] ? '#ef4444' : '#d1d5db'}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                      marginBottom: '12px',
                    }}
                  />
                  {errors['newPhysicalAddress.line1'] && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '-8px', marginBottom: '8px' }}>{errors['newPhysicalAddress.line1']}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.city || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'city', e.target.value)}
                      placeholder="City"
                      style={{ 
                        padding: '12px', 
                        border: `1px solid ${errors['newPhysicalAddress.city'] ? '#ef4444' : '#d1d5db'}`, 
                        borderRadius: '8px', 
                        fontSize: '14px' 
                      }}
                    />
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.state || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'state', e.target.value)}
                      placeholder="State"
                      style={{ 
                        padding: '12px', 
                        border: `1px solid ${errors['newPhysicalAddress.state'] ? '#ef4444' : '#d1d5db'}`, 
                        borderRadius: '8px', 
                        fontSize: '14px' 
                      }}
                    />
                    <input
                      type="text"
                      value={formData.newPhysicalAddress?.zip || ''}
                      onChange={(e) => updateNestedFormData('newPhysicalAddress', 'zip', e.target.value)}
                      placeholder="Zip"
                      style={{ 
                        padding: '12px', 
                        border: `1px solid ${errors['newPhysicalAddress.zip'] ? '#ef4444' : '#d1d5db'}`, 
                        borderRadius: '8px', 
                        fontSize: '14px' 
                      }}
                    />
                  </div>
                  {(errors['newPhysicalAddress.city'] || errors['newPhysicalAddress.state'] || errors['newPhysicalAddress.zip']) && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                      {errors['newPhysicalAddress.city'] || errors['newPhysicalAddress.state'] || errors['newPhysicalAddress.zip']}
                    </div>
                  )}
                  {errors.zoneNotServiced && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>
                      {errors.zoneNotServiced.includes('www.vetatyourdoor.com/service-area') ? (
                        <>
                          {errors.zoneNotServiced.split('www.vetatyourdoor.com/service-area')[0]}
                          <a 
                            href="https://www.vetatyourdoor.com/service-area" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ color: '#3b82f6', textDecoration: 'underline' }}
                          >
                            www.vetatyourdoor.com/service-area
                          </a>
                          {errors.zoneNotServiced.split('www.vetatyourdoor.com/service-area')[1]}
                        </>
                      ) : (
                        errors.zoneNotServiced
                      )}
                    </div>
                  )}
                </div>
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

            {/* Temporarily hidden - will be moved elsewhere */}
            {/* <div style={{ marginBottom: '20px' }}>
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
            </div> */}
          </div>
        );

      case 'existing-client-pets':
        const updatePetSpecificData = (petId: string, field: string, value: any) => {
          setFormData(prev => {
            const petData = prev.petSpecificData || {};
            return {
              ...prev,
              petSpecificData: {
                ...petData,
                [petId]: {
                  ...petData[petId],
                  [field]: value,
                },
              },
            };
          });
        };

        const getPetData = (petId: string) => {
          return formData.petSpecificData?.[petId] || {};
        };

        const addExistingClientNewPet = () => {
          const newPetId = `existing-new-pet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          setFormData(prev => ({
            ...prev,
            existingClientNewPets: [
              ...(prev.existingClientNewPets || []),
              {
                id: newPetId,
                name: '',
                species: '',
                age: '',
                spayedNeutered: '',
                sex: '',
                breed: '',
                color: '',
                weight: '',
                behaviorAtPreviousVisits: '',
                needsCalmingMedications: '',
                hasCalmingMedications: '',
                needsMuzzleOrSpecialHandling: '',
              }
            ]
          }));
        };

        const removeExistingClientNewPet = (petId: string) => {
          setFormData(prev => ({
            ...prev,
            existingClientNewPets: (prev.existingClientNewPets || []).filter(p => p.id !== petId),
            selectedPetIds: prev.selectedPetIds.filter(id => id !== petId),
          }));
        };

        const updateExistingClientNewPet = (petId: string, field: string, value: any) => {
          setFormData(prev => ({
            ...prev,
            existingClientNewPets: (prev.existingClientNewPets || []).map(pet => {
              if (pet.id !== petId) return pet;
              
              // If species is being changed, clear breed and breedId
              if (field === 'speciesId') {
                const selectedSpecies = speciesList.find(s => s.id === Number(value));
                return {
                  ...pet,
                  speciesId: value ? Number(value) : undefined,
                  species: selectedSpecies?.name || '',
                  breed: undefined,
                  breedId: undefined
                };
              }
              
              // If breed is being changed, update breed name
              if (field === 'breedId') {
                const selectedBreed = breedsBySpecies[pet.speciesId || 0]?.find(b => b.id === Number(value));
                return {
                  ...pet,
                  breedId: value ? Number(value) : undefined,
                  breed: selectedBreed?.name || ''
                };
              }
              
              return { ...pet, [field]: value };
            })
          }));
        };

        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Select Pet(s)
              </h1>
              <p style={{ fontSize: '16px', color: '#6b7280' }}>
                Which pet(s) would you like the appointment for?
              </p>
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
                  {pets.map((pet) => {
                    const isSelected = formData.selectedPetIds.includes(pet.id);
                    const petData = getPetData(pet.id);
                    return (
                      <div key={pet.id} style={{ marginBottom: isSelected ? '12px' : '2px' }}>
                        <label
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '12px',
                            cursor: 'pointer',
                            borderRadius: '6px',
                            backgroundColor: isSelected ? '#f0fdf4' : 'transparent',
                            border: `1px solid ${isSelected ? '#10b981' : 'transparent'}`,
                            transition: 'all 0.2s ease',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData(prev => {
                                  const petData = prev.petSpecificData || {};
                                  // Initialize pet data if not exists
                                  if (!petData[pet.id]) {
                                    petData[pet.id] = {
                                      needsToday: '',
                                      needsTodayDetails: '',
                                      euthanasiaReason: '',
                                      beenToVetLastThreeMonths: '',
                                      interestedInOtherOptions: '',
                                      aftercarePreference: '',
                                    };
                                  }
                                  return {
                                    ...prev,
                                    selectedPetIds: [...prev.selectedPetIds, pet.id],
                                    petSpecificData: petData,
                                  };
                                });
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
                        
                        {/* Expandable questions section for selected pets */}
                        {isSelected && (
                          <div style={{
                            marginTop: '8px',
                            marginLeft: '30px',
                            padding: '16px',
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                            borderLeft: '3px solid #10b981',
                          }}>
                            <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                              Questions for {pet.name}
                            </h3>
                            
                            {/* What does your pet need today? */}
                            <div style={{ marginBottom: '4px' }}>
                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                                What does {pet.name} need today? <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {(() => {
                                  const appointmentTypeOptions = getAppointmentTypeOptions();
                                  
                                  // Show loading state if appointment types are still loading
                                  if (loadingAppointmentTypes) {
                                    return (
                                      <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                                        Loading appointment types...
                                      </div>
                                    );
                                  }
                                  
                                  // If no appointment types available, show fallback
                                  if (appointmentTypeOptions.length === 0) {
                                    return (
                                      <div style={{ padding: '12px', color: '#ef4444', fontSize: '14px' }}>
                                        No appointment types available. Please refresh the page.
                                      </div>
                                    );
                                  }
                                  
                                  return appointmentTypeOptions.map((option) => (
                                  <div key={option.name}>
                                    <label
                                      style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        cursor: 'pointer',
                                        padding: '5px 0',
                                        backgroundColor: 'transparent',
                                        transition: 'all 0.2s ease',
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`needsToday-${pet.id}`}
                                        value={option.name}
                                        checked={petData.needsToday === option.name}
                                        onChange={(e) => {
                                          updatePetSpecificData(pet.id, 'needsToday', e.target.value);
                                          // Clear details when changing selection
                                          updatePetSpecificData(pet.id, 'needsTodayDetails', '');
                                        }}
                                        style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                                      />
                                      <span style={{ fontSize: '16px', lineHeight: '1.4' }}>{option.prettyName}</span>
                                    </label>
                                    {petData.needsToday === option.name && (
                                      <div style={{ marginLeft: '26px', marginTop: '8px', marginBottom: '8px' }}>
                                        {isEuthanasiaAppointmentType(option.name) ? (
                                          // Euthanasia questions
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Let us know what is going on with {pet.name} that has brought you to this difficult decision. <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <textarea
                                                value={petData.euthanasiaReason || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'euthanasiaReason', e.target.value)}
                                                rows={5}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`euthanasiaReason.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                  fontFamily: 'inherit',
                                                }}
                                              />
                                              {errors[`euthanasiaReason.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`euthanasiaReason.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Has {pet.name} been to the veterinarian for these issues in the last three months (it's ok if not - this just helps us schedule correctly)? <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <input
                                                type="text"
                                                value={petData.beenToVetLastThreeMonths || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'beenToVetLastThreeMonths', e.target.value)}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`beenToVetLastThreeMonths.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                }}
                                              />
                                              {errors[`beenToVetLastThreeMonths.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`beenToVetLastThreeMonths.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                Are you interested in pursuing other options other than euthanasia? We absolutely do not judge your decision - we are here for you - we just want to be sure we schedule an appointment that addresses all of your and {pet.name}'s needs. <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {[
                                                  'No. While this is very difficult, I have made my decision. I don\'t wish to pursue further discussion about my decision or investigate other options at this point.',
                                                  'Yes. I am interested in speaking with the doctor about other options that may help.',
                                                  'I\'m not sure.',
                                                ].map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.interestedInOtherOptions === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.interestedInOtherOptions === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`interestedInOtherOptions-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.interestedInOtherOptions === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'interestedInOtherOptions', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`interestedInOtherOptions.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`interestedInOtherOptions.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                            <div>
                                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                What are your preferences for aftercare? <span style={{ color: '#ef4444' }}>*</span>
                                              </label>
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {[
                                                  'I will handle my pet\'s remains (e.g. bury at home)',
                                                  'Private Cremation (Cremation WITH return of ashes)',
                                                  'Burial At Sea (Cremation WITHOUT return of ashes)',
                                                  'I am not sure yet.',
                                                ].map((opt) => (
                                                  <label
                                                    key={opt}
                                                    style={{
                                                      display: 'flex',
                                                      alignItems: 'flex-start',
                                                      gap: '8px',
                                                      cursor: 'pointer',
                                                      padding: '8px 12px',
                                                      border: `1px solid ${petData.aftercarePreference === opt ? '#10b981' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      backgroundColor: petData.aftercarePreference === opt ? '#f0fdf4' : '#fff',
                                                    }}
                                                  >
                                                    <input
                                                      type="radio"
                                                      name={`aftercarePreference-${pet.id}`}
                                                      value={opt}
                                                      checked={petData.aftercarePreference === opt}
                                                      onChange={(e) => updatePetSpecificData(pet.id, 'aftercarePreference', e.target.value)}
                                                      style={{ marginTop: '2px', flexShrink: 0 }}
                                                    />
                                                    <span style={{ fontSize: '14px' }}>{opt}</span>
                                                  </label>
                                                ))}
                                              </div>
                                              {errors[`aftercarePreference.${pet.id}`] && (
                                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                  {errors[`aftercarePreference.${pet.id}`]}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          // Regular text box with dynamic placeholder
                                          <textarea
                                            value={petData.needsTodayDetails || ''}
                                            onChange={(e) => updatePetSpecificData(pet.id, 'needsTodayDetails', e.target.value)}
                                            placeholder={
                                              matchesAppointmentTypeName(option.name, ['wellness', 'check-up'])
                                                ? `Do you have any specific concerns you want to discuss at the visit?`
                                                : matchesAppointmentTypeName(option.name, ['not feeling well', 'illness', 'Medical Visit'])
                                                ? `Describe what is going on with ${pet.name}`
                                                : matchesAppointmentTypeName(option.name, ['recheck', 'follow-up', 'Follow Up'])
                                                ? `What are we checking on for ${pet.name}?`
                                                : matchesAppointmentTypeName(option.name, ['technician', 'Tech'])
                                                ? `What would you like done for ${pet.name}?`
                                                : 'Please provide details about the reason for this appointment...'
                                            }
                                            rows={3}
                                            style={{
                                              width: '100%',
                                              padding: '8px',
                                              border: `1px solid ${errors[`needsTodayDetails.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                              borderRadius: '6px',
                                              fontSize: '14px',
                                              fontFamily: 'inherit',
                                            }}
                                          />
                                        )}
                                        {errors[`needsTodayDetails.${pet.id}`] && (
                                          <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                            {errors[`needsTodayDetails.${pet.id}`]}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ));
                                })()}
                              </div>
                              {errors[`needsToday.${pet.id}`] && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                                  {errors[`needsToday.${pet.id}`]}
                                </div>
                              )}
                            </div>

                          </div>
                        )}
                      </div>
                    );
                  })}
                  {formData.selectedPetIds.length === 0 && errors.selectedPetIds && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', padding: '0 6px' }}>
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

            {/* New pets added by existing client */}
            {isLoggedIn && formData.existingClientNewPets && formData.existingClientNewPets.length > 0 && (
              <div style={{ marginTop: '24px', marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  New Pet(s) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ 
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  padding: '4px',
                  backgroundColor: '#f9fafb',
                }}>
                  {formData.existingClientNewPets.map((pet, index) => {
                    const isSelected = formData.selectedPetIds.includes(pet.id);
                    const petData = getPetData(pet.id);
                    return (
                      <div key={pet.id} style={{ marginBottom: index < (formData.existingClientNewPets?.length || 0) - 1 ? '12px' : '2px' }}>
                        <div style={{
                          padding: '12px',
                          backgroundColor: '#f0fdf4',
                          border: `1px solid ${isSelected ? '#10b981' : '#e5e7eb'}`,
                          borderRadius: '6px',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                cursor: 'pointer',
                                flex: 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFormData(prev => {
                                      const petData = prev.petSpecificData || {};
                                      if (!petData[pet.id]) {
                                        petData[pet.id] = {
                                          needsToday: '',
                                          needsTodayDetails: '',
                                          euthanasiaReason: '',
                                          beenToVetLastThreeMonths: '',
                                          interestedInOtherOptions: '',
                                          aftercarePreference: '',
                                        };
                                      }
                                      return {
                                        ...prev,
                                        selectedPetIds: [...prev.selectedPetIds, pet.id],
                                        petSpecificData: petData,
                                      };
                                    });
                                  } else {
                                    updateFormData('selectedPetIds', formData.selectedPetIds.filter(id => id !== pet.id));
                                  }
                                }}
                                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                              />
                              <div style={{ flex: 1, fontSize: '14px', fontWeight: 500, color: '#111827' }}>
                                {pet.name || `New Pet ${index + 1}`}
                              </div>
                            </label>
                            <button
                              type="button"
                              onClick={() => removeExistingClientNewPet(pet.id)}
                              style={{
                                padding: '6px 12px',
                                backgroundColor: '#fee2e2',
                                color: '#991b1b',
                                border: '1px solid #fecaca',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              Remove
                            </button>
                          </div>

                          {/* Pet Information Fields */}
                          <div style={{ marginLeft: '28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Pet Name */}
                            <div>
                              <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                Pet Name <span style={{ color: '#ef4444' }}>*</span>
                              </label>
                              <input
                                type="text"
                                value={pet.name || ''}
                                onChange={(e) => updateExistingClientNewPet(pet.id, 'name', e.target.value)}
                                placeholder="Enter pet name"
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  border: `1px solid ${errors[`existingClientNewPet.${pet.id}.name`] ? '#ef4444' : '#d1d5db'}`,
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                }}
                              />
                              {errors[`existingClientNewPet.${pet.id}.name`] && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                  {errors[`existingClientNewPet.${pet.id}.name`]}
                                </div>
                              )}
                            </div>

                            {/* Species, Age/DOB, Spayed/Neutered, Breed, Color, Weight in a grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Species <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <select
                                  value={pet.speciesId || ''}
                                  onChange={(e) => {
                                    const newSpeciesId = e.target.value;
                                    updateExistingClientNewPet(pet.id, 'speciesId', newSpeciesId);
                                    // Clear breed fields when species changes
                                    updateExistingClientNewPet(pet.id, 'breed', '');
                                    updateExistingClientNewPet(pet.id, 'breedId', '');
                                    setBreedSearchTerms(prev => ({ ...prev, [pet.id]: '' }));
                                    setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                                  }}
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.species`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                    backgroundColor: '#fff',
                                  }}
                                >
                                  <option value="">Select species...</option>
                                  {loadingSpecies ? (
                                    <option disabled>Loading species...</option>
                                  ) : (
                                    speciesList.map(species => (
                                      <option key={species.id} value={species.id}>
                                        {species.prettyName || species.name}
                                      </option>
                                    ))
                                  )}
                                </select>
                                {errors[`existingClientNewPet.${pet.id}.species`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.species`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Age/DOB <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                  type="text"
                                  value={pet.age || ''}
                                  onChange={(e) => updateExistingClientNewPet(pet.id, 'age', e.target.value)}
                                  placeholder="e.g., 5 years"
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.age`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                  }}
                                />
                                {errors[`existingClientNewPet.${pet.id}.age`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.age`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Spayed/Neutered? <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <select
                                  value={pet.spayedNeutered || ''}
                                  onChange={(e) => updateExistingClientNewPet(pet.id, 'spayedNeutered', e.target.value)}
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.spayedNeutered`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                    backgroundColor: '#fff',
                                  }}
                                >
                                  <option value="">Select...</option>
                                  <option value="Yes">Yes</option>
                                  <option value="No">No</option>
                                </select>
                                {errors[`existingClientNewPet.${pet.id}.spayedNeutered`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.spayedNeutered`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Sex <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <select
                                  value={pet.sex || ''}
                                  onChange={(e) => updateExistingClientNewPet(pet.id, 'sex', e.target.value)}
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.sex`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                    backgroundColor: '#fff',
                                  }}
                                >
                                  <option value="">Select...</option>
                                  <option value="Male">Male</option>
                                  <option value="Female">Female</option>
                                </select>
                                {errors[`existingClientNewPet.${pet.id}.sex`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.sex`]}
                                  </div>
                                )}
                              </div>
                              <div style={{ position: 'relative' }}>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Breed <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                {(() => {
                                  // Check if breeds exist for this species
                                  const hasBreeds = pet.speciesId && 
                                    breedsBySpecies[pet.speciesId] && 
                                    breedsBySpecies[pet.speciesId].length > 0;
                                  const isLoading = pet.speciesId && loadingBreeds[pet.speciesId];
                                  
                                  // If no breeds available (and not loading), show simple text input
                                  if (pet.speciesId && !isLoading && !hasBreeds) {
                                    return (
                                      <input
                                        type="text"
                                        value={pet.breed || ''}
                                        onChange={(e) => updateExistingClientNewPet(pet.id, 'breed', e.target.value)}
                                        placeholder="Enter breed"
                                        style={{
                                          padding: '8px',
                                          border: `1px solid ${errors[`existingClientNewPet.${pet.id}.breed`] ? '#ef4444' : '#d1d5db'}`,
                                          borderRadius: '6px',
                                          fontSize: '14px',
                                          width: '100%',
                                          backgroundColor: '#fff',
                                        }}
                                      />
                                    );
                                  }
                                  
                                  // Otherwise, show autocomplete input
                                  return (
                                    <>
                                      <input
                                        type="text"
                                        value={pet.breed || breedSearchTerms[pet.id] || ''}
                                        onChange={(e) => {
                                          const searchTerm = e.target.value;
                                          setBreedSearchTerms(prev => ({ ...prev, [pet.id]: searchTerm }));
                                          setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: true }));
                                          // Clear selection if user is typing
                                          if (searchTerm !== pet.breed) {
                                            updateExistingClientNewPet(pet.id, 'breedId', '');
                                            updateExistingClientNewPet(pet.id, 'breed', '');
                                          }
                                        }}
                                        onFocus={() => {
                                          if (pet.speciesId) {
                                            setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: true }));
                                          }
                                        }}
                                        onBlur={() => {
                                          // Delay closing to allow click on dropdown item
                                          setTimeout(() => {
                                            setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                                          }, 200);
                                        }}
                                        disabled={!pet.speciesId}
                                        placeholder={!pet.speciesId 
                                          ? 'Select species first...' 
                                          : loadingBreeds[pet.speciesId]
                                          ? 'Loading breeds...'
                                          : 'Type to search breeds...'}
                                        style={{
                                          padding: '8px',
                                          border: `1px solid ${errors[`existingClientNewPet.${pet.id}.breed`] ? '#ef4444' : '#d1d5db'}`,
                                          borderRadius: '6px',
                                          fontSize: '14px',
                                          width: '100%',
                                          backgroundColor: pet.speciesId ? '#fff' : '#f3f4f6',
                                          cursor: pet.speciesId ? 'text' : 'not-allowed',
                                        }}
                                      />
                                      {pet.speciesId && breedDropdownOpen[pet.id] && breedsBySpecies[pet.speciesId] && (
                                  <div
                                    style={{
                                      position: 'absolute',
                                      top: '100%',
                                      left: 0,
                                      right: 0,
                                      zIndex: 1000,
                                      backgroundColor: '#fff',
                                      border: '1px solid #d1d5db',
                                      borderRadius: '6px',
                                      marginTop: '4px',
                                      maxHeight: '200px',
                                      overflowY: 'auto',
                                      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                                    }}
                                  >
                                    {breedsBySpecies[pet.speciesId]
                                      .filter(breed => 
                                        breed.name.toLowerCase().includes((breedSearchTerms[pet.id] || '').toLowerCase())
                                      )
                                      .slice(0, 50) // Limit to 50 results for performance
                                      .map(breed => (
                                        <div
                                          key={breed.id}
                                          onClick={() => {
                                            updateExistingClientNewPet(pet.id, 'breedId', breed.id.toString());
                                            updateExistingClientNewPet(pet.id, 'breed', breed.name);
                                            setBreedSearchTerms(prev => ({ ...prev, [pet.id]: breed.name }));
                                            setBreedDropdownOpen(prev => ({ ...prev, [pet.id]: false }));
                                          }}
                                          style={{
                                            padding: '8px 12px',
                                            cursor: 'pointer',
                                            borderBottom: '1px solid #f3f4f6',
                                            backgroundColor: pet.breedId === breed.id ? '#f0fdf4' : '#fff',
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = '#f9fafb';
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = pet.breedId === breed.id ? '#f0fdf4' : '#fff';
                                          }}
                                        >
                                          {breed.name}
                                        </div>
                                      ))}
                                    {breedsBySpecies[pet.speciesId].filter(breed => 
                                      breed.name.toLowerCase().includes((breedSearchTerms[pet.id] || '').toLowerCase())
                                    ).length === 0 && (
                                      <div style={{ padding: '8px 12px', color: '#6b7280', fontSize: '14px' }}>
                                        No breeds found
                                      </div>
                                    )}
                                  </div>
                                )}
                                    </>
                                  );
                                })()}
                                {errors[`existingClientNewPet.${pet.id}.breed`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.breed`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Color <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                  type="text"
                                  value={pet.color || ''}
                                  onChange={(e) => updateExistingClientNewPet(pet.id, 'color', e.target.value)}
                                  placeholder="Color"
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.color`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                  }}
                                />
                                {errors[`existingClientNewPet.${pet.id}.color`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.color`]}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#6b7280', fontWeight: 500 }}>
                                  Approximate Weight (lbs) <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                  type="number"
                                  value={pet.weight || ''}
                                  onChange={(e) => updateExistingClientNewPet(pet.id, 'weight', e.target.value)}
                                  placeholder="e.g., 12"
                                  min="0"
                                  step="0.1"
                                  style={{
                                    padding: '8px',
                                    border: `1px solid ${errors[`existingClientNewPet.${pet.id}.weight`] ? '#ef4444' : '#d1d5db'}`,
                                    borderRadius: '6px',
                                    fontSize: '14px',
                                    width: '100%',
                                  }}
                                />
                                {errors[`existingClientNewPet.${pet.id}.weight`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.weight`]}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Tell us anything else */}
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                Tell us anything else you want us to know about {pet.name || 'this pet'}:
                              </label>
                              <textarea
                                value={pet.behaviorAtPreviousVisits || ''}
                                onChange={(e) => updateExistingClientNewPet(pet.id, 'behaviorAtPreviousVisits', e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  padding: '8px',
                                  border: `1px solid ${errors[`existingClientNewPet.${pet.id}.behaviorAtPreviousVisits`] ? '#ef4444' : '#d1d5db'}`,
                                  borderRadius: '6px',
                                  fontSize: '14px',
                                  fontFamily: 'inherit',
                                }}
                              />
                              {errors[`existingClientNewPet.${pet.id}.behaviorAtPreviousVisits`] && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                  {errors[`existingClientNewPet.${pet.id}.behaviorAtPreviousVisits`]}
                                </div>
                              )}
                            </div>

                            {/* Has pet needed calming medications */}
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                Has {pet.name || 'this pet'} needed calming medications at a previous veterinary visit? <span style={{ color: '#ef4444' }}>*</span>
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
                                    }}
                                  >
                                    <input
                                      type="radio"
                                      name={`needsCalmingMedications-${pet.id}`}
                                      value={option}
                                      checked={pet.needsCalmingMedications === option}
                                      onChange={(e) => {
                                        updateExistingClientNewPet(pet.id, 'needsCalmingMedications', e.target.value);
                                        if (e.target.value === 'No') {
                                          updateExistingClientNewPet(pet.id, 'hasCalmingMedications', '');
                                        }
                                      }}
                                      style={{ margin: 0 }}
                                    />
                                    <span style={{ fontSize: '14px' }}>{option}</span>
                                  </label>
                                ))}
                              </div>
                              {errors[`existingClientNewPet.${pet.id}.needsCalmingMedications`] && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                  {errors[`existingClientNewPet.${pet.id}.needsCalmingMedications`]}
                                </div>
                              )}
                            </div>

                            {/* Do you have these medications on hand? */}
                            {pet.needsCalmingMedications === 'Yes' && (
                              <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                  Do you have these medications on hand? <span style={{ color: '#ef4444' }}>*</span>
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
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`hasCalmingMedications-${pet.id}`}
                                        value={option}
                                        checked={pet.hasCalmingMedications === option}
                                        onChange={(e) => updateExistingClientNewPet(pet.id, 'hasCalmingMedications', e.target.value)}
                                        style={{ margin: 0 }}
                                      />
                                      <span style={{ fontSize: '14px' }}>{option}</span>
                                    </label>
                                  ))}
                                </div>
                                {pet.hasCalmingMedications === 'No' && (
                                  <div style={{ marginTop: '8px' }}>
                                    <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 500 }}>
                                      Unfortunately we cannot prescribe medications without having seen {pet.name || 'this pet'}. Please get the prescription from your previous vet so you can administer them prior to {pet.name || 'this pet'}'s first visit with us.
                                    </span>
                                  </div>
                                )}
                                {errors[`existingClientNewPet.${pet.id}.hasCalmingMedications`] && (
                                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                    {errors[`existingClientNewPet.${pet.id}.hasCalmingMedications`]}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Has pet needed muzzle */}
                            <div>
                              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                Has {pet.name || 'this pet'} needed a muzzle or other special handling at a previous veterinary visit (please know this is not meant to judge - it is just so we can best prepare)? <span style={{ color: '#ef4444' }}>*</span>
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
                                    }}
                                  >
                                    <input
                                      type="radio"
                                      name={`needsMuzzleOrSpecialHandling-${pet.id}`}
                                      value={option}
                                      checked={pet.needsMuzzleOrSpecialHandling === option}
                                      onChange={(e) => updateExistingClientNewPet(pet.id, 'needsMuzzleOrSpecialHandling', e.target.value)}
                                      style={{ margin: 0 }}
                                    />
                                    <span style={{ fontSize: '14px' }}>{option}</span>
                                  </label>
                                ))}
                              </div>
                              {errors[`existingClientNewPet.${pet.id}.needsMuzzleOrSpecialHandling`] && (
                                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                  {errors[`existingClientNewPet.${pet.id}.needsMuzzleOrSpecialHandling`]}
                                </div>
                              )}
                            </div>

                            {/* Expandable questions section for selected pets */}
                            {isSelected && (
                              <div style={{
                                marginTop: '8px',
                                padding: '16px',
                                backgroundColor: '#fff',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                borderLeft: '3px solid #10b981',
                              }}>
                                <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
                                  Questions for {pet.name || 'this pet'}
                                </h3>
                                
                                {/* What does your pet need today? */}
                                <div style={{ marginBottom: '4px' }}>
                                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                                    What does {pet.name || 'this pet'} need today? <span style={{ color: '#ef4444' }}>*</span>
                                  </label>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    {(() => {
                                      const appointmentTypeOptions = getAppointmentTypeOptions();
                                      
                                      // Show loading state if appointment types are still loading
                                      if (loadingAppointmentTypes) {
                                        return (
                                          <div style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                                            Loading appointment types...
                                          </div>
                                        );
                                      }
                                      
                                      // If no appointment types available, show fallback
                                      if (appointmentTypeOptions.length === 0) {
                                        return (
                                          <div style={{ padding: '12px', color: '#ef4444', fontSize: '14px' }}>
                                            No appointment types available. Please refresh the page.
                                          </div>
                                        );
                                      }
                                      
                                      return appointmentTypeOptions.map((option) => (
                                      <div key={option.name}>
                                        <label
                                          style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '8px',
                                            cursor: 'pointer',
                                            padding: '5px 0',
                                            backgroundColor: 'transparent',
                                            transition: 'all 0.2s ease',
                                          }}
                                        >
                                          <input
                                            type="radio"
                                            name={`needsToday-${pet.id}`}
                                            value={option.name}
                                            checked={petData.needsToday === option.name}
                                            onChange={(e) => {
                                              updatePetSpecificData(pet.id, 'needsToday', e.target.value);
                                              updatePetSpecificData(pet.id, 'needsTodayDetails', '');
                                            }}
                                            style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                                          />
                                          <span style={{ fontSize: '16px', lineHeight: '1.4' }}>{option.prettyName}</span>
                                        </label>
                                        {petData.needsToday === option.name && (
                                          <div style={{ marginLeft: '26px', marginTop: '8px', marginBottom: '8px' }}>
                                            {isEuthanasiaAppointmentType(option.name) ? (
                                              // Euthanasia questions - same as existing pets
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                <div>
                                                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                    Let us know what is going on with {pet.name || 'this pet'} that has brought you to this difficult decision. <span style={{ color: '#ef4444' }}>*</span>
                                                  </label>
                                                  <textarea
                                                    value={petData.euthanasiaReason || ''}
                                                    onChange={(e) => updatePetSpecificData(pet.id, 'euthanasiaReason', e.target.value)}
                                                    rows={5}
                                                    style={{
                                                      width: '100%',
                                                      padding: '8px',
                                                      border: `1px solid ${errors[`euthanasiaReason.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      fontSize: '14px',
                                                      fontFamily: 'inherit',
                                                    }}
                                                  />
                                                  {errors[`euthanasiaReason.${pet.id}`] && (
                                                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                      {errors[`euthanasiaReason.${pet.id}`]}
                                                    </div>
                                                  )}
                                                </div>
                                                <div>
                                                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                    Has {pet.name || 'this pet'} been to the veterinarian for these issues in the last three months (it's ok if not - this just helps us schedule correctly)? <span style={{ color: '#ef4444' }}>*</span>
                                                  </label>
                                                  <input
                                                    type="text"
                                                    value={petData.beenToVetLastThreeMonths || ''}
                                                    onChange={(e) => updatePetSpecificData(pet.id, 'beenToVetLastThreeMonths', e.target.value)}
                                                    style={{
                                                      width: '100%',
                                                      padding: '8px',
                                                      border: `1px solid ${errors[`beenToVetLastThreeMonths.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                      borderRadius: '6px',
                                                      fontSize: '14px',
                                                    }}
                                                  />
                                                  {errors[`beenToVetLastThreeMonths.${pet.id}`] && (
                                                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                      {errors[`beenToVetLastThreeMonths.${pet.id}`]}
                                                    </div>
                                                  )}
                                                </div>
                                                <div>
                                                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                    Are you interested in pursuing other options other than euthanasia? We absolutely do not judge your decision - we are here for you - we just want to be sure we schedule an appointment that addresses all of your and {pet.name || 'this pet'}'s needs. <span style={{ color: '#ef4444' }}>*</span>
                                                  </label>
                                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {[
                                                      'No. While this is very difficult, I have made my decision. I don\'t wish to pursue further discussion about my decision or investigate other options at this point.',
                                                      'Yes. I am interested in speaking with the doctor about other options that may help.',
                                                      'I\'m not sure.',
                                                    ].map((opt) => (
                                                      <label
                                                        key={opt}
                                                        style={{
                                                          display: 'flex',
                                                          alignItems: 'flex-start',
                                                          gap: '8px',
                                                          cursor: 'pointer',
                                                          padding: '8px 12px',
                                                          border: `1px solid ${petData.interestedInOtherOptions === opt ? '#10b981' : '#d1d5db'}`,
                                                          borderRadius: '6px',
                                                          backgroundColor: petData.interestedInOtherOptions === opt ? '#f0fdf4' : '#fff',
                                                        }}
                                                      >
                                                        <input
                                                          type="radio"
                                                          name={`interestedInOtherOptions-${pet.id}`}
                                                          value={opt}
                                                          checked={petData.interestedInOtherOptions === opt}
                                                          onChange={(e) => updatePetSpecificData(pet.id, 'interestedInOtherOptions', e.target.value)}
                                                          style={{ marginTop: '2px', flexShrink: 0 }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{opt}</span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                  {errors[`interestedInOtherOptions.${pet.id}`] && (
                                                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                      {errors[`interestedInOtherOptions.${pet.id}`]}
                                                    </div>
                                                  )}
                                                </div>
                                                <div>
                                                  <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '14px' }}>
                                                    What are your preferences for aftercare? <span style={{ color: '#ef4444' }}>*</span>
                                                  </label>
                                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                                                          alignItems: 'flex-start',
                                                          gap: '8px',
                                                          cursor: 'pointer',
                                                          padding: '8px 12px',
                                                          border: `1px solid ${petData.aftercarePreference === option ? '#10b981' : '#d1d5db'}`,
                                                          borderRadius: '6px',
                                                          backgroundColor: petData.aftercarePreference === option ? '#f0fdf4' : '#fff',
                                                        }}
                                                      >
                                                        <input
                                                          type="radio"
                                                          name={`aftercarePreference-${pet.id}`}
                                                          value={option}
                                                          checked={petData.aftercarePreference === option}
                                                          onChange={(e) => updatePetSpecificData(pet.id, 'aftercarePreference', e.target.value)}
                                                          style={{ marginTop: '2px', flexShrink: 0 }}
                                                        />
                                                        <span style={{ fontSize: '14px' }}>{option}</span>
                                                      </label>
                                                    ))}
                                                  </div>
                                                  {errors[`aftercarePreference.${pet.id}`] && (
                                                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                      {errors[`aftercarePreference.${pet.id}`]}
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            ) : (
                                              <textarea
                                                value={petData.needsTodayDetails || ''}
                                                onChange={(e) => updatePetSpecificData(pet.id, 'needsTodayDetails', e.target.value)}
                                                placeholder={
                                                  matchesAppointmentTypeName(option.name, ['wellness', 'check-up'])
                                                    ? `Do you have any specific concerns you want to discuss at the visit?`
                                                    : matchesAppointmentTypeName(option.name, ['not feeling well', 'illness', 'Medical Visit'])
                                                    ? `Describe what is going on with ${pet.name || 'this pet'}`
                                                    : matchesAppointmentTypeName(option.name, ['recheck', 'follow-up', 'Follow Up'])
                                                    ? `What are we checking on for ${pet.name || 'this pet'}?`
                                                    : matchesAppointmentTypeName(option.name, ['technician', 'Tech'])
                                                    ? `What would you like done for ${pet.name || 'this pet'}?`
                                                    : 'Please provide details about the reason for this appointment...'
                                                }
                                                rows={3}
                                                style={{
                                                  width: '100%',
                                                  padding: '8px',
                                                  border: `1px solid ${errors[`needsTodayDetails.${pet.id}`] ? '#ef4444' : '#d1d5db'}`,
                                                  borderRadius: '6px',
                                                  fontSize: '14px',
                                                  fontFamily: 'inherit',
                                                }}
                                              />
                                            )}
                                            {errors[`needsTodayDetails.${pet.id}`] && (
                                              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                                                {errors[`needsTodayDetails.${pet.id}`]}
                                              </div>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    ));
                                  })()}
                                  </div>
                                  {errors[`needsToday.${pet.id}`] && (
                                    <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                                      {errors[`needsToday.${pet.id}`]}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add Pet Button */}
            {isLoggedIn && (
              <div style={{ marginTop: '16px', marginBottom: '20px' }}>
                <button
                  type="button"
                  onClick={addExistingClientNewPet}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: '#f0fdf4',
                    color: '#10b981',
                    border: '2px dashed #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#dcfce7';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#f0fdf4';
                  }}
                >
                  + Add Pet
                </button>
              </div>
            )}

            {/* How soon do your pets need to be seen? - Single question for all pets */}
            <div style={{ marginTop: '24px', marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                How soon do you need to be seen? <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[
                  'Emergent – today',
                  'Urgent – within 24–48 hours',
                  'Soon – sometime this week',
                  'In 3–4 weeks',
                  'Flexible – within the next month',
                  'Routine – in about 3 months',
                  'Planned – in about 6 months',
                  'Future – in about 12 months',
                ].map((option) => (
                  <label
                    key={option}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '5px 0',
                      backgroundColor: 'transparent',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="howSoon"
                      value={option}
                      checked={formData.howSoon === option}
                      onChange={(e) => updateFormData('howSoon', e.target.value)}
                      style={{ margin: 0, width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '16px' }}>{option}</span>
                  </label>
                ))}
              </div>
              {errors.howSoon && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px' }}>
                  {errors.howSoon}
                </div>
              )}
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
        // Check if any pet is selected for euthanasia (existing or new client pets)
        const hasEuthanasiaPetEuthanasiaPage = 
          (formData.selectedPetIds?.some(petId => {
            const petData = formData.petSpecificData?.[petId];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false) ||
          (formData.newClientPets?.some(pet => {
            const petData = formData.petSpecificData?.[pet.id];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false);

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

            {!hasEuthanasiaPetEuthanasiaPage && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Are you interested in membership or pay as you go?{' '}
                  <a
                    href="https://www.vetatyourdoor.com/care-options"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#10b981',
                      textDecoration: 'none',
                      fontSize: '14px',
                      fontWeight: 400,
                      marginLeft: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.textDecoration = 'underline';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.textDecoration = 'none';
                    }}
                  >
                    What's this?
                  </a>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    'Pay as you go',
                    'Membership',
                    "I'm not sure yet",
                  ].map((option) => (
                    <label
                      key={option}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.membershipInterest === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.membershipInterest === option ? '#f0fdf4' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name="membershipInterest"
                        value={option}
                        checked={formData.membershipInterest === option}
                        onChange={(e) => updateFormData('membershipInterest', e.target.value as 'Pay as you go' | 'Membership' | "I'm not sure yet")}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontSize: '14px' }}>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case 'request-visit-continued':
        // Check if any pet is selected for euthanasia (existing or new client pets)
        const hasEuthanasiaPet = 
          (formData.selectedPetIds?.some(petId => {
            const petData = formData.petSpecificData?.[petId];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false) ||
          (formData.newClientPets?.some(pet => {
            const petData = formData.petSpecificData?.[pet.id];
            return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
          }) || false);

        return (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <h1 style={{ fontSize: '24px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>
                Request Visit (Continued)
              </h1>
            </div>

            {/* Doctor Selection - at the top of request visit page */}
            <div style={{ marginBottom: '32px', padding: '20px', backgroundColor: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151', fontSize: '16px' }}>
                Select a Doctor <span style={{ color: '#ef4444' }}>*</span>{' '}
                <a 
                  href="https://www.vetatyourdoor.com/#team" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style={{ color: '#3b82f6', textDecoration: 'underline', fontWeight: 400, fontSize: '14px' }}
                >
                  (View Our Team)
                </a>
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
                
                // Use the appropriate field based on client type
                const doctorValue = formData.preferredDoctorExisting || formData.preferredDoctor || '';
                const updateDoctor = (value: string) => {
                  if (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') {
                    updateFormData('preferredDoctorExisting', value);
                  } else {
                    updateFormData('preferredDoctor', value);
                  }
                };
                
                return (
                  <>
                    <select
                      value={doctorValue}
                      onChange={(e) => updateDoctor(e.target.value)}
                      disabled={isDisabled || loadingVeterinarians}
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: `1px solid ${errors.preferredDoctorExisting || errors.preferredDoctor ? '#ef4444' : '#d1d5db'}`,
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: (isDisabled || loadingVeterinarians) ? '#f3f4f6' : '#fff',
                        cursor: (isDisabled || loadingVeterinarians) ? 'not-allowed' : 'pointer',
                        opacity: (isDisabled || loadingVeterinarians) ? 0.6 : 1,
                      }}
                    >
                      <option value="">
                        {isDisabled 
                          ? 'Please enter your address above first...' 
                          : loadingVeterinarians
                          ? 'Loading doctors...'
                          : 'Select a doctor...'}
                      </option>
                      {!isDisabled && !loadingVeterinarians && (() => {
                        // Determine which provider list to use
                        const providerList = (isLoggedIn || formData.haveUsedServicesBefore === 'Yes') 
                          ? providers 
                          : (publicProviders.length > 0 ? publicProviders : providers);
                        
                        return (
                          <>
                            <option value="I have no preference">I have no preference</option>
                            {providerList.map((provider) => {
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
                            {(isLoggedIn || formData.haveUsedServicesBefore === 'Yes') && (
                              <option value="Whomever I saw last time (I don't remember their name)">
                                Whomever I saw last time (I don't remember their name)
                              </option>
                            )}
                          </>
                        );
                      })()}
                    </select>
                    {isDisabled && (
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                        Please enter your complete address (street, city, state, zip) above to see available doctors.
                      </div>
                    )}
                    {(errors.preferredDoctorExisting || errors.preferredDoctor) && (
                      <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                        {errors.preferredDoctorExisting || errors.preferredDoctor}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {/* If any pet is selected for euthanasia, show message instead of time slots */}
            {hasEuthanasiaPet ? (
              <>
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
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Please enter any preferences for days/times for us to visit you. <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <textarea
                    value={formData.preferredDateTimeVisit || ''}
                    onChange={(e) => updateFormData('preferredDateTimeVisit', e.target.value)}
                    rows={3}
                    placeholder="Enter any preferences for days/times here..."
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: errors.preferredDateTimeVisit ? '1px solid #ef4444' : '1px solid #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                    }}
                  />
                  {errors.preferredDateTimeVisit && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                      {errors.preferredDateTimeVisit}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Show banner and input field if Emergent or Urgent is selected */}
                {(() => {
                  const isUrgentTimeframe = formData.howSoon === 'Emergent – today' || formData.howSoon === 'Urgent – within 24–48 hours';
                  if (isUrgentTimeframe) {
                    return (
                      <>
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
                        <div style={{ marginBottom: '20px' }}>
                          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                            Please enter any preferences for days/times for us to visit you. <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <textarea
                            value={formData.preferredDateTimeVisit || ''}
                            onChange={(e) => updateFormData('preferredDateTimeVisit', e.target.value)}
                            rows={3}
                            placeholder="Enter any preferences for days/times here..."
                            style={{
                              width: '100%',
                              padding: '12px',
                              border: errors.preferredDateTimeVisit ? '1px solid #ef4444' : '1px solid #d1d5db',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontFamily: 'inherit',
                            }}
                          />
                          {errors.preferredDateTimeVisit && (
                            <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                              {errors.preferredDateTimeVisit}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  }
                  return null;
                })()}
                
                {/* Show time slots if not urgent/emergent */}
                {(() => {
                  const isUrgentTimeframe = formData.howSoon === 'Emergent – today' || formData.howSoon === 'Urgent – within 24–48 hours';
                  return !isUrgentTimeframe;
                })() && (
            <div style={{ marginBottom: '20px' }}>
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
              
              {!loadingSlots && recommendedSlots.length > 0 && (
                <>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                    Here are some possible dates and times. Our schedule is always changing, so these are not guaranteed, but we'll confirm availability with you as soon as we receive your request.
                  </label>
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
                      <div style={{ marginTop: '20px', marginLeft: '0' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                          Please enter any preferences for days/times for us to visit you. <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <textarea
                          value={formData.preferredDateTimeVisit || ''}
                          onChange={(e) => updateFormData('preferredDateTimeVisit', e.target.value)}
                          rows={3}
                          placeholder="Enter any preferences for days/times here..."
                          style={{
                            width: '100%',
                            padding: '12px',
                            border: errors.preferredDateTimeVisit ? '1px solid #ef4444' : '1px solid #d1d5db',
                            borderRadius: '8px',
                            fontSize: '14px',
                            fontFamily: 'inherit',
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
                  {errors.selectedDateTimeSlotsVisit && (
                    <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                      {errors.selectedDateTimeSlotsVisit}
                    </div>
                  )}
                  </div>
                </>
              )}
              
              {!loadingSlots && recommendedSlots.length === 0 && (formData.preferredDoctorExisting || formData.preferredDoctor) && (
                <>
                  <div style={{ 
                    marginBottom: '20px', 
                    padding: '12px',
                    backgroundColor: '#d1fae5',
                    border: '1px solid #10b981',
                    borderRadius: '8px',
                    fontSize: '14px',
                    color: '#065f46',
                    fontWeight: 500,
                  }}>
                    Once you submit the form, a Client Liaison will be in touch with you shortly about available times.
                  </div>
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                      Please enter any preferences for days/times for us to visit you. <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                      value={formData.preferredDateTimeVisit || ''}
                      onChange={(e) => updateFormData('preferredDateTimeVisit', e.target.value)}
                      rows={3}
                      placeholder="Enter any preferences for days/times here..."
                      style={{
                        width: '100%',
                        padding: '12px',
                        border: errors.preferredDateTimeVisit ? '1px solid #ef4444' : '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontFamily: 'inherit',
                      }}
                    />
                    {errors.preferredDateTimeVisit && (
                      <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '4px' }}>
                        {errors.preferredDateTimeVisit}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            )}
              </>
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

            {!hasEuthanasiaPet && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: '#374151' }}>
                  Are you interested in membership or pay as you go?{' '}
                  <a
                    href="https://www.vetatyourdoor.com/care-options"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: '#10b981',
                      textDecoration: 'none',
                      fontSize: '14px',
                      fontWeight: 400,
                      marginLeft: '4px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.textDecoration = 'underline';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.textDecoration = 'none';
                    }}
                  >
                    What's this?
                  </a>
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    'Pay as you go',
                    'Membership',
                    "I'm not sure yet",
                  ].map((option) => (
                    <label
                      key={option}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        padding: '12px',
                        border: `1px solid ${formData.membershipInterest === option ? '#10b981' : '#d1d5db'}`,
                        borderRadius: '8px',
                        backgroundColor: formData.membershipInterest === option ? '#f0fdf4' : '#fff',
                      }}
                    >
                      <input
                        type="radio"
                        name="membershipInterest"
                        value={option}
                        checked={formData.membershipInterest === option}
                        onChange={(e) => updateFormData('membershipInterest', e.target.value as 'Pay as you go' | 'Membership' | "I'm not sure yet")}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontSize: '14px' }}>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      default:
        return <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Page: {currentPage} - Implementation in progress...</div>;
    }
  };

  if (currentPage === 'success') {
    return (
      <div style={{ minHeight: '100vh', width: '100%' }}>
        {/* Header - only show for logged-in users */}
        {isLoggedIn && (
          <header style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            background: '#f8fdfa',
            borderBottom: '1px solid rgba(17, 163, 106, 0.1)',
            backdropFilter: 'saturate(120%) blur(6px)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img
                src="/final_thick_lines_cropped.jpeg"
                alt="VAYD Scout Logo"
                style={{
                  height: '60px',
                  width: 'auto',
                  opacity: 0.9,
                  mixBlendMode: 'multiply',
                }}
              />
              <span style={{
                fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
                fontWeight: 400,
                fontSize: '30px',
                color: '#2c1810',
                lineHeight: '60px',
                display: 'flex',
                alignItems: 'center',
              }}>
                Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
              </span>
            </div>
          </header>
        )}

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

        {/* Footer */}
        <footer
          style={{
            marginTop: '40px',
            padding: '24px 16px',
            borderTop: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '12px', color: '#6b7280' }}>
            © 2026. All rights reserved.
          </div>
        </footer>
      </div>
    );
  }

  // Map page variations to main step IDs for progress tracking
  const getMainStepId = (page: Page): Page => {
    if (page === 'euthanasia-portland' || page === 'euthanasia-high-peaks') {
      return 'euthanasia-service-area';
    }
    // existing-client-pets is a separate step, so return it as-is
    return page;
  };

  // Determine progress steps based on flow - always show all steps for the user's flow
  const getProgressSteps = (): Array<{ id: Page; label: string }> => {
    const allSteps: Array<{ id: Page; label: string }> = [];
    
    // Determine if user is existing client (logged in) or new client
    const isExistingClient = isLoggedIn || formData.haveUsedServicesBefore === 'Yes' || 
                            currentPage === 'existing-client' || currentPage === 'existing-client-pets';
    
    // Determine if we're in euthanasia flow - check current page first, then form data
    const hasEuthanasiaPet = 
      (formData.selectedPetIds?.some(petId => {
        const petData = formData.petSpecificData?.[petId];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false) ||
      (formData.newClientPets?.some(pet => {
        const petData = formData.petSpecificData?.[pet.id];
        return petData?.needsToday ? isEuthanasiaAppointmentType(petData.needsToday) : false;
      }) || false);
    
    const isEuthanasia = currentPage.startsWith('euthanasia') ||
      formData.lookingForEuthanasia === 'Yes' || 
      formData.lookingForEuthanasiaExisting === 'Yes' ||
      hasEuthanasiaPet;
    
    // Build steps based on client type - always show the same steps once determined
    if (isExistingClient) {
      // Existing client flow
      allSteps.push({ id: 'existing-client', label: 'Request an Appointment' });
      allSteps.push({ id: 'existing-client-pets', label: 'Select Pet(s)' });
      
      // Add final step based on flow type
      if (isEuthanasia) {
        allSteps.push({ id: 'euthanasia-intro', label: 'Euthanasia Details' });
        allSteps.push({ id: 'euthanasia-service-area', label: 'Service Area' });
        allSteps.push({ id: 'euthanasia-continued', label: 'Pick Your Appointment Time' });
      } else {
        // Default to visit flow
        allSteps.push({ id: 'request-visit-continued', label: 'Pick Your Appointment Time' });
      }
    } else {
      // New client flow
      allSteps.push({ id: 'intro', label: 'Introduction' });
      allSteps.push({ id: 'new-client', label: 'New Client Information' });
      allSteps.push({ id: 'new-client-pet-info', label: 'Pet Information' });
      
      // Add final step based on flow type
      if (isEuthanasia) {
        allSteps.push({ id: 'euthanasia-intro', label: 'Euthanasia Details' });
        allSteps.push({ id: 'euthanasia-service-area', label: 'Service Area' });
        allSteps.push({ id: 'euthanasia-continued', label: 'Pick Your Appointment Time' });
      } else {
        // Default to visit flow
        allSteps.push({ id: 'request-visit-continued', label: 'Pick Your Appointment Time' });
      }
    }
    
    // Always return all steps - getStepStatus will handle highlighting
    return allSteps;
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

  // Removed blocking loadingClientData check - form now shows immediately while data loads in background

  return (
    <div style={{ minHeight: '100vh', width: '100%' }}>
      {/* Header - only show for logged-in users */}
      {isLoggedIn && (
        <header style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          background: '#f8fdfa',
          borderBottom: '1px solid rgba(17, 163, 106, 0.1)',
          backdropFilter: 'saturate(120%) blur(6px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img
              src="/final_thick_lines_cropped.jpeg"
              alt="VAYD Scout Logo"
              style={{
                height: '60px',
                width: 'auto',
                opacity: 0.9,
                mixBlendMode: 'multiply',
              }}
            />
            <span style={{
              fontFamily: "'Libre Baskerville', 'Times New Roman', serif",
              fontWeight: 400,
              fontSize: '30px',
              color: '#2c1810',
              lineHeight: '60px',
              display: 'flex',
              alignItems: 'center',
            }}>
              Scout<sup style={{ fontSize: '9px', verticalAlign: 'super', marginLeft: '2px', lineHeight: 0, position: 'relative', top: '-8px' }}>TM</sup>
            </span>
          </div>
        </header>
      )}

      <div style={{ maxWidth: '1200px', margin: '40px auto', padding: '0 16px' }}>
        {/* Mobile Progress Indicator - Top */}
        {isMobile && (
          <div style={{ marginBottom: '24px' }}>
            {renderProgressIndicator()}
          </div>
        )}
      
      <div style={{
        display: isMobile ? 'block' : 'flex',
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
          {currentPage !== 'intro' && currentPage !== 'existing-client' && (
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

      {/* Footer */}
      <footer
        style={{
          marginTop: 'auto',
          padding: '24px 16px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '12px', color: '#6b7280' }}>
          © 2026. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

