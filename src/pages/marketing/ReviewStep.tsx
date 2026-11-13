import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { CheckCircle2, CircleAlert, Send } from 'lucide-react';
import dayjs from 'dayjs';
import {
  AudienceSummary,
  CampaignOptions,
  EmailCampaign,
  errorMessage,
  GOAL_LABELS,
  sendEmailCampaignTest,
} from '../../api/emailCampaigns';
import { useAuth } from '../../auth/useAuth';
import {
  formatDateTime,
  formatSendWindow,
  sendWindowEnd,
  SPREAD_OPTIONS,
  spreadLabel,
} from './campaignFormat';

export type ReviewCheck = { ok: boolean; label: string; blocking: boolean };

type Props = {
  campaign: EmailCampaign;
  options: CampaignOptions | null;
  summary: AudienceSummary | null;
  checks: ReviewCheck[];
  busy: boolean;
  onFlush: () => Promise<boolean>;
  onSpreadChange: (minutes: number) => void;
  onSchedule: (sendAt: string | null) => Promise<void>;
  onCancel: () => Promise<void>;
};

export default function ReviewStep({
  campaign,
  options,
  summary,
  checks,
  busy,
  onFlush,
  onSpreadChange,
  onSchedule,
  onCancel,
}: Props) {
  const { userEmail } = useAuth();
  const [testTo, setTestTo] = useState(userEmail ?? '');
  const [testState, setTestState] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );
  const [testing, setTesting] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('later');
  const [sendAt, setSendAt] = useState(() =>
    dayjs().add(1, 'day').hour(9).minute(0).format('YYYY-MM-DDTHH:mm')
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const blocking = checks.filter((c) => c.blocking && !c.ok);
  const isDraft = campaign.status === 'draft';
  const recipients = summary?.eligible ?? 0;
  const spreadChoices = SPREAD_OPTIONS.includes(campaign.spreadMinutes)
    ? SPREAD_OPTIONS
    : [...SPREAD_OPTIONS, campaign.spreadMinutes].sort((a, b) => a - b);

  const windowFrom = (start: Date) =>
    formatSendWindow(start, sendWindowEnd(start, campaign.spreadMinutes, recipients));
  const draftStart = when === 'now' ? new Date() : new Date(sendAt);
  const draftWindow = Number.isNaN(draftStart.getTime()) ? null : windowFrom(draftStart);

  const sendTest = async () => {
    setTesting(true);
    setTestState(null);
    try {
      if (!(await onFlush())) throw new Error('Save failed; fix the errors above first.');
      const to = testTo
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await sendEmailCampaignTest(campaign.id, to);
      setTestState({ kind: 'success', text: `Test sent to ${res.sentTo.join(', ')}.` });
    } catch (err) {
      setTestState({ kind: 'error', text: errorMessage(err, 'The test could not be sent.') });
    } finally {
      setTesting(false);
    }
  };

  const schedule = async () => {
    setScheduleError(null);
    const at = when === 'now' ? null : new Date(sendAt);
    if (at && (Number.isNaN(at.getTime()) || at.getTime() < Date.now())) {
      setScheduleError('Pick a time in the future.');
      return;
    }
    const msg =
      when === 'now'
        ? `Send "${campaign.name}" to ${recipients.toLocaleString()} clients now?`
        : `Schedule "${campaign.name}" for ${formatDateTime(at!.toISOString())} to about ${recipients.toLocaleString()} clients?`;
    const pace =
      campaign.spreadMinutes > 0
        ? ` Emails go out gradually over ${spreadLabel(campaign.spreadMinutes)}.`
        : '';
    if (!window.confirm(msg + pace)) return;
    try {
      await onSchedule(at ? at.toISOString() : null);
    } catch (err) {
      setScheduleError(errorMessage(err, 'Could not schedule the campaign.'));
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Checklist
        </Typography>
        <Stack spacing={0.75}>
          {checks.map((c) => (
            <Box key={c.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {c.ok ? (
                <CheckCircle2 size={18} color="#15803d" />
              ) : (
                <CircleAlert size={18} color={c.blocking ? '#b91c1c' : '#b45309'} />
              )}
              <Typography variant="body2">{c.label}</Typography>
            </Box>
          ))}
        </Stack>
        <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: '160px 1fr', rowGap: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            Subject
          </Typography>
          <Typography variant="body2">{campaign.subject || '—'}</Typography>
          <Typography variant="body2" color="text.secondary">
            Recipients
          </Typography>
          <Typography variant="body2">
            {summary ? summary.eligible.toLocaleString() : '…'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Goal
          </Typography>
          <Typography variant="body2">
            {GOAL_LABELS[campaign.goal.type]}
            {campaign.goal.type !== 'none' ? ` within ${campaign.goal.windowDays} days` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pet-loss window
          </Typography>
          <Typography variant="body2">{campaign.protections.petLossWindowDays} days</Typography>
          <Typography variant="body2" color="text.secondary">
            Inactive-pet households
          </Typography>
          <Typography variant="body2">
            {campaign.protections.includeInactivePetHouseholds ? 'Included' : 'Left out'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sending pace
          </Typography>
          <Typography variant="body2">
            {campaign.spreadMinutes > 0
              ? `Spread over ${spreadLabel(campaign.spreadMinutes)}`
              : 'As fast as possible'}
          </Typography>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Send a test
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Uses a real recipient’s name and pets so you can check merge tags. Links in tests aren’t
          tracked.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Send to (up to 5, comma separated)"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            sx={{ flex: 1, minWidth: 260 }}
          />
          <Button
            variant="outlined"
            onClick={() => void sendTest()}
            disabled={testing || !testTo.trim()}
          >
            {testing ? 'Sending…' : 'Send test'}
          </Button>
        </Box>
        {testState ? (
          <Alert severity={testState.kind} sx={{ mt: 1.5 }}>
            {testState.text}
          </Alert>
        ) : null}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Send
        </Typography>
        {options && !options.isProduction ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {options.sendingEnabled
              ? 'This is not production: a handful of emails go to the test inbox and the rest are only recorded as sent.'
              : 'Sending is turned off outside production until a test inbox is configured on the server.'}
          </Alert>
        ) : null}

        {campaign.status === 'scheduled' ? (
          <Stack spacing={1.5}>
            <Alert severity="info">
              {`Scheduled to send ${
                campaign.scheduledAt ? windowFrom(new Date(campaign.scheduledAt)) : '—'
              }. Unschedule to make changes.`}
            </Alert>
            <Box>
              <Button
                variant="outlined"
                color="warning"
                onClick={() => void onCancel()}
                disabled={busy}
              >
                Unschedule
              </Button>
            </Box>
          </Stack>
        ) : campaign.status === 'sending' ? (
          <Stack spacing={1.5}>
            <Alert severity="info">
              Sending now. Anyone not yet emailed will be skipped if you stop it.
            </Alert>
            <Box>
              <Button
                variant="outlined"
                color="error"
                disabled={busy}
                onClick={() => window.confirm('Stop sending this campaign?') && void onCancel()}
              >
                Stop sending
              </Button>
            </Box>
          </Stack>
        ) : isDraft ? (
          <Stack spacing={1.5}>
            <RadioGroup
              row
              value={when}
              onChange={(e) => setWhen(e.target.value as 'now' | 'later')}
            >
              <FormControlLabel value="later" control={<Radio />} label="Schedule" />
              <FormControlLabel value="now" control={<Radio />} label="Send now" />
            </RadioGroup>
            {when === 'later' ? (
              <TextField
                size="small"
                type="datetime-local"
                label="Send at (your local time)"
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
                InputLabelProps={{ shrink: true }}
                sx={{ maxWidth: 280 }}
              />
            ) : null}
            <TextField
              select
              size="small"
              label="Spread sending over"
              value={campaign.spreadMinutes}
              onChange={(e) => onSpreadChange(Number(e.target.value))}
              sx={{ maxWidth: 280 }}
            >
              {spreadChoices.map((m) => (
                <MenuItem key={m} value={m}>
                  {spreadLabel(m)}
                </MenuItem>
              ))}
            </TextField>
            {draftWindow ? (
              <Typography variant="body2" color="text.secondary">
                Sends {draftWindow}.
                {campaign.spreadMinutes > 0
                  ? ' Emails go out evenly across this window instead of all at once.'
                  : ''}
              </Typography>
            ) : null}
            {blocking.length ? (
              <Alert severity="error">
                Fix these first: {blocking.map((b) => b.label).join('; ')}.
              </Alert>
            ) : null}
            {scheduleError ? <Alert severity="error">{scheduleError}</Alert> : null}
            <Box>
              <Button
                variant="contained"
                startIcon={<Send size={18} />}
                disabled={
                  busy || blocking.length > 0 || (options ? !options.sendingEnabled : false)
                }
                onClick={() => void schedule()}
              >
                {when === 'now' ? 'Send now' : 'Schedule'}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Alert severity="info">
            This campaign has been {campaign.status}. Duplicate it to send again.
          </Alert>
        )}
      </Paper>
    </Stack>
  );
}
