/// <reference types="cypress" />
/** OSV-07/08/09/10 probe: take orders through the stages and record each screen's labels. */
import '../../support/e2e';
import { labels, recordFails, shot, signIn } from './osvKit';

const expand = (orderNo: string) => {
  cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type(orderNo.replace('#', ''));
  cy.wait(2500);
  cy.contains(orderNo).first().click({ force: true });
  cy.wait(3000);
};
const selectIn = (labelRe: RegExp, optionRe: RegExp) =>
  cy.get('body').then(($b) => {
    const sel = [...$b.find('select:visible')].find((s) => labelRe.test(s.closest('label')?.innerText || ''));
    if (!sel) return;
    const opt = [...(sel as HTMLSelectElement).options].find((o) => optionRe.test(o.text));
    if (opt) cy.wrap(sel).select(opt.value);
  });
const clickBtn = (re: RegExp) =>
  cy.get('body').then(($b) => {
    const b = [...$b.find('button:visible')].find((el) => re.test((el as HTMLElement).innerText.trim()) && !(el as HTMLButtonElement).disabled);
    if (b) cy.wrap(b).scrollIntoView().click();
    else cy.log(`no enabled ${re}`);
  });

describe('OSV stages', () => {
  it.skip('Riley fills #272', () => {
    const save = recordFails();
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#272');
    selectIn(/Filling from office/, /Raleigh/);
    selectIn(/^Location/, /Main/);
    cy.wait(1000);
    shot('s-01-272-ready-to-fill');
    labels('s-01-272-ready-to-fill');
    cy.intercept('POST', '**/mail-orders/*/pharmacy*').as('pharmacy');
    cy.contains('button', /^Mark filled$/).scrollIntoView().click();
    cy.wait('@pharmacy', { timeout: 20000 }).then((x) => cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/s-02-pharmacy.json`, { status: x.response?.statusCode, body: x.response?.body }));
    cy.wait(2000);
    shot('s-02-272-after-mark-filled');
    labels('s-02-272-after-mark-filled');
    save('s-02');
  });

  it.skip('Robin checks #272, then ship', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#272');
    shot('s-03-272-check');
    labels('s-03-272-check');
  });

  it.skip('Robin sends #275 to Dr. Lane; Dr. Lane opens the task', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#275');
    selectIn(/^Doctor/, /Avery Lane/);
    cy.wait(1500);
    labels('s-07-275-doctor-chosen');
    clickBtn(/^Send task$/);
    cy.wait(3000);
    shot('s-08-275-task-sent');
    labels('s-08-275-task-sent');
    signIn('doctorA', '/schedule/tasks');
    cy.wait(6000);
    shot('s-09-doctor-tasks');
    labels('s-09-doctor-tasks');
    cy.get('body').then(($b) => {
      const t = [...$b.find('*')].find((el) => el.children.length === 0 && /Thyroid|mail order/i.test(el.textContent || ''));
      if (t) {
        cy.wrap(t).click({ force: true });
        cy.wait(4000);
        shot('s-10-doctor-task-open');
        labels('s-10-doctor-task-open');
      }
    });
  });

  it.skip('Robin opens Reject + refund on #273 (dialog only)', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#273');
    clickBtn(/^Reject \+ refund \+ email$/);
    cy.wait(2000);
    shot('s-11-273-reject-refund-dialog');
    labels('s-11-273-reject-refund-dialog');
  });

  it.skip('Riley labels #272 and sends it to check', () => {
    const save = recordFails();
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#272');
    cy.contains('label', 'Package weight (oz)').find('input').clear().type('12');
    cy.intercept('POST', '**/mail-orders/**').as('mailPost');
    cy.contains('button', /^Get cheapest rates$/).click();
    cy.wait(6000);
    shot('s-12-rates');
    labels('s-12-rates');
    cy.contains('button', /^Print cheapest label$/).click();
    cy.wait(8000);
    shot('s-13-label');
    labels('s-13-label');
    cy.get('body').then(($b) => {
      const b = [...$b.find('button:visible')].find((el) => /^Ready for check$/.test((el as HTMLElement).innerText.trim()) && !(el as HTMLButtonElement).disabled);
      if (b) {
        cy.wrap(b).click();
        cy.wait(3000);
        shot('s-14-ready-for-check');
        labels('s-14-ready-for-check');
      }
    });
    save('s-12');
  });

  it.skip('Riley sees her own fill at check', () => {
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#272');
    cy.contains('button', /^I checked Maple$/).scrollIntoView();
    shot('s-16-riley-own-check');
    labels('s-16-riley-own-check');
  });

  it.skip('Robin checks #272', () => {
    const save = recordFails();
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#272');
    cy.contains('button', /^I checked Maple$/).scrollIntoView().click();
    cy.wait(3000);
    shot('s-17-robin-checked');
    labels('s-17-robin-checked');
    save('s-17');
  });

  it('OSV-07: Robin sends #275 to Dr. Lane', () => {
    const save = recordFails();
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#275');
    cy.contains('label', /^Send to/).find('select').then(($sel) => {
      const opts = [...($sel[0] as HTMLSelectElement).options].map((o) => ({ v: o.value, t: o.text }));
      cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/s-20-sendto-options.json`, opts);
      const lane = opts.find((o) => /Lane/.test(o.t) && o.v);
      if (lane) cy.wrap($sel).select(lane.v);
    });
    cy.wait(1500);
    shot('s-20-275-doctor');
    labels('s-20-275-doctor');
    cy.intercept('POST', '**/mail-orders/**').as('sendTask');
    cy.contains('button', /^Send task$/).should('not.be.disabled').click();
    cy.wait('@sendTask', { timeout: 20000 }).then((x) => cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/s-21-reply.json`, { url: x.request.url, status: x.response?.statusCode }));
    cy.wait(2500);
    shot('s-21-send-task');
    labels('s-21-send-task');
    save('s-20');
  });

  it.skip('OSV-10: Robin opens Reject + refund + email on #273', () => {
    signIn('manager', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    expand('#273');
    cy.contains('button', /^Reject \+ refund \+ email$/).scrollIntoView().click();
    cy.wait(2000);
    shot('s-22-reject-refund');
    labels('s-22-reject-refund');
  });

  it('OSV-07: Dr. Lane opens the approval task', () => {
    const save = recordFails();
    signIn('doctorA', '/schedule/tasks');
    cy.wait(6000);
    shot('s-23-lane-tasks');
    labels('s-23-lane-tasks');
    cy.contains(/Thyroid|Mail order|mail order/).first().click({ force: true });
    cy.wait(4000);
    shot('s-24-lane-task-open');
    labels('s-24-lane-task-open');
    save('s-24');
  });
});
