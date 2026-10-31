import { defineConfig } from 'cypress';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { createRequire } from 'module';

export default defineConfig({
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
        cleanRoomLoader() {
          runSeed(['clean', rlDb]);
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
