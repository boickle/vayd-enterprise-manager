import { Box, Typography } from '@mui/material';
import AppointmentRequestPromotionsPanel from '../components/AppointmentRequestPromotionsPanel';

export default function AppointmentRequestPromotionsPage() {
  return (
    <Box p={3} display="flex" flexDirection="column" gap={3}>
      <Box>
        <Typography variant="h5" fontWeight={600}>
          Appointment request promotions
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Create employer promotions (dollar off or description-only, e.g. free trip fee) and
          share a link or code. When someone opens the request form with that promo, they&apos;ll
          see the offer at the top, and it is submitted with their request so the care team can
          follow up.
        </Typography>
      </Box>

      <AppointmentRequestPromotionsPanel />
    </Box>
  );
}
