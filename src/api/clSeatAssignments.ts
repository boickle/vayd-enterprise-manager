/**
 * CL weekly seat assignments — GET/PUT /practice/:practiceId/cl-seat-assignments
 */
import { http } from './http';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';
import {
  CL_DEFAULT_SEAT_PAR,
  type ClSeat,
} from '../utils/clPoints';

export type ClSeatAssignmentRow = {
  id: number;
  practiceId: number;
  employeeId: number;
  weekStart: string;
  seat: ClSeat;
};

export type ClSeatAssignmentsResponse = {
  practiceId: number;
  weekStart?: string;
  fromWeekStart?: string;
  toWeekStart?: string;
  assignments: ClSeatAssignmentRow[];
};

export type ClSeatParSettings = Record<ClSeat, number>;

export const CL_SEAT_PAR_SETTING_KEY = 'cl.seatPar';

/** Sunday on or before `isoDate` (local calendar). */
export function sundayWeekStartLocal(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export async function fetchClSeatAssignments(
  practiceId: number,
  weekStart: string
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.get<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    { params: { weekStart: sundayWeekStartLocal(weekStart) } }
  );
  return data;
}

export async function fetchClSeatAssignmentsRange(
  practiceId: number,
  fromWeekStart: string,
  toWeekStart: string
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.get<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    {
      params: {
        fromWeekStart: sundayWeekStartLocal(fromWeekStart),
        toWeekStart: sundayWeekStartLocal(toWeekStart),
      },
    }
  );
  return data;
}

export async function upsertClSeatAssignments(
  practiceId: number,
  body: {
    weekStart: string;
    assignments: { employeeId: number; seat: ClSeat | null }[];
  }
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.put<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    {
      weekStart: sundayWeekStartLocal(body.weekStart),
      assignments: body.assignments,
    }
  );
  return data;
}

function parseSeatPar(raw: unknown): ClSeatParSettings {
  const base = { ...CL_DEFAULT_SEAT_PAR };
  let obj: Partial<ClSeatParSettings> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Partial<ClSeatParSettings>;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw) as Partial<ClSeatParSettings>;
    } catch {
      obj = null;
    }
  }
  if (!obj) return base;
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    phones: num(obj.phones, base.phones),
    outreach: num(obj.outreach, base.outreach),
    email: num(obj.email, base.email),
  };
}

export async function fetchClSeatPar(practiceId: number): Promise<ClSeatParSettings> {
  const settings = await getPracticeSettings(practiceId);
  return parseSeatPar(
    (settings as Record<string, unknown>)[CL_SEAT_PAR_SETTING_KEY]
  );
}

export async function updateClSeatPar(
  practiceId: number,
  seatPar: ClSeatParSettings
): Promise<ClSeatParSettings> {
  const cleaned = parseSeatPar(seatPar);
  const updated = await updatePracticeSettings(practiceId, {
    [CL_SEAT_PAR_SETTING_KEY]: cleaned,
  } as Parameters<typeof updatePracticeSettings>[1]);
  return parseSeatPar(
    (updated as Record<string, unknown>)[CL_SEAT_PAR_SETTING_KEY]
  );
}
