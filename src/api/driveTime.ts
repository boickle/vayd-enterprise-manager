import { http } from './http';

export type DriveTimeByDoctor = {
  doctorId: number;
  pimsId: string;
  doctorName: string;
  driveMinutes: number;
  /** Average drive minutes between consecutive appointments (only when driveMinutes > 0). */
  averageDriveMinutesBetweenAppointments?: number;
};

export type DriveTimeResponse = {
  practiceId: number;
  startDate: string;
  endDate: string;
  totalDriveMinutes: number;
  byDoctor: DriveTimeByDoctor[];
};

/**
 * GET /analytics/drive-time?practiceId=&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function fetchDriveTime(params: {
  practiceId: number;
  startDate: string;
  endDate: string;
}): Promise<DriveTimeResponse> {
  const { data } = await http.get<DriveTimeResponse>('/analytics/drive-time', {
    params: {
      practiceId: params.practiceId,
      startDate: params.startDate,
      endDate: params.endDate,
    },
  });
  return data;
}
