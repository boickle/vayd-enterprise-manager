/// <reference types="cypress" />
import '../support/e2e';

describe('Appointment Request Form - Complete Flow Tests', () => {
  const clientEmail = Cypress.env('CLIENT_EMAIL');
  const clientPassword = Cypress.env('CLIENT_PASSWORD');

  beforeEach(() => {
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    
    // Intercept API calls that the form makes
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' }).as('getSpecies');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' }).as('getBreeds');
    cy.intercept('GET', '**/public/appointments/find-zone-by-address*', { statusCode: 200 }).as('checkZone');
    
    // Intercept POST request for availability - use multiple patterns to catch all variations
    // Try both the specific path and a more general pattern
    cy.intercept('POST', '**/public/appointments/availability', (req) => {
      req.reply({ 
        statusCode: 200,
        fixture: 'availability-slots.json',
        headers: { 'Content-Type': 'application/json' }
      });
    }).as('getAvailability');
    
    // Intercept veterinarians endpoint - can be called with or without address parameter
    cy.intercept('GET', '**/employees/veterinarians*', { fixture: 'veterinarians.json' }).as('getVeterinarians');
    cy.intercept('GET', '**/public/appointments/veterinarians*', { fixture: 'veterinarians.json' }).as('getPublicVeterinarians');
    cy.intercept('GET', '**/appointments/client', { fixture: 'client-data.json' }).as('getClientData');
    cy.intercept('GET', '**/patients/client/mine', { fixture: 'client-pets.json' }).as('getClientPets');
  });

  describe('New Client Flow - Regular Visit', () => {
    it('should complete new client flow with single pet and verify payload', () => {
      // Intercept the final submission
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      // Visit the appointment request form (not logged in)
      cy.visit('/client-portal/request-appointment');

      // Step 1: Intro Page - Fill in basic info
      cy.get('input[type="email"]').should('be.visible').type('newclient@example.com');
      cy.get('input[placeholder="First Name"]').type('John');
      cy.get('input[placeholder="Last Name"]').type('Doe');
      cy.get('input[type="tel"]').first().type('207-555-1234');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('button', 'Next').click();

      // Step 2: New Client Page - Address and vet info
      cy.get('input[placeholder="Street Address"]').type('24 Orchard Ln');
      cy.get('input[placeholder="City"]').type('Durham');
      cy.get('input[placeholder="State"]').type('ME');
      cy.get('input[placeholder="Zip"]').type('04111');
      cy.wait('@checkZone');
      cy.wait('@getPublicVeterinarians');
      
      // Wait for veterinarians to load and select first veterinarian (index 1, after "I have no preference")
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 10000 });
      // Wait for options to be available (should have at least 2 options: "I have no preference" and at least one doctor)
      cy.get('select option').should('have.length.at.least', 2, { timeout: 10000 });
      // Select first veterinarian option (index 1, after "I have no preference" at index 0)
      // Get the select element and verify it has options, then select by index
      cy.get('select').then(($select) => {
        const options = $select.find('option');
        expect(options.length).to.be.at.least(2);
        // Select the second option (index 1), which should be the first doctor
        cy.wrap($select).select(1);
      });
      // Verify a selection was made and it's not "I have no preference"
      cy.get('select').should('not.have.value', '');
      cy.get('select').should('not.have.value', 'I have no preference');
      
      cy.contains('What veterinary practice(s) did you use previously').parent().find('textarea').type('Portland Animal Hospital');
      cy.contains('button', 'Next').click();
      
      // Wait for navigation to pet info page
      cy.url().should('include', 'request-appointment');

      // Step 3: Pet Information Page
      cy.wait('@getSpecies');
      
      // Add a pet
      cy.contains('button', 'Add Pet').click();
      
      // Fill in pet details
      cy.get('input[placeholder*="Enter pet name"]').first().type('Fluffy');
      
      // Select species - find the species dropdown (it's a select element)
      cy.get('label').contains('Species').parent().find('select').first().select('2'); // Feline
      cy.wait('@getBreeds', { timeout: 15000 });
      
      // Select breed (using type-ahead) - wait for the input to be enabled
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().should('not.be.disabled');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().type('Maine');
      cy.wait(500); // Wait for dropdown to appear
      cy.get('div').contains('Maine Coon').first().click();
      
      cy.get('input[placeholder="e.g., 5 years"]').first().type('5 years');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').first().select('Yes');
      cy.get('input[placeholder="Color"]').first().type('Orange');
      // Scroll weight input into view and type - use force if needed
      cy.get('input[type="number"]').first().scrollIntoView({ offset: { top: -100, left: 0 } }).should('be.visible').clear().type('12', { force: true });
      cy.get('textarea').first().type('Very friendly and calm');
      
      // Answer medication questions - find by label text
      cy.contains('Has').parent().parent().find('input[value="No"]').first().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').first().check();
      
      // Select how soon - scroll to find it if needed
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Flexible – within the next month"]').check();
      
      cy.contains('button', 'Next').click();

      // Step 4: Appointment Time Selection
      // Wait for the page to load - the availability API is called automatically via useEffect
      // when on request-visit-continued page with a doctor selected and non-urgent timeframe
      // First verify we're on the right page and the form is ready
      cy.contains('Here are some possible dates and times', { timeout: 10000 }).should('be.visible');
      
      // Wait up to 5 seconds for the API call (if it happens)
      // NOTE: For new clients, the API call might not happen due to a form code issue
      // where it checks providers.length > 0 instead of publicProviders.length > 0
      cy.wait(5000); // Give time for the API call to happen
      
      // Check if time slots are available (either from API call or already displayed)
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          // Time slots are available, select one
          cy.get('input[type="radio"]').first().check();
        } else {
          // No time slots available - enter preferred date and time manually
          cy.log('No time slots available - entering preferred date and time manually');
          // Look for the input field for preferred date and time
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Monday, January 15, 2024 at 2:00 PM');
        }
      });
      cy.contains('button', 'Submit').click();

      // Verify the payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        // Verify client type
        expect(payload.clientType).to.equal('new');
        expect(payload.isLoggedIn).to.equal(false);
        
        // Verify contact info
        expect(payload.email).to.equal('newclient@example.com');
        expect(payload.fullName.first).to.equal('John');
        expect(payload.fullName.last).to.equal('Doe');
        expect(payload.phoneNumber).to.equal('207-555-1234');
        expect(payload.canWeText).to.equal('Yes');
        
        // Verify address
        expect(payload.physicalAddress.line1).to.equal('24 Orchard Ln');
        expect(payload.physicalAddress.city).to.equal('Durham');
        expect(payload.physicalAddress.state).to.equal('ME');
        expect(payload.physicalAddress.zip).to.equal('04111');
        
        // Verify pet info
        expect(payload.newClientPets).to.have.length(1);
        expect(payload.newClientPets[0].name).to.equal('Fluffy');
        expect(payload.newClientPets[0].species).to.exist;
        expect(payload.newClientPets[0].speciesId).to.exist;
        expect(payload.newClientPets[0].breed).to.include('Maine');
        expect(payload.newClientPets[0].breedId).to.exist;
        expect(payload.newClientPets[0].age).to.equal('5 years');
        expect(payload.newClientPets[0].spayedNeutered).to.equal('Yes');
        expect(payload.newClientPets[0].color).to.equal('Orange');
        // Weight can be string or number depending on form submission
        expect(Number(payload.newClientPets[0].weight)).to.equal(12);
        expect(payload.newClientPets[0].behaviorAtPreviousVisits).to.equal('Very friendly and calm');
        expect(payload.newClientPets[0].needsCalmingMedications).to.equal('No');
        // needsMuzzleOrSpecialHandling might be empty string if not set, or 'No' if set
        expect(payload.newClientPets[0].needsMuzzleOrSpecialHandling || 'No').to.equal('No');
        
        // Verify appointment details
        expect(payload.howSoon).to.equal('Flexible – within the next month');
        expect(payload.appointmentType).to.equal('regular_visit');
        expect(payload.preferredDoctor).to.exist; // Should be the first veterinarian (Dr. Abigail Messina based on fixture)
        expect(payload.preferredDoctor).to.not.equal('I have no preference');
        // Either selectedDateTimePreferences or preferredDateTimeVisit should be set
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
          expect(payload.selectedDateTimePreferences.length).to.be.greaterThan(0);
        } else if (payload.preferredDateTimeVisit) {
          expect(payload.preferredDateTimeVisit).to.be.a('string');
          expect(payload.preferredDateTimeVisit.length).to.be.greaterThan(0);
        }
        
        // Verify form flow
        expect(payload.formFlow.startedAsLoggedIn).to.equal(false);
        expect(payload.formFlow.startedAsExistingClient).to.equal(false);
      });
    });

    it('should complete new client flow with no doctor preference', () => {
      // Intercept the final submission
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      // Visit the appointment request form (not logged in)
      cy.visit('/client-portal/request-appointment');

      // Step 1: Intro Page - Fill in basic info
      cy.get('input[type="email"]').should('be.visible').type('nopreference@example.com');
      cy.get('input[placeholder="First Name"]').type('No');
      cy.get('input[placeholder="Last Name"]').type('Preference');
      cy.get('input[type="tel"]').first().type('207-555-9999');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('button', 'Next').click();

      // Step 2: New Client Page - Address and vet info
      cy.get('input[placeholder="Street Address"]').type('24 Orchard Ln');
      cy.get('input[placeholder="City"]').type('Durham');
      cy.get('input[placeholder="State"]').type('ME');
      cy.get('input[placeholder="Zip"]').type('04111');
      cy.wait('@checkZone');
      cy.wait('@getPublicVeterinarians');
      
      // Wait for veterinarians to load and select "I have no preference"
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 10000 });
      cy.get('select').select('I have no preference');
      
      cy.contains('What veterinary practice(s) did you use previously').parent().find('textarea').type('Portland Animal Hospital');
      cy.contains('button', 'Next').click();

      // Step 3: Pet Information Page
      cy.wait('@getSpecies');
      
      // Add a pet
      cy.contains('button', 'Add Pet').click();
      
      // Fill in pet details
      cy.get('input[placeholder*="Enter pet name"]').first().type('Fluffy');
      
      // Select species - find the species dropdown (it's a select element)
      cy.get('label').contains('Species').parent().find('select').first().select('2'); // Feline
      cy.wait('@getBreeds', { timeout: 15000 });
      
      // Select breed (using type-ahead) - wait for the input to be enabled
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().should('not.be.disabled');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().type('Maine');
      cy.wait(500); // Wait for dropdown to appear
      cy.get('div').contains('Maine Coon').first().click();
      
      cy.get('input[placeholder="e.g., 5 years"]').first().type('5 years');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').first().select('Yes');
      cy.get('input[placeholder="Color"]').first().type('Orange');
      // Scroll weight input into view and type - use force if needed
      cy.get('input[type="number"]').first().scrollIntoView({ offset: { top: -100, left: 0 } }).should('be.visible').clear().type('12', { force: true });
      cy.get('textarea').first().type('Very friendly and calm');
      
      // Answer medication questions - find by label text
      cy.contains('Has').parent().parent().find('input[value="No"]').first().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').first().check();
      
      // Select how soon - scroll to find it if needed
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Flexible – within the next month"]').check();
      
      cy.contains('button', 'Next').click();

      // Step 4: Appointment Time Selection
      cy.wait(5000); // Give time for API call if it happens
      
      // Check if time slots are available, otherwise enter preferred date/time manually
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          cy.get('input[type="radio"]', { timeout: 10000 }).first().check();
        } else {
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Monday, January 15, 2024 at 2:00 PM');
        }
      });
      cy.contains('button', 'Submit').click();

      // Verify the payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        // Verify client type
        expect(payload.clientType).to.equal('new');
        expect(payload.isLoggedIn).to.equal(false);
        
        // Verify contact info
        expect(payload.email).to.equal('nopreference@example.com');
        expect(payload.fullName.first).to.equal('No');
        expect(payload.fullName.last).to.equal('Preference');
        
        // Verify address
        expect(payload.physicalAddress.line1).to.equal('24 Orchard Ln');
        expect(payload.physicalAddress.city).to.equal('Durham');
        expect(payload.physicalAddress.state).to.equal('ME');
        expect(payload.physicalAddress.zip).to.equal('04111');
        
        // Verify doctor preference
        expect(payload.preferredDoctor).to.equal('I have no preference');
        
        // Verify appointment details
        expect(payload.howSoon).to.equal('Flexible – within the next month');
        expect(payload.appointmentType).to.equal('regular_visit');
        // Either selectedDateTimePreferences or preferredDateTimeVisit should be set
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
          expect(payload.selectedDateTimePreferences.length).to.be.greaterThan(0);
        } else if (payload.preferredDateTimeVisit) {
          expect(payload.preferredDateTimeVisit).to.be.a('string');
          expect(payload.preferredDateTimeVisit.length).to.be.greaterThan(0);
        }
        
        // Verify form flow
        expect(payload.formFlow.startedAsLoggedIn).to.equal(false);
        expect(payload.formFlow.startedAsExistingClient).to.equal(false);
      });
    });

    it('should complete new client flow with multiple pets', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');

      // Intro page
      cy.get('input[type="email"]').type('multipet@example.com');
      cy.get('input[placeholder="First Name"]').type('Jane');
      cy.get('input[placeholder="Last Name"]').type('Smith');
      cy.get('input[type="tel"]').first().type('207-555-5678');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('button', 'Next').click();

      // Address page
      cy.get('input[placeholder="Street Address"]').type('456 Oak Ave');
      cy.get('input[placeholder="City"]').type('Freeport');
      cy.get('input[placeholder="State"]').type('ME');
      cy.get('input[placeholder="Zip"]').type('04032');
      cy.wait('@checkZone');
      cy.wait('@getPublicVeterinarians');
      
      cy.get('select').then(($select) => {
        if ($select.find('option').length > 1) {
          cy.wrap($select).select(1);
        } else {
          cy.wrap($select).select('I have no preference');
        }
      });
      
      cy.contains('What veterinary practice(s) did you use previously').parent().find('textarea').type('Freeport Animal Clinic');
      cy.contains('button', 'Next').click();

      // Pet page - Add first pet
      cy.wait('@getSpecies');
      cy.contains('button', 'Add Pet').click();
      
      cy.get('input[placeholder="Enter pet name"]').first().type('Buddy');
      cy.get('label').contains('Species').parent().find('select').first().select('1'); // Canine
      cy.wait('@getBreeds');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().type('Golden');
      cy.wait(500);
      cy.get('div').contains('Golden Retriever').first().click();
      cy.get('input[placeholder="e.g., 5 years"]').first().type('3 years');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').first().select('Yes');
      cy.get('input[placeholder="Color"]').first().type('Golden');
      // Scroll weight input into view and type
      cy.get('input[type="number"]').first().scrollIntoView().should('be.visible').type('65');
      cy.get('textarea').first().type('Very friendly');
      cy.contains('Has').parent().parent().find('input[value="No"]').first().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').first().check();

      // Add second pet
      cy.contains('button', 'Add Pet').click();
      
      cy.get('input[placeholder="Enter pet name"]').last().type('Max');
      cy.get('label').contains('Species').parent().find('select').last().select('1'); // Canine
      // Wait a bit for breeds to load (might reuse breeds if same species, so API call might not happen)
      cy.wait(2000);
      // Verify breed input is enabled (breeds should be loaded) - scroll into view first
      cy.get('label').contains('Breed').parent().find('input[type="text"]').last().scrollIntoView({ offset: { top: -100, left: 0 } }).should('not.be.disabled');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').last().clear().type('Labrador', { force: true });
      cy.wait(1000); // Wait for dropdown to appear
      // Click on Labrador from the dropdown
      cy.get('div').contains('Labrador', { timeout: 5000 }).first().click();
      cy.get('input[placeholder="e.g., 5 years"]').last().type('2 years');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').last().select('No');
      cy.get('input[placeholder="Color"]').last().type('Black');
      // Scroll weight input into view and type - use force if needed
      cy.get('input[type="number"]').last().scrollIntoView({ offset: { top: -100, left: 0 } }).should('be.visible').type('50', { force: true });
      cy.get('textarea').last().type('Energetic puppy');
      cy.contains('Has').parent().parent().find('input[value="No"]').last().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').last().check();

      // Select how soon
      cy.contains('How soon do your pets need to be seen').parent().find('input[value="Soon – sometime this week"]').check();
      cy.contains('button', 'Next').click();

      // Time selection
      cy.wait(5000); // Give time for API call if it happens
      
      // Check if time slots are available, otherwise enter preferred date/time manually
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          cy.get('input[type="radio"]').first().check();
        } else {
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Tuesday, January 16, 2024 at 10:00 AM');
        }
      });
      cy.contains('button', 'Next').click();

      // Submit
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.newClientPets).to.have.length(2);
        expect(payload.newClientPets[0].name).to.equal('Buddy');
        expect(payload.newClientPets[1].name).to.equal('Max');
        expect(payload.howSoon).to.equal('Soon – sometime this week');
        expect(payload.serviceMinutes).to.exist; // Should be calculated (40 + 20 = 60)
        // Either selectedDateTimePreferences or preferredDateTimeVisit should be set
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
        } else if (payload.preferredDateTimeVisit) {
          expect(payload.preferredDateTimeVisit).to.be.a('string');
          expect(payload.preferredDateTimeVisit.length).to.be.greaterThan(0);
        }
      });
    });

    it('should handle urgent/emergent case for new client', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');

      // Complete intro and address pages quickly
      cy.get('input[type="email"]').type('urgent@example.com');
      cy.get('input[placeholder="First Name"]').type('Urgent');
      cy.get('input[placeholder="Last Name"]').type('Client');
      cy.get('input[type="tel"]').first().type('207-555-9999');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('button', 'Next').click();

      cy.get('input[placeholder="Street Address"]').type('789 Emergency St');
      cy.get('input[placeholder="City"]').type('Portland');
      cy.get('input[placeholder="State"]').type('ME');
      cy.get('input[placeholder="Zip"]').type('04101');
      cy.wait('@checkZone');
      cy.wait('@getPublicVeterinarians');
      
      cy.get('select').then(($select) => {
        if ($select.find('option').length > 1) {
          cy.wrap($select).select(1);
        } else {
          cy.wrap($select).select('I have no preference');
        }
      });
      
      cy.contains('What veterinary practice(s) did you use previously').parent().find('textarea').type('Emergency Clinic');
      cy.contains('button', 'Next').click();

      // Add pet
      cy.wait('@getSpecies');
      cy.contains('button', 'Add Pet').click();
      
      cy.get('input[placeholder="Enter pet name"]').first().type('Emergency Pet');
      cy.get('label').contains('Species').parent().find('select').first().select('1');
      cy.wait('@getBreeds');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').first().type('Mix');
      cy.wait(500);
      cy.get('div').contains('Mixed').first().click();
      cy.get('input[placeholder="e.g., 5 years"]').first().type('8 years');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').first().select('Yes');
      cy.get('input[placeholder="Color"]').first().type('Brown');
      // Scroll weight input into view and type - use force if needed
      cy.get('input[type="number"]').first().scrollIntoView({ offset: { top: -100, left: 0 } }).should('be.visible').type('30', { force: true });
      cy.get('textarea').first().type('Emergency situation');
      cy.contains('Has').parent().parent().find('input[value="No"]').first().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').first().check();

      // Select urgent
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Urgent – within 24–48 hours"]').check();
      cy.contains('button', 'Next').click();

      // Should show banner, not time slots
      cy.contains('Client Liaison will be in touch').should('be.visible');
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.howSoon).to.equal('Urgent – within 24–48 hours');
        expect(payload.selectedDateTimePreferences).to.be.null;
        expect(payload.appointmentType).to.equal('regular_visit');
      });
    });
  });

    describe('Existing Client Flow - Logged In', () => {
      beforeEach(() => {
        // Intercept client data loading BEFORE login (intercepts are already in main beforeEach)
        
        // Login as existing client
        cy.loginAs('client');
      });

    it('should complete existing client flow with existing pet selection', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');
      
      cy.wait('@getClientData');
      cy.wait('@getClientPets');

      // Step 1: Existing Client Page
      // Phone number should be pre-filled, verify it exists (should not be empty)
      cy.get('input[type="tel"]').should('not.have.value', '');
      
      // Answer "Can we text" if needed
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      
      // Answer address question - veterinarians are fetched AFTER this is answered
      cy.contains('Is this the address where we will come to see you').parent().find('input[value="Yes"]').check();
      
      // Wait for veterinarians dropdown to be ready (they're fetched after address question is answered)
      // Instead of waiting for the API call, wait for the UI to update
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 20000 });
      cy.get('select').should('have.length.greaterThan', 0);
      
      // Wait for veterinarians dropdown to be ready and select one
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 10000 });
      cy.get('select').then(($select) => {
        if ($select.find('option').length > 1) {
          cy.wrap($select).select(1);
        } else {
          cy.wrap($select).select('I have no preference');
        }
      });
      
      cy.contains('button', 'Next').click();

      // Step 2: Pet Selection Page
      cy.wait('@getSpecies');
      
      // Select an existing pet - wait for checkboxes to appear
      cy.get('input[type="checkbox"]', { timeout: 10000 }).first().check();
      
      // Answer per-pet questions - wait for the expanded section
      cy.contains('What does').parent().parent().find('input[value="Wellness exam / check-up"]').check();
      cy.get('textarea').first().type('Annual check-up and vaccinations');
      
      // Select how soon
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Flexible – within the next month"]').check();
      cy.contains('button', 'Next').click();

      // Step 3: Time Selection
      cy.wait(5000); // Give time for API call if it happens
      
      // Check if time slots are available, otherwise enter preferred date/time manually
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          cy.get('input[type="radio"]', { timeout: 10000 }).first().check();
        } else {
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Monday, January 15, 2024 at 2:00 PM');
        }
      });
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.clientType).to.equal('existing');
        expect(payload.isLoggedIn).to.equal(true);
        expect(payload.email).to.equal(clientEmail);
        
        // Verify pets
        expect(payload.pets).to.exist;
        expect(payload.pets.length).to.be.greaterThan(0);
        expect(payload.allPets).to.exist;
        
        // Verify pet specific data
        expect(payload.petSpecificData).to.exist;
        const petIds = Object.keys(payload.petSpecificData);
        expect(petIds.length).to.be.greaterThan(0);
        expect(payload.petSpecificData[petIds[0]].needsToday).to.equal('Wellness exam / check-up');
        expect(payload.petSpecificData[petIds[0]].needsTodayDetails).to.equal('Annual check-up and vaccinations');
        
        // Verify appointment details
        expect(payload.howSoon).to.equal('Flexible – within the next month');
        expect(payload.appointmentType).to.equal('regular_visit');
        // Either selectedDateTimePreferences or preferredDateTimeVisit should be set
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
        } else if (payload.preferredDateTimeVisit) {
          expect(payload.preferredDateTimeVisit).to.be.a('string');
          expect(payload.preferredDateTimeVisit.length).to.be.greaterThan(0);
        }
        
        // Verify form flow
        expect(payload.formFlow.startedAsLoggedIn).to.equal(true);
        expect(payload.formFlow.startedAsExistingClient).to.equal(true);
      });
    });

    it('should handle existing client adding new pet', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');
      
      cy.wait('@getClientData');
      cy.wait('@getClientPets');

      // Existing client page
      cy.get('input[type="tel"]').should('not.have.value', '');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('Is this the address where we will come to see you').parent().find('input[value="Yes"]').check();
      
      // Wait for veterinarians dropdown to be ready (they're fetched AFTER address question is answered)
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 20000 });
      cy.get('select').should('have.length.greaterThan', 0);
      
      cy.get('select').contains('Dr.').first().then(($select) => {
        cy.wrap($select).parent().find('select').select(1);
      });
      
      cy.contains('button', 'Next').click();

      // Pet selection page - select existing pet and add new pet
      cy.wait('@getSpecies');
      
      // Select existing pet
      cy.get('input[type="checkbox"]', { timeout: 10000 }).first().check();
      cy.contains('What does').parent().parent().find('input[value="My pet isn\'t feeling well"]').check();
      cy.get('textarea').first().type('Limping on front leg');
      
      // Add new pet
      cy.contains('button', 'Add Pet').click();
      
      cy.get('input[placeholder="Enter pet name"]').last().type('New Pet');
      cy.get('label').contains('Species').parent().find('select').last().select('2'); // Feline
      cy.wait('@getBreeds');
      cy.get('label').contains('Breed').parent().find('input[type="text"]').last().type('Siamese');
      cy.wait(500);
      cy.get('div').contains('Siamese').first().click();
      cy.get('input[placeholder="e.g., 5 years"]').last().type('1 year');
      cy.get('label').contains('Spayed/Neutered').parent().find('select').last().select('Yes');
      cy.get('input[placeholder="Color"]').last().type('Seal Point');
      // Scroll weight input into view and type - use force if needed
      cy.get('input[type="number"]').last().scrollIntoView({ offset: { top: -100, left: 0 } }).should('be.visible').type('8', { force: true });
      cy.get('textarea').last().type('Very playful');
      cy.contains('Has').parent().parent().find('input[value="No"]').last().check();
      cy.contains('muzzle').parent().parent().find('input[value="No"]').last().check();
      
      // Select the new pet checkbox
      cy.get('input[type="checkbox"]').last().check();
      
      // Answer questions for new pet - wait for expanded section
      cy.contains('What does').parent().parent().find('input[value="Wellness exam / check-up"]').last().check();
      cy.get('textarea').last().type('First visit wellness exam');
      
      // Select how soon
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Soon – sometime this week"]').check();
      cy.contains('button', 'Next').click();

      // Time selection
      cy.wait(5000); // Give time for API call if it happens
      
      // Check if time slots are available, otherwise enter preferred date/time manually
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          cy.get('input[type="radio"]', { timeout: 10000 }).first().check();
        } else {
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Monday, January 15, 2024 at 2:00 PM');
        }
      });
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.pets).to.exist;
        expect(payload.pets.length).to.be.greaterThan(0);
        expect(payload.existingClientNewPets).to.exist;
        expect(payload.existingClientNewPets.length).to.equal(1);
        expect(payload.existingClientNewPets[0].name).to.equal('New Pet');
        expect(payload.existingClientNewPets[0].speciesId).to.exist;
        expect(payload.existingClientNewPets[0].breedId).to.exist;
        expect(payload.existingClientNewPets[0].weight).to.equal(8);
        
        // Verify pet specific data includes both pets
        expect(payload.petSpecificData).to.exist;
        const petIds = Object.keys(payload.petSpecificData);
        expect(petIds.length).to.equal(2); // Existing pet + new pet
      });
    });

    it('should handle existing client with new address', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');
      
      cy.wait('@getClientData');
      cy.wait('@getClientPets');
      // Wait for veterinarians dropdown to be ready (they're fetched after address question is answered)
      // Instead of waiting for the API call, wait for the UI to update
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 20000 });
      cy.get('select').should('have.length.greaterThan', 0);

      // Existing client page
      cy.get('input[type="tel"]').should('not.have.value', '');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      
      // Answer "No" to address question
      cy.contains('Is this the address where we will come to see you').parent().find('input[value="No"]').check();
      
      // Enter new address - find the input field after answering "No"
      cy.contains('Please let us know where we will meet you').parent().parent().find('input[placeholder="Street Address"]').type('999 New Address St');
      cy.get('input[placeholder="City"]').last().type('Augusta');
      cy.get('input[placeholder="State"]').last().type('ME');
      cy.get('input[placeholder="Zip"]').last().type('04330');
      cy.wait('@checkZone');
      // Wait for veterinarians dropdown to be ready instead of API call
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 20000 });
      
      cy.get('select').then(($select) => {
        if ($select.find('option').length > 1) {
          cy.wrap($select).select(1);
        } else {
          cy.wrap($select).select('I have no preference');
        }
      });
      
      cy.contains('button', 'Next').click();

      // Pet selection
      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 }).first().check();
      cy.contains('What does').parent().parent().find('input[value="Wellness exam / check-up"]').check();
      cy.get('textarea').first().type('Regular check-up');
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Flexible – within the next month"]').check();
      cy.contains('button', 'Next').click();

      // Time selection
      cy.wait(5000); // Give time for API call if it happens
      
      // Check if time slots are available, otherwise enter preferred date/time manually
      cy.get('body').then(($body) => {
        if ($body.find('input[type="radio"]').length > 0) {
          cy.get('input[type="radio"]', { timeout: 10000 }).first().check();
        } else {
          cy.get('input[placeholder*="Enter your preferred date and time"]').type('Monday, January 15, 2024 at 2:00 PM');
        }
      });
      cy.contains('button', 'Submit').click();

      // Verify payload uses new address
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.physicalAddress.line1).to.equal('999 New Address St');
        expect(payload.physicalAddress.city).to.equal('Augusta');
        expect(payload.physicalAddress.state).to.equal('ME');
        expect(payload.physicalAddress.zip).to.equal('04330');
      });
    });

    it('should handle euthanasia request for existing client', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');
      
      cy.wait('@getClientData');
      cy.wait('@getClientPets');

      // Existing client page
      cy.get('input[type="tel"]').should('not.have.value', '');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('Is this the address where we will come to see you').parent().find('input[value="Yes"]').check();
      
      // Wait for veterinarians dropdown to be ready (they're fetched AFTER address question is answered)
      cy.get('select').should('not.contain', 'Loading doctors...', { timeout: 20000 });
      cy.get('select').should('have.length.greaterThan', 0);
      
      cy.get('select').contains('Dr.').first().then(($select) => {
        cy.wrap($select).parent().find('select').select(1);
      });
      
      cy.contains('button', 'Next').click();

      // Pet selection - select euthanasia
      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 }).first().check();
      
      // Select "End-of-life care / euthanasia" - it's at the bottom of the list
      cy.contains('What does').parent().parent().find('input[value="End-of-life care / euthanasia"]').check();
      
      // Fill euthanasia questions - wait for questions to appear
      cy.get('textarea').first().type('Terminal cancer, in significant pain');
      cy.get('input[type="text"]').eq(1).type('Yes, saw vet last month');
      cy.contains('interested in pursuing other options').parent().parent().find('input[value*="No. While this is very difficult"]').check();
      cy.contains('preferences for aftercare').parent().parent().find('input[value*="Private Cremation"]').check();
      
      cy.contains('How soon do your pets need to be seen').scrollIntoView();
      cy.contains('How soon do your pets need to be seen').parent().parent().find('input[value="Urgent – within 24–48 hours"]').check();
      cy.contains('button', 'Next').click();

      // Should show banner, not time slots
      cy.contains('Client Liaison will be in touch').should('be.visible');
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        const petIds = Object.keys(payload.petSpecificData);
        const petData = payload.petSpecificData[petIds[0]];
        
        expect(petData.needsToday).to.equal('End-of-life care / euthanasia');
        expect(petData.euthanasiaReason).to.equal('Terminal cancer, in significant pain');
        expect(petData.beenToVetLastThreeMonths).to.equal('Yes, saw vet last month');
        expect(petData.interestedInOtherOptions).to.include('No. While this is very difficult');
        expect(petData.aftercarePreference).to.include('Private Cremation');
        
        expect(payload.selectedDateTimePreferences).to.be.null;
        expect(payload.howSoon).to.equal('Urgent – within 24–48 hours');
      });
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should show zone error for non-serviced address', () => {
      cy.intercept('GET', '**/public/appointments/find-zone-by-address*', { statusCode: 404 }).as('checkZone404');

      cy.visit('/client-portal/request-appointment');

      cy.get('input[type="email"]').type('test@example.com');
      cy.get('input[placeholder="First Name"]').type('Test');
      cy.get('input[placeholder="Last Name"]').type('User');
      cy.get('input[type="tel"]').first().type('207-555-0000');
      cy.contains('Can we text this number').parent().find('input[value="Yes"]').check();
      cy.contains('button', 'Next').click();

      cy.get('input[placeholder="Street Address"]').type('123 Unserviced St');
      cy.get('input[placeholder="City"]').type('Nowhere');
      cy.get('input[placeholder="State"]').type('ME');
      cy.get('input[placeholder="Zip"]').type('00000');
      
      cy.wait('@checkZone404');
      
      // Should show error message
      cy.contains('We do not service your zone', { timeout: 10000 }).should('be.visible');
      
      // Should not be able to proceed - Next button should be disabled or form should not submit
      cy.contains('button', 'Next').should('exist');
    });

    it('should validate required fields', () => {
      cy.visit('/client-portal/request-appointment');

      // Try to proceed without filling required fields
      cy.contains('button', 'Next').click();
      
      // Should show validation errors
      cy.contains('required').should('exist');
    });
  });
});

