import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ArrowLeft, BarChart3, Code2, Copy, FileUp, LayoutTemplate } from 'lucide-react';
import {
  CampaignOptions,
  CampaignWrite,
  cancelEmailCampaign,
  duplicateEmailCampaign,
  EmailCampaign,
  errorMessage,
  getEmailCampaign,
  getEmailCampaignOptions,
  scheduleEmailCampaign,
  updateEmailCampaign,
} from '../../api/emailCampaigns';
import AudienceStep, { useAudiencePreview } from './AudienceStep';
import DesignBlocksEditor, { MergeTagButton } from './DesignBlocksEditor';
import EmailPreview from './EmailPreview';
import GoalStep from './GoalStep';
import ReviewStep from './ReviewStep';
import { StatusChip } from './campaignFormat';
import { campaignChecks } from './campaignChecks';
import { createDefaultDesign, EmailDesign, parseDesign, renderDesignToHtml } from './emailDesign';
import { MARKETING_BASE_PATH } from './EmailCampaignsPage';

type Step = 'content' | 'audience' | 'goal' | 'review';
type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const AUTOSAVE_MS = 1200;

export default function EmailCampaignEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [options, setOptions] = useState<CampaignOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('content');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pending = useRef<CampaignWrite>({});
  const timer = useRef<number | null>(null);
  const saving = useRef<Promise<boolean>>(Promise.resolve(true));

  const readOnly = !campaign || campaign.status !== 'draft';
  const design = useMemo(() => parseDesign(campaign?.design), [campaign?.design]);

  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    saving.current = saving.current.then(async () => {
      const body = pending.current;
      if (!Object.keys(body).length) return true;
      pending.current = {};
      setSaveState('saving');
      try {
        const saved = await updateEmailCampaign(id, body);
        setCampaign((c) =>
          c ? { ...c, status: saved.status, updated: saved.updated, lastError: saved.lastError } : c
        );
        setSaveState(Object.keys(pending.current).length ? 'pending' : 'saved');
        setSaveError(null);
        return true;
      } catch (err) {
        pending.current = { ...body, ...pending.current };
        setSaveState('error');
        setSaveError(errorMessage(err, 'Changes could not be saved.'));
        return false;
      }
    });
    return saving.current;
  }, [id]);

  const patch = useCallback(
    (p: CampaignWrite) => {
      setCampaign((c) => (c ? ({ ...c, ...p } as EmailCampaign) : c));
      pending.current = { ...pending.current, ...p };
      setSaveState('pending');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush]
  );

  useEffect(() => {
    let alive = true;
    setCampaign(null);
    setLoadError(null);
    Promise.all([getEmailCampaign(id), getEmailCampaignOptions().catch(() => null)])
      .then(([c, o]) => {
        if (!alive) return;
        setOptions(o);
        setCampaign(c);
        if (c.status === 'draft' && c.editorMode === 'design' && !parseDesign(c.design)) {
          const d = createDefaultDesign();
          pending.current = { design: d, html: renderDesignToHtml(d, c.subject) };
          setCampaign({ ...c, design: d, html: renderDesignToHtml(d, c.subject) });
          void flush();
        }
        if (c.status !== 'draft') setStep('review');
      })
      .catch((err) => alive && setLoadError(errorMessage(err, 'Could not load the campaign.')));
    return () => {
      alive = false;
    };
  }, [id, flush]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (campaign?.status !== 'sending' && campaign?.status !== 'scheduled') return;
    const t = window.setInterval(() => {
      getEmailCampaign(id)
        .then((c) =>
          setCampaign((prev) =>
            prev
              ? {
                  ...prev,
                  status: c.status,
                  sendStartedAt: c.sendStartedAt,
                  sentAt: c.sentAt,
                  lastError: c.lastError,
                }
              : c
          )
        )
        .catch(() => undefined);
    }, 20_000);
    return () => window.clearInterval(t);
  }, [campaign?.status, id]);

  const preview = useAudiencePreview(
    campaign?.id ?? null,
    campaign?.audience ?? null,
    campaign?.protections ?? null
  );

  const patchDesign = (d: EmailDesign) => {
    if (!campaign) return;
    patch({ design: d, html: renderDesignToHtml(d, campaign.subject) });
  };

  const switchMode = (mode: 'design' | 'html') => {
    if (!campaign || mode === campaign.editorMode) return;
    if (mode === 'html') {
      if (
        !window.confirm(
          'Switch to HTML? You can edit the code directly. Going back to the designer later will undo your HTML edits.'
        )
      )
        return;
      patch({ editorMode: 'html' });
      return;
    }
    const existing = parseDesign(campaign.design);
    const msg = existing
      ? 'Go back to the designer? Changes made in HTML will be lost.'
      : 'Start a new design? The current HTML will be replaced.';
    if (!window.confirm(msg)) return;
    const d = existing ?? createDefaultDesign();
    patch({ editorMode: 'design', design: d, html: renderDesignToHtml(d, campaign.subject) });
  };

  const importHtmlFile = async (file: File) => {
    const text = await file.text();
    patch({ editorMode: 'html', html: text });
  };

  const checks = useMemo(
    () => (campaign ? campaignChecks(campaign, design, preview.summary) : []),
    [campaign, design, preview.summary]
  );

  const runAction = async (fn: () => Promise<EmailCampaign>) => {
    setBusy(true);
    setActionError(null);
    try {
      if (!(await flush())) throw new Error('Save your changes first.');
      const c = await fn();
      setCampaign(c);
    } catch (err) {
      setActionError(errorMessage(err));
      throw err;
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError}</Alert>
        <Button
          component={RouterLink}
          to={MARKETING_BASE_PATH}
          sx={{ mt: 2 }}
          startIcon={<ArrowLeft size={16} />}
        >
          Back to campaigns
        </Button>
      </Box>
    );
  }
  if (!campaign) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <Button
          component={RouterLink}
          to={MARKETING_BASE_PATH}
          startIcon={<ArrowLeft size={16} />}
          size="small"
        >
          Campaigns
        </Button>
        <TextField
          variant="standard"
          value={campaign.name}
          onChange={(e) => patch({ name: e.target.value })}
          disabled={readOnly}
          inputProps={{ 'aria-label': 'Campaign name', style: { fontSize: 22, fontWeight: 700 } }}
          sx={{ flex: 1, minWidth: 240 }}
        />
        <StatusChip status={campaign.status} />
        <Typography
          variant="caption"
          color={saveState === 'error' ? 'error' : 'text.secondary'}
          sx={{ minWidth: 80 }}
        >
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'pending'
              ? 'Unsaved'
              : saveState === 'saved'
                ? 'Saved'
                : saveState === 'error'
                  ? 'Not saved'
                  : ''}
        </Typography>
        {campaign.sendStartedAt ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<BarChart3 size={16} />}
            onClick={() => navigate(`${MARKETING_BASE_PATH}/${campaign.id}/report`)}
          >
            Report
          </Button>
        ) : null}
        {readOnly ? (
          <Button
            size="small"
            startIcon={<Copy size={16} />}
            onClick={async () => {
              const copy = await duplicateEmailCampaign(campaign.id);
              navigate(`${MARKETING_BASE_PATH}/${copy.id}`);
            }}
          >
            Duplicate to edit
          </Button>
        ) : null}
      </Box>

      {saveError ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void flush()}>Retry</Button>}
        >
          {saveError}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      ) : null}
      {campaign.lastError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {campaign.lastError}
        </Alert>
      ) : null}
      {campaign.status === 'scheduled' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          This campaign is scheduled, so it can’t be edited. Unschedule it on the Review step to
          make changes.
        </Alert>
      ) : null}

      <Tabs
        value={step}
        onChange={(_e, v) => {
          void flush();
          setStep(v);
        }}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="content" label="1. Content" />
        <Tab
          value="audience"
          label={`2. Audience${preview.summary ? ` (${preview.summary.eligible.toLocaleString()})` : ''}`}
        />
        <Tab value="goal" label="3. Goal & safety" />
        <Tab value="review" label="4. Review & send" />
      </Tabs>

      {step === 'content' ? (
        <Grid container spacing={3}>
          <Grid item xs={12} lg={6}>
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={2}>
                  <TextField
                    size="small"
                    label="Subject line"
                    value={campaign.subject}
                    onChange={(e) => {
                      const subject = e.target.value;
                      patch(
                        campaign.editorMode === 'design' && design
                          ? { subject, html: renderDesignToHtml(design, subject) }
                          : { subject }
                      );
                    }}
                    disabled={readOnly}
                    inputProps={{ maxLength: 300 }}
                    InputProps={{
                      endAdornment: (
                        <MergeTagButton
                          disabled={readOnly}
                          onInsert={(tag) => patch({ subject: `${campaign.subject}${tag}` })}
                        />
                      ),
                    }}
                  />
                  <TextField
                    size="small"
                    label="Preview text (shown after the subject in most inboxes)"
                    value={campaign.preheader ?? ''}
                    onChange={(e) => patch({ preheader: e.target.value })}
                    disabled={readOnly}
                    inputProps={{ maxLength: 300 }}
                  />
                  <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                    <TextField
                      size="small"
                      label="From name"
                      placeholder="Vet At Your Door"
                      value={campaign.fromName ?? ''}
                      onChange={(e) => patch({ fromName: e.target.value })}
                      disabled={readOnly}
                      sx={{ flex: 1, minWidth: 200 }}
                    />
                    <TextField
                      size="small"
                      label="Reply-to email (optional)"
                      value={campaign.replyTo ?? ''}
                      onChange={(e) => patch({ replyTo: e.target.value })}
                      disabled={readOnly}
                      sx={{ flex: 1, minWidth: 200 }}
                    />
                  </Box>
                </Stack>
              </Paper>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={campaign.editorMode}
                  onChange={(_e, v) => v && switchMode(v)}
                  disabled={readOnly}
                >
                  <ToggleButton value="design">
                    <LayoutTemplate size={16} style={{ marginRight: 6 }} /> Designer
                  </ToggleButton>
                  <ToggleButton value="html">
                    <Code2 size={16} style={{ marginRight: 6 }} /> HTML
                  </ToggleButton>
                </ToggleButtonGroup>
                <Box sx={{ flex: 1 }} />
                {campaign.editorMode === 'html' && !readOnly ? (
                  <Button size="small" component="label" startIcon={<FileUp size={16} />}>
                    Import .html file
                    <input
                      type="file"
                      accept=".html,.htm,text/html"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f && window.confirm('Replace the current email with this file?'))
                          void importHtmlFile(f);
                      }}
                    />
                  </Button>
                ) : null}
              </Box>

              {campaign.editorMode === 'design' && design ? (
                <DesignBlocksEditor design={design} onChange={patchDesign} readOnly={readOnly} />
              ) : (
                <TextField
                  multiline
                  fullWidth
                  minRows={24}
                  value={campaign.html}
                  onChange={(e) => patch({ html: e.target.value })}
                  disabled={readOnly}
                  InputProps={{
                    sx: {
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 13,
                      lineHeight: 1.5,
                    },
                  }}
                  helperText="Full HTML documents are supported. Scripts, forms and embedded frames are removed because email clients block them. Use tables and inline styles for the most consistent results."
                />
              )}
            </Stack>
          </Grid>
          <Grid item xs={12} lg={6}>
            <Box sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}>
              <EmailPreview
                html={campaign.html}
                subject={campaign.subject}
                preheader={campaign.preheader}
                fromName={campaign.fromName}
              />
            </Box>
          </Grid>
        </Grid>
      ) : step === 'audience' ? (
        <AudienceStep
          audience={campaign.audience}
          protections={campaign.protections}
          options={options}
          onChange={(audience) => patch({ audience })}
          readOnly={readOnly}
          preview={preview}
        />
      ) : step === 'goal' ? (
        <GoalStep
          goal={campaign.goal}
          protections={campaign.protections}
          options={options}
          onGoalChange={(goal) => patch({ goal })}
          onProtectionsChange={(protections) => patch({ protections })}
          readOnly={readOnly}
        />
      ) : (
        <ReviewStep
          campaign={campaign}
          options={options}
          summary={preview.summary}
          checks={checks}
          busy={busy}
          onFlush={flush}
          onSpreadChange={(spreadMinutes) => patch({ spreadMinutes })}
          onSchedule={(sendAt) => runAction(() => scheduleEmailCampaign(campaign.id, sendAt))}
          onCancel={() => runAction(() => cancelEmailCampaign(campaign.id)).catch(() => undefined)}
        />
      )}
    </Box>
  );
}
