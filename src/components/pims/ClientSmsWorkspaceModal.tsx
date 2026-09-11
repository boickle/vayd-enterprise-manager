import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { sendClientSms } from '../../api/clientSms';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import type { Message } from '../../api/clientPortal';
import {
  fetchClientMessagesCached,
  getCachedClientMessages,
} from '../../utils/clientMessagesCache';
import {
  CLIENT_MESSAGES_PER_LINE,
  groupClientMessagesByLine,
  messageTouchesClientPhone,
  practiceLineOnMessage,
} from '../../utils/clientMessagesByLine';
import {
  displayNameForQuoLine,
  resolveLineDirectoryEntry,
  useOpenPhoneLineDirectory,
} from '../../hooks/useOpenPhoneLineDirectory';
import type { ClientReachPet, ClientReachPhone } from '../../utils/clientReachContacts';
import { clientDoNotSmsFromRecord, confirmSendDespiteDoNotSms } from '../../utils/doNotSmsWarning';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { smsAllowsProductionOverride } from '../../utils/smsEnvironment';
import { appAlert } from '../../utils/appDialog';
import MessageTemplatePicker from '../messageTemplates/MessageTemplatePicker';
import { mergeValuesFromNames } from '../../utils/messageTemplateFields';
import { formatDisplayPhone, phonesMatchForQuo } from '../../utils/quoContact';

type Props = {
  open: boolean;
  clientId: number;
  clientLabel: string;
  phones: ClientReachPhone[];
  initialPhone?: string | null;
  historyOnly?: boolean;
  pets: ClientReachPet[];
  defaultPatientIds?: number[];
  doNotSms?: boolean;
  onClose: () => void;
  onPostedToEmr?: () => void;
};

function isIncoming(message: Message): boolean {
  const dir = String(message.direction ?? '').toLowerCase();
  return dir === 'incoming' || dir === 'inbound';
}

function formatWhen(iso: string): string {
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toFormat('MMM d, yyyy h:mm a') : iso;
}

function transcriptForMessages(messages: Message[], clientLabel: string, phoneLabel: string): string {
  const ordered = [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const lines = ordered.map((m) => {
    const who = isIncoming(m) ? 'Client' : 'Clinic';
    return `${formatWhen(m.createdAt)} · ${who}\n${m.content.trim()}`;
  });
  return [`Text history with ${clientLabel}${phoneLabel ? ` · ${phoneLabel}` : ''}`, '', ...lines].join(
    '\n',
  );
}

export function ClientSmsWorkspaceModal({
  open,
  clientId,
  clientLabel,
  phones,
  initialPhone,
  historyOnly = false,
  pets,
  defaultPatientIds,
  doNotSms,
  onClose,
  onPostedToEmr,
}: Props) {
  const allowOverride = smsAllowsProductionOverride();
  const { directory, lines: quoLines } = useOpenPhoneLineDirectory(open);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'compose' | 'history'>(historyOnly ? 'history' : 'compose');
  const [phoneFilter, setPhoneFilter] = useState<string>('all');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [resolvedDoNotSms, setResolvedDoNotSms] = useState(doNotSms === true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [emrPets, setEmrPets] = useState<number[]>(defaultPatientIds ?? []);
  const [postingEmr, setPostingEmr] = useState(false);
  const [overrideNonProd, setOverrideNonProd] = useState(false);
  const [openLineKeys, setOpenLineKeys] = useState<Set<string>>(() => new Set());
  const [fromPhone, setFromPhone] = useState('');
  const isHistory = mode === 'history';

  function firstSendablePhone(): string {
    return phones.find((p) => p.sms)?.phone ?? phones[0]?.phone ?? 'all';
  }

  function goCompose() {
    setMode('compose');
    setPhoneFilter((cur) => (cur === 'all' ? firstSendablePhone() : cur));
  }

  useEffect(() => {
    if (!open) return;
    const match = initialPhone
      ? phones.find((p) => phonesMatchForQuo(p.phone, initialPhone))
      : null;
    setMode(historyOnly ? 'history' : 'compose');
    setPhoneFilter(historyOnly ? (match?.phone ?? 'all') : (match?.phone ?? firstSendablePhone()));
    setDraft('');
    setSendError(null);
    setError(null);
    setSelectedIds(new Set());
    setOpenLineKeys(new Set());
    setEmrPets(defaultPatientIds ?? []);
    setOverrideNonProd(false);
    setFromPhone('');
  }, [open, initialPhone, historyOnly, phones, defaultPatientIds]);

  useEffect(() => {
    if (!open) return;
    if (doNotSms === true || doNotSms === false) {
      setResolvedDoNotSms(doNotSms);
      return;
    }
    let cancelled = false;
    void fetchClientByIdStaff(clientId)
      .then((raw) => {
        if (!cancelled) setResolvedDoNotSms(clientDoNotSmsFromRecord(raw));
      })
      .catch(() => {
        if (!cancelled) setResolvedDoNotSms(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientId, doNotSms]);

  useEffect(() => {
    if (!open) {
      setMessages([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    let cancelled = false;
    const cached = getCachedClientMessages(clientId);
    if (cached?.messages?.length) {
      setMessages(cached.messages);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    void (async () => {
      try {
        const res = await fetchClientMessagesCached(clientId, { refresh: Boolean(cached) });
        if (cancelled) return;
        setMessages(res.messages ?? []);
        setError(null);
      } catch (e: unknown) {
        if (cancelled || cached) return;
        const ax = e as { response?: { data?: { message?: string } }; message?: string };
        setError(ax?.response?.data?.message ?? ax?.message ?? 'Could not load texts.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, clientId]);

  const filtered = useMemo(() => {
    if (phoneFilter === 'all') return messages;
    return messages.filter((m) => messageTouchesClientPhone(m, phoneFilter));
  }, [messages, phoneFilter]);

  const lineGroups = useMemo(() => {
    const clientPhones = phones.map((p) => p.phone);
    return groupClientMessagesByLine(filtered, clientPhones, CLIENT_MESSAGES_PER_LINE);
  }, [filtered, phones]);

  const visibleMessages = useMemo(
    () => lineGroups.filter((g) => openLineKeys.has(g.lineKey)).flatMap((g) => g.messages),
    [lineGroups, openLineKeys],
  );

  const allMessages = useMemo(() => lineGroups.flatMap((g) => g.messages), [lineGroups]);

  const sendToPhone =
    phoneFilter !== 'all'
      ? phoneFilter
      : phones.find((p) => p.sms)?.phone ?? phones[0]?.phone ?? null;
  const sendToRow = phones.find((p) => phonesMatchForQuo(p.phone, sendToPhone ?? ''));
  const sendFromRow =
    quoLines.find((line) => phonesMatchForQuo(line.phone, fromPhone)) ??
    (fromPhone ? resolveLineDirectoryEntry(directory, fromPhone) : null);

  useEffect(() => {
    if (!open || isHistory || fromPhone || quoLines.length === 0) return;
    const clientPhones = phones.map((p) => p.phone);
    const lastPracticeLine = messages
      .map((m) => practiceLineOnMessage(m, clientPhones))
      .find((line) => quoLines.some((q) => phonesMatchForQuo(q.phone, line)));
    const preferred =
      (lastPracticeLine && quoLines.find((q) => phonesMatchForQuo(q.phone, lastPracticeLine))?.phone) ??
      quoLines[0]?.phone ??
      '';
    if (preferred) setFromPhone(preferred);
  }, [open, isHistory, fromPhone, quoLines, messages, phones]);
  const phoneLabel =
    phoneFilter === 'all'
      ? 'All numbers'
      : sendToRow
        ? `${sendToRow.label} ${sendToRow.phone}`
        : phoneFilter;

  async function handleSend() {
    const text = draft.trim();
    if (!text || !sendToPhone || sending) return;
    const ok = await confirmSendDespiteDoNotSms(resolvedDoNotSms);
    if (!ok) return;
    setSending(true);
    setSendError(null);
    try {
      await sendClientSms(clientId, {
        message: text,
        to: sendToPhone,
        ...(fromPhone ? { from: fromPhone } : {}),
        source: 'client_reach',
        ...(overrideNonProd ? { overrideNonProd: true } : {}),
      });
      if (emrPets.length > 0) {
        await recordScoutChartCommunication({
          clientId,
          patientIds: emrPets,
          channel: 'sms',
          body: text,
          destination: sendToPhone,
          sentFrom: fromPhone || undefined,
          includeOnMedicalRecord: true,
        });
        onPostedToEmr?.();
      }
      setDraft('');
      await appAlert('Text sent.');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      setSendError(ax?.response?.data?.message ?? ax?.message ?? 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  async function handleAddHistoryToEmr() {
    const chosen = visibleMessages.filter((m) => selectedIds.has(m.id));
    if (chosen.length === 0) {
      await appAlert('Check the texts you want on the chart.');
      return;
    }
    if (emrPets.length === 0) {
      await appAlert('Choose at least one pet.');
      return;
    }
    setPostingEmr(true);
    try {
      await recordScoutChartCommunication({
        clientId,
        patientIds: emrPets,
        channel: 'sms',
        body: transcriptForMessages(chosen, clientLabel, phoneLabel),
        destination: phoneFilter === 'all' ? undefined : phoneFilter,
        typeLabel: 'Text history',
        includeOnMedicalRecord: true,
      });
      onPostedToEmr?.();
      setSelectedIds(new Set());
      await appAlert(
        chosen.length === 1
          ? 'Added that text to the patient chart.'
          : `Added ${chosen.length} texts to the patient chart.`,
      );
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string } }; message?: string };
      await appAlert(ax?.response?.data?.message ?? ax?.message ?? 'Could not add to the chart.');
    } finally {
      setPostingEmr(false);
    }
  }

  function toggleMessage(id: string) {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleEmrPet(id: number) {
    setEmrPets((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleLine(lineKey: string) {
    setOpenLineKeys((cur) => {
      const next = new Set(cur);
      if (next.has(lineKey)) next.delete(lineKey);
      else next.add(lineKey);
      return next;
    });
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick client-reach-overlay" role="dialog" aria-modal="true" aria-labelledby="client-sms-ws-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card client-reach-sms">
        <div className="pims-chart-pick__head">
          <div>
            <h3 id="client-sms-ws-title">{isHistory ? 'Text history' : 'Text client'}</h3>
            <p className="client-reach-sms__hint">
              {clientLabel}
              {isHistory && lineGroups.length
                ? ` · ${lineGroups.length} Quo ${lineGroups.length === 1 ? 'line' : 'lines'} with texts`
                : ''}
              {isHistory && refreshing ? ' · refreshing…' : ''}
            </p>
          </div>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>

        {isHistory ? (
          <button type="button" className="client-reach-sms__switch" onClick={goCompose}>
            Write a text
          </button>
        ) : (
          <button type="button" className="client-reach-sms__switch" onClick={() => setMode('history')}>
            View text history
          </button>
        )}

        {phones.length ? (
          <div className="client-reach-sms__phones" role="tablist" aria-label="Client numbers">
            <span className="client-reach-sms__phones-label">
              {isHistory ? 'Their numbers' : 'Send to'}
            </span>
            {isHistory && phones.length > 1 ? (
              <button
                type="button"
                role="tab"
                className={`brief-btn${phoneFilter === 'all' ? ' primary' : ''}`}
                aria-selected={phoneFilter === 'all'}
                onClick={() => setPhoneFilter('all')}
              >
                Either number
              </button>
            ) : null}
            {phones.map((row) => (
              <button
                key={row.phone}
                type="button"
                role="tab"
                className={`brief-btn${
                  phones.length === 1 || phonesMatchForQuo(phoneFilter, row.phone) ? ' primary' : ''
                }`}
                aria-selected={phones.length === 1 || phonesMatchForQuo(phoneFilter, row.phone)}
                onClick={() => setPhoneFilter(row.phone)}
              >
                {row.label} {formatDisplayPhone(row.phone)}
                {!row.sms ? ' · no SMS' : ''}
              </button>
            ))}
          </div>
        ) : (
          <p className="client-reach-sms__hint">No phone on file.</p>
        )}

        {!isHistory ? (
          <label className="client-reach-sms__field">
            <span>Send from</span>
            {quoLines.length === 0 ? (
              <p className="client-reach-sms__hint">Loading Quo lines…</p>
            ) : (
              <select
                className="client-reach-sms__from-select"
                value={fromPhone}
                disabled={sending}
                onChange={(e) => setFromPhone(e.target.value)}
              >
                {fromPhone ? null : <option value="">Choose a Quo line…</option>}
                {quoLines.map((line) => (
                  <option key={line.phone} value={line.phone}>
                    {displayNameForQuoLine(line)} · {formatDisplayPhone(line.phone)}
                  </option>
                ))}
              </select>
            )}
          </label>
        ) : null}

        {resolvedDoNotSms ? (
          <p className="client-reach-sms__warn" role="alert">
            {isHistory
              ? 'Do not SMS is on. You can still review history.'
              : 'Do not SMS is on. You can still send after confirming.'}
          </p>
        ) : null}

        {isHistory ? (
          <>
            <div className="client-reach-sms__history">
              {loading ? <p className="client-reach-sms__hint">Loading texts…</p> : null}
              {error ? <p className="client-reach-sms__error">{error}</p> : null}
              {!loading && !error && allMessages.length === 0 ? (
                <p className="client-reach-sms__hint">No texts found on any Quo line for these numbers.</p>
              ) : null}
              {lineGroups.map((group) => {
                const quo = resolveLineDirectoryEntry(directory, group.linePhone);
                const expanded = openLineKeys.has(group.lineKey);
                const lineName = displayNameForQuoLine(quo);
                return (
                <section key={group.lineKey} className="client-reach-sms__line">
                  <button
                    type="button"
                    className="client-reach-sms__quo"
                    aria-expanded={expanded}
                    onClick={() => toggleLine(group.lineKey)}
                  >
                    <span className="client-reach-sms__quo-main">
                      {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                      <strong>
                        {lineName} ({group.messages.length})
                      </strong>
                    </span>
                    <span>{formatDisplayPhone(quo.phone)}</span>
                  </button>
                  {expanded
                    ? group.messages.map((message) => {
                        const incoming = isIncoming(message);
                        return (
                          <label
                            key={message.id}
                            className={`client-reach-sms__bubble${incoming ? ' is-in' : ' is-out'}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(message.id)}
                              onChange={() => toggleMessage(message.id)}
                            />
                            <span>
                              <span className="client-reach-sms__meta">
                                {incoming ? 'Incoming' : 'Outgoing'} · {formatWhen(message.createdAt)}
                              </span>
                              <span className="client-reach-sms__body">{message.content}</span>
                            </span>
                          </label>
                        );
                      })
                    : null}
                </section>
                );
              })}
            </div>

            <fieldset className="client-reach-sms__emr">
              <legend>Add to patient EMR</legend>
              <p>
                Check the texts above, choose every pet this belongs on, then add them to the chart.
              </p>
              {pets.length === 0 ? (
                <p className="client-reach-sms__hint">No pets on this client.</p>
              ) : (
                <div className="client-reach-sms__pets">
                  {pets.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={emrPets.includes(p.id)}
                        onChange={() => toggleEmrPet(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
              <div className="pims-chart-pick__foot">
                <button
                  type="button"
                  className="brief-btn"
                  disabled={visibleMessages.length === 0}
                  onClick={() =>
                    setSelectedIds(
                      selectedIds.size === visibleMessages.length
                        ? new Set()
                        : new Set(visibleMessages.map((m) => m.id)),
                    )
                  }
                >
                  {selectedIds.size === visibleMessages.length && visibleMessages.length > 0
                    ? 'Clear selection'
                    : 'Select visible'}
                </button>
                <button
                  type="button"
                  className="brief-btn primary"
                  disabled={postingEmr || selectedIds.size === 0 || emrPets.length === 0}
                  onClick={() => void handleAddHistoryToEmr()}
                >
                  {postingEmr ? 'Adding…' : 'Add selected to EMR'}
                </button>
              </div>
            </fieldset>

            <div className="pims-chart-pick__foot">
              <button type="button" className="brief-btn" onClick={onClose}>
                Close
              </button>
              <button type="button" className="brief-btn primary" onClick={goCompose}>
                Write a text
              </button>
            </div>
          </>
        ) : (
          <div className="client-reach-sms__compose">
            <MessageTemplatePicker
              channel="sms"
              mergeValues={mergeValuesFromNames({ clientFullName: clientLabel })}
              disabled={sending}
              currentBody={draft}
              onApply={({ body }) => setDraft(body)}
            />
            <label className="client-reach-sms__field">
              <span>
                New text
                {sendFromRow
                  ? ` · from ${displayNameForQuoLine(sendFromRow)}`
                  : ''}
                {sendToRow ? ` · to ${sendToRow.label} ${formatDisplayPhone(sendToRow.phone)}` : ''}
              </span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                disabled={sending || !sendToPhone}
                placeholder={sendToPhone ? 'Write a text…' : 'No number to text'}
              />
            </label>
            <fieldset className="client-reach-sms__emr">
              <legend>Patient chart</legend>
              <p>
                Choose the pets this outgoing text should go on. Leave them unchecked to send without
                adding it to any EMR.
              </p>
              {pets.length === 0 ? (
                <p className="client-reach-sms__hint">No pets on this client.</p>
              ) : (
                <div className="client-reach-sms__pets">
                  {pets.map((p) => (
                    <label key={p.id}>
                      <input
                        type="checkbox"
                        checked={emrPets.includes(p.id)}
                        onChange={() => toggleEmrPet(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            {allowOverride ? (
              <label className="client-reach-sms__inline">
                <input
                  type="checkbox"
                  checked={overrideNonProd}
                  onChange={(e) => setOverrideNonProd(e.target.checked)}
                />
                Send to the actual client
              </label>
            ) : null}
            {sendError ? <p className="client-reach-sms__error">{sendError}</p> : null}
            <div className="pims-chart-pick__foot">
              <button type="button" className="brief-btn" onClick={onClose} disabled={sending}>
                Close
              </button>
              <button
                type="button"
                className="brief-btn primary"
                disabled={sending || !draft.trim() || !sendToPhone || (quoLines.length > 0 && !fromPhone)}
                onClick={() => void handleSend()}
              >
                {sending ? 'Sending…' : 'Send text'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
