import { SourceVisitLinks } from './plannerActions';
import type { PlannerPet } from './plannerData';

const pet = (over: Partial<PlannerPet>): PlannerPet => ({
  patientId: 1,
  name: 'Biscuit',
  species: null,
  onTodaysVisit: false,
  appointmentId: null,
  soapEncounterId: null,
  savedMode: null,
  ...over,
});

describe('SourceVisitLinks', () => {
  it("links today's pets to today's visit, once per pet", () => {
    const links = new SourceVisitLinks();
    const p = pet({ onTodaysVisit: true, appointmentId: 101 });
    expect(links.take(p)).toBe(101);
    expect(links.take(p)).toBeNull();
    links.release(1);
    expect(links.take(p)).toBe(101);
  });

  it('links a labs-are-back pet to the visit the labs were drawn at', () => {
    expect(
      new SourceVisitLinks().take(pet({ focusReason: 'Labs are back', sourceAppointmentId: 104 }))
    ).toBe(104);
  });

  it('leaves other household pets unlinked', () => {
    expect(new SourceVisitLinks().take(pet({}))).toBeNull();
  });
});
