/// <reference types="cypress" />
/**
 * Training video, MEM-10: how many exams are left? (docs/training/scripts/memberships/MEM-10-how-many-left.md)
 * TEST stack, demo names only. Pepper (dog, 10 y) is on Canine Golden monthly, 7 months in; his annual senior wellness
 * visit, senior screen, rabies and a trip fee were used 6 months ago. Casey Morgan (client liaison) answers Maria.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, enrolPet, fileAgreement, pets, PLAN_GOLDEN_DOG, quietChart, resetMembershipWorld, settle, trace, useBenefits } from './memKit';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: MEM-10 how many left', () => {
  it('MEM-10', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.pepper, PLAN_GOLDEN_DOG, { startDaysAgo: 213 }).then((id) =>
      useBenefits(id, [
        { name: 'Senior Wellness Visit', daysAgo: 182 },
        { name: 'Senior Screen Canine (4Dx, Fecal O&P, chem 25, CBC, T4, UA)', daysAgo: 182 },
        { name: 'Rabies Vaccine - 3 year', daysAgo: 182 },
        { name: 'Trip Fee', daysAgo: 182 },
      ])
    );
    fileAgreement(p.pepper, p.maria, 213);
    signInAsScheduling('cl', chartUrl(p.pepper));
    quietChart();
    cy.contains('.pmp-allowance__title', 'What Pepper can use', { timeout: 60000 }).should('exist');
    settle(() => cy.contains('.pmp-allowance__title', 'What Pepper can use'));
    cy.wait(1000);

    const row = (t: string) => cy.contains('.pmp-allowance__row', t).first();
    trace('clock');
    startClock();
    trace('m10-01'); line('m10-01');
    trace('m10-02'); line('m10-02');
    trace('m10-03'); line('m10-03', () => pointAt(() => cy.contains('.pmp-allowance__title', 'What Pepper can use'), 4000));
    trace('m10-04'); line('m10-04', () => {
      settle(() => row('6 Month Followup'));
      pointAt(() => row('6 Month Followup'), 5000);
    });
    trace('m10-05'); line('m10-05', () => {
      settle(() => cy.get('.pmp-allowance__row.is-spent').first());
      pointAt(() => cy.get('.pmp-allowance__row.is-spent').first(), 5000);
    });
    trace('m10-06'); line('m10-06', () => pointAt(() => cy.contains('.pmp-allowance', 'Used this term'), 4000));
    trace('m10-07'); line('m10-07', () => tap(() => cy.contains('.pmp-inactive-details-toggle', 'Benefit details')));
    trace('m10-08'); line('m10-08', () => {
      settle(() => cy.get('.pmp-group--choice').first());
      pointAt(() => cy.get('.pmp-group--choice').first().find('.pmp-group__head, .pmp-group__explain'), 6000);
    });
    trace('m10-09'); line('m10-09', () => {
      pointAt(() => cy.get('.pmp-group--choice').first().find('.pmp-coverage').first(), 3500);
      settle(() => cy.get('.pmp-audit__toggle'));
    });
    trace('m10-10'); line('m10-10', () => tap(() => cy.get('.pmp-audit__toggle')));
    trace('m10-11'); line('m10-11');
    trace('done');
    finish();
  });
});
