# Appointment Request Form - Payload Structure

This document describes the payload structure for the appointment request form submission. The payload adapts based on whether the user is logged in, is a new/existing client, and whether they're requesting euthanasia or a regular visit.

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
  "phoneNumber": string,
  "canWeText": "Yes" | "No" | undefined,
  "physicalAddress": AddressObject | undefined,
  "mailingAddress": AddressObject | undefined,
  "pets": PetObject[] | undefined,
  "petInfoText": string | undefined,
  "newPetInfo": string | undefined,
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
  "name": string,
  "species": string,
  "breed": string
}
```

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
  "aftercarePreference": string | undefined
}
```

## Regular Visit-Specific Fields

When `appointmentType` is `"regular_visit"`, the payload includes:

```json
{
  "visitDetails": string | undefined,
  "needsUrgentScheduling": "Yes" | "No" | undefined,
  "preferredDateTime": string | undefined,
  "selectedDateTimePreferences": DateTimePreference[] | null,
  "noneOfWorkForMe": boolean
}
```

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
  "petInfoText": "Fluffy, Cat, 5 years, Spayed, Maine Coon, Orange, 12 lbs",
  "previousVeterinaryPractices": "Portland Animal Hospital",
  "okayToContactPreviousVets": "Yes",
  "petBehaviorAtPreviousVisits": "Very friendly and calm",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Abigail Messina",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "Annual wellness exam and vaccinations",
  "needsUrgentScheduling": "No",
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
  "howDidYouHearAboutUs": "Google search",
  "submittedAt": "2024-01-10T10:30:00Z",
  "formFlow": {
    "startedAsLoggedIn": false,
    "startedAsExistingClient": false
  }
}
```

### Example 2: Existing Client (Logged In) - Euthanasia

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
      "name": "Buddy",
      "species": "Canine",
      "breed": "Golden Retriever"
    }
  ],
  "movedSinceLastVisit": "No",
  "hadVetCareElsewhere": "No",
  "appointmentType": "euthanasia",
  "preferredDoctor": "Dr. Heather Crispell",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "euthanasiaReason": "My dog has been diagnosed with terminal cancer and is in significant pain. We've tried all treatment options.",
  "beenToVetLastThreeMonths": "Yes, we saw Dr. Johnson at Portland Animal Hospital last month",
  "interestedInOtherOptions": "No. While this is very difficult, I have made my decision. I don't wish to pursue further discussion about my decision or investigate other options at this point.",
  "urgency": "The procedure is not urgent / my pet can wait a few days.",
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
    },
    {
      "preference": 3,
      "dateTime": "2024-01-22T15:00:00-05:00",
      "display": "Monday, January 22, 2024 at 3:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "aftercarePreference": "Private Cremation (Cremation WITH return of ashes)",
  "submittedAt": "2024-01-10T14:20:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

### Example 3: Existing Client (Not Logged In) - Regular Visit with Urgent Scheduling

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
  "visitDetails": "My cat has been vomiting and not eating for 2 days",
  "needsUrgentScheduling": "Yes",
  "preferredDateTime": null,
  "selectedDateTimePreferences": null,
  "noneOfWorkForMe": false,
  "submittedAt": "2024-01-10T16:45:00Z",
  "formFlow": {
    "startedAsLoggedIn": false,
    "startedAsExistingClient": true
  }
}
```

### Example 4: New Client - Euthanasia with "None of These Work for Me"

```json
{
  "clientType": "new",
  "isLoggedIn": false,
  "email": "new@example.com",
  "fullName": {
    "first": "Alice",
    "last": "Williams"
  },
  "phoneNumber": "207-555-3456",
  "physicalAddress": {
    "line1": "321 Elm St",
    "city": "Kennebunk",
    "state": "ME",
    "zip": "04043",
    "country": "US"
  },
  "petInfoText": "Whiskers, Cat, 18 years, Neutered, Domestic Shorthair, Black, 8 lbs",
  "previousVeterinaryPractices": "Kennebunk Veterinary Clinic",
  "okayToContactPreviousVets": "Yes",
  "petBehaviorAtPreviousVisits": "Very calm, no issues",
  "appointmentType": "euthanasia",
  "preferredDoctor": "Dr. Julie Greenlaw",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "euthanasiaReason": "My cat is very old and has stopped eating. He seems to be in pain.",
  "beenToVetLastThreeMonths": "No",
  "interestedInOtherOptions": "I'm not sure.",
  "urgency": "The procedure is not urgent / my pet can wait a few days.",
  "preferredDateTime": null,
  "selectedDateTimePreferences": null,
  "noneOfWorkForMe": true,
  "aftercarePreference": "I will handle my pet's remains (e.g. bury at home)",
  "submittedAt": "2024-01-10T11:15:00Z",
  "formFlow": {
    "startedAsLoggedIn": false,
    "startedAsExistingClient": false
  }
}
```

### Example 5: Logged-In Client with Multiple Pets - Regular Visit

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
      "name": "Luna",
      "species": "Canine",
      "breed": "Border Collie"
    },
    {
      "id": "pet-789",
      "name": "Charlie",
      "species": "Canine",
      "breed": "Labrador Retriever"
    }
  ],
  "movedSinceLastVisit": "No",
  "hadVetCareElsewhere": "No",
  "appointmentType": "regular_visit",
  "preferredDoctor": "Dr. Deirdre Frey",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "Annual wellness exams and vaccinations for both dogs",
  "needsUrgentScheduling": "No",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-20T09:00:00-05:00",
      "display": "Saturday, January 20, 2024 at 9:00 AM"
    },
    {
      "preference": 2,
      "dateTime": "2024-01-22T11:00:00-05:00",
      "display": "Monday, January 22, 2024 at 11:00 AM"
    },
    {
      "preference": 3,
      "dateTime": "2024-01-23T13:00:00-05:00",
      "display": "Tuesday, January 23, 2024 at 1:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "howDidYouHearAboutUs": "Friend recommendation",
  "submittedAt": "2024-01-10T09:30:00Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Field Notes

### Conditional Fields

1. **`pets` vs `petInfoText`**: 
   - `pets` is included when user is logged in and has selected pets
   - `petInfoText` is included when user is not logged in or is a new client

2. **Address Fields**:
   - For existing clients who moved: `physicalAddress` uses `newPhysicalAddress`
   - For new clients: `physicalAddress` uses the address from the form
   - `mailingAddress` is only included if different from physical address

3. **DateTime Preferences**:
   - If user selected from recommended slots: `selectedDateTimePreferences` contains array of preferences
   - If user selected "None of these work for me": `noneOfWorkForMe` is `true` and `selectedDateTimePreferences` is `null`
   - If no slots were recommended: `preferredDateTime` contains free-form text

4. **Urgent Scheduling**:
   - When `needsUrgentScheduling` is `"Yes"`, `selectedDateTimePreferences` will be `null` and the message indicates a Client Liaison will contact them

### Undefined Values

All `undefined` values are removed from the final payload before submission to keep it clean and reduce payload size.

### Service Minutes Calculation

For routing API calls (not included in payload, but used internally):
- First pet: 40 minutes
- Each additional pet: +20 minutes
- Default (no pets selected): 40 minutes

