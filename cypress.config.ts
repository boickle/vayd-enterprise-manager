import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:5173',
    setupNodeEvents(on, config) {
      // Load environment variables from cypress.env.json or process.env
      // Priority: process.env > cypress.env.json
      
      // You can also load from other sources here if needed
      // For example, from a secrets manager or encrypted file
      
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
