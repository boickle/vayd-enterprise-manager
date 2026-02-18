# Room Loader: Membership Comparison API (Backend Requirements)

This document describes the API additions needed so the **client room loader form** (last page = Summary) can show non-members how their bill would change with each membership option, per pet, with monthly and annual payment options.

---

## 1. Extend `GET /public/room-loader/form`

**Current behavior:** Returns form data for the client (token-based): practice, patients, appointments, reminders with pricing, etc.

**Add to the response body:**

### 1.1 `clientHasMembership` (boolean)

- `true` if the client (identified by token → room loader → client) has an active membership for any pet on this room loader.
- Used by the frontend to show the “See how a membership could change your bill” section only when `clientHasMembership === false`.

### 1.2 `availablePlansForPets` (array)

List of membership plans offered **per pet**, based on each pet’s species (and optionally age), so the client sees only plans that apply to that pet (e.g. dog vs cat plans, add-ons).

**Shape (TypeScript):**

```ts
interface RoomLoaderMembershipOffer {
  planId: string;           // e.g. "foundations", "golden", "comfort-care", "plus-addon", "starter-addon"
  planName: string;        // e.g. "Foundations", "Golden"
  tagLine?: string;        // e.g. "Annual Membership Plan"
  monthlyPrice: number;    // dollars
  annualPrice?: number;    // dollars (total for year or first year)
  isAddOn?: boolean;       // true for PLUS, Puppy/Kitten add-ons
}

interface RoomLoaderAvailablePlansForPet {
  patientId: number;
  patientName?: string;
  species?: string;
  plans: RoomLoaderMembershipOffer[];
}

// Response: { ...existingFields, clientHasMembership: boolean, availablePlansForPets: RoomLoaderAvailablePlansForPet[] }
```

**Logic:**

- For each patient in the room loader, determine species (and optionally age/weight if you use it for plan eligibility).
- Return the subset of your subscription/membership catalog that applies to that species (e.g. Foundations Dog, Foundations Cat, Golden Dog, Golden Cat; add-ons like PLUS, Puppy/Kitten if applicable).
- Include both **monthly** and **annual** list prices where the plan supports both (so the frontend can show “Monthly $X | Annual $Y” and let the user pick).

You can derive this from the same catalog used for membership signup (e.g. Square subscription plans or your internal plan table), filtered by species and optionally by “base vs add-on”.

---

## 2. New endpoint: `POST /public/room-loader/simulate-bill-with-membership`

**Purpose:** Given the current summary line items (and optional store totals), return the totals **as if** the client had a specific membership (plan + monthly or annual), so the frontend can show “With Foundations (monthly) your total would be $X — save $Y.”

### 2.1 Request body

```ts
{
  token: string;
  practiceId?: number;
  clientId?: number;
  planId: string;              // e.g. "foundations", "golden"
  pricingOption: "monthly" | "annual";
  patientIds: number[];         // which patient(s) the plan is for (e.g. one pet for a base plan)
  lineItems: Array<{
    name: string;
    quantity: number;
    price: number;             // current price (non-member) in dollars
    patientId: number;
    patientName?: string;
    category?: string;
    itemType?: "lab" | "procedure" | "inventory";
    itemId?: number;
  }>;
  storeSubtotal?: number;
  storeTax?: number;
}
```

- **token:** Same as form load; used to validate and resolve room loader / client.
- **planId / pricingOption:** Which membership to simulate (e.g. Foundations monthly).
- **patientIds:** Typically one patient for a single-pet plan; backend uses this to apply that plan’s benefits to the correct line items.
- **lineItems:** The same summary line items the client sees (procedures, labs, vaccines, trip fee, etc.). Include **itemType** and **itemId** when available so the backend can re-run pricing with the simulated membership; for items without ids, backend can match by name or leave price unchanged.
- **storeSubtotal / storeTax:** Optional; add to “original total” and “with membership total” so the displayed totals match the full bill (visit + store + tax).

### 2.2 Response body

```ts
{
  originalVisitSubtotal: number;   // sum of lineItems at current (non-member) price
  originalTotal: number;            // originalVisitSubtotal + storeSubtotal + storeTax
  withMembershipVisitSubtotal: number;  // same items with membership discounts applied
  membershipFee: number;            // fee for this plan/cadence (e.g. first month or annual)
  withMembershipTotal: number;     // withMembershipVisitSubtotal + membershipFee + store + tax
  savings: number;                 // originalTotal - withMembershipTotal (positive = savings)
  lineItemAdjustments?: Array<{    // optional: for per-line display
    name: string;
    patientId: number;
    originalPrice: number;
    adjustedPrice: number;
    quantity: number;
  }>;
}
```

**Backend logic:**

1. Validate token and resolve client/practice.
2. For each line item with `itemType` and `itemId`, call the same pricing logic used for `POST /public/room-loader/check-item-pricing`, but **in a “simulated” mode** where the client is treated as having the given plan (planId + pricingOption) for the given patientIds (e.g. one pet). Use existing wellness/membership discount rules.
3. Sum original prices → `originalVisitSubtotal`; sum adjusted prices → `withMembershipVisitSubtotal`.
4. Get the plan’s first payment (monthly or annual) from your catalog → `membershipFee`.
5. Compute `originalTotal`, `withMembershipTotal`, and `savings`. Optionally populate `lineItemAdjustments` for each item that changed.

---

## 3. Summary

| Change | Description |
|--------|-------------|
| **GET /public/room-loader/form** | Add `clientHasMembership: boolean` and `availablePlansForPets: RoomLoaderAvailablePlansForPet[]` so the client form knows when to show the comparison and which plans to offer per pet. |
| **POST /public/room-loader/simulate-bill-with-membership** | New endpoint; takes token, planId, pricingOption, patientIds, lineItems (and optional store totals), and returns original vs with-membership totals and savings. |

The frontend will:

- On the Summary page, if `!clientHasMembership` and `availablePlansForPets` has entries, show a “See how a membership could change your bill” section.
- For each pet (or combined), list the offered plans with Monthly | Annual toggle.
- When the user selects a plan + option, call the simulate endpoint with the current summary line items and display the returned totals and savings.
