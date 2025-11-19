/**
 * Script to update Square subscription plan variation prices
 * 
 * This script updates prices for existing subscription plan variations
 * using Square's UpdateSubscriptionPlanVariation endpoint.
 * 
 * Usage: 
 * 1. Set your SQUARE_ACCESS_TOKEN environment variable
 * 2. Set your SQUARE_LOCATION_ID environment variable  
 * 3. Run: node update-square-prices.js
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
  const locationId = process.env.SQUARE_LOCATION_ID;
  
  if (!accessToken || !locationId) {
    throw new Error("SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID environment variables must be set");
  }

  // First, get the current variation to preserve the phase structure
  const getUrl = `https://connect.squareup.com/v2/catalog/object/${variationId}`;
  const getResponse = await fetch(getUrl, {
    method: 'GET',
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!getResponse.ok) {
    const error = await getResponse.json();
    throw new Error(`Failed to get variation: ${JSON.stringify(error)}`);
  }

  const currentData = await getResponse.json();
  const currentVariation = currentData.object?.subscription_plan_variation_data;
  
  if (!currentVariation) {
    throw new Error(`Variation ${variationId} not found`);
  }

  // Update only the price amount in the existing phase structure
  const updatedPhases = currentVariation.phases.map(phase => {
    if (phase.cadence === cadence && phase.pricing?.type === 'STATIC') {
      return {
        ...phase,
        pricing: {
          ...phase.pricing,
          price_money: {
            ...phase.pricing.price_money,
            amount: priceAmount
          }
        }
      };
    }
    return phase;
  });

  // Update the variation with the modified phases
  const updateUrl = `https://connect.squareup.com/v2/catalog/object/${variationId}`;
  const updatePayload = {
    idempotency_key: `update-${variationId}-${Date.now()}`,
    object: {
      type: "SUBSCRIPTION_PLAN_VARIATION",
      id: variationId,
      subscription_plan_variation_data: {
        name: currentVariation.name,
        phases: updatedPhases,
        subscription_plan_id: planId
      }
    }
  };

  const updateResponse = await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updatePayload)
  });

  if (!updateResponse.ok) {
    const error = await updateResponse.json();
    throw new Error(`Failed to update variation ${variationId}: ${JSON.stringify(error)}`);
  }

  return await updateResponse.json();
}

async function updateAllPrices() {
  console.log(`Updating ${updates.length} subscription plan variations...\n`);
  
  for (const update of updates) {
    try {
      console.log(`Updating variation ${update.variationId} (${update.cadence}) to $${(update.priceAmount / 100).toFixed(2)}...`);
      const result = await updateVariationPrice(
        update.variationId,
        update.planId,
        update.priceAmount,
        update.cadence
      );
      console.log(`✓ Successfully updated ${update.variationId}\n`);
      
      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`✗ Failed to update ${update.variationId}:`, error.message);
      console.error(`  Continuing with next update...\n`);
    }
  }
  
  console.log('All updates completed!');
}

// Run the updates
updateAllPrices().catch(console.error);

