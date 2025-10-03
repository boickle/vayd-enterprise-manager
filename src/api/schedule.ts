// src/api/schedule.ts
import { http } from './http';

export type DayBlock = {
  id: string | number;
  startIso: string; // within day TZ
  endIso: string;
  title?: string;
};

export type DayAppt = {
  id: string | number;
  startIso: string; // within day TZ
  endIso: string;
  title?: string;
  serviceMinutes?: number; // optional (falls back to end-start)
};

export type DaySchedule = {
  date: string; // "YYYY-MM-DD"
  timezone: string; // e.g. "America/New_York"
  workStartLocal?: string; // "HH:mm[:ss]"
  workEndLocal?: string; // "HH:mm[:ss]"
  appts: DayAppt[];
  blocks: DayBlock[]; // non-working/reserve/out-of-office
  driveSeconds?: number; // optional total drive time for the day
};

export async function fetchDoctorMonthSchedule(
  doctorId: string,
  year: number,
  month1Based: number
): Promise<DaySchedule[]> {
  const { data } = await http.get('/appointments/doctor/month', {
    params: { doctorId, year, month: month1Based },
  });
  const days = Array.isArray(data?.days) ? data.days : [];
  return days as DaySchedule[];
}
