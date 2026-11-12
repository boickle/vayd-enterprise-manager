import { describe, expect, it } from 'vitest';
import { foldCheckinIntoVisit } from './roomLoaderSubjectiveText';

/**
 * Lizzie Freeman, 9/2 wellness. The room covered every check-in answer except two declines,
 * and the fold still added three "(Pre-Exam Check-In)" restatements of what the visit said.
 */
const CHECKIN = `Presenting Complaint: Lizzie presents for annual wellness exam

Patient History:
- Owner reports Lizzie's weight is still an issue
- Owner reports eating, drinking, defecating, and urinating normally
- Owner requests Lyme and Lepto vaccines and a heartworm and tick test
- Owner declines Bordetella vaccine
- Owner declines Senior Screen (Canine) panel`;

const VISIT = `Presenting Complaint: Lizzie presents for annual wellness exam, fecal, heartworm/tick test, and Lyme and lepto vaccines

Patient History:
- Housemate dog Jeannie recently died after suspected acute pancreatitis; Lizzie now adapting to top-dog role, clingier, some howling
- Eating and drinking normally; no concerns from owner
- Diet: Hill's Science Diet reduced calorie, 3/4 to 7/8 cup BID plus a couple tablespoons wet food
- Tends to be slightly overweight; does not run like she used to

Current Medications:
- Interceptor Plus
- Bravecto`;

describe('foldCheckinIntoVisit — check-in answers the room already covered', () => {
  const out = foldCheckinIntoVisit(CHECKIN, VISIT);
  const history = out.split('Patient History:')[1]!.split('Current Medications:')[0]!;

  it('does not restate a weight concern the history already records', () => {
    expect(history).not.toMatch(/weight is still an issue/i);
  });

  it('does not append an all-normal intake line to a normal-intake bullet', () => {
    expect(history).not.toMatch(/per pre-exam check-in/i);
    expect(history.match(/drinking/gi)).toHaveLength(1);
  });

  it('does not repeat services the Presenting Complaint already names', () => {
    expect(history).not.toMatch(/requests lyme/i);
  });

  it('keeps the declines, which only the check-in knows, as one bullet', () => {
    const declines = history.split('\n').filter((l) => /declin/i.test(l));
    expect(declines).toHaveLength(1);
    expect(declines[0]).toMatch(/Bordetella/);
    expect(declines[0]).toMatch(/Senior Screen/);
    expect(declines[0]).toMatch(/\(Pre-Exam Check-In\)$/);
  });

  it('leaves the visit bullets alone', () => {
    expect(history).toContain('Tends to be slightly overweight; does not run like she used to');
    expect(history).toContain('Eating and drinking normally; no concerns from owner');
  });
});
