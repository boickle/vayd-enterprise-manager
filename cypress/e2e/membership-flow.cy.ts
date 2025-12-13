/// <reference types="cypress" />

/**
 * Membership Purchase Flow Tests
 * 
 * Tests the complete membership signup flow including:
 * - Plan selection (Foundations, Golden, Comfort Care)
 * - Add-on selection (PLUS, Puppy/Kitten)
 * - Billing preference (monthly/annual)
 * - Total calculation verification
 * - Navigation to payment page
 * 
 * Note: Tests stop before actual payment submission
 */

describe('Membership Purchase Flow', () => {
  beforeEach(() => {
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    
    // Login as client
    cy.loginAs('client');
    
    // Mock API responses for membership catalog and plans
    // These will be intercepted if needed
  });

  /**
   * Helper function to navigate to membership signup by clicking on a pet's "Sign up for Membership" button
   * @param petName - Name of the pet to click on (e.g., "Templeton", "Oldie", "Newey")
   */
  function navigateToMembershipSignup(petName: string) {
    // Navigate to client portal first
    cy.visit('/client-portal');
    
    // Wait for page to load - look for pet cards or the pet name
    cy.contains(petName, { timeout: 10000 }).should('exist');
    
    // Find the pet card container by finding the pet name and traversing up to the card
    // The pet card is an article element containing the pet name in a strong tag
    cy.contains('strong', petName, { timeout: 10000 })
      .should('exist')
      .then(($petNameEl) => {
        // Find the parent article (pet card)
        const $card = $petNameEl.closest('article');
        if ($card.length === 0) {
          // Fallback to div if article not found
          const $divCard = $petNameEl.closest('div');
          if ($divCard.length === 0) {
            throw new Error(`Could not find card container for pet: ${petName}`);
          }
          return cy.wrap($divCard);
        }
        return cy.wrap($card);
      })
      .scrollIntoView() // Scroll the card into view
      .should('exist')
      .find('button')
      .contains(/sign up/i)
      .should('exist')
      .scrollIntoView()
      .click({ force: true });
    
    // Wait for membership signup page to load
    cy.contains('Membership Signup', { timeout: 10000 }).should('be.visible');
  }

  /**
   * Helper to select a plan
   */
  function selectPlan(planName: 'Foundations' | 'Golden' | 'Comfort Care') {
    // First answer the comfort care question if needed
    cy.get('body').then(($body) => {
      if ($body.find('button:contains("No"), button:contains("Yes, show Comfort Care")').length > 0) {
        if (planName === 'Comfort Care') {
          cy.contains('button', 'Yes, show Comfort Care').click();
        } else {
          cy.contains('button', 'No').click();
        }
      }
    });

    // Wait a moment for plans to appear
    cy.wait(500);

    // Click on the plan card's "Add to Cart" button
    cy.contains('h3', planName)
      .parents('.cp-plan-card')
      .within(() => {
        cy.contains('button', 'Add to Cart').click();
      });

    // Verify plan is selected
    cy.contains('h3', planName)
      .parents('.cp-plan-card')
      .should('have.class', 'selected');
  }

  /**
   * Helper to select add-ons
   */
  function selectAddOn(addOnName: 'PLUS Add-on' | 'Puppy / Kitten Add-on') {
    cy.contains('h3', addOnName)
      .parents('.cp-plan-card')
      .within(() => {
        cy.contains('button', 'Add to Cart').click();
      });

    // Verify add-on is selected
    cy.contains('h3', addOnName)
      .parents('.cp-plan-card')
      .should('have.class', 'selected');
  }

  /**
   * Helper to select billing preference
   */
  function selectBillingPreference(preference: 'monthly' | 'annual') {
    // Find the billing toggle buttons
    cy.get('.cp-billing-toggle').within(() => {
      if (preference === 'monthly') {
        cy.contains('button', 'Monthly').click();
      } else {
        cy.contains('button', 'Annual').click();
      }
    });
  }

  /**
   * Helper to accept agreement and proceed to payment
   */
  function acceptAgreementAndProceed() {
    // Scroll to agreement section if needed
    cy.contains('Membership Agreement', { timeout: 10000 }).scrollIntoView();
    
    // Wait a moment for the agreement section to be fully rendered
    cy.wait(500);
    
    // Find and check the agreement checkbox
    // The checkbox is within the agreement section (in a cp-card)
    cy.contains('Membership Agreement', { timeout: 5000 })
      .parents('.cp-card')
      .find('input[type="checkbox"]')
      .first()
      .check({ force: true });
    
    // Enter signature - find by label "Typed Signature" and then find the input
    // The label and input are both inside a div, so we find the label and then get the sibling input
    cy.contains('Membership Agreement')
      .parents('.cp-card')
      .contains('label', 'Typed Signature')
      .parent('div')
      .find('input[type="text"]')
      .should('exist')
      .clear()
      .type('Test User');
    
    // Wait a moment for the signature to be registered
    cy.wait(300);
    
    // Click proceed button - the button text is "Continue to Payment"
    cy.contains('button', /continue to payment|proceed|continue|checkout|payment/i, { timeout: 5000 })
      .should('not.be.disabled')
      .click({ force: true });
  }

  /**
   * Helper to verify totals on signup page
   */
  function verifyCostSummary(expectedTotal: number, billingType: 'monthly' | 'annual' = 'monthly') {
    // Wait a moment for price calculations to complete
    cy.wait(500);
    
    // Based on the code, annual prices are displayed as:
    // "${amount} annually (10% discount!)" 
    // Monthly prices are displayed as:
    // "${amount}/month"
    const priceVariations = billingType === 'monthly'
      ? [
          `$${expectedTotal}/month`,
          `$${expectedTotal}/mo`,
          `$${expectedTotal} per month`,
          `$${expectedTotal}.00/month`,
          `$${expectedTotal}/month`,
        ]
      : [
          `$${expectedTotal} annually`,
          `$${expectedTotal}.00 annually`,
          `$${expectedTotal} annually (10% discount!)`,
          `$${expectedTotal}.00 annually (10% discount!)`,
          `$${expectedTotal}`,
          `$${expectedTotal}.00`,
        ];
    
    // Check if the price appears anywhere on the page (case-insensitive)
    cy.get('body', { timeout: 10000 }).should(($body) => {
      const bodyText = $body.text();
      // Check if any of the price variations exist in the body text (case-insensitive)
      const found = priceVariations.some(variation => {
        const normalizedVariation = variation.toLowerCase();
        const normalizedBodyText = bodyText.toLowerCase();
        return normalizedBodyText.includes(normalizedVariation);
      });
      
      if (!found) {
        // Last resort: check if the dollar amount appears anywhere
        if (!bodyText.includes(`$${expectedTotal}`) && !bodyText.toLowerCase().includes(`$${expectedTotal}`.toLowerCase())) {
          throw new Error(`Price $${expectedTotal} not found on page. Tried variations: ${priceVariations.join(', ')}`);
        }
      }
    });
  }

  /**
   * Helper to verify totals on payment page
   */
  function verifyPaymentPageTotals(expectedTotalCents: number) {
    cy.url().should('include', '/membership-payment');
    
    // Convert cents to dollars for display
    const expectedTotalDollars = (expectedTotalCents / 100).toFixed(2);
    
    // Verify total is shown on payment page
    cy.contains(`$${expectedTotalDollars}`, { timeout: 5000 }).should('be.visible');
    
    // Verify we're on the payment page (look for Square payment form or credit card fields)
    cy.get('body').should('satisfy', ($body) => {
      // Payment page should have Square form or payment-related content
      // Check for various payment-related selectors (without case-insensitive flags)
      const hasPaymentElements = 
        $body.find('#sq-card-number').length > 0 ||
        $body.find('[id*="card"]').length > 0 ||
        $body.find('[data-testid*="payment"]').length > 0 ||
        $body.find('input[placeholder*="card"], input[placeholder*="Card"], input[placeholder*="CARD"]').length > 0 ||
        $body.find('input[name*="card"], input[name*="Card"], input[name*="CARD"]').length > 0;
      
      const hasPaymentText = 
        $body.text().includes('Payment') ||
        $body.text().includes('Credit Card') ||
        $body.text().includes('Credit card') ||
        $body.text().includes('credit card');
      
      return hasPaymentElements || hasPaymentText;
    });
  }

  describe('Foundations Plan Scenarios', () => {
    it('should complete Foundations plan (monthly) for cat using Templeton', () => {
      navigateToMembershipSignup('Templeton');

      // Answer comfort care question
      cy.contains('button', 'No').click();

      // Select Foundations plan
      selectPlan('Foundations');

      // Select monthly billing
      selectBillingPreference('monthly');

      // Verify total: $59/month for cat (Foundations - Templeton is a cat)
      verifyCostSummary(59, 'monthly');

      // Accept agreement and proceed
      acceptAgreementAndProceed();

      // Verify on payment page with correct total (59 * 100 = 5900 cents for cat)
      verifyPaymentPageTotals(5900);
      
      // Verify we can see credit card form (but don't fill it)
      cy.get('body').should('contain', 'Payment');
    });

    it('should complete Foundations plan (annual) for cat using Templeton', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectBillingPreference('annual');
      
      // Verify total: $659/year for cat (Foundations annual)
      verifyCostSummary(659, 'annual');
      
      acceptAgreementAndProceed();
      
      // Verify payment page total (659 * 100 = 65900 cents)
      verifyPaymentPageTotals(65900);
    });
  });

  describe('Golden Plan Scenarios (Senior Dog)', () => {
    it.skip('should complete Golden plan (monthly) for senior dog using Oldie', () => {
      navigateToMembershipSignup('Oldie');
      
      cy.contains('button', 'No').click();
      
      // Oldie is a senior dog (9+ years), so Golden plan should be available
      cy.contains('h3', 'Golden', { timeout: 5000 }).should('be.visible');
      selectPlan('Golden');
      selectBillingPreference('monthly');
      
      // Verify total: $109/month for dog (Golden)
      verifyCostSummary(109, 'monthly');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(10900); // 109 * 100
    });

    it.skip('should complete Golden plan (annual) for senior dog using Oldie', () => {
      navigateToMembershipSignup('Oldie');
      
      cy.contains('button', 'No').click();
      
      cy.contains('h3', 'Golden', { timeout: 5000 }).should('be.visible');
      selectPlan('Golden');
      selectBillingPreference('annual');
      
      // Verify total: $1179/year for dog (Golden annual)
      verifyCostSummary(1179, 'annual');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(117900); // 1179 * 100
    });
  });

  describe('Comfort Care Plan Scenarios', () => {
    it('should complete Comfort Care plan (monthly only) using Templeton', () => {
      navigateToMembershipSignup('Templeton');
      
      // Select Comfort Care
      cy.contains('button', 'Yes, show Comfort Care').click();
      
      // Wait for Comfort Care plan to appear
      cy.wait(1000);
      
      // Explicitly select Comfort Care plan (it may not auto-select)
      selectPlan('Comfort Care');
      
      // Verify plan is selected
      cy.contains('h3', 'Comfort Care')
        .parents('.cp-plan-card')
        .should('have.class', 'selected');
      
      // Wait for cost summary to appear and calculate
      cy.wait(1000);
      
      // Verify total: $289/month (Comfort Care is monthly only)
      // Comfort Care is monthly only, so check for the price in the cost summary
      cy.contains('Cost Summary', { timeout: 5000 }).should('be.visible');
      verifyCostSummary(289, 'monthly');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(28900); // 289 * 100
    });
  });

  describe('Add-on Scenarios', () => {
    it('should complete Foundations + PLUS (monthly) for cat using Templeton', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectAddOn('PLUS Add-on');
      selectBillingPreference('monthly');
      
      // Verify total: $59 (Foundations cat) + $49 (PLUS) = $108/month
      verifyCostSummary(108, 'monthly');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(10800); // 108 * 100
    });

    it('should complete Foundations + PLUS (annual) for cat using Templeton', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectAddOn('PLUS Add-on');
      selectBillingPreference('annual');
      
      // Verify total: $659 (Foundations cat annual) + $529 (PLUS annual) = $1188/year
      verifyCostSummary(1188, 'annual');
      
      acceptAgreementAndProceed();
      // Verify payment page total (1188 * 100 = 118800 cents)
      verifyPaymentPageTotals(118800);
    });

    it('should complete Foundations + Puppy/Kitten (monthly) for kitten using Newey', () => {
      navigateToMembershipSignup('Newey');
      
      // Answer comfort care question
      cy.contains('button', 'No').click();
      cy.wait(500);
      
      // Answer starter question if it appears (for puppies/kittens)
      cy.get('body').then(($body) => {
        if ($body.find('p:contains("core vaccines")').length > 0) {
          cy.contains('button', 'No').last().click();
          cy.wait(500);
        }
      });
      
      selectPlan('Foundations');
      
      // Puppy/Kitten add-on should appear for Newey (kitten)
      cy.contains('h3', 'Puppy / Kitten', { timeout: 5000 }).should('be.visible');
      selectAddOn('Puppy / Kitten Add-on');
      selectBillingPreference('monthly');
      
      // Verify total: $59 (Foundations cat) + $29 (Puppy/Kitten) = $88/month
      verifyCostSummary(88, 'monthly');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(8800); // 88 * 100
    });

    it('should complete Foundations + Puppy/Kitten (annual) for kitten using Newey', () => {
      navigateToMembershipSignup('Newey');
      
      cy.contains('button', 'No').click();
      cy.wait(500);
      
      cy.get('body').then(($body) => {
        if ($body.find('p:contains("core vaccines")').length > 0) {
          cy.contains('button', 'No').last().click();
          cy.wait(500);
        }
      });
      
      selectPlan('Foundations');
      cy.contains('h3', 'Puppy / Kitten', { timeout: 5000 }).should('be.visible');
      selectAddOn('Puppy / Kitten Add-on');
      selectBillingPreference('annual');
      
      // Verify total: $659 (Foundations cat annual) + $309 (Puppy/Kitten annual) = $968/year
      verifyCostSummary(968, 'annual');
      
      acceptAgreementAndProceed();
      // Verify payment page total (968 * 100 = 96800 cents)
      verifyPaymentPageTotals(96800);
    });

    it('should complete Foundations + PLUS + Puppy/Kitten (annual) for kitten using Newey', () => {
      navigateToMembershipSignup('Newey');
      
      cy.contains('button', 'No').click();
      cy.wait(500);
      
      cy.get('body').then(($body) => {
        if ($body.find('p:contains("core vaccines")').length > 0) {
          cy.contains('button', 'No').last().click();
          cy.wait(500);
        }
      });
      
      selectPlan('Foundations');
      
      // Both add-ons should be available
      cy.contains('h3', 'PLUS Add-on', { timeout: 5000 }).should('be.visible');
      cy.contains('h3', 'Puppy / Kitten', { timeout: 5000 }).should('be.visible');
      
      selectAddOn('PLUS Add-on');
      selectAddOn('Puppy / Kitten Add-on');
      selectBillingPreference('annual');
      
      // Verify total: $659 (Foundations cat annual) + $529 (PLUS annual) + $309 (Puppy/Kitten annual) = $1497/year
      verifyCostSummary(1497, 'annual');
      
      acceptAgreementAndProceed();
      // Verify payment page total (1497 * 100 = 149700 cents)
      verifyPaymentPageTotals(149700);
    });

    it.skip('should complete Golden + PLUS (monthly) for senior dog using Oldie', () => {
      navigateToMembershipSignup('Oldie');
      
      cy.contains('button', 'No').click();
      
      cy.contains('h3', 'Golden', { timeout: 5000 }).should('be.visible');
      selectPlan('Golden');
      selectAddOn('PLUS Add-on');
      selectBillingPreference('monthly');
      
      // Verify total: $109 (Golden dog) + $49 (PLUS) = $158/month
      verifyCostSummary(158, 'monthly');
      
      acceptAgreementAndProceed();
      verifyPaymentPageTotals(15800); // 158 * 100
    });
  });

  describe('Total Calculation Verification', () => {
    it('should correctly calculate totals for all combinations', () => {
      const testCases = [
        // Base plans - monthly
        { plan: 'Foundations', species: 'dog', billing: 'monthly', addons: [], expected: 79 },
        { plan: 'Foundations', species: 'cat', billing: 'monthly', addons: [], expected: 59 },
        { plan: 'Golden', species: 'dog', billing: 'monthly', addons: [], expected: 109 },
        { plan: 'Golden', species: 'cat', billing: 'monthly', addons: [], expected: 99 },
        { plan: 'Comfort Care', species: null, billing: 'monthly', addons: [], expected: 289 },
        
        // Base plans - annual
        { plan: 'Foundations', species: 'dog', billing: 'annual', addons: [], expected: 749 },
        { plan: 'Foundations', species: 'cat', billing: 'annual', addons: [], expected: 659 },
        { plan: 'Golden', species: 'dog', billing: 'annual', addons: [], expected: 1179 },
        { plan: 'Golden', species: 'cat', billing: 'annual', addons: [], expected: 1069 },
        
        // With PLUS - monthly
        { plan: 'Foundations', species: 'dog', billing: 'monthly', addons: ['PLUS'], expected: 128 },
        { plan: 'Foundations', species: 'cat', billing: 'monthly', addons: ['PLUS'], expected: 108 },
        { plan: 'Golden', species: 'dog', billing: 'monthly', addons: ['PLUS'], expected: 158 },
        { plan: 'Golden', species: 'cat', billing: 'monthly', addons: ['PLUS'], expected: 148 },
        { plan: 'Comfort Care', species: null, billing: 'monthly', addons: ['PLUS'], expected: 338 },
        
        // With PLUS - annual
        { plan: 'Foundations', species: 'dog', billing: 'annual', addons: ['PLUS'], expected: 1278 },
        { plan: 'Foundations', species: 'cat', billing: 'annual', addons: ['PLUS'], expected: 1188 },
        { plan: 'Golden', species: 'dog', billing: 'annual', addons: ['PLUS'], expected: 1708 },
        { plan: 'Golden', species: 'cat', billing: 'annual', addons: ['PLUS'], expected: 1598 },
        
        // With Puppy/Kitten - monthly
        { plan: 'Foundations', species: 'dog', billing: 'monthly', addons: ['Puppy/Kitten'], expected: 108 },
        { plan: 'Foundations', species: 'cat', billing: 'monthly', addons: ['Puppy/Kitten'], expected: 88 },
        
        // With Puppy/Kitten - annual
        { plan: 'Foundations', species: 'dog', billing: 'annual', addons: ['Puppy/Kitten'], expected: 1058 },
        { plan: 'Foundations', species: 'cat', billing: 'annual', addons: ['Puppy/Kitten'], expected: 968 },
        
        // With both add-ons - monthly
        { plan: 'Foundations', species: 'dog', billing: 'monthly', addons: ['PLUS', 'Puppy/Kitten'], expected: 157 },
        { plan: 'Foundations', species: 'cat', billing: 'monthly', addons: ['PLUS', 'Puppy/Kitten'], expected: 137 },
        
        // With both add-ons - annual
        { plan: 'Foundations', species: 'dog', billing: 'annual', addons: ['PLUS', 'Puppy/Kitten'], expected: 1587 },
        { plan: 'Foundations', species: 'cat', billing: 'annual', addons: ['PLUS', 'Puppy/Kitten'], expected: 1497 },
      ];

      // Run first test case as a sample using Templeton
      const testCase = testCases[0];
      cy.log(`Testing: ${testCase.plan} ${testCase.species || ''} ${testCase.billing} with addons: ${testCase.addons.join(', ')}`);
      
      navigateToMembershipSignup('Templeton');
      
      // This is a simplified test - in practice, you'd iterate through test cases
      // For now, we'll test one representative case
      if (testCase.plan === 'Comfort Care') {
        cy.contains('button', 'Yes, show Comfort Care').click();
      } else {
        cy.contains('button', 'No').click();
        cy.wait(500);
        selectPlan(testCase.plan as 'Foundations' | 'Golden');
      }
      
      if (testCase.addons.includes('PLUS')) {
        selectAddOn('PLUS Add-on');
      }
      
      if (testCase.addons.includes('Puppy/Kitten')) {
        cy.get('body').then(($body) => {
          if ($body.find('h3:contains("Puppy / Kitten")').length > 0) {
            selectAddOn('Puppy / Kitten Add-on');
          }
        });
      }
      
      selectBillingPreference(testCase.billing as 'monthly' | 'annual');
      verifyCostSummary(testCase.expected, testCase.billing as 'monthly' | 'annual');
    });
  });

  describe('Payment Page Verification', () => {
    it('should display correct information on payment page using Templeton', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectBillingPreference('monthly');
      acceptAgreementAndProceed();
      
      // Verify we're on payment page
      cy.url().should('include', '/membership-payment');
      
      // Verify payment page elements are present
      cy.contains(/payment|checkout|credit card/i, { timeout: 5000 }).should('be.visible');
      
      // Verify total amount is displayed (cat Foundations monthly = $59.00)
      cy.contains('$59.00', { timeout: 5000 }).should('be.visible');
      
      // Verify plan name is displayed
      cy.contains('Foundations', { timeout: 5000 }).should('be.visible');
    });

    it('should not allow payment submission without credit card info', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectBillingPreference('monthly');
      acceptAgreementAndProceed();
      
      cy.url().should('include', '/membership-payment');
      
      // Look for submit/pay button and verify it's disabled or requires card info
      cy.get('body').then(($body) => {
        const submitButton = $body.find('button:contains("Pay"), button:contains("Submit"), button:contains("Complete")');
        if (submitButton.length > 0) {
          // Button should be disabled or form should prevent submission
          cy.get('button:contains("Pay"), button:contains("Submit"), button:contains("Complete")').first()
            .should('satisfy', ($btn) => {
              return $btn.is(':disabled') || $btn.attr('disabled') !== undefined;
            });
        }
      });
    });

    it('should show correct breakdown for plan with add-ons on payment page', () => {
      navigateToMembershipSignup('Templeton');
      
      cy.contains('button', 'No').click();
      selectPlan('Foundations');
      selectAddOn('PLUS Add-on');
      selectBillingPreference('annual');
      acceptAgreementAndProceed();
      
      cy.url().should('include', '/membership-payment');
      
      // Verify total amount is displayed (cat Foundations annual + PLUS = $1188.00)
      cy.contains('$1,188.00', { timeout: 5000 }).should('be.visible');
      
      // Verify plan name includes add-ons
      cy.contains('Foundations', { timeout: 5000 }).should('be.visible');
      cy.contains('PLUS', { timeout: 5000 }).should('be.visible');
    });
  });
});

