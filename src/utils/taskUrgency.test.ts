import { describe, expect, it } from 'vitest';
import { isUrgentTask } from './taskUrgency';

const NOW = Date.parse('2026-11-13T15:00:00Z');
const h = 60 * 60 * 1000;
const base = { status: 'open', priority: null as number | null, assignedToEmployeeId: null as number | null };

describe('isUrgentTask (T-Q3)', () => {
  it('T-Q3-1 unassigned, normal priority, due in 3 days is not urgent', () => {
    expect(isUrgentTask({ ...base, dueAt: new Date(NOW + 72 * h).toISOString() }, NOW)).toBe(false);
  });
  it('unassigned with no due date is not urgent', () => {
    expect(isUrgentTask({ ...base, dueAt: null }, NOW)).toBe(false);
  });
  it('T-Q3-2 urgent priority is urgent', () => {
    expect(isUrgentTask({ ...base, priority: 1, dueAt: null }, NOW)).toBe(true);
  });
  it('T-Q3-3 due in 2 hours is urgent', () => {
    expect(isUrgentTask({ ...base, assignedToEmployeeId: 5, dueAt: new Date(NOW + 2 * h).toISOString() }, NOW)).toBe(true);
  });
  it('T-Q3-4 overdue is urgent', () => {
    expect(isUrgentTask({ ...base, assignedToEmployeeId: 5, dueAt: new Date(NOW - 5 * h).toISOString() }, NOW)).toBe(true);
  });
  it('done tasks are never urgent', () => {
    expect(isUrgentTask({ ...base, status: 'done', priority: 1, dueAt: null }, NOW)).toBe(false);
  });
});
