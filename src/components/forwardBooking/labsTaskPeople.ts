import { fetchLabsTaskPeople } from '../../api/tasks';

export type LabsTaskPeopleSuggestion = { assignees: number[]; watchers: number[] };

/**
 * Who the labs-pending task starts out with, for the visit's doctor (SCH-E):
 * - a regular doctor: the doctor and every active technician who works with them;
 * - a relief doctor: the relief doctor, with every veterinarian, relief veterinarian and
 *   medical director watching.
 * Staff can still add or remove people. If the API cannot answer, the doctor alone.
 */
export async function suggestLabsTaskPeople(
  doctorEmployeeId: number | null | undefined
): Promise<LabsTaskPeopleSuggestion> {
  const doctor = Number(doctorEmployeeId);
  if (!Number.isInteger(doctor) || doctor <= 0) return { assignees: [], watchers: [] };
  try {
    const people = await fetchLabsTaskPeople(doctor);
    if (people.assigneeEmployeeIds.length === 0) return { assignees: [doctor], watchers: [] };
    return {
      assignees: people.assigneeEmployeeIds,
      watchers: people.watcherEmployeeIds.filter((id) => !people.assigneeEmployeeIds.includes(id)),
    };
  } catch {
    return { assignees: [doctor], watchers: [] };
  }
}
