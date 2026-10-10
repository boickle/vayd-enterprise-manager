import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X } from 'lucide-react';
import {
  decodeGmailSnippet,
  fetchGmailRecordContext,
  gmailErrorMessage,
  saveGmailThreadToRecord,
  type GmailRecordClientMatch,
  type GmailRecordContext,
  type GmailRecordMessage,
  type GmailRecordSavedEntry,
} from '../../api/gmail';
import { searchClientsStaff, type ClientSearchRow } from '../../api/clientsStaff';
import { currentPracticeId } from '../../utils/practiceIdFromToken';
import './GmailSaveToRecordModal.css';

type Props = {
  mailbox: string;
  threadId: string;
  subject: string;
  onClose: () => void;
  onSaved: (summary: string) => void;
};

function displayFrom(header: string): string {
  const name = header.replace(/<[^>]*>/g, '').replace(/"/g, '').trim();
  return name || header;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function searchRowName(row: ClientSearchRow): string {
  return [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || `Client #${row.id}`;
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Emails between the practice and this client; staff-only forwards are left
 * out. If none of the client's addresses are on the thread (picked by search),
 * anything with an outside address on it counts.
 */
function clientFacing(messages: GmailRecordMessage[], client: GmailRecordClientMatch | undefined) {
  if (!client) return messages.filter((m) => m.participants.length > 0);
  const withClient = messages.filter((m) => m.participants.some((e) => client.emails.includes(e)));
  return withClient.length ? withClient : messages.filter((m) => m.participants.length > 0);
}

/** Patients to pre-tick: whoever the thread is already on, else the only active pet. */
function defaultPatientIds(
  client: GmailRecordClientMatch | undefined,
  entry: GmailRecordSavedEntry | undefined,
): Set<number> {
  if (entry?.patients.length) return new Set(entry.patients.map((p) => p.id));
  const active = (client?.patients ?? []).filter((p) => p.isActive);
  return new Set(active.length === 1 ? [active[0].id] : []);
}

export default function GmailSaveToRecordModal({ mailbox, threadId, subject, onClose, onSaved }: Props) {
  const practiceId = currentPracticeId();
  const [context, setContext] = useState<GmailRecordContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [clientId, setClientId] = useState<number | null>(null);
  const [selectedNewIds, setSelectedNewIds] = useState<Set<string>>(new Set());
  const [patientIds, setPatientIds] = useState<Set<number>>(new Set());
  const [onMedicalRecord, setOnMedicalRecord] = useState(true);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const applyClient = (ctx: GmailRecordContext, id: number) => {
    const match = ctx.matches.find((m) => m.clientId === id);
    const entry = ctx.saved.find((s) => s.clientId === id);
    setClientId(id);
    setSelectedNewIds(
      new Set(clientFacing(ctx.messages, match).filter((m) => !m.savedClientIds.includes(id)).map((m) => m.id)),
    );
    setPatientIds(defaultPatientIds(match, entry));
    setOnMedicalRecord(entry ? entry.patients.some((p) => p.onMedicalRecord) || !entry.clientLevel : true);
  };

  const loadContext = async (extraClientId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const ctx = await fetchGmailRecordContext({ mailbox, threadId, practiceId, clientId: extraClientId });
      setContext(ctx);
      const preferred =
        extraClientId ??
        ctx.saved[0]?.clientId ??
        (ctx.matches.length === 1 ? ctx.matches[0].clientId : undefined);
      if (preferred && ctx.matches.some((m) => m.clientId === preferred)) applyClient(ctx, preferred);
      if (!ctx.matches.length) setSearchOpen(true);
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailbox, threadId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = window.setTimeout(() => {
      searchClientsStaff(q)
        .then((rows) => {
          if (seq === searchSeq.current) setResults(rows.slice(0, 8));
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const allMessages = context?.messages ?? [];
  const matches = context?.matches ?? [];
  const client = matches.find((m) => m.clientId === clientId);
  const messages = useMemo(() => clientFacing(allMessages, client), [allMessages, client]);
  const hiddenInternal = allMessages.length - messages.length;
  const entry = context?.saved.find((s) => s.clientId === clientId);
  const savedIds = useMemo(() => new Set(entry?.messageIds ?? []), [entry]);
  const newMessages = messages.filter((m) => !savedIds.has(m.id));
  const entryPatientIds = useMemo(() => new Set(entry?.patients.map((p) => p.id) ?? []), [entry]);
  const allNewSelected = newMessages.length > 0 && newMessages.every((m) => selectedNewIds.has(m.id));

  const toggleMessage = (id: string) =>
    setSelectedNewIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const togglePatient = (id: number) =>
    setPatientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const chooseSearchResult = async (row: ClientSearchRow) => {
    const id = Number(row.id);
    setSearchOpen(false);
    setQuery('');
    setResults([]);
    if (context && matches.some((m) => m.clientId === id)) {
      applyClient(context, id);
      return;
    }
    await loadContext(id);
  };

  const hasPatients = (client?.patients.length ?? 0) > 0;
  const wantsRecord = onMedicalRecord && hasPatients;
  const needsPatient = wantsRecord && patientIds.size === 0;
  const addingEmails = newMessages.filter((m) => selectedNewIds.has(m.id)).length;
  const addingPatients = [...patientIds].filter((id) => !entryPatientIds.has(id));
  const addingToRecord =
    wantsRecord && Boolean(entry?.patients.some((p) => patientIds.has(p.id) && !p.onMedicalRecord));
  const nothingToDo = Boolean(entry) && addingEmails === 0 && addingPatients.length === 0 && !addingToRecord;
  const canSave =
    Boolean(client) && !needsPatient && !saving && !loading && !nothingToDo && (Boolean(entry) || addingEmails > 0);

  const patientName = (id: number) => client?.patients.find((p) => p.id === id)?.name ?? 'patient';
  const targetLabel =
    patientIds.size > 0 ? listNames([...patientIds].map(patientName)) : (client?.name ?? 'the client');

  const saveLabel = (() => {
    if (saving) return 'Saving…';
    if (!entry) return addingEmails ? `Save thread (${plural(addingEmails, 'email')}) as one entry` : 'Save';
    if (nothingToDo) return 'Already up to date';
    const bits = [
      addingEmails ? `Add ${plural(addingEmails, 'new email')}` : null,
      addingPatients.length ? `add to ${listNames(addingPatients.map(patientName))}` : null,
    ].filter(Boolean);
    return bits.length ? bits.join(' and ').replace(/^a/, 'A') : 'Update entry';
  })();

  const save = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await saveGmailThreadToRecord({
        mailbox,
        threadId,
        practiceId,
        messageIds: newMessages.filter((m) => selectedNewIds.has(m.id)).map((m) => m.id),
        clientId: client.clientId,
        patientIds: [...patientIds],
        includeOnMedicalRecord: wantsRecord,
      });
      const where = `${targetLabel}${wantsRecord ? ' (medical record + client communications)' : ' (client communications)'}`;
      if (!res.addedEmails && !res.addedPatients && entry) {
        onSaved(`Updated the thread entry on ${where}.`);
      } else if (entry) {
        onSaved(
          `Updated the existing entry on ${where} — it now has ${plural(res.totalEmails, 'email')}.`,
        );
      } else {
        onSaved(`Saved this thread as one entry (${plural(res.totalEmails, 'email')}) on ${where}.`);
      }
      onClose();
    } catch (e) {
      setError(gmailErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const statusBanner = (() => {
    if (!client) return null;
    if (!entry) {
      return (
        <div className="gmail-record-status gmail-record-status--new">
          <strong>Not on {client.name}’s record yet.</strong> All {plural(messages.length, 'email')} will be saved
          together as one entry.
        </div>
      );
    }
    const on = entry.patients.length ? listNames(entry.patients.map((p) => p.name)) : 'the client file';
    if (newMessages.length === 0) {
      return (
        <div className="gmail-record-status gmail-record-status--done">
          <Check size={14} aria-hidden /> <strong>Already saved.</strong> Every email in this thread is in the entry on{' '}
          {on}. Nothing new to add.
        </div>
      );
    }
    return (
      <div className="gmail-record-status gmail-record-status--partial">
        <strong>
          {savedIds.size} of {messages.length} emails are already on {on}.
        </strong>{' '}
        Suggested: add the {plural(newMessages.length, 'new email')} to that same entry.
      </div>
    );
  })();

  const body = (
    <div
      className="gmail-record-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="gmail-record-modal" role="dialog" aria-modal="true" aria-labelledby="gmail-record-title">
        <header className="gmail-record-modal__head">
          <div>
            <h2 id="gmail-record-title">Save to record</h2>
            <p className="gmail-record-modal__subject" title={subject}>
              {subject || '(no subject)'}
            </p>
          </div>
          <button type="button" className="gmail-record-modal__close" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="gmail-record-modal__body">
          {loading && !context ? <div className="gmail-record-modal__state">Checking the record…</div> : null}
          {error ? <div className="gmail-record-modal__error">{error}</div> : null}

          {context ? (
            <>
              <section className="gmail-record-section">
                <div className="gmail-record-section__title-row">
                  <h3>Client</h3>
                  {matches.length > 0 && !searchOpen ? (
                    <button type="button" className="gmail-record-link" onClick={() => setSearchOpen(true)}>
                      Search for a different client
                    </button>
                  ) : null}
                </div>
                {matches.length === 0 ? (
                  <p className="gmail-record-hint">
                    No client in Scout has
                    {context.participantEmails.length
                      ? ` ${context.participantEmails.join(', ')} `
                      : ' an email on this thread '}
                    on file. Search for the client to save this to.
                  </p>
                ) : (
                  <div className="gmail-record-clients" role="radiogroup" aria-label="Client">
                    {matches.map((m) => {
                      const saved = context.saved.find((s) => s.clientId === m.clientId);
                      return (
                        <label
                          key={m.clientId}
                          className={`gmail-record-client${m.clientId === clientId ? ' is-selected' : ''}`}
                        >
                          <input
                            type="radio"
                            name="gmail-record-client"
                            checked={m.clientId === clientId}
                            onChange={() => applyClient(context, m.clientId)}
                          />
                          <span>
                            <strong>{m.name}</strong>
                            <span className="gmail-record-client__meta">
                              {m.matchedEmail ? `Matched ${m.matchedEmail}` : 'Chosen from search'}
                              {' · '}
                              {plural(m.patients.length, 'pet')}
                              {saved ? ` · thread saved (${plural(saved.messageIds.length, 'email')})` : ''}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {searchOpen ? (
                  <div className="gmail-record-search">
                    <div className="gmail-record-search__input">
                      <Search size={15} aria-hidden />
                      <input
                        autoFocus
                        type="search"
                        placeholder="Client name, phone, or email"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    {searching ? <div className="gmail-record-hint">Searching…</div> : null}
                    {!searching && query.trim().length >= 2 && results.length === 0 ? (
                      <div className="gmail-record-hint">No clients found.</div>
                    ) : null}
                    {results.length > 0 ? (
                      <ul className="gmail-record-search__results">
                        {results.map((row) => (
                          <li key={String(row.id)}>
                            <button type="button" onClick={() => void chooseSearchResult(row)}>
                              <strong>{searchRowName(row)}</strong>
                              <span>
                                {[row.address1, row.city].filter(Boolean).join(', ') ||
                                  (typeof row.email === 'string' ? row.email : '')}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {client ? (
                <section className="gmail-record-section">
                  <div className="gmail-record-section__title-row">
                    <h3>Emails</h3>
                    {newMessages.length > 1 ? (
                      <label className="gmail-record-check gmail-record-check--inline">
                        <input
                          type="checkbox"
                          checked={allNewSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = selectedNewIds.size > 0 && !allNewSelected;
                          }}
                          onChange={() =>
                            setSelectedNewIds(allNewSelected ? new Set() : new Set(newMessages.map((m) => m.id)))
                          }
                        />
                        Select all {entry ? 'new ' : ''}({newMessages.length})
                      </label>
                    ) : null}
                  </div>
                  {statusBanner}
                  {hiddenInternal > 0 ? (
                    <p className="gmail-record-hint">
                      {plural(hiddenInternal, 'staff-only email')} in this thread (forwards between staff) {hiddenInternal === 1 ? 'is' : 'are'} not
                      offered for the record. {hiddenInternal === 1 ? 'It stays' : 'They stay'} in Gmail.
                    </p>
                  ) : null}
                  {messages.length === 0 ? (
                    <p className="gmail-record-hint gmail-record-hint--warn">
                      None of the emails in this thread are to or from {client.name}.
                    </p>
                  ) : null}
                  <ul className="gmail-record-messages">
                    {messages.map((m) => {
                      const isSaved = savedIds.has(m.id);
                      return (
                        <li key={m.id} className={isSaved ? 'is-saved' : undefined}>
                          <label className="gmail-record-message">
                            <input
                              type="checkbox"
                              checked={isSaved || selectedNewIds.has(m.id)}
                              disabled={isSaved}
                              onChange={() => toggleMessage(m.id)}
                            />
                            <span className="gmail-record-message__main">
                              <span className="gmail-record-message__top">
                                <strong>{displayFrom(m.from)}</strong>
                                <span className="gmail-record-message__date">{formatWhen(m.date)}</span>
                              </span>
                              <span className="gmail-record-message__snippet">{decodeGmailSnippet(m.snippet)}</span>
                            </span>
                            {isSaved ? (
                              <span className="gmail-record-tag gmail-record-tag--saved">
                                <Check size={11} aria-hidden /> In record
                              </span>
                            ) : (
                              <span className="gmail-record-tag gmail-record-tag--new">
                                {entry ? 'New' : 'Not saved'}
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              {client ? (
                <section className="gmail-record-section">
                  <h3>Patients</h3>
                  {!hasPatients ? (
                    <p className="gmail-record-hint">This client has no patients, so it will go on the client file.</p>
                  ) : (
                    <div className="gmail-record-patients">
                      {client.patients.map((p) => {
                        const already = entryPatientIds.has(p.id);
                        return (
                          <label key={p.id} className={`gmail-record-check${p.isActive ? '' : ' is-inactive'}`}>
                            <input
                              type="checkbox"
                              checked={already || patientIds.has(p.id)}
                              disabled={already}
                              onChange={() => togglePatient(p.id)}
                            />
                            {p.name}
                            {p.species ? <span className="gmail-record-patient__meta">{p.species}</span> : null}
                            {!p.isActive ? (
                              <span className="gmail-record-patient__meta">{p.status ?? 'Inactive'}</span>
                            ) : null}
                            {already ? (
                              <span className="gmail-record-tag gmail-record-tag--saved">
                                <Check size={11} aria-hidden /> On record
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              {client ? (
                <section className="gmail-record-section">
                  <h3>Save to</h3>
                  <label className="gmail-record-check">
                    <input type="checkbox" checked disabled />
                    Client communications
                    <span className="gmail-record-patient__meta">always</span>
                  </label>
                  <label className="gmail-record-check">
                    <input
                      type="checkbox"
                      checked={wantsRecord}
                      disabled={!hasPatients}
                      onChange={(e) => setOnMedicalRecord(e.target.checked)}
                    />
                    Patient medical record (EMR)
                  </label>
                  {needsPatient && hasPatients ? (
                    <p className="gmail-record-hint gmail-record-hint--warn">
                      Choose at least one patient for the medical record, or untick it to save to client communications
                      only.
                    </p>
                  ) : null}
                  <p className="gmail-record-hint">
                    The whole thread is kept as a single entry, dated by its latest email. Emails that arrive later are
                    added to that same entry.
                  </p>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="gmail-record-modal__foot">
          <button type="button" className="gmail-record-btn" onClick={onClose} disabled={saving}>
            {nothingToDo ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="gmail-record-btn gmail-record-btn--primary"
            onClick={() => void save()}
            disabled={!canSave}
          >
            {saveLabel}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
