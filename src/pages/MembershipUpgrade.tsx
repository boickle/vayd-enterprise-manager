// src/pages/MembershipUpgrade.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  fetchSubscriptionPlanCatalog,
  type SubscriptionPlanCatalog,
  fetchFormattedSubscriptionPlans,
  type FormattedSubscriptionPlan,
  upgradeMembership,
  type MembershipUpgradeRequest,
} from '../api/payments';
import { listMembershipTransactions, type MembershipTransaction } from '../api/membershipTransactions';
import { useAuth } from '../auth/useAuth';

type UpgradeOption = {
  planId: string;
  planName: string;
  pricingOption: 'monthly' | 'annual';
  price: number;
  description?: string;
};

type UpgradeNavigationState = {
  petId: string;
  patientId: number | string;
  petName: string;
  currentPlanName?: string | null;
  petSpecies?: string | null;
};

type ProratedCalculation = {
  refundAmount: number; // in dollars
  chargeAmount: number; // in dollars
  refundDescription: string;
  chargeDescription: string;
  nextBillingDate: string; // ISO date string
  upgradeDate: string; // ISO date string
};

export default function MembershipUpgrade() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as UpgradeNavigationState | undefined;
  const { userEmail } = useAuth() as any;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planCatalog, setPlanCatalog] = useState<SubscriptionPlanCatalog | null>(null);
  const [formattedPlans, setFormattedPlans] = useState<FormattedSubscriptionPlan[]>([]);
  const [selectedUpgrades, setSelectedUpgrades] = useState<UpgradeOption[]>([]);
  const [processing, setProcessing] = useState(false);
  const [currentMembership, setCurrentMembership] = useState<MembershipTransaction | null>(null);

  useEffect(() => {
    if (!state) {
      navigate('/client-portal');
      return;
    }

    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Fetch current membership transaction to get enrollment date and billing info
        const [catalog, plans, transactions] = await Promise.all([
          fetchSubscriptionPlanCatalog(),
          fetchFormattedSubscriptionPlans(),
          listMembershipTransactions({ patientId: state.patientId }),
        ]);
        if (!alive) return;
        setPlanCatalog(catalog);
        setFormattedPlans(plans);
        
        // Get the most recent active/pending membership transaction
        const sortedTransactions = transactions
          .filter(t => t.status === 'active' || t.status === 'pending')
          .sort((a, b) => {
            const aTime = Date.parse(a.createdAt || a.updatedAt || '');
            const bTime = Date.parse(b.createdAt || b.updatedAt || '');
            return bTime - aTime; // Most recent first
          });
        
        if (sortedTransactions.length > 0) {
          setCurrentMembership(sortedTransactions[0]);
        }
      } catch (err: any) {
        if (!alive) return;
        setError(err?.message || 'Failed to load upgrade options.');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [state, navigate]);

  // Get available upgrade options based on current plan
  const availableUpgrades = useMemo(() => {
    if (!state?.currentPlanName || !formattedPlans.length) {
      console.log('MembershipUpgrade: Missing requirements', {
        hasPlanName: !!state?.currentPlanName,
        planName: state?.currentPlanName,
        formattedPlansCount: formattedPlans.length,
      });
      return [];
    }

    const currentPlan = state.currentPlanName.toLowerCase();
    console.log('MembershipUpgrade: Checking for upgrades', {
      currentPlan,
      formattedPlansCount: formattedPlans.length,
      formattedPlans: formattedPlans.map(p => p.planName),
    });

    const upgrades: UpgradeOption[] = [];

    // Check if they already have Plus
    const hasPlus = currentPlan.includes('plus');
    const isFoundationsPlanCheck = currentPlan.includes('foundations') || currentPlan.includes('foundation');
    const isFoundationsPlusCheck = isFoundationsPlanCheck && hasPlus;
    
    // If they have Plus (and it's not Foundations Plus), no upgrades available
    if (hasPlus && !isFoundationsPlusCheck) {
      console.log('MembershipUpgrade: Already has Plus (non-Foundations), no upgrades available');
      return [];
    }

    // Determine species from current plan or state
    // Normalize: feline -> cat, canine -> dog
    let species: string | null = state.petSpecies?.toLowerCase() || 
                   (currentPlan.includes('cat') || currentPlan.includes('feline') ? 'cat' : 
                    currentPlan.includes('dog') || currentPlan.includes('canine') ? 'dog' : null);
    
    // Normalize species names
    if (species === 'feline') {
      species = 'cat';
    } else if (species === 'canine') {
      species = 'dog';
    }
    
    console.log('MembershipUpgrade: Species normalization', {
      original: state.petSpecies,
      normalized: species,
    });

    // Check if current plan is Puppy/Kitten - no upgrades available (Puppy/Kitten is an add-on, not a base plan to upgrade from)
    const isPuppyKittenPlan = currentPlan.includes('puppy') || currentPlan.includes('kitten');
    
    if (isPuppyKittenPlan) {
      console.log('MembershipUpgrade: Puppy/Kitten plan detected, no upgrade options available');
      return []; // Puppy/Kitten is an add-on, not a base plan that can be upgraded
    }

    // Check if current plan is Foundations/Foundations Plus
    const isFoundationsPlan = currentPlan.includes('foundations') || currentPlan.includes('foundation');
    const hasFoundationsPlus = isFoundationsPlan && currentPlan.includes('plus');
    
    if (isFoundationsPlan) {
      console.log('MembershipUpgrade: Foundations/Foundations Plus plan detected', {
        hasFoundationsPlus,
        currentPlan,
      });
      
      // 1. Show Plus upgrade ONLY if they have Foundations base (NOT Plus)
      // If they already have Plus, skip this section entirely
      if (!hasFoundationsPlus) {
        // Find Foundations Plus plans
        formattedPlans.forEach((plan) => {
          const planNameLower = plan.planName.toLowerCase();
          
          const isFoundations = planNameLower.includes('foundations') || planNameLower.includes('foundation');
          const hasPlus = planNameLower.includes('plus');
          
          // Exclude Starter Plus plans (we only want base Foundations Plus)
          const hasStarter = planNameLower.includes('starter') || 
                            planNameLower.includes('puppy') || 
                            planNameLower.includes('kitten');
          
          if (isFoundations && hasPlus && !hasStarter) {
            // Check if species matches
            let speciesMatches = true;
            if (species) {
              const hasCat = planNameLower.includes('cat') || planNameLower.includes('feline');
              const hasDog = planNameLower.includes('dog') || planNameLower.includes('canine');
              const isCat = species === 'cat' || species === 'feline';
              const isDog = species === 'dog' || species === 'canine';
              speciesMatches = 
                (isCat && hasCat) ||
                (isDog && hasDog) ||
                (!hasCat && !hasDog);
            }
            
            if (speciesMatches) {
              // Add all variations of this Plus plan
              plan.variations.forEach((variation) => {
                if (variation.price?.amount) {
                  const price = variation.price.amount / 100;
                  const varNameLower = variation.name.toLowerCase();
                  const isMonthly = varNameLower.includes('monthly') || varNameLower.includes('month');
                  const cadence = isMonthly ? 'monthly' : 'annual';
                  
                  const exists = upgrades.some(
                    (u) => u.planId === plan.planId && u.pricingOption === cadence
                  );
                  
                  if (!exists) {
                    upgrades.push({
                      planId: plan.planId,
                      planName: plan.planName,
                      pricingOption: cadence,
                      price,
                      description: `Upgrade to ${plan.planName}`,
                    });
                  }
                }
                
                variation.phases?.forEach((phase) => {
                  let priceAmount: number | null = null;
                  if (phase.pricing?.amount) {
                    priceAmount = phase.pricing.amount;
                  } else if ((phase.pricing as any)?.price_money?.amount) {
                    priceAmount = (phase.pricing as any).price_money.amount;
                  } else if (typeof phase.pricing === 'number') {
                    priceAmount = phase.pricing;
                  }
                  
                  if (priceAmount) {
                    const price = priceAmount / 100;
                    const isMonthly = phase.cadence === 'MONTHLY';
                    const cadence = isMonthly ? 'monthly' : 'annual';
                    
                    const exists = upgrades.some(
                      (u) => u.planId === plan.planId && u.pricingOption === cadence
                    );
                    
                    if (!exists) {
                      upgrades.push({
                        planId: plan.planId,
                        planName: plan.planName,
                        pricingOption: cadence,
                        price,
                        description: `Upgrade to ${plan.planName}`,
                      });
                    }
                  }
                });
              });
            }
          }
        });
      }
      
      // 2. Show Puppy/Kitten options if criteria is met (pet < 1 year old, no past appointments)
      // Note: The eligibility check is done in canUpgradeMembership, so if we're here, criteria is met
      // If they have Foundations Plus, ONLY show Puppy/Kitten (no Plus options)
      // If they have Foundations base, show both Plus and Puppy/Kitten options
      console.log('MembershipUpgrade: Processing upgrades for Foundations plan', {
        hasFoundationsPlus,
        willShowPlus: !hasFoundationsPlus,
        willShowPuppyKitten: true,
      });
      
      formattedPlans.forEach((plan) => {
        const planNameLower = plan.planName.toLowerCase();
        
        // Look for Starter Wellness plans (Puppy/Kitten)
        // Exclude plans that have "plus" in them (we want only the base Starter plans, not Starter Plus)
        const isStarter = (planNameLower.includes('starter') || 
                          planNameLower.includes('puppy') || 
                          planNameLower.includes('kitten')) &&
                          !planNameLower.includes('plus'); // Exclude "Starter Plus" plans
        
        if (isStarter) {
          // Check if species matches
          let speciesMatches = true;
          if (species) {
            const hasCat = planNameLower.includes('cat') || planNameLower.includes('feline');
            const hasDog = planNameLower.includes('dog') || planNameLower.includes('canine');
            const isCat = species === 'cat' || species === 'feline';
            const isDog = species === 'dog' || species === 'canine';
            speciesMatches = 
              (isCat && hasCat) ||
              (isDog && hasDog) ||
              (!hasCat && !hasDog);
          }
          
          if (speciesMatches) {
            // Add all variations of this Starter plan
            plan.variations.forEach((variation) => {
              if (variation.price?.amount) {
                const price = variation.price.amount / 100;
                const varNameLower = variation.name.toLowerCase();
                const isMonthly = varNameLower.includes('monthly') || varNameLower.includes('month');
                const cadence = isMonthly ? 'monthly' : 'annual';
                
                const exists = upgrades.some(
                  (u) => u.planId === plan.planId && u.pricingOption === cadence
                );
                
                if (!exists) {
                  upgrades.push({
                    planId: plan.planId,
                    planName: plan.planName,
                    pricingOption: cadence,
                    price,
                    description: `Add ${plan.planName}`,
                  });
                }
              }
              
              variation.phases?.forEach((phase) => {
                let priceAmount: number | null = null;
                if (phase.pricing?.amount) {
                  priceAmount = phase.pricing.amount;
                } else if ((phase.pricing as any)?.price_money?.amount) {
                  priceAmount = (phase.pricing as any).price_money.amount;
                } else if (typeof phase.pricing === 'number') {
                  priceAmount = phase.pricing;
                }
                
                if (priceAmount) {
                  const price = priceAmount / 100;
                  const isMonthly = phase.cadence === 'MONTHLY';
                  const cadence = isMonthly ? 'monthly' : 'annual';
                  
                  const exists = upgrades.some(
                    (u) => u.planId === plan.planId && u.pricingOption === cadence
                  );
                  
                  if (!exists) {
                    upgrades.push({
                      planId: plan.planId,
                      planName: plan.planName,
                      pricingOption: cadence,
                      price,
                      description: `Add ${plan.planName}`,
                    });
                  }
                }
              });
            });
          }
        }
      });
      
      console.log('MembershipUpgrade: Final upgrades for Foundations/Foundations Plus', upgrades);
      return upgrades;
    }

    // Determine current base plan type - be more flexible with matching
    let basePlanType: string | null = null;
    if (currentPlan.includes('foundations') || currentPlan.includes('foundation')) {
      basePlanType = 'foundations';
    } else if (currentPlan.includes('golden')) {
      basePlanType = 'golden';
    } else if (currentPlan.includes('comfort')) {
      basePlanType = 'comfort';
    }

    console.log('MembershipUpgrade: Base plan detection', {
      basePlanType,
      species,
      currentPlan,
    });

    if (!basePlanType) {
      console.log('MembershipUpgrade: Could not determine base plan type');
      return []; // Can't determine base plan type
    }

    // Find Plus upgrade options ONLY for the specific base plan (no other modifiers)
    formattedPlans.forEach((plan) => {
      const planNameLower = plan.planName.toLowerCase();
      
      // Look for Plus plans matching the base plan type
      // Must contain base plan type AND "plus" (in that order, or at least both present)
      const hasBasePlan = planNameLower.includes(basePlanType);
      const hasPlus = planNameLower.includes('plus');
      
      // Exclude plans with other modifiers (starter, puppy, kitten, etc.)
      const hasStarter = planNameLower.includes('starter') || 
                        planNameLower.includes('puppy') || 
                        planNameLower.includes('kitten');
      
      // Ensure it's the Plus version of the base plan (e.g., "Foundations Plus", "Golden Plus", "Comfort Care Plus")
      // Pattern should be: [basePlanType] + "plus" (with possible words in between like "care")
      const basePlanPlusPattern = basePlanType === 'comfort' 
        ? /comfort.*care.*plus|comfort.*plus/  // "Comfort Care Plus" or "Comfort Plus"
        : new RegExp(`${basePlanType}.*plus`, 'i'); // "Foundations Plus" or "Golden Plus"
      
      const matchesBasePlanPlusPattern = basePlanPlusPattern.test(planNameLower);
      
      console.log('MembershipUpgrade: Checking plan for Plus upgrade', {
        planName: plan.planName,
        basePlanType,
        hasBasePlan,
        hasPlus,
        hasStarter,
        matchesBasePlanPlusPattern,
      });
      
      // Only show Plus plans that:
      // 1. Match the base plan type (foundations, golden, or comfort)
      // 2. Have "plus" in the name
      // 3. Don't have starter/puppy/kitten modifiers
      // 4. Match the base plan + plus pattern
      // 5. Match the species (if species is known)
      if (hasBasePlan && hasPlus && !hasStarter && matchesBasePlanPlusPattern) {
        // Check if species matches (if we have species info)
        // For Plus upgrades, we MUST match the species - no wildcards
        let speciesMatches = true;
        if (species) {
          const hasCat = planNameLower.includes('cat') || planNameLower.includes('feline');
          const hasDog = planNameLower.includes('dog') || planNameLower.includes('canine');
          
          const isCat = species === 'cat' || species === 'feline';
          const isDog = species === 'dog' || species === 'canine';
          
          // Strict species matching: must match exactly
          // If plan specifies cat, pet must be cat. If plan specifies dog, pet must be dog.
          // Only allow plans without species if pet species is unknown
          if (hasCat || hasDog) {
            speciesMatches = (isCat && hasCat) || (isDog && hasDog);
          } else {
            // Plan doesn't specify species - only allow if pet species is also unknown
            speciesMatches = false; // Don't allow plans without species if we know the pet's species
          }
          
          console.log('MembershipUpgrade: Species check (strict)', {
            species,
            isCat,
            isDog,
            hasCat,
            hasDog,
            speciesMatches,
            planName: plan.planName,
          });
        } else {
          // No species info - only allow plans that don't specify species
          const hasCat = planNameLower.includes('cat') || planNameLower.includes('feline');
          const hasDog = planNameLower.includes('dog') || planNameLower.includes('canine');
          speciesMatches = !hasCat && !hasDog; // Only allow plans without species specification
        }

        if (!speciesMatches) {
          console.log('MembershipUpgrade: Species mismatch, skipping', {
            planName: plan.planName,
            species,
          });
          return; // Skip if species doesn't match
        }

        // Add all variations of this Plus plan
        plan.variations.forEach((variation) => {
          console.log('MembershipUpgrade: Processing variation', {
            variationName: variation.name,
            hasPhases: !!variation.phases,
            phasesCount: variation.phases?.length || 0,
            hasPrice: !!variation.price,
            price: variation.price,
            phases: variation.phases,
          });
          
          // Check if variation has direct price
          if (variation.price?.amount) {
            const price = variation.price.amount / 100; // Convert cents to dollars
            // Try to determine cadence from variation name or use default
            const varNameLower = variation.name.toLowerCase();
            const isMonthly = varNameLower.includes('monthly') || varNameLower.includes('month');
            const cadence = isMonthly ? 'monthly' : 'annual';
            
            const exists = upgrades.some(
              (u) => u.planId === plan.planId && u.pricingOption === cadence
            );
            
            if (!exists) {
              console.log('MembershipUpgrade: Adding upgrade from variation price', {
                planId: plan.planId,
                planName: plan.planName,
                cadence,
                price,
              });
              upgrades.push({
                planId: plan.planId,
                planName: plan.planName,
                pricingOption: cadence,
                price,
                description: `Upgrade to ${plan.planName}`,
              });
            }
          }
          
          // Also check phases
          variation.phases?.forEach((phase) => {
            console.log('MembershipUpgrade: Processing phase', {
              cadence: phase.cadence,
              pricing: phase.pricing,
              hasAmount: !!phase.pricing?.amount,
            });
            
            // Try different pricing structures
            let priceAmount: number | null = null;
            if (phase.pricing?.amount) {
              priceAmount = phase.pricing.amount;
            } else if ((phase.pricing as any)?.price_money?.amount) {
              priceAmount = (phase.pricing as any).price_money.amount;
            } else if (typeof phase.pricing === 'number') {
              priceAmount = phase.pricing;
            }
            
            if (priceAmount) {
              const price = priceAmount / 100; // Convert cents to dollars
              const isMonthly = phase.cadence === 'MONTHLY';
              const cadence = isMonthly ? 'monthly' : 'annual';
              
              // Check if we already added this exact upgrade
              const exists = upgrades.some(
                (u) => u.planId === plan.planId && u.pricingOption === cadence
              );
              
              if (!exists) {
                console.log('MembershipUpgrade: Adding upgrade from phase', {
                  planId: plan.planId,
                  planName: plan.planName,
                  cadence,
                  price,
                });
                upgrades.push({
                  planId: plan.planId,
                  planName: plan.planName,
                  pricingOption: cadence,
                  price,
                  description: `Upgrade to ${plan.planName}`,
                });
              }
            }
          });
        });
      }
    });

    console.log('MembershipUpgrade: Final upgrades', upgrades);
    return upgrades;
  }, [state?.currentPlanName, state?.petSpecies, formattedPlans]);

  const totalPrice = useMemo(() => {
    return selectedUpgrades.reduce((sum, upgrade) => sum + upgrade.price, 0);
  }, [selectedUpgrades]);

  // Calculate prorated refunds and charges
  const proratedCalculation = useMemo((): ProratedCalculation | null => {
    if (!currentMembership || selectedUpgrades.length === 0) {
      return null;
    }

    const upgradeDate = new Date(); // Today's date
    const signupDateStr = currentMembership.createdAt || currentMembership.updatedAt;
    if (!signupDateStr) return null;

    const signupDate = new Date(signupDateStr);
    const oldPricingOption = (currentMembership.pricingOption || 'monthly').toLowerCase();
    const oldAmount = currentMembership.amount || 0; // in cents
    const oldAmountDollars = oldAmount / 100;

    // Get the first selected upgrade (assuming single upgrade for now)
    const newUpgrade = selectedUpgrades[0];
    const newPricingOption = newUpgrade.pricingOption;
    const newPrice = newUpgrade.price; // in dollars

    // Determine if it's month-to-month (Comfort Care)
    const isMonthToMonth = (currentMembership.planName || '').toLowerCase().includes('comfort');

    let refundAmount = 0;
    let chargeAmount = 0;
    let refundDescription = '';
    let chargeDescription = '';
    let nextBillingDate = '';

    if (oldPricingOption === 'annual') {
      // Annual plan upgrade
      const signupYear = signupDate.getFullYear();
      const signupMonth = signupDate.getMonth();
      const signupDay = signupDate.getDate();

      // Calculate end of annual period (1 year from signup date)
      const annualEndDate = new Date(signupYear + 1, signupMonth, signupDay);
      
      // Calculate days remaining from upgrade date to annual end date
      const daysRemaining = Math.max(0, Math.ceil((annualEndDate.getTime() - upgradeDate.getTime()) / (1000 * 60 * 60 * 24)));
      const daysInYear = 365;
      const monthsRemaining = daysRemaining / (daysInYear / 12);

      // Refund: prorated amount for remaining period
      refundAmount = (oldAmountDollars * monthsRemaining) / 12;
      refundDescription = `Prorated refund for ${monthsRemaining.toFixed(1)} months remaining (${daysRemaining} days)`;

      if (newPricingOption === 'annual') {
        // New annual plan: prorate from upgrade date to end of year (based on signup date)
        const currentYear = upgradeDate.getFullYear();
        const nextRenewalDate = new Date(signupYear + 1, signupMonth, signupDay);
        
        // If upgrade is after signup date in current year, next renewal is next year
        if (upgradeDate > new Date(signupYear, signupMonth, signupDay)) {
          const daysUntilRenewal = Math.ceil((nextRenewalDate.getTime() - upgradeDate.getTime()) / (1000 * 60 * 60 * 24));
          const monthsUntilRenewal = daysUntilRenewal / (daysInYear / 12);
          chargeAmount = (newPrice * monthsUntilRenewal) / 12;
          chargeDescription = `Prorated charge for ${monthsUntilRenewal.toFixed(1)} months until renewal`;
          nextBillingDate = nextRenewalDate.toISOString().split('T')[0];
        } else {
          // Upgrade before signup date this year
          const daysUntilRenewal = Math.ceil((nextRenewalDate.getTime() - upgradeDate.getTime()) / (1000 * 60 * 60 * 24));
          const monthsUntilRenewal = daysUntilRenewal / (daysInYear / 12);
          chargeAmount = (newPrice * monthsUntilRenewal) / 12;
          chargeDescription = `Prorated charge for ${monthsUntilRenewal.toFixed(1)} months until renewal`;
          nextBillingDate = nextRenewalDate.toISOString().split('T')[0];
        }
      } else {
        // New monthly plan: charge from upgrade date, then monthly on signup day
        chargeAmount = newPrice; // Full month charge
        chargeDescription = `Charge for new plan starting ${upgradeDate.toISOString().split('T')[0]}`;
        
        // Next billing date is signup day of next month
        const nextBilling = new Date(upgradeDate);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        nextBilling.setDate(signupDay);
        nextBillingDate = nextBilling.toISOString().split('T')[0];
      }
    } else if (isMonthToMonth) {
      // Month-to-month (Comfort Care) upgrade
      // Refund: current month's charge
      refundAmount = oldAmountDollars;
      refundDescription = `Refund for current month's charge`;

      // Charge: new plan from upgrade date, then monthly
      chargeAmount = newPrice;
      chargeDescription = `Charge for new plan starting ${upgradeDate.toISOString().split('T')[0]}`;
      
      // Next billing date is signup day of next month
      const nextBilling = new Date(upgradeDate);
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      nextBilling.setDate(signupDate.getDate());
      nextBillingDate = nextBilling.toISOString().split('T')[0];
    } else {
      // Monthly 12-month commitment upgrade
      // Refund: current month's charge
      refundAmount = oldAmountDollars;
      refundDescription = `Refund for current month's charge`;

      if (newPricingOption === 'annual') {
        // New annual plan: prorate from upgrade date to end of year (based on signup date)
        const signupYear = signupDate.getFullYear();
        const signupMonth = signupDate.getMonth();
        const signupDay = signupDate.getDate();
        const nextRenewalDate = new Date(signupYear + 1, signupMonth, signupDay);
        
        const daysUntilRenewal = Math.ceil((nextRenewalDate.getTime() - upgradeDate.getTime()) / (1000 * 60 * 60 * 24));
        const monthsUntilRenewal = daysUntilRenewal / (365 / 12);
        chargeAmount = (newPrice * monthsUntilRenewal) / 12;
        chargeDescription = `Prorated charge for ${monthsUntilRenewal.toFixed(1)} months until renewal`;
        nextBillingDate = nextRenewalDate.toISOString().split('T')[0];
      } else {
        // New monthly plan: charge from upgrade date, then monthly on signup day
        chargeAmount = newPrice;
        chargeDescription = `Charge for new plan starting ${upgradeDate.toISOString().split('T')[0]}`;
        
        // Next billing date is signup day of next month
        const nextBilling = new Date(upgradeDate);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        nextBilling.setDate(signupDate.getDate());
        nextBillingDate = nextBilling.toISOString().split('T')[0];
      }
    }

    return {
      refundAmount: Math.max(0, refundAmount),
      chargeAmount: Math.max(0, chargeAmount),
      refundDescription,
      chargeDescription,
      nextBillingDate,
      upgradeDate: upgradeDate.toISOString().split('T')[0],
    };
  }, [currentMembership, selectedUpgrades]);

  function toggleUpgrade(upgrade: UpgradeOption) {
    setSelectedUpgrades((prev) => {
      const exists = prev.find(
        (u) => u.planId === upgrade.planId && u.pricingOption === upgrade.pricingOption
      );
      if (exists) {
        return prev.filter((u) => !(u.planId === upgrade.planId && u.pricingOption === upgrade.pricingOption));
      }
      return [...prev, upgrade];
    });
  }

  async function handleCheckout() {
    if (!state || selectedUpgrades.length === 0) {
      setError('Please select at least one upgrade option.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Calculate net amount (charge - refund)
      const netAmount = proratedCalculation 
        ? proratedCalculation.chargeAmount - proratedCalculation.refundAmount
        : totalPrice;

      // Navigate to payment page with upgrade information
      navigate('/client-portal/membership-payment', {
        state: {
          petId: state.petId,
          petName: state.petName,
          isUpgrade: true,
          patientId: state.patientId,
          selectedUpgrades,
          amountCents: Math.max(0, Math.round(netAmount * 100)), // Net amount after refund
          currency: 'USD',
          proratedCalculation, // Include prorated calculation details
          currentMembership, // Include current membership for backend processing
        },
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to proceed to checkout.');
    } finally {
      setProcessing(false);
    }
  }

  if (!state) {
    return null;
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px', textAlign: 'center' }}>
        <p>Loading upgrade options...</p>
      </div>
    );
  }

  if (error && !availableUpgrades.length) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
        <div style={{ padding: 20, background: '#fef2f2', border: '1px solid #dc2626', borderRadius: 8, color: '#dc2626' }}>
          <strong>Error:</strong> {error}
        </div>
        <button
          onClick={() => navigate('/client-portal')}
          style={{
            marginTop: 20,
            padding: '10px 20px',
            backgroundColor: '#0f766e',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Back to Portal
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
      <button
        onClick={() => navigate('/client-portal')}
        style={{
          marginBottom: 20,
          padding: '8px 16px',
          background: 'transparent',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          cursor: 'pointer',
          color: '#0f766e',
        }}
      >
        ← Back
      </button>

      <h1 style={{ marginBottom: 8 }}>Upgrade Membership Plan</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Upgrade {state.petName}'s {state.currentPlanName || 'membership'} plan with additional options.
      </p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #dc2626', borderRadius: 8, color: '#dc2626', marginBottom: 24 }}>
          {error}
        </div>
      )}

      {availableUpgrades.length === 0 ? (
        <div style={{ padding: 24, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <p style={{ margin: 0, color: '#6b7280' }}>
            No upgrade options are currently available for this plan. Please contact support if you believe this is an error.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 16, marginBottom: 32 }}>
            {availableUpgrades.map((upgrade) => {
              const isSelected = selectedUpgrades.some(
                (u) => u.planId === upgrade.planId && u.pricingOption === upgrade.pricingOption
              );
              return (
                <div
                  key={`${upgrade.planId}-${upgrade.pricingOption}`}
                  onClick={() => toggleUpgrade(upgrade)}
                  style={{
                    padding: 20,
                    border: `2px solid ${isSelected ? '#0f766e' : '#e5e7eb'}`,
                    borderRadius: 12,
                    background: isSelected ? '#f0fdfa' : '#fff',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = '#0f766e';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = '#e5e7eb';
                    }
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600 }}>
                        {upgrade.planName}
                      </h3>
                      {upgrade.description && (
                        <p style={{ margin: 0, color: '#6b7280', fontSize: 14 }}>{upgrade.description}</p>
                      )}
                      <p style={{ margin: '8px 0 0', color: '#6b7280', fontSize: 14 }}>
                        Billing: {upgrade.pricingOption === 'monthly' ? 'Monthly' : 'Annual'}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#0f766e' }}>
                        {upgrade.price.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {upgrade.pricingOption === 'monthly' ? '/month' : '/year'}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <div style={{ marginTop: 12, padding: 8, background: '#0f766e', color: '#fff', borderRadius: 6, fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
                      Selected
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {selectedUpgrades.length > 0 && (
            <div
              style={{
                padding: 24,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                marginBottom: 24,
              }}
            >
              <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>Summary</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                {selectedUpgrades.map((upgrade, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      paddingBottom: 12,
                      borderBottom: idx < selectedUpgrades.length - 1 ? '1px solid #e5e7eb' : 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{upgrade.planName}</div>
                      <div style={{ fontSize: 14, color: '#6b7280' }}>
                        {upgrade.pricingOption === 'monthly' ? 'Monthly' : 'Annual'}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600 }}>{upgrade.price.toFixed(2)}</div>
                  </div>
                ))}
                {proratedCalculation && (
                  <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', marginTop: 8 }}>
                    <div style={{ marginBottom: 12, fontSize: 14, color: '#6b7280' }}>
                      <strong>Prorated Calculation:</strong>
                    </div>
                    {proratedCalculation.refundAmount > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: '#059669' }}>
                        <span>Refund ({proratedCalculation.refundDescription}):</span>
                        <span>-{proratedCalculation.refundAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span>Charge ({proratedCalculation.chargeDescription}):</span>
                      <span>{proratedCalculation.chargeAmount.toFixed(2)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
                      Next billing date: {new Date(proratedCalculation.nextBillingDate).toLocaleDateString()}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 8,
                    paddingTop: 12,
                    borderTop: '2px solid #0f766e',
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  <span>Net Amount Due</span>
                  <span>
                    {proratedCalculation 
                      ? (proratedCalculation.chargeAmount - proratedCalculation.refundAmount).toFixed(2)
                      : totalPrice.toFixed(2)
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={handleCheckout}
            disabled={selectedUpgrades.length === 0 || processing}
            style={{
              width: '100%',
              padding: '16px',
              backgroundColor: selectedUpgrades.length === 0 || processing ? '#9ca3af' : '#0f766e',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 600,
              cursor: selectedUpgrades.length === 0 || processing ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s',
            }}
          >
            {processing ? 'Processing...' : selectedUpgrades.length === 0 ? 'Select an upgrade to continue' : 'Proceed to Checkout'}
          </button>
        </>
      )}
    </div>
  );
}

