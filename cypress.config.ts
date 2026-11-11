import { defineConfig } from 'cypress';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { createRequire } from 'module';
import { createHmac } from 'crypto';

export default defineConfig({
  chromeWebSecurity: false, // RL-03-13/14 type into the cross-origin Stripe card iframe (test mode)
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:5173',
    setupNodeEvents(on, config) {
      // ── H3: email capture ─────────────────────────────────────────────────
      // When CYPRESS_EMAIL_CAPTURE_PATH is set the backend appends one JSON
      // line per outgoing email to that file (configured in your .env).
      // cy.capturedEmails() reads it; cy.clearCapturedEmails() truncates it.
      const emailFile: string | undefined =
        (config.env as Record<string, unknown>)['EMAIL_CAPTURE_PATH'] as string | undefined ??
        process.env.CYPRESS_EMAIL_CAPTURE_PATH;

      if (emailFile) {
        config.env = { ...config.env, EMAIL_CAPTURE_PATH: emailFile };
        // Ensure the file exists so cy.readFile never 404s.
        const abs = path.isAbsolute(emailFile)
          ? emailFile
          : path.join(process.cwd(), emailFile);
        if (!fs.existsSync(abs)) fs.writeFileSync(abs, '');
        on('task', {
          clearEmailCapture() {
            fs.writeFileSync(abs, '');
            return null;
          },
        });
      }

      // ── H-RL: room-loader seeding ─────────────────────────────────────────
      // Runs vayd-api's test/scripts/room-loader-e2e-seed.ts against a LOCAL database (default
      // vayd_api_test; the API the dev server talks to must use the same one). Override with
      // ROOM_LOADER_API_DIR / ROOM_LOADER_DB.
      const apiDir = path.resolve(process.env.ROOM_LOADER_API_DIR || '../vayd-api');
      const rlDb = process.env.ROOM_LOADER_DB || 'vayd_api_test';
      // The starter Room Loader settings document (frontend ESM) as JSON for the API seed script.
      let seedDocPath: string | null = null;
      const starterSettingsDoc = () => {
        if (seedDocPath) return seedDocPath;
        const bundle = path.join(os.tmpdir(), `rl-seed-doc-${process.pid}.cjs`);
        execFileSync(
          'npx',
          ['esbuild', 'src/utils/roomLoaderConfigSeed.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${bundle}`, '--log-level=error'],
          { cwd: process.cwd(), stdio: ['ignore', 'inherit', 'inherit'] },
        );
        const doc = createRequire(import.meta.url)(bundle).vaydRoomLoaderConfigSeed();
        seedDocPath = path.join(os.tmpdir(), `rl-seed-doc-${process.pid}.json`);
        fs.writeFileSync(seedDocPath, JSON.stringify(doc));
        return seedDocPath;
      };
      const runSeed = (args: string[]) =>
        execFileSync('npx', ['ts-node', '-T', 'test/scripts/room-loader-e2e-seed.ts', ...args], {
          cwd: apiDir,
          env: {
            ...process.env,
            NODE_ENV: 'test',
            NODE_OPTIONS: '--no-experimental-strip-types',
            ...(args[0] === 'seed' ? { ROOM_LOADER_SEED_DOC: starterSettingsDoc() } : {}),
          },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      on('task', {
        /** Seeds a sent room loader; returns { loaderId, token, petName, path } (path is the public form route). */
        seedRoomLoader(options?: { scenario?: Record<string, unknown> } | null) {
          const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const out = path.join(os.tmpdir(), `rl-seed-${stamp}.json`);
          const scn = path.join(os.tmpdir(), `rl-scenario-${stamp}.json`);
          fs.writeFileSync(scn, JSON.stringify({ scenario: options?.scenario ?? {} }));
          try {
            runSeed(['seed', rlDb, out, scn]);
          } finally {
            fs.unlinkSync(scn);
          }
          const seeded = JSON.parse(fs.readFileSync(out, 'utf8'));
          fs.unlinkSync(out);
          return seeded;
        },
        /** Staff change the labs answer and resend: updates what the sent loader carries. */
        resendRoomLoader({ loaderId, labs }: { loaderId: number; labs: 'yes' | 'no' }) {
          runSeed(['resend', rlDb, String(loaderId), labs]);
          return null;
        },
        /** Wellness plans on the seeded pets with their multi-pet credit amount (RL-03-14). */
        roomLoaderPlans() {
          const out = path.join(os.tmpdir(), `rl-credits-${Date.now()}.json`);
          runSeed(['credits', rlDb, out]);
          const rows = JSON.parse(fs.readFileSync(out, 'utf8'));
          fs.unlinkSync(out);
          return rows;
        },
        cleanRoomLoader() {
          runSeed(['clean', rlDb]);
          return null;
        },
      });

      // ── H-EMR: euthanasia / visit-payment world ────────────────────────────
      // Runs vayd-api's test/scripts/emr-e2e-seed.ts. The database is REQUIRED (EMR_DB or CYPRESS_EMR_DB), its name
      // must contain "test" and not be vayd_api_local (the script refuses otherwise), and the API the dev server
      // talks to must use the same one. EMR_API_DIR overrides the API checkout (default ../vayd-api).
      const emrApiDir = path.resolve(process.env.EMR_API_DIR || '../vayd-api');
      const emrDb = process.env.EMR_DB || process.env.CYPRESS_EMR_DB || '';
      const emrWorldFile = path.join(os.tmpdir(), 'emr-world-current.json');
      const runEmrSeed = (command: 'seed' | 'clean') => {
        if (!emrDb) throw new Error('Set EMR_DB to a test database (e.g. vayd_api_test) before using the EMR seed.');
        execFileSync('npx', ['ts-node', '-T', 'test/scripts/emr-e2e-seed.ts', command, emrDb, emrWorldFile], {
          cwd: emrApiDir,
          env: { ...process.env, DB_DATABASE: emrDb, NODE_ENV: 'test', NODE_OPTIONS: '--no-experimental-strip-types' },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      };
      on('task', {
        /** Seeds the EMR world (see cypress/support/emrWorld.ts for its shape) and returns it. */
        seedEmrWorld() {
          runEmrSeed('seed');
          return JSON.parse(fs.readFileSync(emrWorldFile, 'utf8'));
        },
        cleanEmrWorld() {
          if (fs.existsSync(emrWorldFile)) {
            runEmrSeed('clean');
            fs.unlinkSync(emrWorldFile);
          }
          return null;
        },
        /**
         * EMR-04-6 / EMR-05-6: post a signed payment_intent.succeeded to the dev API, the way Stripe would after a
         * Checkout pay link is paid (local dev gets no real webhooks). Signed with the API's own
         * STRIPE_WEBHOOK_SECRET (env, else the API checkout's .env). Only with an EMR test database set.
         */
        async emrStripeWebhook(input: {
          apiUrl: string;
          paymentIntentId: string;
          amountCents: number;
          metadata: Record<string, string>;
        }) {
          if (!emrDb || !/test/i.test(emrDb) || /vayd_api_local|prod/i.test(emrDb)) {
            throw new Error('Set EMR_DB to a test database before simulating Stripe webhooks.');
          }
          let secret = process.env.STRIPE_WEBHOOK_SECRET || '';
          const envFile = path.join(emrApiDir, '.env');
          if (!secret && fs.existsSync(envFile)) {
            const line = fs
              .readFileSync(envFile, 'utf8')
              .split('\n')
              .find((l) => /^\s*STRIPE_WEBHOOK_SECRET\s*=/.test(l));
            secret = (line?.split('=').slice(1).join('=') ?? '').trim().replace(/^['"]|['"]$/g, '');
          }
          if (!secret) throw new Error('No STRIPE_WEBHOOK_SECRET for the dev API.');
          const created = Math.floor(Date.now() / 1000);
          const event = {
            id: `evt_emr_cy_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
            object: 'event',
            api_version: '2024-06-20',
            created,
            livemode: false,
            type: 'payment_intent.succeeded',
            data: {
              object: {
                id: input.paymentIntentId,
                object: 'payment_intent',
                amount: input.amountCents,
                amount_received: input.amountCents,
                currency: 'usd',
                status: 'succeeded',
                metadata: input.metadata,
              },
            },
          };
          const body = JSON.stringify(event);
          const v1 = createHmac('sha256', secret).update(`${created}.${body}`, 'utf8').digest('hex');
          const res = await fetch(`${input.apiUrl.replace(/\/+$/, '')}/stripe/webhooks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${created},v1=${v1}` },
            body,
          });
          return { status: res.status, body: await res.text() };
        },
      });

      // ── H-LAB: Labs world ──────────────────────────────────────────────────
      // Runs vayd-api's test/scripts/labs-e2e-seed.ts (in-house lab forms, IDEXX-coded labs, two-pet household, Staff
      // client, PLUS pet, eVet lab history, staff logins per role). The database is LABS_DB / CYPRESS_LABS_DB
      // (default vayd_api_test_e2e); its name must contain "test" (the script refuses otherwise) and the API the dev
      // server talks to must use the same one. LABS_API_DIR overrides the API checkout (default ../vayd-api).
      const labsApiDir = path.resolve(process.env.LABS_API_DIR || '../vayd-api');
      const labsDb = process.env.LABS_DB || process.env.CYPRESS_LABS_DB || 'vayd_api_test_e2e';
      const labsWorldFile = path.join(os.tmpdir(), 'labs-world-current.json');
      const runLabsSeed = (command: 'seed' | 'clean') =>
        execFileSync('npx', ['ts-node', '-T', 'test/scripts/labs-e2e-seed.ts', command, labsDb, labsWorldFile], {
          cwd: labsApiDir,
          env: { ...process.env, DB_DATABASE: labsDb, NODE_ENV: 'test', NODE_OPTIONS: '--no-experimental-strip-types' },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      on('task', {
        /** Seeds the Labs world (shape: cypress/support/labsWorld.ts) and returns it. */
        seedLabsWorld() {
          runLabsSeed('seed');
          return JSON.parse(fs.readFileSync(labsWorldFile, 'utf8'));
        },
        cleanLabsWorld() {
          if (fs.existsSync(labsWorldFile)) {
            runLabsSeed('clean');
            fs.unlinkSync(labsWorldFile);
          }
          return null;
        },
      });

      // ── H-STORE: Online Store world ─────────────────────────────────────────
      // Runs vayd-api's test/scripts/store-e2e-seed.ts: a listed store item and Rx item, a tag-along rebate, two
      // portal clients with household Stripe customer ids, an auto-ship, an open eVet invoice, an Rx with refills,
      // a gift card and a ready-to-fill order. The database is REQUIRED (STORE_DB or CYPRESS_STORE_DB); its name
      // must contain "test" and not be vayd_api_local (the script refuses otherwise), and the API the dev server
      // talks to must use the same one. STORE_API_DIR overrides the API checkout (default ../vayd-api).
      const storeApiDir = path.resolve(process.env.STORE_API_DIR || '../vayd-api');
      const storeDb = process.env.STORE_DB || process.env.CYPRESS_STORE_DB || '';
      const storeWorldFile = path.join(os.tmpdir(), 'store-world-current.json');
      const runStoreSeed = (command: 'seed' | 'clean') => {
        if (!storeDb) throw new Error('Set STORE_DB to a test database (e.g. vayd_api_test_os_a) before using the store seed.');
        execFileSync('npx', ['ts-node', '-T', 'test/scripts/store-e2e-seed.ts', command, storeDb, storeWorldFile], {
          cwd: storeApiDir,
          env: { ...process.env, DB_DATABASE: storeDb, NODE_ENV: 'test', NODE_OPTIONS: '--no-experimental-strip-types' },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      };
      on('task', {
        /** Seeds the Online Store world (shape: see the world JSON written by store-e2e-seed.ts) and returns it. */
        seedStoreWorld() {
          runStoreSeed('seed');
          return JSON.parse(fs.readFileSync(storeWorldFile, 'utf8'));
        },
        cleanStoreWorld() {
          if (fs.existsSync(storeWorldFile)) {
            runStoreSeed('clean');
            fs.unlinkSync(storeWorldFile);
          }
          return null;
        },
      });

      // ── H-PA: platform auth world ──────────────────────────────────────────
      // Runs vayd-api's test/scripts/pa-e2e-seed.ts: a client with an example.com email and no login (one active pet,
      // one passed away), a practice manager login with a password, and a login with a temporary password. The
      // database is REQUIRED (PA_DB or CYPRESS_PA_DB); its name must contain "test" and not be vayd_api_local (the
      // script refuses otherwise), and the API the dev server talks to must use the same one. PA_API_DIR overrides the
      // API checkout (default ../vayd-api).
      const paApiDir = path.resolve(process.env.PA_API_DIR || '../vayd-api');
      const paDb = process.env.PA_DB || process.env.CYPRESS_PA_DB || '';
      const paWorldFile = path.join(os.tmpdir(), 'pa-world-current.json');
      const runPaSeed = (command: 'seed' | 'clean') => {
        if (!paDb) throw new Error('Set PA_DB to a test database (e.g. vayd_api_test_pa_e2e) before using the PA seed.');
        execFileSync('npx', ['ts-node', '-T', 'test/scripts/pa-e2e-seed.ts', command, paDb, paWorldFile], {
          cwd: paApiDir,
          env: { ...process.env, DB_DATABASE: paDb, NODE_ENV: 'test', NODE_OPTIONS: '--no-experimental-strip-types' },
          stdio: ['ignore', 'inherit', 'inherit'],
        });
      };
      on('task', {
        /** Seeds the platform auth world (shape: cypress/support/paWorld.ts) and returns it. */
        seedPaWorld() {
          runPaSeed('seed');
          return JSON.parse(fs.readFileSync(paWorldFile, 'utf8'));
        },
        cleanPaWorld() {
          if (fs.existsSync(paWorldFile)) {
            runPaSeed('clean');
            fs.unlinkSync(paWorldFile);
          }
          return null;
        },
      });

      return config;
    },
    viewportWidth: 1280,
    viewportHeight: 720,
    video: true,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    requestTimeout: 10000,
    responseTimeout: 10000,
    env: {
      // These can be overridden by cypress.env.json or process.env
      // Use process.env.CYPRESS_CLIENT_EMAIL or set in cypress.env.json
      CLIENT_EMAIL: process.env.CYPRESS_CLIENT_EMAIL || '',
      CLIENT_PASSWORD: process.env.CYPRESS_CLIENT_PASSWORD || '',
      EMPLOYEE_EMAIL: process.env.CYPRESS_EMPLOYEE_EMAIL || '',
      EMPLOYEE_PASSWORD: process.env.CYPRESS_EMPLOYEE_PASSWORD || '',
    },
  },
  component: {
    devServer: {
      framework: 'react',
      bundler: 'vite',
    },
  },
});
