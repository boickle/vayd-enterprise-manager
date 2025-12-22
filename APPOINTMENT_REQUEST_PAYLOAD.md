# Appointment Request Form - Payload Structure

This document describes the payload structure for the appointment request form submission. The payload adapts based on whether the user is logged in, is a new/existing client, and whether they're requesting euthanasia or a regular visit.

## API Endpoints Used

The form uses the following API endpoints for species and breed selection:

- **Species List**: `GET /public/species-breeds?practiceId=1`
  - Returns a list of available species (e.g., Canine, Feline, Avian)
  - Response includes `species` array with objects containing `id` and `name`
  
- **Breeds List**: `GET /public/species-breeds?practiceId=1&speciesId={speciesId}`
  - Returns a list of breeds for the specified species
  - Only called after a species is selected
  - Response includes `breeds` array with objects containing `id`, `name`, and nested `species` object

**Note**: The breed field in the form is implemented as a searchable type-ahead dropdown that filters breeds in real-time as the user types.

## Base Payload Structure

```json
{
  "clientType": "existing" | "new",
  "isLoggedIn": boolean,
  "email": string,
  "fullName": {
    "first": string,
    "last": string,
    "middle": string | undefined,
    "prefix": string | undefined,
    "suffix": string | undefined
  },
  "phoneNumber": string, // For existing clients: formData.bestPhoneNumber, for new clients: formData.phoneNumbers (from intro page)
  "canWeText": "Yes" | "No" | undefined, // Asked on intro page for new clients, existing client page for existing clients
  "physicalAddress": AddressObject | undefined,
  "mailingAddress": AddressObject | undefined,
  "pets": PetObject[] | undefined,
  "allPets": PetObjectWithSelection[] | undefined,
  "petInfoText": string | undefined,
  "newClientPets": NewClientPetObject[] | undefined,
  "existingClientNewPets": ExistingClientNewPetObject[] | undefined,
  "newPetInfo": string | undefined,
  "petSpecificData": PetSpecificDataObject | undefined,
  "otherPersonsOnAccount": string | undefined,
  "condoApartmentInfo": string | undefined,
  "previousVeterinaryPractices": string | undefined,
  "previousVeterinaryHospitals": string | undefined,
  "okayToContactPreviousVets": "Yes" | "No" | undefined,
  "hadVetCareElsewhere": "Yes" | "No" | undefined,
  "mayWeAskForRecords": "Yes" | "No" | undefined,
  "petBehaviorAtPreviousVisits": string | undefined,
  "needsCalmingMedications": "Yes" | "No" | undefined,
  "hasCalmingMedications": "Yes" | "No" | undefined,
  "needsMuzzleOrSpecialHandling": "Yes" | "No" | undefined,
  "appointmentType": "euthanasia" | "regular_visit",
  "preferredDoctor": string | undefined,
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area" | "Maine High Peaks Area" | undefined,
  "howSoon": "Emergent – today" | "Urgent – within 24–48 hours" | "Soon – sometime this week" | "In 3–4 weeks" | "Flexible – within the next month" | "Routine – in about 3 months" | "Planned – in about 6 months" | "Future – in about 12 months" | undefined,
  "howDidYouHearAboutUs": string | undefined,
  "anythingElse": string | undefined,
  "submittedAt": string (ISO 8601),
  "formFlow": {
    "startedAsLoggedIn": boolean,
    "startedAsExistingClient": boolean
  }
}
```

## Address Object Structure

```json
{
  "line1": string,
  "line2": string | undefined,
  "city": string,
  "state": string,
  "zip": string,
  "country": string (default: "US")
}
```

## Pet Object Structure (for logged-in users)

```json
{
  "id": string,
  "dbId": string,
  "clientId": string,
  "name": string,
  "species": string,
  "breed": string,
  "dob": string | undefined,
  "subscription": any | undefined,
  "primaryProviderName": string | undefined,
  "photoUrl": string | undefined,
  "wellnessPlans": any[] | undefined,
  "alerts": string | null
}
```

## Pet Object With Selection Structure

For `allPets` field, includes an additional `isSelected` boolean:

```json
{
  "id": string,
  "dbId": string,
  "clientId": string,
  "name": string,
  "species": string,
  "breed": string,
  "dob": string | undefined,
  "subscription": any | undefined,
  "primaryProviderName": string | undefined,
  "photoUrl": string | undefined,
  "wellnessPlans": any[] | undefined,
  "alerts": string | null,
  "isSelected": boolean
}
```

## New Client Pet Object Structure

For `newClientPets` field (used for new clients who add pets on the pet information page):

```json
{
  "id": string, // Unique ID for this pet (e.g., "new-pet-1234567890-abc123")
  "name": string,
  "species": string, // Species name (e.g., "Canine", "Feline") - populated from API dropdown
  "speciesId": number, // ID of selected species from /public/species-breeds endpoint
  "age": string, // e.g., "5 years" or DOB (labeled as "Age/DOB" in the form)
  "spayedNeutered": "Yes" | "No" | "", // Selected from dropdown
  "breed": string, // Breed name (e.g., "Golden Retriever") - populated from API searchable dropdown
  "breedId": number, // ID of selected breed from /public/species-breeds endpoint
  "color": string,
  "weight": number, // Numeric value in pounds (e.g., 12) - number input field
  "behaviorAtPreviousVisits": string, // Free-form text: "Tell us anything else you want us to know about {pet name}"
  "needsCalmingMedications": "Yes" | "No" | "",
  "hasCalmingMedications": "Yes" | "No" | "", // Only present if needsCalmingMedications is "Yes"
  "needsMuzzleOrSpecialHandling": "Yes" | "No" | ""
}
```

**Note**: 
- Species and breed are selected from API endpoints:
  - Species list: `GET /public/species-breeds?practiceId=1`
  - Breeds list: `GET /public/species-breeds?practiceId=1&speciesId={speciesId}`
- The breed field is a searchable type-ahead dropdown that filters breeds as the user types
- Both `species` and `speciesId` are included (species name for display, speciesId for reference)
- Both `breed` and `breedId` are included (breed name for display, breedId for reference)
- `spayedNeutered` is selected from a Yes/No dropdown
- `weight` is a numeric field (number type) representing pounds

## Existing Client New Pet Object Structure

For `existingClientNewPets` field (used for existing clients who add new pets on the pet selection page):

```json
{
  "id": string, // Unique ID for this pet (e.g., "existing-new-pet-1234567890-abc123")
  "name": string,
  "species": string, // Species name (e.g., "Canine", "Feline") - populated from API dropdown
  "speciesId": number, // ID of selected species from /public/species-breeds endpoint
  "age": string, // e.g., "5 years" or DOB (labeled as "Age/DOB" in the form)
  "spayedNeutered": "Yes" | "No" | "", // Selected from dropdown
  "breed": string, // Breed name (e.g., "Golden Retriever") - populated from API searchable dropdown
  "breedId": number, // ID of selected breed from /public/species-breeds endpoint
  "color": string,
  "weight": number, // Numeric value in pounds (e.g., 12) - number input field
  "behaviorAtPreviousVisits": string, // Free-form text: "Tell us anything else you want us to know about {pet name}"
  "needsCalmingMedications": "Yes" | "No" | "",
  "hasCalmingMedications": "Yes" | "No" | "", // Only present if needsCalmingMedications is "Yes"
  "needsMuzzleOrSpecialHandling": "Yes" | "No" | ""
}
```

**Note**: 
- `existingClientNewPets` has the same structure as `newClientPets` (see above for field descriptions)
- Species and breed are selected from API endpoints:
  - Species list: `GET /public/species-breeds?practiceId=1`
  - Breeds list: `GET /public/species-breeds?practiceId=1&speciesId={speciesId}`
- The breed field is a searchable type-ahead dropdown that filters breeds as the user types
- Both `species` and `speciesId` are included (species name for display, speciesId for reference)
- Both `breed` and `breedId` are included (breed name for display, breedId for reference)
- `spayedNeutered` is selected from a Yes/No dropdown
- `weight` is a numeric field (number type) representing pounds
- These pets are also included in `selectedPetIds` and have corresponding entries in `petSpecificData` when selected. They appear in the pet selection list alongside existing pets from the database.

## Pet Specific Data Structure

The `petSpecificData` object contains per-pet information keyed by pet ID. This is used for existing clients who select pets and answer questions about each pet. This includes both existing pets from the database and new pets added via `existingClientNewPets`.

```json
{
  "pet-id-1": {
    "needsToday": "Wellness exam / check-up" | "My pet isn't feeling well (new concern or illness)" | "Recheck / follow-up with the doctor (for a condition we've already seen — please briefly describe)" | "Technician visit (nail trim, anal glands, booster, blood draw, monthly injection, etc.)" | "End-of-life care / euthanasia",
    "needsTodayDetails": string | undefined,
    "euthanasiaReason": string | undefined,
    "beenToVetLastThreeMonths": string | undefined,
    "interestedInOtherOptions": string | undefined,
    "aftercarePreference": "I will handle my pet's remains (e.g. bury at home)" | "Private Cremation (Cremation WITH return of ashes)" | "Burial At Sea (Cremation WITHOUT return of ashes)" | "I am not sure yet." | undefined
  },
  "pet-id-2": {
    // Same structure for additional pets
  }
}
```

### Pet Specific Data Field Descriptions

- **`needsToday`**: Single selected option for what the pet needs (radio button selection)
- **`needsTodayDetails`**: Details/reason text provided when a radio option is selected. The placeholder text varies based on the selected option:
  - "Wellness exam / check-up": "Do you have any specific concerns you want to discuss at the visit?"
  - "My pet isn't feeling well": "Describe what is going on with {pet name}"
  - "Recheck / follow-up with the doctor": "What are we checking on for {pet name}?"
  - "Technician visit": "What would you like done for {pet name}?"
  - "End-of-life care / euthanasia": Shows full euthanasia questions instead of a single text box
- **`euthanasiaReason`**: Only present when `needsToday` is "End-of-life care / euthanasia"
- **`beenToVetLastThreeMonths`**: Only present when `needsToday` is "End-of-life care / euthanasia"
- **`interestedInOtherOptions`**: Only present when `needsToday` is "End-of-life care / euthanasia"
- **`aftercarePreference`**: Only present when `needsToday` is "End-of-life care / euthanasia"

## Euthanasia-Specific Fields

When `appointmentType` is `"euthanasia"`, the payload includes:

```json
{
  "euthanasiaReason": string | undefined,
  "beenToVetLastThreeMonths": string | undefined,
  "interestedInOtherOptions": string | undefined,
  "urgency": string | undefined,
  "preferredDateTime": string | undefined,
  "selectedDateTimePreferences": DateTimePreference[] | null,
  "noneOfWorkForMe": boolean,
  "aftercarePreference": string | undefined,
  "serviceMinutes": number | undefined
}
```

**Note**: For existing clients, euthanasia-specific fields may also be present in `petSpecificData` for individual pets when they select "End-of-life care / euthanasia" as their `needsToday` option.

## Regular Visit-Specific Fields

When `appointmentType` is `"regular_visit"`, the payload includes:

```json
{
  "preferredDateTime": string | undefined,
  "selectedDateTimePreferences": DateTimePreference[] | null,
  "noneOfWorkForMe": boolean,
  "serviceMinutes": number | undefined
}
```

**Note**: 
- The `visitDetails` field has been removed from the form and is no longer included in the payload.
- The `needsUrgentScheduling` field has been removed. Urgency is now determined solely by the `howSoon` field.
- When `howSoon` is "Emergent – today" or "Urgent – within 24–48 hours", `selectedDateTimePreferences` will be `null` and a message indicates the Client Liaison will contact them.
- The appointment availability search is automatically triggered when the user reaches the appointment time selection page (no manual urgency question).

## DateTime Preference Structure

When the user selects from recommended time slots:

```json
[
  {
    "preference": number (1, 2, or 3),
    "dateTime": string (ISO 8601),
    "display": string (e.g., "Monday, January 15, 2024 at 2:00 PM")
  }
]
```

## Zone Checking

Before fetching available veterinarians, the form performs a zone check using the `/public/appointments/find-zone-by-address` endpoint:
- **For new clients**: The check happens automatically when a complete address is entered (all fields: line1, city, state, zip)
- **For existing clients**: The check only happens when they enter a **new address** (when they answer "No" to "Is this the address where we will come to see you?" and enter a complete new address). The check is NOT performed for their address on file.
- The check is debounced (500ms delay) to avoid excessive API calls while typing
- If the zone check returns a 404 (zone not serviced), an error message "We do not service your zone" is displayed and veterinarian fetching is skipped
- If the zone check succeeds or returns a non-404 error, the veterinarian fetch proceeds normally

**Note**: The zone check result is not included in the submission payload - it's only used to validate whether the form can proceed.

## Example Payloads

### Example 1: New Client - Regular Visit

```json
{
  "clientType": "new",
  "isLoggedIn": false,
  "email": "newclient@example.com",
  "fullName": {
    "first": "John",
    "last": "Doe"
  },
  "phoneNumber": "207-555-1234",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "123 Main St",
    "city": "Portland",
    "state": "ME",
    "zip": "04101",
    "country": "US"
  },
  "mailingAddress": {
    "line1": "123 Main St",
    "city": "Portland",
    "state": "ME",
    "zip": "04101",
    "country": "US"
  },
  "newClientPets": [
    {
      "id": "new-pet-1234567890-abc123",
      "name": "Fluffy",
      "species": "Feline",
      "speciesId": 2,
      "age": "5 years",
      "spayedNeutered": "Yes",
      "breed": "Maine Coon",
      "breedId": 123,
      "color": "Orange",
      "weight": 12,
      "behaviorAtPreviousVisits": "Very friendly and calm",
      "needsCalmingMedications": "No",
      "needsMuzzleOrSpecialHandling": "No"
    }
  ],
  "previousVeterinaryPractices": "Portland Animal Hospital",
  "okayToContactPreviousVets": "Yes",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Abigail Messina",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Flexible – within the next month",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-15T14:00:00-05:00",
      "display": "Monday, January 15, 2024 at 2:00 PM"
    },
    {
      "preference": 2,
      "dateTime": "2024-01-16T10:00:00-05:00",
      "display": "Tuesday, January 16, 2024 at 10:00 AM"
    },
    {
      "preference": 3,
      "dateTime": "2024-01-17T15:00:00-05:00",
      "display": "Wednesday, January 17, 2024 at 3:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "serviceMinutes": 40,
  "howDidYouHearAboutUs": "Google search",
  "submittedAt": "2024-01-10T10:30:00Z",
  "formFlow": {
    "startedAsLoggedIn": false,
    "startedAsExistingClient": false
  }
}
```

### Example 2: Existing Client (Logged In) - Regular Visit with Multiple Pets

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "existing@example.com",
  "fullName": {
    "first": "Jane",
    "last": "Smith"
  },
  "phoneNumber": "207-555-5678",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "456 Oak Ave",
    "city": "Freeport",
    "state": "ME",
    "zip": "04032",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "alerts": null
    },
    {
      "id": "pet-124",
      "dbId": "db-124",
      "clientId": "client-456",
      "name": "Max",
      "species": "Canine",
      "breed": "Labrador Retriever",
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "pet-124",
      "dbId": "db-124",
      "clientId": "client-456",
      "name": "Max",
      "species": "Canine",
      "breed": "Labrador Retriever",
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "pet-125",
      "dbId": "db-125",
      "clientId": "client-456",
      "name": "Luna",
      "species": "Feline",
      "breed": "Siamese",
      "alerts": null,
      "isSelected": false
    }
  ],
  "petSpecificData": {
    "pet-123": {
      "needsToday": "Wellness exam / check-up",
      "needsTodayDetails": "Annual check-up and vaccinations"
    },
    "pet-124": {
      "needsToday": "My pet isn't feeling well (new concern or illness)",
      "needsTodayDetails": "Max has been limping on his front left leg for the past few days"
    }
  },
  "hadVetCareElsewhere": "No",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Heather Crispell",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Soon – sometime this week",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-18T14:00:00-05:00",
      "display": "Thursday, January 18, 2024 at 2:00 PM"
    },
    {
      "preference": 2,
      "dateTime": "2024-01-19T10:00:00-05:00",
      "display": "Friday, January 19, 2024 at 10:00 AM"
    }
  ],
  "noneOfWorkForMe": false,
  "serviceMinutes": 60,
  "submittedAt": "2024-01-10T14:20:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

### Example 3: Existing Client (Logged In) - Euthanasia Request

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "existing@example.com",
  "fullName": {
    "first": "Jane",
    "last": "Smith"
  },
  "phoneNumber": "207-555-5678",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "456 Oak Ave",
    "city": "Freeport",
    "state": "ME",
    "zip": "04032",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-123": {
      "needsToday": "End-of-life care / euthanasia",
      "euthanasiaReason": "My dog has been diagnosed with terminal cancer and is in significant pain. We've tried all treatment options.",
      "beenToVetLastThreeMonths": "Yes, we saw Dr. Johnson at Portland Animal Hospital last month",
      "interestedInOtherOptions": "No. While this is very difficult, I have made my decision. I don't wish to pursue further discussion about my decision or investigate other options at this point.",
      "aftercarePreference": "Private Cremation (Cremation WITH return of ashes)"
    }
  },
  "hadVetCareElsewhere": "No",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Heather Crispell",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Urgent – within 24–48 hours",
  "selectedDateTimePreferences": null,
  "submittedAt": "2024-01-10T14:20:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

**Note**: When any pet has `needsToday` set to "End-of-life care / euthanasia", the time slot selection UI is hidden and a message is displayed that "Once you submit the form, a Client Liaison will be in touch with you shortly about available times." In this case, `selectedDateTimePreferences` will be `null`.

### Example 4: Existing Client (Logged In) - Regular Visit with Existing Pet and New Pet Added

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "existing@example.com",
  "fullName": {
    "first": "Jane",
    "last": "Smith"
  },
  "phoneNumber": "207-555-5678",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "456 Oak Ave",
    "city": "Freeport",
    "state": "ME",
    "zip": "04032",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "dob": "2018-05-15",
      "subscription": null,
      "primaryProviderName": "Dr. Heather Crispell",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    },
    {
      "id": "existing-new-pet-1234567890-abc123",
      "name": "Luna",
      "species": "Feline",
      "speciesId": 2,
      "age": "2 years",
      "spayedNeutered": "Yes",
      "breed": "Siamese",
      "breedId": 456,
      "color": "Seal Point",
      "weight": 8,
      "behaviorAtPreviousVisits": "Very friendly, loves attention",
      "needsCalmingMedications": "No",
      "hasCalmingMedications": "",
      "needsMuzzleOrSpecialHandling": "No"
    }
  ],
  "allPets": [
    {
      "id": "pet-123",
      "dbId": "db-123",
      "clientId": "client-456",
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever",
      "dob": "2018-05-15",
      "subscription": null,
      "primaryProviderName": "Dr. Heather Crispell",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "existing-new-pet-1234567890-abc123",
      "name": "Luna",
      "species": "Feline",
      "age": "2 years",
      "spayedNeutered": "Yes",
      "breed": "Siamese",
      "color": "Seal Point",
      "weight": "8 lbs",
      "behaviorAtPreviousVisits": "Very friendly, loves attention",
      "needsCalmingMedications": "No",
      "hasCalmingMedications": "",
      "needsMuzzleOrSpecialHandling": "No",
      "isSelected": true
    }
  ],
  "existingClientNewPets": [
    {
      "id": "existing-new-pet-1234567890-abc123",
      "name": "Luna",
      "species": "Feline",
      "speciesId": 2,
      "age": "2 years",
      "spayedNeutered": "Yes",
      "breed": "Siamese",
      "breedId": 456,
      "color": "Seal Point",
      "weight": 8,
      "behaviorAtPreviousVisits": "Very friendly, loves attention",
      "needsCalmingMedications": "No",
      "hasCalmingMedications": "",
      "needsMuzzleOrSpecialHandling": "No"
    }
  ],
  "petSpecificData": {
    "pet-123": {
      "needsToday": "Wellness exam / check-up",
      "needsTodayDetails": "Annual check-up and vaccinations"
    },
    "existing-new-pet-1234567890-abc123": {
      "needsToday": "My pet isn't feeling well (new concern or illness)",
      "needsTodayDetails": "Luna has been sneezing and has discharge from her eyes"
    }
  },
  "hadVetCareElsewhere": "No",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Heather Crispell",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Soon – sometime this week",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-18T14:00:00-05:00",
      "display": "Thursday, January 18, 2024 at 2:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "serviceMinutes": 60,
  "submittedAt": "2024-01-10T14:20:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

**Note**: In this example, the existing client added a new pet (Luna) using the "Add Pet" button on the pet selection page. The new pet is included in both `existingClientNewPets` and `allPets` (with `isSelected: true`). When selected, the new pet also has an entry in `petSpecificData` with its appointment-specific information.

### Example 5: Existing Client (Not Logged In) - Regular Visit with Urgent Scheduling

```json
{
  "clientType": "existing",
  "isLoggedIn": false,
  "email": "returning@example.com",
  "fullName": {
    "first": "Bob",
    "last": "Johnson"
  },
  "phoneNumber": "207-555-9012",
  "physicalAddress": {
    "line1": "789 Pine St",
    "city": "Augusta",
    "state": "ME",
    "zip": "04330",
    "country": "US"
  },
  "petInfoText": "Max",
  "hadVetCareElsewhere": "Yes",
  "previousVeterinaryHospitals": "Emergency Veterinary Clinic in Portland",
  "mayWeAskForRecords": "Yes",
  "appointmentType": "regular_visit",
  "preferredDoctor": "I have no preference",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Emergent – today",
  "selectedDateTimePreferences": null,
  "submittedAt": "2024-01-10T16:45:00Z",
  "formFlow": {
    "startedAsLoggedIn": false,
    "startedAsExistingClient": true
  }
}
```

**Note**: When `howSoon` is "Emergent – today" or "Urgent – within 24–48 hours", `selectedDateTimePreferences` will be `null` and a message is displayed that "Once you submit the form, a Client Liaison will be in touch with you shortly about available times." The availability search is not performed for these urgent cases.

### Example 6: Existing Client - Mixed Pet Needs (One Euthanasia, One Regular)

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "multipet@example.com",
  "fullName": {
    "first": "Sarah",
    "last": "Davis"
  },
  "phoneNumber": "207-555-7890",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "555 Maple Dr",
    "city": "Scarborough",
    "state": "ME",
    "zip": "04074",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-456",
      "dbId": "db-456",
      "clientId": "client-789",
      "name": "Luna",
      "species": "Canine",
      "breed": "Border Collie",
      "alerts": null
    },
    {
      "id": "pet-789",
      "dbId": "db-789",
      "clientId": "client-789",
      "name": "Charlie",
      "species": "Canine",
      "breed": "Labrador Retriever",
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-456",
      "dbId": "db-456",
      "clientId": "client-789",
      "name": "Luna",
      "species": "Canine",
      "breed": "Border Collie",
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "pet-789",
      "dbId": "db-789",
      "clientId": "client-789",
      "name": "Charlie",
      "species": "Canine",
      "breed": "Labrador Retriever",
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-456": {
      "needsToday": "Wellness exam / check-up",
      "needsTodayDetails": "Annual wellness exam and vaccinations"
    },
    "pet-789": {
      "needsToday": "End-of-life care / euthanasia",
      "euthanasiaReason": "Charlie is very old and has stopped eating. He seems to be in pain.",
      "beenToVetLastThreeMonths": "No",
      "interestedInOtherOptions": "I'm not sure.",
      "aftercarePreference": "I will handle my pet's remains (e.g. bury at home)"
    }
  },
  "hadVetCareElsewhere": "No",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Deirdre Frey",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "howSoon": "Flexible – within the next month",
  "selectedDateTimePreferences": null,
  "submittedAt": "2024-01-10T09:30:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

**Note**: In this example, since one pet (Charlie) has `needsToday` set to "End-of-life care / euthanasia", the time slot selection UI is hidden and `selectedDateTimePreferences` is `null`, even though `howSoon` is not urgent.

## Field Notes

### Conditional Fields

1. **`pets` vs `petInfoText` vs `newClientPets` vs `existingClientNewPets`**: 
   - `pets` is included when user is logged in and has selected pets (includes existing pets from database)
   - `petInfoText` is included when user is not logged in or is a new client without structured pet data
   - `newClientPets` is included when new clients add pets on the pet information page
   - `existingClientNewPets` is included when existing clients add new pets on the pet selection page
   - `allPets` is included when user is logged in and shows all pets with their selection status (includes both existing pets and new pets added via `existingClientNewPets`)

2. **`petSpecificData`**:
   - Only included for existing clients (logged in) who have selected pets
   - Contains per-pet information keyed by pet ID
   - Includes data for both existing pets from the database and new pets added via `existingClientNewPets`
   - Each pet's data includes their selected `needsToday` option and associated details
   - For pets with "End-of-life care / euthanasia", includes full euthanasia questionnaire responses
   - New pets added via `existingClientNewPets` must be selected (included in `selectedPetIds`) to have entries in `petSpecificData`

3. **Address Fields**:
   - For existing clients who moved (`isThisTheAddressWhereWeWillCome` is "No"): `physicalAddress` uses `newPhysicalAddress`
   - For existing clients who haven't moved: `physicalAddress` uses the address from the form (their address on file)
   - For new clients: `physicalAddress` uses the address from the form
   - `mailingAddress` is only included if different from physical address
   - Before veterinarians are fetched, a zone check is performed using `/public/appointments/find-zone-by-address` to ensure the address is in a serviced zone
   - **For existing clients**: Zone check only runs when they enter a new address (not for their address on file)
   - **For new clients**: Zone check always runs when a complete address is entered

4. **DateTime Preferences**:
   - If user selected from recommended slots: `selectedDateTimePreferences` contains array of preferences
   - If user selected "None of these work for me": `noneOfWorkForMe` is `true` and `selectedDateTimePreferences` is `null`
   - If no slots were recommended: `preferredDateTime` contains free-form text
   - **If any pet has `needsToday` set to "End-of-life care / euthanasia"**: Time slot selection is hidden and `selectedDateTimePreferences` is `null`
   - **If `howSoon` is "Emergent – today" or "Urgent – within 24–48 hours"**: Time slot selection is hidden and `selectedDateTimePreferences` is `null`

5. **Urgent Scheduling**:
   - When `howSoon` is "Emergent – today" or "Urgent – within 24–48 hours": `selectedDateTimePreferences` will be `null` and a message is displayed that "Once you submit the form, a Client Liaison will be in touch with you shortly about available times."
   - When `howSoon` is any other value: The appointment availability search automatically runs when the user reaches the appointment time selection page, and users can select from available time slots or enter a preferred date/time
   - The `needsUrgentScheduling` field has been completely removed from the form and payload

6. **`howSoon` Field**:
   - Indicates how soon all pets need to be seen (single question for all pets, asked once on the pet information/selection page)
   - Affects the date range used for searching available appointment slots
   - Values: "Emergent – today", "Urgent – within 24–48 hours", "Soon – sometime this week", "In 3–4 weeks", "Flexible – within the next month", "Routine – in about 3 months", "Planned – in about 6 months", "Future – in about 12 months"
   - When "Emergent – today" or "Urgent – within 24–48 hours": No appointment search is performed, `selectedDateTimePreferences` is `null`, and Client Liaison will contact the client manually
   - When any other value: Appointment availability search automatically runs when user reaches the appointment time selection page
   - This field is now present for both new and existing clients

7. **Euthanasia Handling**:
   - When any pet has `needsToday` set to "End-of-life care / euthanasia", the appointment time selection UI is completely hidden
   - A message is displayed: "Once you submit the form, a Client Liaison will be in touch with you shortly about available times."
   - `selectedDateTimePreferences` will be `null` in this case
   - Euthanasia-specific fields (`euthanasiaReason`, `beenToVetLastThreeMonths`, `interestedInOtherOptions`, `aftercarePreference`) are stored in `petSpecificData` for that pet
   - No appointment availability search is performed when any pet is selected for euthanasia

### Undefined Values

All `undefined` values are removed from the final payload before submission to keep it clean and reduce payload size.

### Service Minutes Calculation

For routing API calls (not included in payload, but used internally):
- First pet: 40 minutes
- Each additional pet: +20 minutes
- Default (no pets selected): 40 minutes
- `serviceMinutes` is included in the payload when time slots are selected from the recommended list

### Appointment Search Timeframe

The date range for searching available appointments is dynamically adjusted based on `howSoon` using day offsets from today (today = day 0). All ranges are inclusive:

- **"Emergent – today"**: Do not auto-search - Handled manually by Client Liaison for same-day coordination
- **"Urgent – within 24–48 hours"**: Do not auto-search - Handled manually by Client Liaison
- **"Soon – sometime this week"**: Search window: Start: +1 days, End: +7 days (7 days total)
- **"In 3–4 weeks"**: Search window: Start: +21 days, End: +35 days (15 days total)
- **"Flexible – within the next month"**: Search window: Start: +4 days, End: +42 days (about 6 weeks, 39 days total)
- **"Routine – in about 3 months"**: Search window: Start: +75 days (2.5 months), End: +105 days (3.5 months, 31 days total)
- **"Planned – in about 6 months"**: Search window: Start: +135 days (4.5 months), End: +165 days (5.5 months, 31 days total)
- **"Future – in about 12 months"**: Search window: Start: +345 days (11.5 months), End: +365 days (12 months, 21 days total)

**Developer Notes:**
- Normalize everything to day offsets from today
- Use `today + min_days` and `today + max_days` when querying availability
- Skip searching for "Emergent" and "Urgent"; those go to Client Liaison workflow
- Using days avoids month-length edge cases and keeps logic consistent

### Geocoding

- For logged-in (existing) clients, address geocoding is performed before the appointment search to obtain latitude/longitude coordinates for routing
- For new clients, geocoding is skipped (address is passed as a string to the public availability API)
- Zone checking (via `/public/appointments/find-zone-by-address`) is performed for both new and existing clients before veterinarian lookup

### Species and Breed Selection

- Species are selected from a dropdown populated from `GET /public/species-breeds?practiceId=1`
- Breeds are selected from a searchable type-ahead dropdown populated from `GET /public/species-breeds?practiceId=1&speciesId={speciesId}`
- Both `species` (name) and `speciesId` are included in the payload for reference
- Both `breed` (name) and `breedId` are included in the payload for reference
- The breed dropdown is disabled until a species is selected
- The breed dropdown filters results in real-time as the user types (case-insensitive search)
- `spayedNeutered` is selected from a Yes/No dropdown (not free-form text)
- `weight` is a numeric field (number type) representing pounds, not a string