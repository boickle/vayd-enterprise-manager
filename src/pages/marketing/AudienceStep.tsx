import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { HeartCrack, ShieldCheck } from 'lucide-react';
import {
  AudienceSummary,
  CampaignClient,
  CampaignOptions,
  EmailCampaignAudience,
  EmailCampaignProtections,
  EmailCampaignSkipReason,
  errorMessage,
  getEmailCampaignClientsByIds,
  PET_LOSS_REASONS,
  previewEmailCampaignAudience,
  searchEmailCampaignClients,
  SKIP_REASON_LABELS,
} from '../../api/emailCampaigns';
import ExternalContactsField from './ExternalContactsField';

type Props = {
  audience: EmailCampaignAudience;
  protections: EmailCampaignProtections;
  options: CampaignOptions | null;
  onChange: (audience: EmailCampaignAudience) => void;
  readOnly: boolean;
  preview: { summary: AudienceSummary | null; loading: boolean; error: string | null };
};

type Option = { id: number; label: string };

function IdMultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  options: Option[];
  value: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const selected = options.filter((o) => value.includes(o.id));
  return (
    <Autocomplete
      multiple
      size="small"
      options={options}
      value={selected}
      disabled={disabled}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => onChange(v.map((o) => o.id))}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={selected.length ? undefined : (placeholder ?? 'Any')}
        />
      )}
    />
  );
}

function ClientPicker({
  label,
  ids,
  onChange,
  disabled,
}: {
  label: string;
  ids: number[];
  onChange: (ids: number[]) => void;
  disabled?: boolean;
}) {
  const [known, setKnown] = useState<Record<number, CampaignClient>>({});
  const [input, setInput] = useState('');
  const [results, setResults] = useState<CampaignClient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const missing = ids.filter((id) => !known[id]);
    if (!missing.length) return;
    let alive = true;
    getEmailCampaignClientsByIds(missing)
      .then((rows) => {
        if (!alive) return;
        setKnown((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ids, known]);

  useEffect(() => {
    if (input.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchEmailCampaignClients(input.trim())
        .then((rows) => alive && setResults(rows))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [input]);

  const value = ids.map(
    (id) => known[id] ?? { id, name: `Client #${id}`, email: null, petNames: [] }
  );

  return (
    <Autocomplete
      multiple
      size="small"
      options={results}
      value={value}
      disabled={disabled}
      filterOptions={(x) => x}
      loading={loading}
      inputValue={input}
      onInputChange={(_e, v, reason) => reason !== 'reset' && setInput(v)}
      getOptionLabel={(o) => o.name || `Client #${o.id}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => {
        setKnown((prev) => ({ ...prev, ...Object.fromEntries(v.map((r) => [r.id, r])) }));
        onChange(v.map((c) => c.id));
        setInput('');
      }}
      renderOption={(props, o) => (
        <li {...props} key={o.id}>
          <Box>
            <Typography variant="body2">{o.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[o.email, o.petNames.join(', ')].filter(Boolean).join(' · ') || 'No email or pets'}
            </Typography>
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Search by name or email"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

/** Counts the audience as it is edited; stale responses are dropped. */
export function useAudiencePreview(
  campaignId: string | null,
  audience: EmailCampaignAudience | null,
  protections: EmailCampaignProtections | null
) {
  const [summary, setSummary] = useState<AudienceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const key = useMemo(() => JSON.stringify({ audience, protections }), [audience, protections]);

  useEffect(() => {
    if (!campaignId || !audience || !protections) return;
    const id = ++requestId.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      previewEmailCampaignAudience({ audience, protections, campaignId })
        .then((s) => {
          if (id !== requestId.current) return;
          setSummary(s);
          setError(null);
        })
        .catch((err) => {
          if (id !== requestId.current) return;
          setError(errorMessage(err, 'Could not count the audience.'));
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, campaignId]);

  return { summary, loading, error };
}

export default function AudienceStep({
  audience,
  protections,
  options,
  onChange,
  readOnly,
  preview,
}: Props) {
  const set = (patch: Partial<EmailCampaignAudience>) =>
    onChange({
      ...audience,
      externalContacts: audience.externalContacts ?? [],
      ...patch,
    });

  const providerOptions = (options?.providers ?? []).map((p) => ({ id: p.id, label: p.name }));
  const zoneOptions = (options?.zones ?? []).map((z) => ({ id: z.id, label: z.name }));
  const statusOptions = (options?.clientStatuses ?? []).map((s) => ({ id: s.id, label: s.name }));
  const speciesOptions = options?.species ?? [];

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={7}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Who should get this email?
            </Typography>
            <RadioGroup
              value={audience.mode}
              onChange={(e) => set({ mode: e.target.value as EmailCampaignAudience['mode'] })}
            >
              <FormControlLabel
                value="segment"
                control={<Radio />}
                label="Clients matching filters"
                disabled={readOnly}
              />
              <FormControlLabel
                value="specific"
                control={<Radio />}
                label="Specific clients"
                disabled={readOnly}
              />
              <FormControlLabel
                value="list"
                control={<Radio />}
                label="Only the pasted list"
                disabled={readOnly}
              />
            </RadioGroup>

            {audience.mode === 'list' ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No clients are selected from the practice. Only the people you add below are
                emailed.
              </Typography>
            ) : audience.mode === 'specific' ? (
              <Box sx={{ mt: 1 }}>
                <ClientPicker
                  label="Clients"
                  ids={audience.clientIds}
                  onChange={(clientIds) => set({ clientIds })}
                  disabled={readOnly}
                />
              </Box>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  select
                  size="small"
                  label="Membership"
                  value={audience.membership}
                  onChange={(e) =>
                    set({ membership: e.target.value as EmailCampaignAudience['membership'] })
                  }
                  disabled={readOnly}
                >
                  <MenuItem value="any">Members and non-members</MenuItem>
                  <MenuItem value="members">Only clients with an active membership</MenuItem>
                  <MenuItem value="non_members">Only clients without a membership</MenuItem>
                </TextField>

                <Autocomplete
                  multiple
                  size="small"
                  options={speciesOptions.map((s) => s.value)}
                  value={audience.species}
                  disabled={readOnly}
                  getOptionLabel={(v) => {
                    const s = speciesOptions.find((o) => o.value === v);
                    return s ? `${s.label} (${s.pets.toLocaleString()} pets)` : v;
                  }}
                  onChange={(_e, v) => set({ species: v })}
                  renderTags={(value, getTagProps) =>
                    value.map((v, i) => (
                      <Chip
                        size="small"
                        {...getTagProps({ index: i })}
                        key={v}
                        label={speciesOptions.find((o) => o.value === v)?.label ?? v}
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Has a living pet of species"
                      placeholder={audience.species.length ? undefined : 'Any'}
                    />
                  )}
                />

                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  <TextField
                    select
                    size="small"
                    label="Last visit"
                    value={audience.lastVisit.mode}
                    onChange={(e) =>
                      set({
                        lastVisit: {
                          ...audience.lastVisit,
                          mode: e.target.value as EmailCampaignAudience['lastVisit']['mode'],
                        },
                      })
                    }
                    disabled={readOnly}
                    sx={{ minWidth: 220, flex: 1 }}
                  >
                    <MenuItem value="any">Any time or never</MenuItem>
                    <MenuItem value="within">Visited within the last…</MenuItem>
                    <MenuItem value="not_within">Has visited, but not in the last…</MenuItem>
                  </TextField>
                  {audience.lastVisit.mode !== 'any' ? (
                    <TextField
                      size="small"
                      type="number"
                      label="Months"
                      value={audience.lastVisit.months}
                      onChange={(e) =>
                        set({
                          lastVisit: {
                            ...audience.lastVisit,
                            months: Math.max(1, Math.min(120, Number(e.target.value) || 1)),
                          },
                        })
                      }
                      disabled={readOnly}
                      inputProps={{ min: 1, max: 120 }}
                      sx={{ width: 110 }}
                    />
                  ) : null}
                </Box>

                <TextField
                  select
                  size="small"
                  label="Upcoming appointment"
                  value={audience.upcomingAppointment}
                  onChange={(e) =>
                    set({
                      upcomingAppointment: e.target
                        .value as EmailCampaignAudience['upcomingAppointment'],
                    })
                  }
                  disabled={readOnly}
                >
                  <MenuItem value="any">Doesn’t matter</MenuItem>
                  <MenuItem value="has">Has an upcoming appointment</MenuItem>
                  <MenuItem value="none">No upcoming appointment</MenuItem>
                </TextField>

                <IdMultiSelect
                  label="Primary doctor"
                  options={providerOptions}
                  value={audience.primaryProviderIds}
                  onChange={(primaryProviderIds) => set({ primaryProviderIds })}
                  disabled={readOnly}
                />
                <IdMultiSelect
                  label="Zone"
                  options={zoneOptions}
                  value={audience.zoneIds}
                  onChange={(zoneIds) => set({ zoneIds })}
                  disabled={readOnly}
                />
                {statusOptions.length ? (
                  <IdMultiSelect
                    label="Client status"
                    options={statusOptions}
                    value={audience.clientStatusIds}
                    onChange={(clientStatusIds) => set({ clientStatusIds })}
                    disabled={readOnly}
                  />
                ) : null}
              </Stack>
            )}
          </Paper>

          <ExternalContactsField
            contacts={audience.externalContacts ?? []}
            onChange={(externalContacts) => set({ externalContacts })}
            disabled={readOnly}
            listOnly={audience.mode === 'list'}
          />

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              Leave out
            </Typography>
            <Stack spacing={2}>
              <ClientPicker
                label="Never send to these clients"
                ids={audience.excludeClientIds}
                onChange={(excludeClientIds) => set({ excludeClientIds })}
                disabled={readOnly}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={audience.excludeEmailedWithinDays != null}
                      onChange={(e) =>
                        set({ excludeEmailedWithinDays: e.target.checked ? 7 : null })
                      }
                      disabled={readOnly}
                    />
                  }
                  label="Skip anyone who got another campaign in the last"
                />
                {audience.excludeEmailedWithinDays != null ? (
                  <TextField
                    size="small"
                    type="number"
                    label="Days"
                    value={audience.excludeEmailedWithinDays}
                    onChange={(e) =>
                      set({
                        excludeEmailedWithinDays: Math.max(
                          1,
                          Math.min(365, Number(e.target.value) || 1)
                        ),
                      })
                    }
                    disabled={readOnly}
                    inputProps={{ min: 1, max: 365 }}
                    sx={{ width: 100 }}
                  />
                ) : null}
              </Box>
            </Stack>
          </Paper>
        </Stack>
      </Grid>

      <Grid item xs={12} md={5}>
        <AudienceSummaryPanel {...preview} protections={protections} />
      </Grid>
    </Grid>
  );
}

export function AudienceSummaryPanel({
  summary,
  loading,
  error,
  protections,
}: {
  summary: AudienceSummary | null;
  loading: boolean;
  error: string | null;
  protections: EmailCampaignProtections;
}) {
  const excluded = Object.entries(summary?.excluded ?? {}) as Array<
    [EmailCampaignSkipReason, number]
  >;
  const petLoss = excluded.filter(([r]) => PET_LOSS_REASONS.includes(r));
  const other = excluded.filter(([r]) => !PET_LOSS_REASONS.includes(r)).sort((a, b) => b[1] - a[1]);
  const petLossTotal = petLoss.reduce((n, [, c]) => n + c, 0);

  return (
    <Paper variant="outlined" sx={{ p: 2, position: { md: 'sticky' }, top: { md: 16 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          Audience
        </Typography>
        {loading ? <CircularProgress size={18} /> : null}
      </Box>
      {error ? (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      ) : null}
      <Typography variant="h3" fontWeight={700} sx={{ mt: 1 }}>
        {summary ? summary.eligible.toLocaleString() : '—'}
      </Typography>
      <Typography color="text.secondary">
        will receive the email
        {summary ? ` (of ${summary.total.toLocaleString()} in this audience)` : ''}
      </Typography>

      <Alert severity="info" icon={<ShieldCheck size={20} />} sx={{ mt: 2 }}>
        <Typography variant="body2" fontWeight={700}>
          Pet-loss protection is always on
        </Typography>
        <Typography variant="body2">
          Households with no living pets, a pet that died or was made inactive in the last{' '}
          {protections.petLossWindowDays} days, or a euthanasia or other end-of-life visit in that
          time are left out. People added by name and email are included too. If that address
          belongs to a client, the same protections apply. This is checked again right before each
          email is sent.
        </Typography>
      </Alert>

      {petLossTotal > 0 ? (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <HeartCrack size={16} />
            <Typography variant="body2" fontWeight={700}>
              Left out for pet loss: {petLossTotal.toLocaleString()}
            </Typography>
          </Box>
          {petLoss.map(([reason, count]) => (
            <ReasonRow key={reason} reason={reason} count={count} />
          ))}
        </Box>
      ) : null}

      {other.length ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
            Also left out
          </Typography>
          {other.map(([reason, count]) => (
            <ReasonRow key={reason} reason={reason} count={count} />
          ))}
        </Box>
      ) : null}

      {summary?.sample.length ? (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
            A few recipients
          </Typography>
          {summary.sample.slice(0, 8).map((s, index) => (
            <Typography
              key={`${s.email ?? 'row'}-${s.clientId ?? 'ext'}-${index}`}
              variant="body2"
              color="text.secondary"
              noWrap
            >
              {[s.firstName, s.lastName].filter(Boolean).join(' ') ||
                (s.clientId ? `Client #${s.clientId}` : s.email || 'External contact')}
              {s.petNames.length ? ` · ${s.petNames.join(', ')}` : ''}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Paper>
  );
}

function ReasonRow({ reason, count }: { reason: EmailCampaignSkipReason; count: number }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
      <Typography variant="body2">{SKIP_REASON_LABELS[reason] ?? reason}</Typography>
      <Typography variant="body2" fontWeight={600}>
        {count.toLocaleString()}
      </Typography>
    </Box>
  );
}
