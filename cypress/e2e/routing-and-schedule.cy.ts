// cypress/e2e/routing-and-schedule.cy.ts

describe('Routing and Schedule Loader', () => {
  beforeEach(() => {
    cy.clearAllCookies();
    cy.clearAllSessionStorage();
  });

  /**
   * Helper function to get the next Monday from a given date (or the same date if it's already a Monday)
   * @param date - Starting date
   * @returns Date object for the next Monday (or same date if already Monday)
   */
  function getNextMonday(date: Date): Date {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    let daysUntilMonday: number;
    if (dayOfWeek === 1) {
      // Already a Monday, use this date
      daysUntilMonday = 0;
    } else if (dayOfWeek === 0) {
      // Sunday, next Monday is tomorrow
      daysUntilMonday = 1;
    } else {
      // Tuesday through Saturday, calculate days until next Monday
      daysUntilMonday = 8 - dayOfWeek;
    }
    const nextMonday = new Date(date);
    nextMonday.setDate(date.getDate() + daysUntilMonday);
    return nextMonday;
  }

  describe('Routing Page', () => {
    it('should load routing results for Abigail Messina and Eric Oickle with one year date range', () => {
      // Login as employee
      cy.loginAs('employee');

      // Navigate to routing page
      cy.visit('/routing');
      cy.url().should('include', '/routing');

      // Wait for page to load
      cy.contains('Get Best Route', { timeout: 10000 }).should('be.visible');

      // Calculate dates - both should be Mondays
      const today = new Date();
      const oneYearLater = new Date(today);
      oneYearLater.setFullYear(today.getFullYear() + 1);
      const startDateMonday = getNextMonday(oneYearLater);
      const endDateMonday = new Date(startDateMonday);
      endDateMonday.setDate(startDateMonday.getDate() + 7); // One week later (also a Monday)
      const startDate = startDateMonday.toISOString().split('T')[0];
      const endDate = endDateMonday.toISOString().split('T')[0];

      // Select doctor: Abigail Messina
      cy.get('input[placeholder*="Type doctor name"]')
        .should('be.visible')
        .scrollIntoView()
        .clear()
        .type('Abigail Messina', { force: true });

      // Wait for dropdown and select doctor
      cy.contains('button', 'Abigail Messina', { timeout: 5000 })
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
        .click({ force: true })
        .clear({ force: true })
        .type('{selectall}45', { force: true });

      // Wait a moment for address to populate from client selection
      cy.wait(1000);

      // Submit the form
      cy.contains('button', /get best route|calculating/i, { timeout: 5000 })
        .should('be.visible')
        .should('not.be.disabled')
        .click();

      // Wait for button to show calculating state (if it does)
      cy.wait(1000);

      // Wait for results to load - give it more time since it might take a while
      cy.wait(5000);

      // Verify results section appears - wait longer and be more flexible
      cy.get('body', { timeout: 30000 }).should('satisfy', ($body) => {
        const bodyText = $body.text();
        // Check if results are displayed (either options or "no results found" message)
        const hasResults = bodyText.includes('Results') || 
                          bodyText.includes('Insertion') || 
                          bodyText.includes('Added Drive') || 
                          bodyText.includes('Start Time') ||
                          bodyText.includes('no results found');
        return hasResults;
      });

      // Additional check - look for specific result indicators
      cy.get('body', { timeout: 5000 }).should('satisfy', ($body) => {
        const bodyText = $body.text();
        // Check if we have actual results (not just "no results found")
        const hasActualResults = $body.find('[class*="card"], article, div').filter((_, el) => {
          const text = Cypress.$(el).text();
          return text.includes('Insertion') || text.includes('Added Drive') || text.includes('Start Time');
        }).length > 0;
        
        // If no results found message exists, that's also valid
        const hasNoResultsMessage = bodyText.includes('no results found');
        
        return hasActualResults || hasNoResultsMessage;
      });
    });
  });

  describe('Schedule Loader (FillDay)', () => {
    it('should load schedule loader results for Abigail Messina', () => {
      // Login as employee
      cy.loginAs('employee');

      // Navigate to schedule-loader page
      cy.visit('/schedule-loader');
      cy.url().should('include', '/schedule-loader');

      // Wait for page to load
      cy.contains('Schedule Loader', { timeout: 10000 }).should('be.visible');

      // Select doctor: Abigail Messina
      cy.get('input[placeholder*="Search for doctor"]')
        .should('be.visible')
        .clear()
        .type('Abigail Messina');

      // Wait for dropdown and select doctor (button in dropdown)
      cy.contains('button', 'Abigail Messina', { timeout: 5000 })
        .should('be.visible')
        .click({ force: true });

      // Verify doctor is selected
      cy.contains('Selected:', { timeout: 3000 }).should('be.visible');
      cy.contains('Abigail Messina').should('be.visible');

      // Set target date - 3 months in the future on a Monday
      const today = new Date();
      const threeMonthsLater = new Date(today);
      threeMonthsLater.setMonth(today.getMonth() + 3);
      const targetMonday = getNextMonday(threeMonthsLater);
      const dateStr = targetMonday.toISOString().split('T')[0];
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

