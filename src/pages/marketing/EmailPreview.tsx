import { useMemo, useState } from 'react';
import { Box, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Monitor, Smartphone } from 'lucide-react';
import { previewMergeTags, stripUnsafeHtml } from './emailDesign';

type Props = {
  html: string;
  subject: string;
  preheader: string | null;
  fromName: string | null;
  height?: number;
};

/** Sandboxed with no permissions, so nothing in the email can run in the app. */
export default function EmailPreview({ html, subject, preheader, fromName, height = 720 }: Props) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const srcDoc = useMemo(() => previewMergeTags(stripUnsafeHtml(html || '')), [html]);

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {fromName || 'Vet At Your Door'}
          </Typography>
          <Typography variant="body2" noWrap>
            {previewText(subject) || <em>No subject</em>}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap display="block">
            {previewText(preheader ?? '')}
          </Typography>
        </Box>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={device}
          onChange={(_e, v) => v && setDevice(v)}
        >
          <ToggleButton value="desktop" aria-label="Desktop preview">
            <Monitor size={16} />
          </ToggleButton>
          <ToggleButton value="mobile" aria-label="Mobile preview">
            <Smartphone size={16} />
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box
        sx={{
          bgcolor: 'grey.100',
          display: 'flex',
          justifyContent: 'center',
          p: device === 'mobile' ? 2 : 0,
        }}
      >
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          style={{
            border: device === 'mobile' ? '1px solid #d1d5db' : 0,
            borderRadius: device === 'mobile' ? 16 : 0,
            width: device === 'mobile' ? 375 : '100%',
            height,
            background: '#fff',
          }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1 }}>
        Merge tags show sample values. Use “Send a test” to see the email with a real client’s
        details.
      </Typography>
    </Paper>
  );
}

function previewText(text: string): string {
  const div = previewMergeTags(text);
  return div
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}
