// src/pages/SurveyResponses.tsx
import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardHeader,
  CardContent,
  Typography,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  Tabs,
  Tab,
} from '@mui/material';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  listSurveyResponses,
  getSurveyResponse,
  getSurveyReportSummary,
  type SurveyResponseListItem,
  type SurveyResponseDetail,
  type SurveyReportSummary,
  type SurveyReportQuestionScale,
  type SurveyReportQuestionChoice,
} from '../api/survey';

dayjs.extend(utc);

const SURVEY_SLUG = 'post-appointment';

function toISODate(d: Dayjs) {
  return d.utc().format('YYYY-MM-DD');
}

function formatDate(iso: string) {
  return dayjs(iso).format('MMM D, YYYY h:mm a');
}

export default function SurveyResponsesPage() {
  const now = dayjs();
  const [from, setFrom] = useState<Dayjs>(now.subtract(29, 'day').startOf('day'));
  const [to, setTo] = useState<Dayjs>(now.startOf('day'));
  const [tab, setTab] = useState(0);
  const [responses, setResponses] = useState<SurveyResponseListItem[]>([]);
  const [report, setReport] = useState<SurveyReportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SurveyResponseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listSurveyResponses({
      surveySlug: SURVEY_SLUG,
      from: toISODate(from),
      to: toISODate(to),
      page,
      limit,
    })
      .then((res) => {
        if (!alive) return;
        setResponses(res.items);
      })
      .catch(() => {
        if (!alive) return;
        setResponses([]);
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [from, to, page, limit]);

  useEffect(() => {
    let alive = true;
    setReportLoading(true);
    getSurveyReportSummary({
      surveySlug: SURVEY_SLUG,
      from: toISODate(from),
      to: toISODate(to),
    })
      .then((data) => {
        if (!alive) return;
        setReport(data);
      })
      .catch(() => {
        if (!alive) return;
        setReport(null);
      })
      .finally(() => {
        if (!alive) return;
        setReportLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  useEffect(() => {
    if (detailId == null) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    getSurveyResponse(detailId)
      .then((data) => {
        if (!alive) return;
        setDetail(data);
      })
      .catch(() => {
        if (!alive) return;
        setDetail(null);
      })
      .finally(() => {
        if (!alive) return;
        setDetailLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [detailId]);

  const openDetail = (id: number) => setDetailId(id);
  const closeDetail = () => setDetailId(null);

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 2 }}>
        <Typography variant="h5" sx={{ mb: 2, fontFamily: 'Libre Baskerville, serif' }}>
          Post-Appointment Survey
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <DatePicker
            label="From"
            value={from}
            onChange={(d) => d && setFrom(d.startOf('day'))}
            slotProps={{ textField: { size: 'small' } }}
          />
          <DatePicker
            label="To"
            value={to}
            onChange={(d) => d && setTo(d.startOf('day'))}
            slotProps={{ textField: { size: 'small' } }}
          />
        </Stack>

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Responses" />
          <Tab label="Report summary" />
        </Tabs>

        {tab === 0 && (
          <Card>
            <CardHeader title="Responses" />
            <CardContent>
              {loading ? (
                <Typography color="text.secondary">Loading…</Typography>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Submitted</TableCell>
                        <TableCell>Appointment ID</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {responses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} align="center">
                            No responses in this date range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        responses.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell>{r.id}</TableCell>
                            <TableCell>{formatDate(r.submittedAt)}</TableCell>
                            <TableCell>{r.appointmentId ?? '—'}</TableCell>
                            <TableCell align="right">
                              <Button size="small" onClick={() => openDetail(r.id)}>
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </CardContent>
          </Card>
        )}

        {tab === 1 && (
          <Card>
            <CardHeader title="Report summary" />
            <CardContent>
              {reportLoading ? (
                <Typography color="text.secondary">Loading…</Typography>
              ) : report && report.questions.length > 0 ? (
                <Stack spacing={3}>
                  {report.questions.map((q) => (
                    <Box key={q.questionKey}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {q.questionText}
                      </Typography>
                      {q.type === 'scale' && (
                        <ScaleStats stats={(q as SurveyReportQuestionScale).stats} />
                      )}
                      {(q.type === 'image_choice' || q.type === 'radio' || q.type === 'dropdown') && (
                        <ChoiceStats stats={(q as SurveyReportQuestionChoice).stats} />
                      )}
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography color="text.secondary">No report data for this date range.</Typography>
              )}
            </CardContent>
          </Card>
        )}
      </Box>

      <Dialog open={detailId != null} onClose={closeDetail} maxWidth="sm" fullWidth>
        <DialogTitle>Response #{detailId}</DialogTitle>
        <DialogContent>
          {detailLoading ? (
            <Typography color="text.secondary">Loading…</Typography>
          ) : detail ? (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Submitted: {formatDate(detail.submittedAt)}
                {detail.appointmentId != null && ` · Appointment: ${detail.appointmentId}`}
              </Typography>
              {detail.answers.map((a) => (
                <Box key={a.questionKey}>
                  <Typography variant="caption" color="text.secondary">
                    {a.questionText}
                  </Typography>
                  <Typography variant="body2">{a.value}</Typography>
                </Box>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">Could not load response.</Typography>
          )}
        </DialogContent>
      </Dialog>
    </LocalizationProvider>
  );
}

function ScaleStats({ stats }: { stats: SurveyReportQuestionScale['stats'] }) {
  const { average, distribution, totalResponses } = stats;
  const entries = Object.entries(distribution ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        Average: <strong>{average != null ? average.toFixed(2) : '—'}</strong>
        {' · '}
        Total responses: <strong>{totalResponses ?? 0}</strong>
      </Typography>
      {entries.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Distribution: {entries.map(([k, v]) => `${k}: ${v}`).join(', ')}
        </Typography>
      )}
    </Stack>
  );
}

function ChoiceStats({ stats }: { stats: SurveyReportQuestionChoice['stats'] }) {
  const { counts, totalResponses } = stats;
  const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        Total responses: <strong>{totalResponses ?? 0}</strong>
      </Typography>
      {entries.length > 0 && (
        <Box component="ul" sx={{ m: 0, pl: 2 }}>
          {entries.map(([label, count]) => (
            <li key={label}>
              <Typography variant="body2">
                {label}: <strong>{count}</strong>
              </Typography>
            </li>
          ))}
        </Box>
      )}
    </Stack>
  );
}
