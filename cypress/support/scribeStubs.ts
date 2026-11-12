/// <reference types="cypress" />
/**
 * cy.intercept stubs for the AI scribe's LLM-backed endpoints (H-SCR), so Cypress never reaches
 * Anthropic/OpenAI. Fixtures live in cypress/fixtures/scribe/. Every stub returns a handle that
 * records the request bodies the page sent, so a spec can assert on them
 * (e.g. `expect(structure.requests()[0].patients).to.have.length(2)`).
 *
 * Register BEFORE visiting the page (call from beforeEach). Pass `{ reply }` to override the answer,
 * `{ delayMs }` to slow it, or `{ status }` to make it fail.
 *
 *   const structure = stubScribeStructure({ household: true });     // POST /soap-encounters/:id/scribe/structure
 *   const sessions  = stubScribeSessions([{ transcript: 'hello' }]); // GET  /soap-encounters/:id/scribe/sessions
 *   const recap     = stubScribeClientRecap();                       // POST /soap-encounters/:id/scribe/client-recap
 *   const writeup   = stubVisitWriteup({ household: true });         // POST /scribe/visit-writeup
 *
 * Household answers (structure and write-up) carry placeholder patientIds (0) in the fixture; the
 * stub fills them in, in order, from the `patients` roster the page sent, so the replies always
 * match the pets on screen. Pet names come from the roster too.
 *
 * Not stubbed here: the live socket (`/scribe` Socket.io) and `POST .../scribe/recordings`.
 */
import structureSingle from '../fixtures/scribe/structure-single.json';
import structureHousehold from '../fixtures/scribe/structure-household.json';
import sessionsFixture from '../fixtures/scribe/sessions.json';
import clientRecapFixture from '../fixtures/scribe/client-recap.json';
import clientRecapEuthanasia from '../fixtures/scribe/client-recap-euthanasia.json';
import writeupSingle from '../fixtures/scribe/visit-writeup-single.json';
import writeupHousehold from '../fixtures/scribe/visit-writeup-household.json';

type StubOptions<T> = {
  /** Replace the fixture. A function gets the request body. */
  reply?: T | ((body: any) => T);
  delayMs?: number;
  /** Non-2xx makes the call fail with `{ message }`. */
  status?: number;
};

type Handle<B = any> = {
  /** Request bodies received so far, in order. */
  requests: () => B[];
  count: () => number;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function install<B>(
  method: 'GET' | 'POST',
  url: string,
  build: (body: any) => unknown,
  opts: StubOptions<unknown> = {},
): Handle<B> {
  const seen: B[] = [];
  cy.intercept(method, url, (req) => {
    seen.push(req.body as B);
    if (opts.status && opts.status >= 400) {
      req.reply({ statusCode: opts.status, body: { message: 'Stubbed scribe failure' }, delay: opts.delayMs });
      return;
    }
    const body = opts.reply !== undefined
      ? typeof opts.reply === 'function' ? (opts.reply as (b: any) => unknown)(req.body) : opts.reply
      : build(req.body);
    req.reply({ statusCode: 200, body, delay: opts.delayMs });
  });
  return { requests: () => seen, count: () => seen.length };
}

/** POST /soap-encounters/:id/scribe/structure. `household` answers per pet from the request's roster. */
export function stubScribeStructure(
  opts: StubOptions<unknown> & { household?: boolean } = {},
): Handle<{ transcript: string; patients?: { patientId: number; name: string; soapEncounterId: string }[] }> {
  return install('POST', '**/scribe/structure', (body) => {
    const roster: { patientId: number }[] = body?.patients ?? [];
    if (!opts.household && roster.length < 2) return clone(structureSingle);
    const out = clone(structureHousehold) as typeof structureHousehold;
    out.patients = roster.map((p, i) => ({
      ...clone(out.patients[Math.min(i, out.patients.length - 1)]),
      patientId: p.patientId,
    }));
    return out;
  }, opts);
}

/** GET /soap-encounters/:id/scribe/sessions. Pass partial sessions to override fields of the fixture row. */
export function stubScribeSessions(
  sessions: Array<Partial<(typeof sessionsFixture)[number]>> = [{}],
  opts: { delayMs?: number } = {},
): Handle {
  return install('GET', '**/scribe/sessions*', () =>
    sessions.map((s, i) => ({ ...clone(sessionsFixture[0]), id: `00000000-0000-4000-8000-0000000000a${i + 1}`, ...s })),
  opts);
}

/**
 * POST /soap-encounters/:id/scribe/client-recap. `euthanasia: true` answers with the condolence fixture.
 * The request body (`patientIds`, ...) is recorded; the answer does not depend on it.
 */
export function stubScribeClientRecap(
  opts: StubOptions<{ subject: string; body: string }> & { euthanasia?: boolean } = {},
): Handle<{ practiceId?: number; patientIds?: number[] }> {
  return install('POST', '**/scribe/client-recap', () => clone(opts.euthanasia ? clientRecapEuthanasia : clientRecapFixture), opts);
}

/** POST /scribe/visit-writeup (medical-note page). Household answers one note per pet in the request's `patients`. */
export function stubVisitWriteup(
  opts: StubOptions<unknown> & { household?: boolean } = {},
): Handle<{ transcript: string; patients?: { patientId: number; name: string }[] }> {
  return install('POST', '**/scribe/visit-writeup', (body) => {
    const roster: { patientId: number; name: string }[] = body?.patients ?? [];
    if (!opts.household && roster.length < 2) return clone(writeupSingle);
    const out = clone(writeupHousehold) as typeof writeupHousehold;
    out.patients = roster.map((p, i) => ({
      ...clone(out.patients[Math.min(i, out.patients.length - 1)]),
      patientId: p.patientId,
      patientName: p.name,
    }));
    return out;
  }, opts);
}

/** All four with default answers; returns the handles. */
export function stubAllScribeLlm(opts: { household?: boolean } = {}) {
  return {
    structure: stubScribeStructure(opts),
    sessions: stubScribeSessions(),
    recap: stubScribeClientRecap(),
    writeup: stubVisitWriteup(opts),
  };
}
