/**
 * Owner decision Nov 7, 2026 (Scheduling and Routing training review, SR-04): booking by hand on the
 * calendar opens with no appointment type ("Choose…"). It used to preset the first type in the list
 * (Medical Visit, 60 min), which a CL could book by mistake. Get Best Route, reschedule and add-pet
 * bookings keep the type they bring with them.
 *
 * SchedulerBookModal needs a dozen APIs to render, so (like SchedulerBookModal.doubleClick.test.tsx)
 * these tests read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const modal = readFileSync(resolve(__dirname, 'SchedulerBookModal.tsx'), 'utf8');
const scheduler = readFileSync(resolve(__dirname, 'Scheduler.tsx'), 'utf8');

describe('Book by hand starts with no appointment type', () => {
  it('both calendar double-clicks (timed and all-day) ask for no default type', () => {
    const manual = scheduler.match(/setBookPrefill\(\{[^}]*modalTitle: MANUAL_CALENDAR_BOOK_MODAL_TITLE[^}]*\}\)/g) ?? [];
    expect(manual).toHaveLength(2);
    for (const call of manual) expect(call).toMatch(/noDefaultType: true/);
  });

  it('the modal returns no default type when asked, before any fallback', () => {
    const resolver = modal.slice(
      modal.indexOf('const resolveDefaultBookTypeId = useCallback('),
      modal.indexOf('const bookSessionKey = useMemo(')
    );
    expect(resolver.indexOf("if (prefill?.noDefaultType) return '';")).toBeGreaterThan(-1);
    expect(resolver.indexOf("if (prefill?.noDefaultType) return '';")).toBeLessThan(
      resolver.indexOf('resolveBookModalDefaultAppointmentTypeId(')
    );
    expect(resolver).toMatch(/prefill\?\.noDefaultType,/);
  });

  it('the all-day picker does not fall back to its first type either', () => {
    const allDay = modal.slice(modal.indexOf('if (!allDayBookSession) return;'));
    expect(allDay.indexOf("if (prefill?.noDefaultType) return '';")).toBeLessThan(
      allDay.indexOf('typesForActivePicker[0]')
    );
  });

  it('the empty choice reads "Choose…" and the title is spelled right', () => {
    expect(modal).toMatch(/onChange=\{\(e\) => setTypeId\(e\.target\.value\)\}\s*required\s*>\s*<option value="">Choose…<\/option>/);
    expect(scheduler).toContain("'Book appointment - MANUAL OVERRIDE'");
    expect(scheduler).not.toContain('OVERIDE');
  });
});
