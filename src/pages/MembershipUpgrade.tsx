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
        const [catalog, plans] = await Promise.all([
          fetchSubscriptionPlanCatalog(),
          fetchFormattedSubscriptionPlans(),
        ]);
        if (!alive) return;
        setPlanCatalog(catalog);
        setFormattedPlans(plans);
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

    // Don't show upgrades if they already have Plus
    if (currentPlan.includes('plus')) {
      console.log('MembershipUpgrade: Already has Plus, no upgrades available');
      return [];
    }

    // Don't show upgrades if they already have Puppy/Kitten
    if (currentPlan.includes('puppy') || currentPlan.includes('kitten')) {
      console.log('MembershipUpgrade: Already has Puppy/Kitten, no upgrades available');
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

    // Find Plus upgrade options for the base plan
    formattedPlans.forEach((plan) => {
      const planNameLower = plan.planName.toLowerCase();
      
      // Look for Plus plans matching the base plan type
      const hasBasePlan = planNameLower.includes(basePlanType);
      const hasPlus = planNameLower.includes('plus');
      
      console.log('MembershipUpgrade: Checking plan', {
        planName: plan.planName,
        hasBasePlan,
        hasPlus,
        basePlanType,
      });
      
      if (hasBasePlan && hasPlus) {
        // Check if species matches (if we have species info)
        let speciesMatches = true;
        if (species) {
          const hasCat = planNameLower.includes('cat') || planNameLower.includes('feline');
          const hasDog = planNameLower.includes('dog') || planNameLower.includes('canine');
          
          // Match species: check both normalized and original values
          // cat/feline matches cat/feline plans, dog/canine matches dog/canine plans
          // Also allow plans that don't specify species
          const isCat = species === 'cat' || species === 'feline';
          const isDog = species === 'dog' || species === 'canine';
          
          speciesMatches = 
            (isCat && hasCat) ||
            (isDog && hasDog) ||
            (!hasCat && !hasDog); // If plan doesn't specify species, allow it
          
          console.log('MembershipUpgrade: Species check', {
            species,
            isCat,
            isDog,
            hasCat,
            hasDog,
            speciesMatches,
            planName: plan.planName,
          });
        } else {
          // No species info, allow all plans
          speciesMatches = true;
        }

        if (!speciesMatches) {
          console.log('MembershipUpgrade: Species mismatch, skipping');
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
            } else if (phase.pricing?.price_money?.amount) {
              priceAmount = phase.pricing.price_money.amount;
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
      // Navigate to payment page with upgrade information
      navigate('/client-portal/membership-payment', {
        state: {
          petId: state.petId,
          petName: state.petName,
          isUpgrade: true,
          patientId: state.patientId,
          selectedUpgrades,
          amountCents: totalPrice * 100,
          currency: 'USD',
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
                        ${upgrade.price.toFixed(2)}
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
                    <div style={{ fontWeight: 600 }}>${upgrade.price.toFixed(2)}</div>
                  </div>
                ))}
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
                  <span>Total</span>
                  <span>${totalPrice.toFixed(2)}</span>
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

