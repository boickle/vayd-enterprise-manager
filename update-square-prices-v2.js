/**
 * Script to update Square subscription plan variation prices
 * 
 * This script attempts multiple approaches to update pricing:
 * 1. Try updating only the pricing field without phases array
 * 2. Try using PATCH method
 * 3. Fall back to full update if needed
 * 
 * Usage: 
 * 1. Set your SQUARE_ACCESS_TOKEN environment variable
 * 2. Run: node update-square-prices-v2.js
 */

const updates = [
  // Foundations Cat - Annual: $639 (63900 cents)
  {
    variationId: "5OQ62K7VIPCPH4JCXS5NWE4Y",
    planId: "VFXIWMFA7HQDAAIIBBMRBFWX",
    priceAmount: 63900,
    cadence: "ANNUAL"
  },
  // Foundations Plus - Cat, Yearly: $1168 (116800 cents)
  {
    variationId: "AANYKRRBUAQN7EKR24LKVUNO",
    planId: "GLEZPBB6V4K53XUWTAVO3UQJ",
    priceAmount: 116800,
    cadence: "ANNUAL"
  },
  // Foundations Starter Wellness - Cat, Yearly: $948 (94800 cents)
  {
    variationId: "JGGM6P6ENLQ6HLCU4DUY6O3R",
    planId: "YDSKJOC2HYHEJSYVSD6EMYO2",
    priceAmount: 94800,
    cadence: "ANNUAL"
  },
  // Foundations Starter Wellness Plus - Cat, Yearly: $1477 (147700 cents)
  {
    variationId: "HSMKGW35MECRD32D3DTU2FQX",
    planId: "4YRLNQNYLVMRIMB7GDZ7BGDT",
    priceAmount: 147700,
    cadence: "ANNUAL"
  },
  // Foundations Dog - Annual: $749 (74900 cents)
  {
    variationId: "AMDGXI7ROH6462N7PZD7RDIU",
    planId: "UT5KMJWVJS3L6GC2POVUCAGP",
    priceAmount: 74900,
    cadence: "ANNUAL"
  },
  // Foundations Plus - Dog, Yearly: $1278 (127800 cents)
  {
    variationId: "RTYPGILYTOK7BZMT2SAO5XFV",
    planId: "FGHIFGX3MBPYP6LEPNUIGZ3F",
    priceAmount: 127800,
    cadence: "ANNUAL"
  },
  // Foundations Starter Wellness - Dog, Yearly: $1058 (105800 cents)
  {
    variationId: "QUDUN2GBYXT2QJUFO3LFJJGM",
    planId: "5USFRLPPLUDS4WEBHJXUNH47",
    priceAmount: 105800,
    cadence: "ANNUAL"
  },
  // Foundations Starter Wellness Plus - Dog, Yearly: $1587 (158700 cents)
  {
    variationId: "TRMKVONWNQJC7GZECRYJRV3Z",
    planId: "WN275KVMCGN4M2FB2ABCU5IP",
    priceAmount: 158700,
    cadence: "ANNUAL"
  },
  // Comfort Care - Monthly: $289 (28900 cents)
  {
    variationId: "UKQB5YYSJYQ7FOW6LJTVFHYB",
    planId: "HUCHWCLTKGCJFM7GHAVJ7A6Q",
    priceAmount: 28900,
    cadence: "MONTHLY"
  }
];

async function updateVariationPrice(variationId, planId, priceAmount, cadence) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("SQUARE_ACCESS_TOKEN environment variable must be set");
  }

  const headers = {
    'Square-Version': '2024-01-18',
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  // Approach 1: Try updating with minimal payload - only include what we're changing
  // This attempts to update just the pricing without the full phases structure
  console.log(`Attempting Approach 1: Minimal update for ${variationId}...`);
  
  const minimalUpdateUrl = `https://connect.squareup.com/v2/catalog/object/${variationId}`;
  const minimalPayload = {
    idempotency_key: `update-${variationId}-${Date.now()}`,
    object: {
      type: "SUBSCRIPTION_PLAN_VARIATION",
      id: variationId,
      subscription_plan_variation_data: {
        // Try including only the phase with updated pricing
        phases: [
          {
            cadence: cadence,
            ordinal: 0,
            pricing: {
              type: "STATIC",
              price_money: {
                amount: priceAmount,
                currency: "USD"
              }
            }
          }
        ]
      }
    }
  };

  try {
    const response = await fetch(minimalUpdateUrl, {
      method: 'PUT',
      headers: headers,
      body: JSON.stringify(minimalPayload)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log(`✓ Successfully updated ${variationId} using minimal update`);
      return result;
    } else {
      console.log(`✗ Approach 1 failed: ${JSON.stringify(result.errors || result)}`);
      
      // Approach 2: Try using the Subscription Billing API endpoint if it exists
      console.log(`Attempting Approach 2: Subscription Billing API endpoint...`);
      
      // Note: This endpoint may not exist, but worth trying
      const billingApiUrl = `https://connect.squareup.com/v2/subscriptions/plans/${planId}/variations/${variationId}`;
      const billingPayload = {
        subscription_plan_variation: {
          phases: [
            {
              cadence: cadence,
              ordinal: 0,
              pricing: {
                type: "STATIC",
                price_money: {
                  amount: priceAmount,
                  currency: "USD"
                }
              }
            }
          ]
        }
      };

      try {
        const billingResponse = await fetch(billingApiUrl, {
          method: 'PUT',
          headers: headers,
          body: JSON.stringify(billingPayload)
        });

        const billingResult = await billingResponse.json();
        
        if (billingResponse.ok) {
          console.log(`✓ Successfully updated ${variationId} using Subscription Billing API`);
          return billingResult;
        } else {
          console.log(`✗ Approach 2 failed: ${JSON.stringify(billingResult.errors || billingResult)}`);
          throw new Error(`All approaches failed for ${variationId}`);
        }
      } catch (billingError) {
        console.log(`✗ Approach 2 error: ${billingError.message}`);
        throw new Error(`All approaches failed for ${variationId}: ${result.errors?.[0]?.detail || 'Unknown error'}`);
      }
    }
  } catch (error) {
    throw new Error(`Failed to update ${variationId}: ${error.message}`);
  }
}

async function updateAllPrices() {
  console.log(`Attempting to update ${updates.length} subscription plan variations...\n`);
  console.log(`Note: Square's API may not allow updating phases on existing variations.\n`);
  console.log(`If this fails, you may need to:\n`);
  console.log(`1. Contact Square Support for the correct API method\n`);
  console.log(`2. Create new variations with updated prices\n`);
  console.log(`3. Use Square's web interface (though you mentioned this costs extra)\n\n`);
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const update of updates) {
    try {
      console.log(`\n--- Updating variation ${update.variationId} ---`);
      console.log(`Plan: ${update.planId}`);
      console.log(`Cadence: ${update.cadence}`);
      console.log(`New Price: $${(update.priceAmount / 100).toFixed(2)}\n`);
      
      const result = await updateVariationPrice(
        update.variationId,
        update.planId,
        update.priceAmount,
        update.cadence
      );
      
      results.success.push({ variationId: update.variationId, result });
      
      // Add a delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`\n✗ Failed: ${error.message}\n`);
      results.failed.push({ 
        variationId: update.variationId, 
        error: error.message 
      });
    }
  }
  
  console.log(`\n\n=== SUMMARY ===`);
  console.log(`Successful: ${results.success.length}`);
  console.log(`Failed: ${results.failed.length}`);
  
  if (results.failed.length > 0) {
    console.log(`\nFailed variations:`);
    results.failed.forEach(f => {
      console.log(`  - ${f.variationId}: ${f.error}`);
    });
  }
  
  if (results.failed.length === updates.length) {
    console.log(`\n⚠️  All updates failed. This likely means Square's API does not support`);
    console.log(`   updating phases on existing subscription plan variations.`);
    console.log(`   You may need to contact Square Support for the correct method.`);
  }
}

// Run the updates
updateAllPrices().catch(console.error);

