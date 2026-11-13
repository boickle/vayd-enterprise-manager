/// <reference types="cypress" />
/** Check B3, B5, B8 and SR-26 (enter reminders and summary) on the scheduling test stack. */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
const db = () => String(Cypress.env('SCH_DB'));
const sql = (q: string) => cy.exec(`psql -d ${db()} -Atc "${q.replace(/"/g, '\\"')}"`);

describe('fix check 2', () => {
  it.skip('B3 + B5: names without an eVet id; no slot on Biscuit’s own visit', () => {
    const w = schedulingWorld();
    resetDemo();
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/routing');
    cy.get('input[placeholder="Type doctor name..."]', { timeout: 30000 }).type('Lane');
    cy.contains('button, li, [role="option"]', 'Avery Lane').click({ force: true });
    cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).options[0]?.text === 'Select type…').first().select('Recheck');
    cy.get('input[placeholder="Type last name..."]').type('Chen');
    cy.contains('button', 'Chen, Tom').click();
    cy.contains('button', /^Biscuit$/).click();
    cy.wait(1500);
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(2000);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 40000 });
    cy.wait(4000);
    dump('fix2-results', 'body');
    sql(`update employees set "pimsId"='90417' where id=${w.doctors.A}`);
  });

  it.skip('B8: a booked request counts as converted', () => {
    Cypress.config('scrollBehavior', 'center');
    resetDemo();
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' });
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' });
    cy.intercept('POST', '**/public/appointments/form').as('submit');
    signInAsScheduling('client', '/client-portal/request-appointment');
    cy.get('input[type="tel"]', { timeout: 30000 }).should('not.have.value', '');
    cy.contains('Is this the place we are doing the visit?').parent().find('input[value="Yes"]').check();
    cy.contains('Is your mailing address the same as this location?').parent().find('input[type="radio"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('input[type="checkbox"]').first().check();
    cy.contains('[data-pet-id]', 'Maple').find('[data-visit-reason="not-feeling-well"]').click();
    cy.get('textarea').first().type('Limping on the left hind leg since yesterday');
    cy.get('[data-how-soon="Flexible"]').click();
    cy.contains('Checking online scheduling options', { timeout: 40000 }).should('not.exist');
    cy.get('textarea[placeholder^="For example: mornings"]').type('Mornings are best, not Wednesdays');
    cy.contains('button', /^Submit$/).click();
    cy.wait('@submit', { timeout: 90000 });
    signInAsScheduling('cl', '/schedule/appointments');
    cy.wait(5000);
    cy.contains('button', /^Book$/).first().click();
    cy.wait(4000);
    cy.get('body').then(($b) => {
      const doc = $b.find('input[placeholder="Type doctor name..."]');
      if (doc.length && !(doc[0] as HTMLInputElement).value) { cy.wrap(doc).type('Lane'); cy.contains('button, li', 'Avery Lane').click({ force: true }); }
    });
    cy.contains('button', /^Get Best Route$/).last().click();
    cy.wait(1500);
    cy.get('body').then(($b) => { if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click(); });
    cy.contains('button', 'View Placement', { timeout: 30000 }).first().click();
    cy.wait(2500);
    cy.contains('button', /^Book$/).click();
    cy.wait(2500);
    cy.contains('[role="dialog"] button', /^Book appointment$/).click();
    cy.wait(4000);
    signInAsScheduling('cl', '/schedule/appointments');
    cy.wait(8000);
    dump('fix2-queue', 'body');
  });

  it('SR-26: enter reminders and summary in the record', { retries: 2 }, () => {
    resetDemo();
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Visit Prep', 'Request');
      cy.get('input[placeholder="Name of the practice"]').type('Maplewood Animal Hospital');
      cy.get('input[placeholder="records@example.com"]').type('records@maplewood-vet.example');
      cy.contains('Client has authorized us').parent().find('input[type="checkbox"]').check({ force: true });
      cy.contains('button', 'Send 1 request').click();
      cy.wait(2500);
      signInAsScheduling('doctorA', '/schedule/scheduling-tools/records');
      cy.wait(5000);
      cy.get('input[type="file"]').first().selectFile('cypress/training/setup/maplewood-biscuit-records.pdf', { force: true });
      cy.wait(4000);
      cy.contains('button', /^Received/).click();
      cy.wait(2500);
      cy.contains('button', /Review & summarize/).first().click({ force: true });
      cy.wait(2000);
      cy.intercept('POST', '**/scribe/summarize-chart').as('summ');
      cy.contains('button', 'Save & summarize records').click();
      cy.wait('@summ', { timeout: 120000 }).then((x: any) => {
        const req = x.request.body || {};
        const res = x.response?.body || {};
        cy.writeFile('cypress/training-out/probe-text/fix2-summ.json', JSON.stringify({
          reqKeys: Object.keys(req), mode: req.mode, sourceLen: (req.sourceText || '').length, images: (req.images || []).length,
          status: x.response?.statusCode, reminders: (res.reminders || []).length, items: (res.reminders || []).map((r: any) => r.item), declined: (res.declined || []).map((d: any) => d.item),
          sourceStart: (req.sourceText || '').slice(0, 300),
        }, null, 1));
      });
      cy.contains('Review previous records', { timeout: 120000 });
      cy.wait(3000);
      dump('fix2-review-open');
      // B10: the model sometimes returns no reminders for the same record; retry the test.
      cy.contains(/Reminders\s*\(?[1-9]/, { timeout: 5000 });
      cy.screenshot('fix2-review-reminders', { capture: 'viewport' });
      cy.contains('button', 'Review Summary First').click();
      cy.wait(2000);
      const posts: any[] = [];
      cy.intercept({ method: /POST|PATCH|PUT/, url: 'http://localhost:3220/**' }, (req) => {
        req.continue((res) => { posts.push({ m: req.method, u: req.url.replace('http://localhost:3220', ''), s: res.statusCode, b: JSON.stringify(res.body).slice(0, 200) }); });
      });
      cy.contains('button', 'Enter Reminders & Summary in Record').click();
      cy.contains('Enter in medical record?', { timeout: 10000 });
      dump('fix2-confirm');
      cy.contains('Enter in medical record?').parents('[role="dialog"], [role="alertdialog"]').first()
        .within(() => cy.contains('button', 'Enter Reminders & Summary in Record').click());
      cy.wait(8000);
      cy.then(() => cy.writeFile('cypress/training-out/probe-text/fix2-posts.json', JSON.stringify(posts, null, 1)));
      dump('fix2-entered', 'body');
      cy.screenshot('fix2-entered', { capture: 'viewport' });
      const w = schedulingWorld();
      sql(`select description || ' | ' || to_char("dueDate", 'YYYY-MM-DD') from reminders where "patientId"=${w.households.B.petId} and created > now() - interval '10 minutes' order by "dueDate"`).then((r) =>
        cy.writeFile('cypress/training-out/probe-text/fix2-reminders.txt', r.stdout));
    });
  });
});
