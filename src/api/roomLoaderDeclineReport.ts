import { http } from './http';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';

export type RoomLoaderDeclineRow = {
  orderId: string;
  itemName: string;
  reason: string;
  declinedAt: string;
  patientId: number;
  patientName: string;
  appointmentId: number;
  appointmentStart: string | null;
  providerId: number | null;
  providerName: string | null;
  declinedByEmployeeId: number | null;
  declinedByName: string | null;
};

export type RoomLoaderDeclineReport = {
  rows: RoomLoaderDeclineRow[];
  byProvider: { providerName: string; count: number }[];
  byStaff: { staffName: string; count: number }[];
};

export async function fetchRoomLoaderDeclineReport(params: {
  startDate: string;
  endDate: string;
  practiceId?: number;
  token?: string | null;
}): Promise<RoomLoaderDeclineReport> {
  const practiceId =
    params.practiceId ?? resolvePracticeIdFromToken(params.token ?? null);
  const { data } = await http.get<RoomLoaderDeclineReport>('/analytics/room-loader-declines', {
    params: {
      practiceId,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return {
    rows: Array.isArray(data?.rows) ? data.rows : [],
    byProvider: Array.isArray(data?.byProvider) ? data.byProvider : [],
    byStaff: Array.isArray(data?.byStaff) ? data.byStaff : [],
  };
}
