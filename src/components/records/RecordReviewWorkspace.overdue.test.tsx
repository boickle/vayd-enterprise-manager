// @vitest-environment jsdom
// SCR-A9-1: AI-found "Overdue" reminders start unticked with a "check the date" hint.
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import RecordReviewWorkspace from './RecordReviewWorkspace';

vi.mock('../../api/careOutreach', () => ({
  createPatientReminder: vi.fn(),
  listPatientOpenReminders: async () => [],
}));

function ymd(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

describe('RecordReviewWorkspace overdue reminders (SCR-A9)', () => {
  it('leaves overdue unticked with a hint; due soon and future stay ticked', () => {
    render(
      <RecordReviewWorkspace
        open
        patientId={1}
        docs={[]}
        loadPreview={async () => undefined}
        summary=""
        onSummaryChange={() => undefined}
        reminders={[
          { item: 'Rabies old', dueDate: ymd(-30), lastDone: '', note: '', status: 'overdue' },
          { item: 'Bordetella soon', dueDate: ymd(30), lastDone: '', note: '', status: 'soon' },
          { item: 'Rabies future', dueDate: ymd(400), lastDone: '', note: '', status: 'ok' },
        ] as never}
        declined={[]}
        writeSummaryNote={async () => true}
        onEntered={() => undefined}
        onClose={() => undefined}
      />
    );
    expect((screen.getByLabelText('Enter Rabies old') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Enter Bordetella soon') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Enter Rabies future') as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText(/check the date/i)).toHaveLength(1);
  });
});
