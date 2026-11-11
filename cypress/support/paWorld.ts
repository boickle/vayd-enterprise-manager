/// <reference types="cypress" />
/**
 * The seeded platform auth world (H-PA) for the cypress/e2e/platform-auth-*.cy.ts specs (cases PA-01-6, PA-02-8,
 * PA-06-4 and PA-08-3). Seeded by vayd-api's test/scripts/pa-e2e-seed.ts into a database whose name contains "test":
 *   cy.task('seedPaWorld')  (cypress.config.ts runs the seed against PA_DB, or CYPRESS_PA_DB)
 * or by hand:
 *   npx ts-node -T test/scripts/pa-e2e-seed.ts seed vayd_api_test_pa_e2e /tmp/pa-world.json
 *   CYPRESS_PA_WORLD="$(cat /tmp/pa-world.json)" npx cypress run --spec "cypress/e2e/platform-auth-*.cy.ts"
 * The API the dev server talks to must use the same database. PA_API_DIR overrides the API checkout (default ../vayd-api).
 */
export type PaClient = {
  clientId: number;
  /** An example.com address with no portal login. */
  email: string;
  activePetId: number;
  activePetName: string;
  /** Passed away (inactive, no reason). Must not appear in any email or portal list that names only current pets. */
  inactivePetId: number;
  inactivePetName: string;
};

export type PaStaff = {
  userId: number;
  employeeId: number;
  email: string;
  /** Signs in on /login with this password. */
  password: string;
};

export type PaTempStaff = {
  userId: number;
  employeeId: number;
  email: string;
  /** Signs in with this temporary password; the app must then open the reset screen. */
  tempPassword: string;
  requiresPasswordReset: true;
};

export type PaWorld = {
  tag: string;
  practiceId: number;
  database: string;
  client: PaClient;
  /** Practice manager (admin login). */
  staff: PaStaff;
  /** Client liaison login with requiresPasswordReset set (PA-02-8). */
  tempStaff: PaTempStaff;
};

export function paWorld(): PaWorld {
  const raw = Cypress.env('PA_WORLD') as string | PaWorld | undefined;
  if (!raw) throw new Error('Set CYPRESS_PA_WORLD to the JSON from pa-e2e-seed.ts (or run cy.task("seedPaWorld") first)');
  return typeof raw === 'string' ? (JSON.parse(raw) as PaWorld) : raw;
}

/** Seeds the world through the cypress.config.ts task and stores it where paWorld() reads it. */
export function seedPaWorld(): Cypress.Chainable<PaWorld> {
  return cy.task<PaWorld>('seedPaWorld', null, { timeout: 120000 }).then((w) => {
    Cypress.env('PA_WORLD', w);
    return w;
  });
}

export function cleanPaWorld() {
  return cy.task('cleanPaWorld', null, { timeout: 120000 });
}

/**
 * True when a captured email was meant for `address`. Outside production the API re-addresses every email to
 * EMAIL_REDIRECT and adds "In production this would have gone to: …" (vayd-api nonprod-recipient.util.ts),
 * so the intended recipient is read from that line when the To: is the redirect inbox.
 */
export function emailMeantFor(
  mail: { to?: string | string[]; html?: string; text?: string },
  address: string,
): boolean {
  const want = address.toLowerCase();
  if ([mail.to ?? []].flat().some((a) => String(a).toLowerCase() === want)) return true;
  const m = /would have gone to:\s*([^<\n]+)/i.exec(`${mail.text ?? ''}\n${mail.html ?? ''}`);
  return !!m && m[1].split(',').some((a) => a.trim().toLowerCase() === want);
}
