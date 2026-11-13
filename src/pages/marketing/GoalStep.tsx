import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Paper,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CampaignOptions,
  EmailCampaignGoal,
  EmailCampaignGoalType,
  EmailCampaignProtections,
  GOAL_LABELS,
} from '../../api/emailCampaigns';

const GOAL_HELP: Record<EmailCampaignGoalType, string> = {
  none: 'The report shows deliveries, opens and clicks.',
  appointment_booked:
    'A recipient converts when they book an appointment within the window after the email was sent, whether or not they clicked.',
  membership_enrolled:
    'A recipient converts when one of their pets starts a membership, or they sign up online, within the window after the email was sent.',
  link_click: 'A recipient converts when they click any link in the email within the window.',
};

type Props = {
  goal: EmailCampaignGoal;
  protections: EmailCampaignProtections;
  options: CampaignOptions | null;
  onGoalChange: (goal: EmailCampaignGoal) => void;
  onProtectionsChange: (p: EmailCampaignProtections) => void;
  readOnly: boolean;
};

export default function GoalStep({
  goal,
  protections,
  options,
  onGoalChange,
  onProtectionsChange,
  readOnly,
}: Props) {
  const setGoal = (patch: Partial<EmailCampaignGoal>) => onGoalChange({ ...goal, ...patch });
  const types = options?.appointmentTypes ?? [];
  const selectedTypes = types.filter((t) => goal.appointmentTypeIds.includes(t.id));

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          What should this campaign achieve?
        </Typography>
        <Stack spacing={2}>
          <TextField
            select
            size="small"
            label="Goal"
            value={goal.type}
            onChange={(e) => setGoal({ type: e.target.value as EmailCampaignGoalType })}
            disabled={readOnly}
            helperText={GOAL_HELP[goal.type]}
          >
            {(Object.keys(GOAL_LABELS) as EmailCampaignGoalType[]).map((t) => (
              <MenuItem key={t} value={t}>
                {GOAL_LABELS[t]}
              </MenuItem>
            ))}
          </TextField>
          {goal.type !== 'none' ? (
            <TextField
              size="small"
              type="number"
              label="Count conversions for this many days after sending"
              value={goal.windowDays}
              onChange={(e) =>
                setGoal({ windowDays: Math.max(1, Math.min(180, Number(e.target.value) || 1)) })
              }
              disabled={readOnly}
              inputProps={{ min: 1, max: 180 }}
              sx={{ maxWidth: 360 }}
            />
          ) : null}
          {goal.type === 'appointment_booked' ? (
            <Autocomplete
              multiple
              size="small"
              options={types}
              value={selectedTypes}
              disabled={readOnly}
              getOptionLabel={(t) => t.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              onChange={(_e, v) => setGoal({ appointmentTypeIds: v.map((t) => t.id) })}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Only these appointment types count"
                  placeholder={selectedTypes.length ? undefined : 'Any appointment type'}
                />
              )}
            />
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          Pet-loss protection
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          A household with no pet on the chart is left out. A household that still has a living pet
          is left out after a pet died or was made inactive recently, or after a euthanasia,
          quality-of-life or other end-of-life visit recently or coming up. Pet names are living
          pets, or the inactive pets when that household has no living pet and the box below is
          checked.
        </Typography>
        <FormControlLabel
          sx={{ alignItems: 'flex-start', mx: 0, mb: 1 }}
          control={
            <Checkbox
              size="small"
              sx={{ pt: 0.25 }}
              checked={protections.includeInactivePetHouseholds === true}
              disabled={readOnly}
              onChange={(e) =>
                onProtectionsChange({
                  ...protections,
                  includeInactivePetHouseholds: e.target.checked,
                })
              }
            />
          }
          label={
            <Box>
              <Typography variant="body2" fontWeight={700}>
                Include households with inactive pets
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Sends to a household when every pet on the chart, or on a past visit, is inactive.
                The same rule applies to a pasted list.
              </Typography>
            </Box>
          }
        />
        <Box sx={{ px: 1 }}>
          <Typography variant="body2" fontWeight={600}>
            “Recently” means the last {protections.petLossWindowDays} days
          </Typography>
          <Slider
            min={30}
            max={730}
            step={15}
            value={protections.petLossWindowDays}
            onChange={(_e, v) =>
              onProtectionsChange({ ...protections, petLossWindowDays: v as number })
            }
            disabled={readOnly}
            marks={[
              { value: 30, label: '30 days' },
              { value: 180, label: '6 months' },
              { value: 365, label: '1 year' },
              { value: 730, label: '2 years' },
            ]}
          />
        </Box>
        {protections.petLossWindowDays < 90 ? (
          <Alert severity="warning" sx={{ mt: 1 }}>
            A short window means families may hear from you only weeks after a loss. Six months is
            recommended.
          </Alert>
        ) : null}
      </Paper>
    </Stack>
  );
}
