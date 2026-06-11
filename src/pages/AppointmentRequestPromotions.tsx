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
          Create employer discount promotions and share a link with the company. When an
          employee opens the appointment request form via that link, they&apos;ll see the
          company name and discount amount at the top of the form, and the token is
          submitted with their request so the care team can follow up accordingly.
        </Typography>
      </Box>

      <AppointmentRequestPromotionsPanel />
    </Box>
  );
}
