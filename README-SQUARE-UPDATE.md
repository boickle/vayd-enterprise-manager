# Square Subscription Plan Price Update

## Issue
Square's Catalog API does not allow modifying the `phases` array on existing subscription plan variations. When using bulk upsert, Square interprets including the phases array as trying to replace it, which triggers the error:

```
"On existing plan BRD2Q3LSJMHPXOAEPX7GI3MJ, phases should not be added, removed, or replaced."
```

## Solutions

### Option 1: Update via Square Dashboard (Recommended)
The easiest way is to update prices manually through Square's web dashboard:
1. Log into Square Dashboard
2. Navigate to Subscriptions > Plans
3. Update each plan's pricing individually

### Option 2: Use Square Subscription Billing API
Square's Subscription Billing API may have different endpoints for updating pricing. Check Square's documentation for:
- `UpdateSubscriptionPlanVariation` endpoint
- Or subscription-specific pricing update endpoints

**Note:** The provided `update-square-prices.js` script will likely fail with the same error because it also attempts to modify the phases array. Square's Catalog API fundamentally does not allow phase modifications on existing variations.

### Option 3: Create New Variations
If you need to update via API:
1. Create new subscription plan variations with the updated prices
2. Deprecate or archive the old variations
3. Update your application to use the new variation IDs

### Option 4: Contact Square Support
Square support can provide guidance on the correct API approach for updating subscription plan variation prices.

## Updated Prices
The following prices have been updated in `catalog-upsert.json`:
- Foundations Cat - Annual: $639 (63900 cents)
- Foundations Dog - Annual: $749 (74900 cents)  
- Comfort Care - Monthly: $289 (28900 cents)

All combined plans (Plus, Starter Wellness, etc.) have been adjusted accordingly.

