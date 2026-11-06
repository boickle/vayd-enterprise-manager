import { useRef, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Trash2 } from 'lucide-react';
import { ExternalContact } from '../../api/emailCampaigns';

const MAX_CONTACTS = 2000;

type Props = {
  contacts: ExternalContact[];
  onChange: (contacts: ExternalContact[]) => void;
  disabled?: boolean;
  /** The pasted list is the whole audience, not an addition to clients. */
  listOnly?: boolean;
};

/** One person per line: "Name, email", "First, Last, email", or "Name <email>". */
export function parseExternalContactList(text: string): ExternalContact[] {
  const rows: ExternalContact[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/name/i.test(line) && /email/i.test(line) && !line.includes('@')) continue;
    const angle = line.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
    if (angle) {
      rows.push({ ...splitName(angle[1]), email: angle[2] });
      continue;
    }
    const parts = line
      .split(/[,\t]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const emailAt = parts.findIndex((p) => p.includes('@'));
    if (emailAt >= 0) {
      const email = parts[emailAt].replace(/^mailto:/i, '');
      const names = parts.filter((_, i) => i !== emailAt);
      if (names.length >= 2) {
        rows.push({
          firstName: names[0],
          lastName: names.slice(1).join(' '),
          email,
        });
      } else {
        rows.push({ ...splitName(names[0] ?? ''), email });
      }
      continue;
    }
    const bits = line.split(/\s+/);
    const emailBit = bits.findIndex((b) => b.includes('@'));
    if (emailBit >= 0) {
      rows.push({
        ...splitName(bits.filter((_, i) => i !== emailBit).join(' ')),
        email: bits[emailBit],
      });
    }
  }
  return rows;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const cleaned = name.replace(/^["']+|["']+$/g, '').trim();
  if (!cleaned) return { firstName: '', lastName: '' };
  const [first, ...rest] = cleaned.split(/\s+/);
  return { firstName: first ?? '', lastName: rest.join(' ') };
}

function mergeContacts(current: ExternalContact[], extra: ExternalContact[]): ExternalContact[] {
  const seen = new Set(current.map((c) => c.email.trim().toLowerCase()).filter(Boolean));
  const next = [...current];
  for (const row of extra) {
    const email = row.email.trim().toLowerCase();
    if (email && seen.has(email)) continue;
    if (email) seen.add(email);
    if (next.length >= MAX_CONTACTS) break;
    next.push({
      firstName: row.firstName.trim(),
      lastName: row.lastName.trim(),
      email,
    });
  }
  return next;
}

export default function ExternalContactsField({
  contacts,
  onChange,
  disabled,
  listOnly,
}: Props) {
  const [draft, setDraft] = useState({ firstName: '', lastName: '', email: '' });
  const [paste, setPaste] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const update = (index: number, patch: Partial<ExternalContact>) => {
    onChange(contacts.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addDraft = () => {
    const email = draft.email.trim().toLowerCase();
    if (!email && !draft.firstName.trim() && !draft.lastName.trim()) return;
    if (email && contacts.some((c) => c.email.trim().toLowerCase() === email)) {
      setNote('That email is already on the list.');
      return;
    }
    if (contacts.length >= MAX_CONTACTS) {
      setNote(`The list holds ${MAX_CONTACTS.toLocaleString()} people.`);
      return;
    }
    setNote(null);
    onChange(
      mergeContacts(contacts, [
        { firstName: draft.firstName, lastName: draft.lastName, email: draft.email },
      ])
    );
    setDraft({ firstName: '', lastName: '', email: '' });
  };

  const addParsed = (text: string) => {
    const parsed = parseExternalContactList(text);
    if (!parsed.length) {
      setNote('No email addresses found. Use one person per line: Name, email.');
      return;
    }
    const next = mergeContacts(contacts, parsed);
    const added = next.length - contacts.length;
    setNote(
      added === 0
        ? 'Those addresses are already on the list.'
        : `Added ${added.toLocaleString()} ${added === 1 ? 'person' : 'people'}.`
    );
    onChange(next);
    setPaste('');
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
        {listOnly ? 'People to email' : 'Also email these people'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {listOnly
          ? 'These are the only recipients. Clients chosen by the filters above are not included. If an address here belongs to a client anyway, pet-loss, do-not-market, and unsubscribe rules still apply.'
          : 'Add anyone who is not in the client list. They are included on top of the clients chosen above. If an address already belongs to a client, that client is used instead, and the pet-loss, do-not-market, and unsubscribe rules still apply. Addresses that are not on a client record are emailed as entered.'}
      </Typography>

      <Stack spacing={1.5}>
        {contacts.length ? (
          <Box sx={{ maxHeight: 360, overflow: 'auto', pt: 1.25, px: 0.25 }}>
            <Stack spacing={2}>
              {contacts.map((row, index) => (
                <Box key={`${row.email}-${index}`} sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    label="First name"
                    value={row.firstName}
                    disabled={disabled}
                    onChange={(e) => update(index, { firstName: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Last name"
                    value={row.lastName}
                    disabled={disabled}
                    onChange={(e) => update(index, { lastName: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Email"
                    value={row.email}
                    disabled={disabled}
                    onChange={(e) => update(index, { email: e.target.value })}
                    sx={{ flex: 1.4 }}
                  />
                  <IconButton
                    aria-label="Remove person"
                    disabled={disabled}
                    onClick={() => onChange(contacts.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No extra people yet.
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="First name"
            value={draft.firstName}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, firstName: e.target.value }))}
            sx={{ width: 140 }}
          />
          <TextField
            size="small"
            label="Last name"
            value={draft.lastName}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, lastName: e.target.value }))}
            sx={{ width: 140 }}
          />
          <TextField
            size="small"
            label="Email"
            value={draft.email}
            disabled={disabled}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            sx={{ width: 220 }}
          />
          <Button variant="outlined" disabled={disabled} onClick={addDraft} sx={{ height: 40 }}>
            Add person
          </Button>
        </Box>

        <TextField
          size="small"
          label="Paste a list"
          placeholder={'Jane Doe, jane@example.com\nBob Smith <bob@example.com>'}
          value={paste}
          disabled={disabled}
          onChange={(e) => setPaste(e.target.value)}
          multiline
          minRows={3}
          fullWidth
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            disabled={disabled || !paste.trim()}
            onClick={() => addParsed(paste)}
          >
            Add pasted people
          </Button>
          <Button variant="outlined" disabled={disabled} onClick={() => fileRef.current?.click()}>
            Upload CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              void file.text().then((text) => addParsed(text));
            }}
          />
        </Box>
        {note ? (
          <Typography variant="body2" color="text.secondary">
            {note}
          </Typography>
        ) : null}
        {contacts.length ? (
          <Typography variant="caption" color="text.secondary">
            {contacts.length.toLocaleString()} {contacts.length === 1 ? 'person' : 'people'} on
            this list
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
