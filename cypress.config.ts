import { defineConfig } from 'cypress';
import * as fs from 'fs';
import * as path from 'path';

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
