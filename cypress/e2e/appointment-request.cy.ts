/// <reference types="cypress" />
import '../support/e2e';

type GeoAddressPreset = {
  suggestion: {
    placeId: string;
    description: string;
    mainText: string;
    secondaryText: string;
  };
  place: {
    placeId: string;
    formattedAddress: string;
    lat: number;
    lon: number;
    address: {
      address1: string;
      address2: string | null;
      city: string;
      state: string;
      zipcode: string;
      country: string;
    };
  };
};

const GEO_ADDRESSES: Record<string, GeoAddressPreset> = {
  durham: {
    suggestion: {
      placeId: 'place-durham',
      description: '24 Orchard Ln, Durham, ME 04111, USA',
      mainText: '24 Orchard Ln',
      secondaryText: 'Durham, ME 04111, USA',
    },
    place: {
      placeId: 'place-durham',
      formattedAddress: '24 Orchard Ln, Durham, ME 04111, USA',
      lat: 43.9,
      lon: -70.2,
      address: {
        address1: '24 Orchard Ln',
        address2: null,
        city: 'Durham',
        state: 'ME',
        zipcode: '04111',
        country: 'US',
      },
    },
  },
  freeport: {
    suggestion: {
      placeId: 'place-freeport',
      description: '456 Oak Ave, Freeport, ME 04032, USA',
      mainText: '456 Oak Ave',
      secondaryText: 'Freeport, ME 04032, USA',
    },
    place: {
      placeId: 'place-freeport',
      formattedAddress: '456 Oak Ave, Freeport, ME 04032, USA',
      lat: 43.85,
      lon: -70.1,
      address: {
        address1: '456 Oak Ave',
        address2: null,
        city: 'Freeport',
        state: 'ME',
        zipcode: '04032',
        country: 'US',
      },
    },
  },
  portland: {
    suggestion: {
      placeId: 'place-portland',
      description: '789 Emergency St, Portland, ME 04101, USA',
      mainText: '789 Emergency St',
      secondaryText: 'Portland, ME 04101, USA',
    },
    place: {
      placeId: 'place-portland',
      formattedAddress: '789 Emergency St, Portland, ME 04101, USA',
      lat: 43.65,
      lon: -70.25,
      address: {
        address1: '789 Emergency St',
        address2: null,
        city: 'Portland',
        state: 'ME',
        zipcode: '04101',
        country: 'US',
      },
    },
  },
  augusta: {
    suggestion: {
      placeId: 'place-augusta',
      description: '999 New Address St, Augusta, ME 04330, USA',
      mainText: '999 New Address St',
      secondaryText: 'Augusta, ME 04330, USA',
    },
    place: {
      placeId: 'place-augusta',
      formattedAddress: '999 New Address St, Augusta, ME 04330, USA',
      lat: 44.31,
      lon: -69.77,
      address: {
        address1: '999 New Address St',
        address2: null,
        city: 'Augusta',
        state: 'ME',
        zipcode: '04330',
        country: 'US',
      },
    },
  },
};

function stubGeoAddress(preset: keyof typeof GEO_ADDRESSES) {
  const { suggestion, place } = GEO_ADDRESSES[preset];
  cy.intercept('GET', '**/public/geo/autocomplete*', {
    statusCode: 200,
    body: { suggestions: [suggestion] },
  }).as('geoAutocomplete');
  cy.intercept('GET', '**/public/geo/place/*', {
    statusCode: 200,
    body: place,
  }).as('geoPlace');
}

function pickAddress(inputId: string, query: string, description: string) {
  cy.get(`#${inputId}`).type(query);
  cy.wait('@geoAutocomplete');
  cy.get(`#${inputId}-listbox`).contains(description).click();
  cy.wait('@geoPlace');
}

function selectNewClientHowSoon(option: string) {
  cy.contains('How soon do you need to be seen?').scrollIntoView();
  cy.get(`[data-how-soon="${option}"]`).click();
}

function fillNewClientClientInfo(options: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  addressPreset: keyof typeof GEO_ADDRESSES;
  addressQuery: string;
  previousVet: string;
}) {
  cy.get('input[type="email"]').should('be.visible').type(options.email);
  cy.get('input[placeholder="First Name"]').type(options.firstName);
  cy.get('input[placeholder="Last Name"]').type(options.lastName);
  cy.get('input[type="tel"]').first().type(options.phone);
  stubGeoAddress(options.addressPreset);
  pickAddress('physical-address', options.addressQuery, GEO_ADDRESSES[options.addressPreset].suggestion.description);
  cy.wait('@getPublicVeterinarians');
  cy.wait('@getAppointmentTypes');
  cy.contains('Previous Veterinarian').parent().find('textarea').type(options.previousVet);
}

function fillNewClientPetInfo(options: {
  petName: string;
  species: 'Dog' | 'Cat' | 'Other';
  petAge: string;
  howSoon: string;
  breed?: string;
  visitReason?: 'wellness' | 'not-feeling-well' | 'end-of-life' | 'something-else';
}) {
  cy.wait('@getSpecies');
  fillSimplifiedPetFields({
    name: options.petName,
    species: options.species,
    age: options.petAge,
    breed: options.breed,
    visitReason: options.visitReason ?? 'wellness',
  });
  selectNewClientHowSoon(options.howSoon);
}

function fillNewClientIntroAndPet(options: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  addressPreset: keyof typeof GEO_ADDRESSES;
  addressQuery: string;
  previousVet: string;
  petName: string;
  species: 'Dog' | 'Cat' | 'Other';
  petAge: string;
  howSoon: string;
  breed?: string;
  visitReason?: string;
}) {
  fillNewClientClientInfo(options);
  cy.contains('button', 'Next').click();
  cy.contains("Now let's meet your pet").should('be.visible');
  fillNewClientPetInfo(options);
}

function petCardRoot(scope: 'first' | 'last' = 'first') {
  return cy
    .get('input[placeholder*="Enter pet name"]')
    .eq(scope === 'last' ? 1 : 0)
    .parents('div')
    .filter('[style*="border-radius: 12px"]')
    .first();
}

function fillSimplifiedPetFields(options: {
  name: string;
  species: 'Dog' | 'Cat' | 'Other';
  age: string;
  sex?: 'Female Intact' | 'Female Spayed' | 'Male Intact' | 'Male Neutered' | 'Unknown';
  breed?: string;
  visitReason?: 'wellness' | 'not-feeling-well' | 'end-of-life' | 'something-else';
  scope?: 'first' | 'last';
}) {
  const {
    name,
    species,
    age,
    sex = 'Male Neutered',
    breed,
    visitReason = 'wellness',
    scope = 'first',
  } = options;

  petCardRoot(scope).within(() => {
    cy.get('input[placeholder*="Enter pet name"]').clear().type(name);
    cy.get(`[data-species-choice="${species}"]`).click();
    if (breed) {
      cy.get('input[placeholder="Start typing breed"]').type(breed);
    }
    cy.get(`[data-pet-sex-option="${sex}"]`).click();
    cy.get('input[placeholder="e.g. 5 years, or DOB if you know it"]').type(age);
    cy.get('[data-handling-need="none"]').click();
    cy.get(`[data-visit-reason="${visitReason}"]`).click();
  });
}

function submitNewClientAppointmentRequest() {
  cy.contains('button', 'Submit Appointment Request').click();
}

function fillExistingClientBasics(options?: {
  addressAnswer?: 'Yes' | 'No';
  newAddress?: { preset: keyof typeof GEO_ADDRESSES; query: string };
}) {
  cy.get('input[type="tel"]').should('not.have.value', '');
  const addressAnswer = options?.addressAnswer ?? 'Yes';
  cy.contains('Is this the address where we will come to see you').parent().find(`input[value="${addressAnswer}"]`).check();
  if (addressAnswer === 'No' && options?.newAddress) {
    stubGeoAddress(options.newAddress.preset);
    pickAddress('new-physical-address', options.newAddress.query, GEO_ADDRESSES[options.newAddress.preset].suggestion.description);
    cy.wait('@checkZone');
  }
}

function selectExistingClientPetVisitReason(
  visitReason: 'wellness' | 'not-feeling-well' | 'end-of-life',
  petIndex = 0,
) {
  cy.get('input[type="checkbox"]').eq(petIndex).check();
  cy.get(`[data-visit-reason="${visitReason}"]`).eq(petIndex).click();
}

function selectHowSoonExisting(value: string) {
  cy.contains('How soon do you need to be seen?').scrollIntoView();
  cy.get(`[data-how-soon="${value}"]`).click();
}

describe('Appointment Request Form - Complete Flow Tests', () => {
  const clientEmail = Cypress.env('CLIENT_EMAIL');
  const clientPassword = Cypress.env('CLIENT_PASSWORD');

  beforeEach(() => {
    cy.clearAllSessionStorage();
    cy.clearAllCookies();
    
    // Intercept API calls that the form makes
    cy.intercept('GET', '**/public/species-breeds?practiceId=1', { fixture: 'species-breeds.json' }).as('getSpecies');
    cy.intercept('GET', '**/public/species-breeds?practiceId=1&speciesId=*', { fixture: 'breeds.json' }).as('getBreeds');
    cy.intercept('GET', '**/public/appointment-types*', { fixture: 'appointment-types.json' }).as('getAppointmentTypes');
    cy.intercept('GET', '**/appointment-types*', { fixture: 'appointment-types.json' }).as('getAuthAppointmentTypes');
    cy.intercept('GET', '**/public/appointments/find-zone-by-address*', { statusCode: 200 }).as('checkZone');
    cy.intercept('GET', '**/public/appointments/check-email*', { statusCode: 200, body: { exists: false } }).as('checkEmail');
    
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

      fillNewClientIntroAndPet({
        email: 'newclient@example.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '207-555-1234',
        addressPreset: 'durham',
        addressQuery: '24 Orchard',
        previousVet: 'Portland Animal Hospital',
        petName: 'Fluffy',
        species: 'Cat',
        petAge: '5 years',
        howSoon: 'Flexible',
      });

      submitNewClientAppointmentRequest();

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
        expect(payload.newClientPets[0].age).to.equal('5 years');
        expect(payload.newClientPets[0].needsCalmingMedications).to.equal('No');
        expect(payload.newClientPets[0].needsMuzzleOrSpecialHandling || 'No').to.equal('No');
        expect(payload.okayToContactPreviousVets).to.equal('Yes');
        
        // Verify appointment details
        expect(payload.howSoon).to.equal('Flexible');
        expect(payload.appointmentType).to.equal('Wellness exam / check-up');
        expect(payload.preferredDoctor).to.exist; // Should be the first veterinarian (Dr. Abigail Messina based on fixture)
        expect(payload.preferredDoctor).to.not.equal('I have no preference');
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
          expect(payload.selectedDateTimePreferences.length).to.be.greaterThan(0);
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

      fillNewClientIntroAndPet({
        email: 'nopreference@example.com',
        firstName: 'No',
        lastName: 'Preference',
        phone: '207-555-9999',
        addressPreset: 'durham',
        addressQuery: '24 Orchard',
        previousVet: 'Portland Animal Hospital',
        petName: 'Fluffy',
        species: 'Cat',
        petAge: '5 years',
        howSoon: 'Flexible',
      });

      submitNewClientAppointmentRequest();

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
        expect(payload.howSoon).to.equal('Flexible');
        expect(payload.appointmentType).to.equal('Wellness exam / check-up');
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
          expect(payload.selectedDateTimePreferences.length).to.be.greaterThan(0);
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

      cy.get('input[type="email"]').type('multipet@example.com');
      cy.get('input[placeholder="First Name"]').type('Jane');
      cy.get('input[placeholder="Last Name"]').type('Smith');
      cy.get('input[type="tel"]').first().type('207-555-5678');
      stubGeoAddress('freeport');
      pickAddress('physical-address', '456 Oak', GEO_ADDRESSES.freeport.suggestion.description);
      cy.wait('@getPublicVeterinarians');
      cy.contains('Previous Veterinarian').parent().find('textarea').type('Freeport Animal Clinic');
      cy.contains('button', 'Next').click();
      cy.contains("Now let's meet your pet").should('be.visible');

      cy.wait('@getSpecies');
      fillSimplifiedPetFields({ name: 'Buddy', species: 'Dog', age: '3 years' });

      cy.contains('button', '+ Include another pet for this visit (optional)').click();
      fillSimplifiedPetFields({ name: 'Max', species: 'Dog', age: '2 years', scope: 'last' });

      selectNewClientHowSoon('Soon – sometime this week');
      submitNewClientAppointmentRequest();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.newClientPets).to.have.length(2);
        expect(payload.newClientPets[0].name).to.equal('Buddy');
        expect(payload.newClientPets[1].name).to.equal('Max');
        expect(payload.howSoon).to.equal('Soon – sometime this week');
        expect(payload.serviceMinutes).to.exist; // Should be calculated (40 + 20 = 60)
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
        }
      });
    });

    it('should handle urgent/emergent case for new client', () => {
      cy.intercept('POST', '**/public/appointments/form', (req) => {
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('submitAppointment');

      cy.visit('/client-portal/request-appointment');

      cy.get('input[type="email"]').type('urgent@example.com');
      cy.get('input[placeholder="First Name"]').type('Urgent');
      cy.get('input[placeholder="Last Name"]').type('Client');
      cy.get('input[type="tel"]').first().type('207-555-9999');
      stubGeoAddress('portland');
      pickAddress('physical-address', '789 Emer', GEO_ADDRESSES.portland.suggestion.description);
      cy.wait('@getPublicVeterinarians');
      cy.contains('Previous Veterinarian').parent().find('textarea').type('Emergency Clinic');
      cy.contains('button', 'Next').click();
      cy.contains("Now let's meet your pet").should('be.visible');

      cy.wait('@getSpecies');
      fillSimplifiedPetFields({ name: 'Emergency Pet', species: 'Dog', age: '8 years' });

      selectNewClientHowSoon('Emergent – today');
      submitNewClientAppointmentRequest();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        expect(payload.howSoon).to.equal('Emergent – today');
        expect(payload.selectedDateTimePreferences).to.be.null;
        expect(payload.appointmentType).to.equal('Wellness exam / check-up');
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

      fillExistingClientBasics();

      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 });
      selectExistingClientPetVisitReason('wellness', 0);
      cy.get('textarea').first().type('Annual check-up and vaccinations');
      selectHowSoonExisting('Flexible');
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
        expect(payload.howSoon).to.equal('Flexible');
        expect(payload.appointmentType).to.equal('Wellness exam / check-up');
        if (payload.selectedDateTimePreferences) {
          expect(payload.selectedDateTimePreferences).to.be.an('array');
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

      fillExistingClientBasics();

      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 });
      selectExistingClientPetVisitReason('not-feeling-well', 0);
      cy.get('textarea').first().type('Limping on front leg');

      cy.contains('button', '+ Add a new pet to this visit').click();
      fillSimplifiedPetFields({
        name: 'New Pet',
        species: 'Dog',
        age: '1 year',
        visitReason: 'wellness',
        scope: 'last',
      });
      selectHowSoonExisting('Soon – sometime this week');
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
        expect(payload.existingClientNewPets[0].needsCalmingMedications).to.equal('No');
        expect(payload.existingClientNewPets[0].needsMuzzleOrSpecialHandling || 'No').to.equal('No');
        
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

      fillExistingClientBasics({
        addressAnswer: 'No',
        newAddress: { preset: 'augusta', query: '999 New' },
      });

      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 });
      selectExistingClientPetVisitReason('wellness', 0);
      cy.get('textarea').first().type('Regular check-up');
      selectHowSoonExisting('Flexible');
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

      fillExistingClientBasics();

      cy.wait('@getSpecies');
      cy.get('input[type="checkbox"]', { timeout: 10000 });
      selectExistingClientPetVisitReason('end-of-life', 0);
      cy.get('textarea').first().type('Terminal cancer, in significant pain');
      cy.contains('interested in pursuing other options').parent().parent().find('input[value*="No. While this is very difficult"]').check();
      selectHowSoonExisting('Urgent – within 24–48 hours');
      cy.contains('button', 'Submit').click();

      // Verify payload
      cy.wait('@submitAppointment').then((interception) => {
        const payload = interception.request.body;
        
        const petIds = Object.keys(payload.petSpecificData);
        const petData = payload.petSpecificData[petIds[0]];
        
        expect(petData.needsToday).to.equal('End-of-life care / euthanasia');
        expect(petData.euthanasiaReason).to.equal('Terminal cancer, in significant pain');
        expect(petData.interestedInOtherOptions).to.include('No. While this is very difficult');
        
        expect(payload.selectedDateTimePreferences).to.be.null;
        expect(payload.howSoon).to.equal('Urgent – within 24–48 hours');
      });
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should validate required fields', () => {
      cy.visit('/client-portal/request-appointment');

      // Try to submit without filling required fields
      cy.contains('button', 'Submit').click();
      
      // Should show validation errors
      cy.contains('required').should('exist');
    });
  });
});

