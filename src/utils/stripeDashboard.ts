const isTestMode = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').startsWith('pk_test_');

export function stripeSubscriptionUrl(subscriptionId: string): string {
  return `https://dashboard.stripe.com/${isTestMode ? 'test/' : ''}subscriptions/${encodeURIComponent(subscriptionId)}`;
}

/** "sub_…ab12": enough to match the row on Stripe's subscription list. */
export function shortStripeId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
