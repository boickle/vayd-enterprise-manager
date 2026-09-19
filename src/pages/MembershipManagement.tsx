import { useMemo, useState } from 'react';
import { Alert, Box, Tab, Tabs, Typography } from '@mui/material';
import { useAuth } from '../auth/useAuth';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import MembershipPackagesPanel from '../components/MembershipPackagesPanel';
import MembershipPatientPlansPanel from '../components/MembershipPatientPlansPanel';

type Section = 'definitions' | 'patients';

export default function MembershipManagementPage() {
  const { token } = useAuth() as { token?: string | null };
  const practiceId = useMemo(
    () => resolvePracticeIdFromToken(token ?? localStorage.getItem('accessToken')),
    [token],
  );
  const [section, setSection] = useState<Section>('definitions');

  return (
    <Box p={3} display="flex" flexDirection="column" gap={3}>
      <Box>
        <Typography variant="h5" fontWeight={600}>
          Membership management
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Manage membership plan definitions and attach memberships to patients in Scout. eVet
          import continues for records that have not been edited here; once Scout modifies a
          plan or patient membership, eVet will no longer overwrite it.
        </Typography>
      </Box>

      <Alert severity="info">
        Scout-owned rows are tagged <strong>Scout</strong>. Untouched eVet imports remain tagged{' '}
        <strong>eVet</strong> and keep syncing until someone edits them in Scout.
      </Alert>

      <Tabs
        value={section}
        onChange={(_e, value: Section) => setSection(value)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="definitions" label="Plan definitions" />
        <Tab value="patients" label="Patient memberships" />
      </Tabs>

      {section === 'definitions' ? (
        <MembershipPackagesPanel practiceId={practiceId} />
      ) : (
        <MembershipPatientPlansPanel practiceId={practiceId} />
      )}
    </Box>
  );
}
