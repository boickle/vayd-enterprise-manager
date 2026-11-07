import { http } from '../api/http';

/**
 * Routing results name each doctor by the id the routing engine returns: the eVet id (`pimsId`)
 * when the doctor has one, otherwise Scout's own employee id. A doctor added in Scout has no eVet id,
 * so `/employees/pims/:id` finds nothing and the card read "Doctor 7673" (training review B3,
 * Nov 7, 2026). Try the eVet id first, then the employee id.
 */
export async function fetchRoutingDoctor(id: string): Promise<Record<string, any> | null> {
  const key = String(id ?? '').trim();
  if (!key) return null;
  try {
    const { data } = await http.get(`/employees/pims/${encodeURIComponent(key)}`);
    const emp = Array.isArray(data) ? data[0] : data;
    if (emp && typeof emp === 'object') return emp;
  } catch {
    /* not an eVet id: try the employee id below */
  }
  if (!/^\d+$/.test(key)) return null;
  try {
    const { data } = await http.get(`/employees/${encodeURIComponent(key)}`);
    const emp = Array.isArray(data) ? data[0] : data;
    return emp && typeof emp === 'object' ? emp : null;
  } catch {
    return null;
  }
}
