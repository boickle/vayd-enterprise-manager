# Room Loader: Membership comparison (frontend guide)

## 1. GET /public/room-loader/form?token=...

**New fields on the existing response:**

| Field | Type | Description |
|-------|------|-------------|
| `clientHasMembership` | boolean | `true` if the client has an active membership for any pet on this room loader. |
| `availablePlansForPets` | array | One entry per pet; each lists the membership plans offered for that pet. |

### When to show the comparison UI

Show the "See how a membership could change your bill" section only when:

- `clientHasMembership === false`
- `availablePlansForPets` is non-empty (e.g. `availablePlansForPets?.length > 0`).

### Shape of availablePlansForPets

```ts
// One element per pet on the room loader
interface RoomLoaderAvailablePlansForPet {
  patientId: number;
  patientName?: string;
  species?: string;
  plans: RoomLoaderMembershipOffer[];
}

interface RoomLoaderMembershipOffer {
  planId: string;        // e.g. "foundations", "golden", "comfort-care"
  planName: string;      // e.g. "Foundations", "Golden"
  tagLine?: string;
  monthlyPrice: number;  // dollars (may be 0 if not configured)
  annualPrice?: number;  // dollars
  isAddOn?: boolean;
}
```

- Use `patientId` (and optionally `patientName` / `species`) to group or label by pet.
- Use `plans` to render plan options; show **Monthly $X | Annual $Y** when both `monthlyPrice` and `annualPrice` are present (and non-zero if you want to hide "$0").

---

## 2. POST /public/room-loader/simulate-bill-with-membership

### When to call

When the user picks a plan and pricing option (monthly vs annual) so you can show "With [Plan] (monthly/annual) your total would be $X — save $Y."

### Request body

```ts
{
  token: string;           // Same token as the form link
  planId: string;          // e.g. "foundations", "golden"
  pricingOption: "monthly" | "annual";
  patientIds: number[];    // Pet(s) the plan is for (usually one)
  lineItems: Array<{
    name: string;
    quantity: number;
    price: number;         // Current (non-member) price in dollars
    patientId: number;
    patientName?: string;
    category?: string;
    itemType?: "lab" | "procedure" | "inventory";  // Send when you have it
    itemId?: number;       // Lab/procedure/inventory id; send when you have it
  }>;
  storeSubtotal?: number;  // Optional; add to totals
  storeTax?: number;       // Optional
  practiceId?: number;     // Optional; resolved from token if omitted
  clientId?: number;       // Optional; resolved from token if omitted
}
```

- **lineItems:** Use the same summary line items the user sees (procedures, labs, vaccines, trip fee, etc.). **Include `itemType` and `itemId` for every line that comes from a known lab, procedure, or inventory item** (reminders, vaccines, labs, add-on items). The backend applies membership discounts only to lines that have both `itemType` (exactly `"lab"`, `"procedure"`, or `"inventory"`) and `itemId`. Omit them for lines that don’t map to a single item (e.g. trip fees, sharps disposal, custom charges); those lines keep their current price in the simulation.
- **patientIds:** Typically one patient for a single-pet plan; must be one of the pets on the room loader.

### Response

```ts
{
  originalVisitSubtotal: number;   // Sum of lineItems at current prices
  originalTotal: number;            // originalVisitSubtotal + store + tax
  withMembershipVisitSubtotal: number;
  membershipFee: number;            // See below — must differ by pricingOption
  withMembershipTotal: number;      // Visit (with discounts) + membershipFee + store + tax
  savings: number;                  // originalTotal - withMembershipTotal (positive = savings)
  monthlyCharge?: number;            // When pricingOption is "monthly": first month's membership due. Frontend uses withMembershipVisitSubtotal + monthlyCharge for "due at visit".
  monthlyMembershipFee?: number;    // When pricingOption is "monthly": optional (e.g. for display)
  lineItemAdjustments?: Array<{     // Optional; per-line changes for UI
    name: string;
    patientId: number;
    originalPrice: number;
    adjustedPrice: number;
    quantity: number;
  }>;
  remainingPlanBenefits?: Array<{   // Optional; plan benefits still available, not used in this visit
    name: string;
    remainingQuantity?: number;
    includedQuantity?: number;
    price?: number;                 // Plan/membership price per unit (what the member pays when using this benefit)
    regularPrice?: number;          // Standard (non-member) price per unit, e.g. for "Value $X"
  }>;
}
```

**Important: response must depend on `pricingOption`.** The frontend calls simulate twice (once with `pricingOption: "monthly"`, once with `"annual"`) and shows both "due at visit" amounts so the client can compare.

- **When `pricingOption === "monthly"`:**  
  `membershipFee` = **first month’s** plan price (what they pay at the visit for the membership).  
  `withMembershipTotal` = discounted visit subtotal + first month fee + store/tax.  
  This is the lower “due at visit” (rest paid over next 11 months).

- **When `pricingOption === "annual"`:**  
  `membershipFee` = **full annual** plan price (what they pay at the visit for the year).  
  `withMembershipTotal` = discounted visit subtotal + annual fee + store/tax.  
  This is the higher “due at visit” (then covered for the year).

If both requests return the same `membershipFee` and `withMembershipTotal`, the UI will show the same number for monthly and annual; the backend must use `pricingOption` to set different fees and totals.

### Suggested UI

- "Your total today: $originalTotal"
- "With planName (pricingOption): $withMembershipTotal (includes $membershipFee membership)"
- "You save $savings"
- Optionally use `lineItemAdjustments` to show which lines got a lower price.
- If provided, `remainingPlanBenefits` is shown under "Also included in your plan (not used this visit):" so clients see benefits they still have (e.g. annual fecal, nail trim) that aren't used in this visit.

---

## 3. Flow summary

1. **Load form:** `GET /public/room-loader/form?token=...`
2. If `!clientHasMembership` and `availablePlansForPets?.length > 0`, show the membership comparison block.
3. For each pet (or combined), list `availablePlansForPets[].plans` with a **Monthly | Annual** toggle.
4. On plan + option selection, call `POST /public/room-loader/simulate-bill-with-membership` with the current summary `lineItems` (and optional store totals).
5. Display the returned totals and savings (and optionally `lineItemAdjustments`).

---

## 4. Notes for frontend

- **Token:** Same token as the form link for both GET form and POST simulate; no auth header.
- **Rate limits:** Form and submit are stricter; simulate is 30/min per IP.
- **Prices:** If backend has no plan display config, `monthlyPrice`/`annualPrice` and `membershipFee` can be 0; you can still show the comparison and "Select to see savings" or contact-for-pricing if you prefer.
- **CORS:** Same as other public room-loader endpoints (no auth).
