# Existing Client Appointment Request - Comprehensive Payload Examples

This document provides example payloads for existing client appointment requests, covering all possible scenarios.

## Complete Example - Multiple Pets with Different Scenarios

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "existing.client@example.com",
  "fullName": {
    "first": "Jane",
    "last": "Smith",
    "middle": undefined,
    "prefix": undefined,
    "suffix": undefined
  },
  "phoneNumber": "207-555-1234",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "123 Main Street",
    "line2": "Apt 4B",
    "city": "Portland",
    "state": "ME",
    "zip": "04101",
    "country": "US"
  },
  "mailingAddress": {
    "line1": "456 Mailing St",
    "line2": undefined,
    "city": "Portland",
    "state": "ME",
    "zip": "04102",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-123",
      "dbId": 123,
      "clientId": "client-456",
      "name": "Atlas",
      "species": "Canine",
      "breed": "Golden Retriever",
      "dob": "2018-05-15",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    },
    {
      "id": "pet-124",
      "dbId": 124,
      "clientId": "client-456",
      "name": "Luna",
      "species": "Feline",
      "breed": "Siamese",
      "dob": "2020-03-20",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-123",
      "dbId": 123,
      "clientId": "client-456",
      "name": "Atlas",
      "species": "Canine",
      "breed": "Golden Retriever",
      "dob": "2018-05-15",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "pet-124",
      "dbId": 124,
      "clientId": "client-456",
      "name": "Luna",
      "species": "Feline",
      "breed": "Siamese",
      "dob": "2020-03-20",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    }
  ],
  "petInfoText": undefined,
  "newPetInfo": undefined,
  "otherPersonsOnAccount": "John Smith (spouse)",
  "condoApartmentInfo": undefined,
  "previousVeterinaryPractices": undefined,
  "previousVeterinaryHospitals": "Portland Animal Hospital",
  "okayToContactPreviousVets": "Yes",
  "hadVetCareElsewhere": "No",
  "mayWeAskForRecords": "Yes",
  "petBehaviorAtPreviousVisits": undefined,
  "needsCalmingMedications": undefined,
  "hasCalmingMedications": undefined,
  "needsMuzzleOrSpecialHandling": undefined,
  "petSpecificData": {
    "pet-123": {
      "needsToday": "Wellness exam / check-up",
      "needsTodayDetails": "Annual check-up, want to discuss diet and exercise routine"
    },
    "pet-124": {
      "needsToday": "My pet isn't feeling well (new concern or illness)",
      "needsTodayDetails": "Luna has been vomiting for the past 2 days and seems lethargic"
    }
  },
  "howSoon": "Urgent – within 24–48 hours",
  "appointmentType": "regular_visit",
  "preferredDoctor": "doctor-789",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "General wellness check for Atlas, urgent care for Luna",
  "needsUrgentScheduling": "Yes",
  "preferredDateTime": undefined,
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
    }
  ],
  "noneOfWorkForMe": false,
  "serviceMinutes": 60,
  "howDidYouHearAboutUs": "Friend referral",
  "anythingElse": "Please call before arriving",
  "submittedAt": "2024-01-10T10:30:00.000Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Example 2: Pet with Recheck/Follow-up

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "client@example.com",
  "fullName": {
    "first": "John",
    "last": "Doe"
  },
  "phoneNumber": "207-555-5678",
  "canWeText": "No",
  "physicalAddress": {
    "line1": "789 Oak Avenue",
    "city": "Kennebunk",
    "state": "ME",
    "zip": "04043",
    "country": "US"
  },
  "mailingAddress": undefined,
  "pets": [
    {
      "id": "pet-125",
      "dbId": 125,
      "clientId": "client-457",
      "name": "Max",
      "species": "Canine",
      "breed": "Labrador",
      "dob": "2019-08-10",
      "subscription": null,
      "primaryProviderName": "Dr. Williams",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-125",
      "dbId": 125,
      "clientId": "client-457",
      "name": "Max",
      "species": "Canine",
      "breed": "Labrador",
      "dob": "2019-08-10",
      "subscription": null,
      "primaryProviderName": "Dr. Williams",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-125": {
      "needsToday": "Recheck / follow-up with the doctor (for a condition we've already seen — please briefly describe)",
      "needsTodayDetails": "Following up on the skin condition we saw last month, checking if the medication is working"
    }
  },
  "howSoon": "Soon – sometime this week",
  "appointmentType": "regular_visit",
  "preferredDoctor": "doctor-789",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "Recheck appointment for Max's skin condition",
  "needsUrgentScheduling": "No",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-17T15:00:00-05:00",
      "display": "Wednesday, January 17, 2024 at 3:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "submittedAt": "2024-01-10T11:00:00.000Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Example 3: Pet with Technician Visit

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "client@example.com",
  "fullName": {
    "first": "Sarah",
    "last": "Johnson"
  },
  "phoneNumber": "207-555-9999",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "321 Pine Street",
    "city": "Augusta",
    "state": "ME",
    "zip": "04330",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-126",
      "dbId": 126,
      "clientId": "client-458",
      "name": "Bella",
      "species": "Canine",
      "breed": "Beagle",
      "dob": "2021-11-05",
      "subscription": null,
      "primaryProviderName": "Dr. Brown",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-126",
      "dbId": 126,
      "clientId": "client-458",
      "name": "Bella",
      "species": "Canine",
      "breed": "Beagle",
      "dob": "2021-11-05",
      "subscription": null,
      "primaryProviderName": "Dr. Brown",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-126": {
      "needsToday": "Technician visit (nail trim, anal glands, booster, blood draw, monthly injection, etc.)",
      "needsTodayDetails": "Need nail trim and monthly heartworm prevention injection"
    }
  },
  "howSoon": "Flexible – within the next month",
  "appointmentType": "regular_visit",
  "preferredDoctor": "doctor-789",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "Technician visit for nail trim and injection",
  "needsUrgentScheduling": "No",
  "selectedDateTimePreferences": null,
  "noneOfWorkForMe": false,
  "submittedAt": "2024-01-10T12:00:00.000Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Example 4: Pet with End-of-Life Care / Euthanasia

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "client@example.com",
  "fullName": {
    "first": "Michael",
    "last": "Davis"
  },
  "phoneNumber": "207-555-7777",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "555 Elm Street",
    "city": "Portland",
    "state": "ME",
    "zip": "04101",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-127",
      "dbId": 127,
      "clientId": "client-459",
      "name": "Charlie",
      "species": "Canine",
      "breed": "German Shepherd",
      "dob": "2010-06-12",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-127",
      "dbId": 127,
      "clientId": "client-459",
      "name": "Charlie",
      "species": "Canine",
      "breed": "German Shepherd",
      "dob": "2010-06-12",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-127": {
      "needsToday": "End-of-life care / euthanasia",
      "needsTodayDetails": undefined,
      "euthanasiaReason": "Charlie has been diagnosed with advanced cancer and is in significant pain. His quality of life has deteriorated significantly over the past month.",
      "beenToVetLastThreeMonths": "Yes, we saw Dr. Johnson last week for pain management",
      "interestedInOtherOptions": "No. While this is very difficult, I have made my decision. I don't wish to pursue further discussion about my decision or investigate other options at this point.",
      "aftercarePreference": "Private Cremation (Cremation WITH return of ashes)"
    }
  },
  "howSoon": "Emergent – today",
  "appointmentType": "euthanasia",
  "preferredDoctor": "doctor-789",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "euthanasiaReason": undefined,
  "beenToVetLastThreeMonths": undefined,
  "interestedInOtherOptions": undefined,
  "urgency": undefined,
  "preferredDateTime": "2024-01-10T14:00:00-05:00",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-10T14:00:00-05:00",
      "display": "Wednesday, January 10, 2024 at 2:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "aftercarePreference": undefined,
  "serviceMinutes": 45,
  "submittedAt": "2024-01-10T10:00:00.000Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Example 5: Multiple Pets - Mixed Scenarios

```json
{
  "clientType": "existing",
  "isLoggedIn": true,
  "email": "client@example.com",
  "fullName": {
    "first": "Emily",
    "last": "Wilson"
  },
  "phoneNumber": "207-555-8888",
  "canWeText": "Yes",
  "physicalAddress": {
    "line1": "999 Maple Drive",
    "city": "Portland",
    "state": "ME",
    "zip": "04102",
    "country": "US"
  },
  "pets": [
    {
      "id": "pet-128",
      "dbId": 128,
      "clientId": "client-460",
      "name": "Rocky",
      "species": "Canine",
      "breed": "Bulldog",
      "dob": "2017-04-22",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    },
    {
      "id": "pet-129",
      "dbId": 129,
      "clientId": "client-460",
      "name": "Mittens",
      "species": "Feline",
      "breed": "Persian",
      "dob": "2019-09-15",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null
    }
  ],
  "allPets": [
    {
      "id": "pet-128",
      "dbId": 128,
      "clientId": "client-460",
      "name": "Rocky",
      "species": "Canine",
      "breed": "Bulldog",
      "dob": "2017-04-22",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    },
    {
      "id": "pet-129",
      "dbId": 129,
      "clientId": "client-460",
      "name": "Mittens",
      "species": "Feline",
      "breed": "Persian",
      "dob": "2019-09-15",
      "subscription": null,
      "primaryProviderName": "Dr. Johnson",
      "photoUrl": null,
      "wellnessPlans": [],
      "alerts": null,
      "isSelected": true
    }
  ],
  "petSpecificData": {
    "pet-128": {
      "needsToday": "Wellness exam / check-up",
      "needsTodayDetails": "Annual wellness exam, vaccinations due"
    },
    "pet-129": {
      "needsToday": "My pet isn't feeling well (new concern or illness)",
      "needsTodayDetails": "Mittens has been sneezing and has discharge from eyes for 3 days"
    }
  },
  "howSoon": "Soon – sometime this week",
  "appointmentType": "regular_visit",
  "preferredDoctor": "doctor-789",
  "serviceArea": "Kennebunk / Greater Portland / Augusta Area",
  "visitDetails": "Wellness exam for Rocky, urgent care for Mittens",
  "needsUrgentScheduling": "No",
  "selectedDateTimePreferences": [
    {
      "preference": 1,
      "dateTime": "2024-01-18T11:00:00-05:00",
      "display": "Thursday, January 18, 2024 at 11:00 AM"
    },
    {
      "preference": 2,
      "dateTime": "2024-01-19T14:00:00-05:00",
      "display": "Friday, January 19, 2024 at 2:00 PM"
    }
  ],
  "noneOfWorkForMe": false,
  "serviceMinutes": 75,
  "submittedAt": "2024-01-10T13:00:00.000Z",
  "formFlow": {
    "startedAsLoggedIn": true,
    "startedAsExistingClient": true
  }
}
```

## Field Descriptions

### petSpecificData Structure

For each selected pet, `petSpecificData` contains:

**Regular Visit Options:**
- `needsToday`: One of:
  - `"Wellness exam / check-up"`
  - `"My pet isn't feeling well (new concern or illness)"`
  - `"Recheck / follow-up with the doctor (for a condition we've already seen — please briefly describe)"`
  - `"Technician visit (nail trim, anal glands, booster, blood draw, monthly injection, etc.)"`
  - `"End-of-life care / euthanasia"`
- `needsTodayDetails`: Required text field with details specific to the selected option

**End-of-Life Care Option:**
When `needsToday` is `"End-of-life care / euthanasia"`, the following fields are required:
- `euthanasiaReason`: Text describing what's going on with the pet
- `beenToVetLastThreeMonths`: Text indicating if pet has been to vet recently
- `interestedInOtherOptions`: One of:
  - `"No. While this is very difficult, I have made my decision. I don't wish to pursue further discussion about my decision or investigate other options at this point."`
  - `"Yes. I am interested in speaking with the doctor about other options that may help."`
  - `"I'm not sure."`
- `aftercarePreference`: One of:
  - `"I will handle my pet's remains (e.g. bury at home)"`
  - `"Private Cremation (Cremation WITH return of ashes)"`
  - `"Burial At Sea (Cremation WITHOUT return of ashes)"`
  - `"I am not sure yet."`

### howSoon Field

Single value for all pets, one of:
- `"Emergent – today"`
- `"Urgent – within 24–48 hours"`
- `"Soon – sometime this week"`
- `"Flexible – within the next month"`
- `"Routine – in about 3 months"`
- `"Planned – in about 6 months"`
- `"Future – in about 12 months"`

### appointmentType

- `"euthanasia"`: If any pet has `needsToday` = `"End-of-life care / euthanasia"`
- `"regular_visit"`: For all other cases

### selectedDateTimePreferences

Array of date/time preferences when user selects from recommended slots:
- `preference`: Number (1, 2, or 3) indicating order of preference
- `dateTime`: ISO 8601 string
- `display`: Human-readable date/time string

### Notes

- All `undefined` values should be omitted from the final payload (the form cleans these out)
- `petSpecificData` only includes entries for selected pets
- When `appointmentType` is `"euthanasia"`, the top-level euthanasia fields may be undefined if the euthanasia info is only in `petSpecificData`
- `serviceMinutes` is included when time slots are selected from recommendations
- `noneOfWorkForMe` is `false` when slots are selected, `true` when user indicates none of the suggested times work


