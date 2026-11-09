/**
 * Found Nov 8, 2026 while recording SR-07 (what the family sees online): on the request form, the
 * "Pick a Date & Time" calendar sent the same availability request about nine times a second. The form
 * built the doctor lists it hands the calendar fresh on every render; the calendar reloads its doctors
 * and fetches availability whenever those lists change. The API's rate limit then refused the requests
 * (429) and families saw "Unable to load availability" with an empty calendar.
 *
 * The form needs dozens of APIs to render, so (like other tests of this page) these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const form = readFileSync(resolve(__dirname, 'AppointmentRequestForm.tsx'), 'utf8');

describe('Request form: doctor lists for the date picker are stable between renders', () => {
  it('builds both lists with useMemo', () => {
    expect(form).toMatch(/const selfSchedulePreloadedDoctors = useMemo\(/);
    expect(form).toMatch(/const selfScheduleRequestOnlyDoctors = useMemo\(/);
  });

  it('passes the memoized lists, not lists built inline during render', () => {
    expect(form).toContain('preloadedDoctors={selfSchedulePreloadedDoctors}');
    expect(form).toContain('requestOnlyDoctors={selfScheduleRequestOnlyDoctors}');
    expect(form).not.toMatch(/preloadedDoctors=\{\(\(\) =>/);
    expect(form).not.toMatch(/requestOnlyDoctors=\{\(\(\) =>/);
  });
});
