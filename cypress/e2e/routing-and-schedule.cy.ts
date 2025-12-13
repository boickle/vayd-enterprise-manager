// cypress/e2e/routing-and-schedule.cy.ts

describe('Routing and Schedule Loader', () => {
  beforeEach(() => {
    cy.clearAllCookies();
    cy.clearAllSessionStorage();
  });

  describe('Routing Page', () => {
    it('should load routing results for Deirdre Frey and Eric Oickle with one month date range', () => {
      // Login as employee
      cy.loginAs('employee');

      // Navigate to routing page
      cy.visit('/routing');
      cy.url().should('include', '/routing');

      // Wait for page to load
      cy.contains('Get Best Route', { timeout: 10000 }).should('be.visible');

      // Calculate dates one month in the future
      const today = new Date();
      const oneMonthLater = new Date(today);
      oneMonthLater.setMonth(today.getMonth() + 1);
      const startDate = today.toISOString().split('T')[0];
      const endDate = oneMonthLater.toISOString().split('T')[0];

      // Select doctor: Deirdre Frey
      cy.get('input[placeholder*="Type doctor name"]')
        .should('be.visible')
        .clear()
        .type('Deirdre Frey');

      // Wait for dropdown and select doctor
      cy.contains('button', 'Deirdre Frey', { timeout: 5000 })
        .should('be.visible')
        .click({ force: true });

      // Set start date - first date input
      cy.get('input[type="date"]').first()
        .should('be.visible')
        .clear()
        .type(startDate);

      // Set end date - second date input
      cy.get('input[type="date"]').last()
        .should('be.visible')
        .clear()
        .type(endDate);

      // Search for client: Eric Oickle
      cy.get('input[placeholder*="Type last name"]')
        .should('be.visible')
        .clear()
        .type('Oickle');

      // Wait for dropdown and select client (look for "Oickle" in the dropdown button)
      cy.contains('button', 'Oickle', { timeout: 5000 })
        .should('be.visible')
        .click({ force: true });

      // Set service minutes - first number input
      cy.get('input[type="number"]').first()
        .should('be.visible')
        .clear()
        .type('45');

      // Wait a moment for address to populate from client selection
      cy.wait(1000);

      // Submit the form
      cy.contains('button', /get best route|calculating/i, { timeout: 5000 })
        .should('be.visible')
        .should('not.be.disabled')
        .click();

      // Wait for results to load
      cy.wait(2000);

      // Verify results section appears
      cy.contains('Results', { timeout: 15000 }).should('be.visible');

      // Verify we have some results (either winner/alternates or "no results found")
      cy.get('body').should('satisfy', ($body) => {
        const bodyText = $body.text();
        // Check if results are displayed (either options or "no results found" message)
        return (
          bodyText.includes('Results') &&
          (bodyText.includes('no results found') ||
            $body.find('[class*="card"], article, div').filter((_, el) => {
              const text = Cypress.$(el).text();
              return text.includes('Insertion') || text.includes('Added Drive') || text.includes('Start Time');
            }).length > 0)
        );
      });
    });
  });

  describe('Schedule Loader (FillDay)', () => {
    it('should load schedule loader results for Deirdre Frey', () => {
      // Login as employee
      cy.loginAs('employee');

      // Navigate to schedule-loader page
      cy.visit('/schedule-loader');
      cy.url().should('include', '/schedule-loader');

      // Wait for page to load
      cy.contains('Schedule Loader', { timeout: 10000 }).should('be.visible');

      // Select doctor: Deirdre Frey
      cy.get('input[placeholder*="Search for doctor"]')
        .should('be.visible')
        .clear()
        .type('Deirdre Frey');

      // Wait for dropdown and select doctor (button in dropdown)
      cy.contains('button', 'Deirdre Frey', { timeout: 5000 })
        .should('be.visible')
        .click({ force: true });

      // Verify doctor is selected
      cy.contains('Selected:', { timeout: 3000 }).should('be.visible');
      cy.contains('Deirdre Frey').should('be.visible');

      // Set target date (use today's date)
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      cy.get('input[type="date"]')
        .should('be.visible')
        .clear()
        .type(dateStr);

      // Click "Find Candidates" button
      cy.contains('button', /find candidates/i, { timeout: 5000 })
        .should('be.visible')
        .should('not.be.disabled')
        .click();

      // Wait for results to load
      cy.wait(2000);

      // Verify results section appears - either stats or candidates list
      cy.get('body', { timeout: 15000 }).should('satisfy', ($body) => {
        const bodyText = $body.text();
        // Check if we have stats or candidates or "No candidates found" message
        return (
          bodyText.includes('Holes Found') ||
          bodyText.includes('Candidates Evaluated') ||
          bodyText.includes('Shortlist Size') ||
          bodyText.includes('Final Results') ||
          bodyText.includes('No candidates found') ||
          bodyText.includes('Proposed Time') ||
          bodyText.includes('Arrival Window')
        );
      });
    });
  });
});

