import { http } from './http';
import { DateTime } from 'luxon';

export type EmailCheckResult = {
  exists: boolean;
  hasAccount: boolean;
  practiceId: number;
};

export type PublicProvider = {
  id: string | number;
  name: string;
  email?: string;
};

export type AvailabilityRequest = {
  practiceId: number;
  startDate: string; // YYYY-MM-DD
  numDays: number;
  serviceMinutes: number;
  address: string;
  allowOtherDoctors?: boolean;
  doctorId?: string | number; // Optional: specific doctor
};

export type AvailabilitySlot = {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  iso: string; // ISO datetime string
  display?: string; // Formatted display string
  doctorId?: string | number;
  doctorName?: string;
};

export type AvailabilityResponse = {
  slots?: AvailabilitySlot[];
  winner?: AvailabilitySlot;
  alternates?: AvailabilitySlot[];
};

/**
 * Check if an email exists and if it has an account
 * GET /public/appointments/check-email?email=user@example.com&practiceId=1
 */
export async function checkEmail(email: string, practiceId: number = 1): Promise<EmailCheckResult> {
  const { data } = await http.get('/public/appointments/check-email', {
    params: { email: email.trim().toLowerCase(), practiceId },
  });
  return data;
}

/**
 * Get list of available providers/doctors
 * GET /public/appointments/providers?practiceId=1
 */
export async function fetchPublicProviders(practiceId: number = 1): Promise<PublicProvider[]> {
  const { data } = await http.get('/public/appointments/providers', {
    params: { practiceId },
  });
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? data?.providers ?? []);
  
  return rows.map((r) => ({
    id: r.id ?? r.pimsId ?? r.employeeId,
    name: r.name ?? (`${r.firstName || ''} ${r.lastName || ''}`.trim() || `Provider ${r.id ?? ''}`),
    email: r?.email,
  }));
}

/**
 * Get list of available veterinarians (public endpoint)
 * GET /public/appointments/veterinarians?practiceId=1&address=...
 * @param practiceId Practice ID
 * @param address Optional address to filter veterinarians by service area
 */
export async function fetchPublicVeterinarians(practiceId: number = 1, address?: string): Promise<PublicProvider[]> {
  const params: any = { practiceId };
  if (address) {
    params.address = address;
  }
  
  const { data } = await http.get('/public/appointments/veterinarians', { params });
  const veterinarians: any[] = Array.isArray(data) ? data : (data?.items ?? data?.veterinarians ?? []);
  
  return veterinarians.map((v) => {
    const id = v.id ?? v.pimsId ?? v.employeeId;
    
    // Build name from title, firstName, lastName, and designation
    const nameParts: string[] = [];
    if (v.title) nameParts.push(v.title);
    if (v.firstName) nameParts.push(v.firstName);
    if (v.lastName) nameParts.push(v.lastName);
    if (v.designation) nameParts.push(v.designation);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ')
      : (`${v.firstName || ''} ${v.lastName || ''}`.trim() || `Veterinarian ${id ?? ''}`);
    
    return {
      id: id,
      name: name,
      email: v?.email,
    };
  });
}

/**
 * Get available appointment slots
 * POST /public/appointments/availability
 * 
 * Response format:
 * {
 *   "candidates": [...],
 *   "status": "OK"
 * }
 */
export async function fetchAvailability(request: AvailabilityRequest): Promise<AvailabilityResponse> {
  const { data } = await http.post('/public/appointments/availability', request);
  
  // Handle new format with candidates array
  if (data?.candidates && Array.isArray(data.candidates)) {
    // Convert candidates to slots format
    const slots: AvailabilitySlot[] = data.candidates.slice(0, 3).map((candidate: any) => {
      const candidateDt = candidate.suggestedStartIso 
        ? DateTime.fromISO(candidate.suggestedStartIso)
        : null;
      
      return {
        date: candidate.date || (candidateDt?.toISODate() || ''),
        time: candidateDt?.toFormat('HH:mm') || undefined,
        iso: candidate.suggestedStartIso || candidateDt?.toISO() || undefined,
        display: candidateDt 
          ? `${candidateDt.toFormat('EEE, MMM d')} at ${candidateDt.toFormat('h:mm a')}`
          : undefined,
        doctorId: candidate.doctorId,
        doctorName: candidate.doctorName,
      };
    });
    
    return {
      slots: slots,
      winner: slots[0] || undefined,
      alternates: slots.slice(1, 3) || [],
    };
  }
  
  // Normalize response - could be in different formats
  if (data?.slots && Array.isArray(data.slots)) {
    return {
      slots: data.slots,
      winner: data.winner,
      alternates: data.alternates,
    };
  }
  
  // If response has winner/alternates structure (like routing v2)
  if (data?.winner || Array.isArray(data?.alternates)) {
    const slots: AvailabilitySlot[] = [];
    if (data.winner) slots.push(data.winner);
    if (Array.isArray(data.alternates)) {
      slots.push(...data.alternates);
    }
    return {
      slots: slots.slice(0, 3), // Limit to 3
      winner: data.winner,
      alternates: data.alternates?.slice(0, 2) || [],
    };
  }
  
  // Fallback: return empty
  return { slots: [], alternates: [] };
}

