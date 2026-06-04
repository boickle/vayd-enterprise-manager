import { Alert, Box, Typography } from '@mui/material';
import MembershipStripeDiscountsPanel from '../components/MembershipStripeDiscountsPanel';
import { getFrontendPaymentProvider } from '../config/paymentProvider';

export default function MembershipPromotionsPage() {
  const paymentProvider = getFrontendPaymentProvider();

  return (
    <Box p={3} display="flex" flexDirection="column" gap={3}>
      <Box>
        <Typography variant="h5" fontWeight={600}>
          Membership promotion links
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Create Stripe discounts and share links so clients enroll with the offer applied automatically — they
          never see the promo code.
        </Typography>
      </Box>

      {paymentProvider !== 'stripe' ? (
        <Alert severity="info">
          Promotion links are only available when <code>VITE_PAYMENT_PROVIDER</code> is set to{' '}
          <code>stripe</code>. Membership checkout is currently using Square.
        </Alert>
      ) : (
        <MembershipStripeDiscountsPanel />
      )}
    </Box>
  );
}
