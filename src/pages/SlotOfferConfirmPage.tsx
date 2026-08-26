import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { DateTime } from 'luxon';
import {
  declineSlotOffer,
  fetchSlotOfferConfirm,
  tapSlotOffer,
  type SlotOfferConfirmPetCareNeeds,
  type SlotOfferConfirmResponse,
} from '../api/publicSlotOffers';
import { formatForwardBookingSmsBookedSlot } from '../utils/forwardBookingSmsMessage';
import { clientFirstNameForSms } from '../utils/clientFirstNameForSms';
import { practiceTimeZoneOrDefault } from '../utils/practiceTimezone';
import './PostAppointmentSurvey.css';

const VAYD_LOGO_SRC = '/final_thick_lines_cropped.jpeg';

function petNamesPossessive(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return "your pet's";
  if (cleaned.length === 1) return `${cleaned[0]!}'s`;
  if (cleaned.length === 2) return `${cleaned[0]!} and ${cleaned[1]!}'s`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]!}'s`;
}

function formatArrivalWindowParts(
  arrivalWindow: SlotOfferConfirmResponse['arrivalWindow'],
  practiceTz: string
): { dateLabel: string; timeRange: string; combined: string } | null {
  const startRaw = arrivalWindow?.start?.trim();
  const endRaw = arrivalWindow?.end?.trim();
  if (!startRaw || !endRaw) return null;
  const window = formatForwardBookingSmsBookedSlot(startRaw, endRaw, practiceTz, startRaw);
  if (window.windowStart === 'xxxx') return null;
  const timeRange = `${window.windowStart} – ${window.windowEnd}`;
  return {
    dateLabel: window.dateLabel,
    timeRange,
    combined: `${window.dateLabel} · ${timeRange}`,
  };
}

function formatArrivalWindow(
  arrivalWindow: SlotOfferConfirmResponse['arrivalWindow'],
  practiceTz: string
): string | null {
  return formatArrivalWindowParts(arrivalWindow, practiceTz)?.combined ?? null;
}

function statusHeadline(
  data: SlotOfferConfirmResponse,
  inDeclineForm: boolean,
  pets: string[]
): string {
  const firstName = clientFirstNameForSms({ firstName: data.clientFirstName });
  if (inDeclineForm && data.status !== 'unavailable') {
    return `Hi, ${firstName}. Request a different time.`;
  }
  if (data.status === 'unavailable') {
    return `Hi, ${firstName}. This time isn't available anymore.`;
  }
  if (data.status === 'pending') {
    return `Hi, ${firstName}. Confirm ${petNamesPossessive(pets)} visit time.`;
  }
  switch (data.status) {
    case 'accepted':
      return `Hi, ${firstName}. You're all set!`;
    case 'expired':
      return inDeclineForm
        ? `Hi, ${firstName}. Share your preferred times.`
        : 'This offer has expired';
    case 'manual_review':
      return 'Your care team will be in touch';
    case 'superseded':
      return 'We sent you a new option';
    default:
      return 'Appointment offer';
  }
}

function formatReminderDueDate(iso: string, practiceTz: string): string {
  const dt = DateTime.fromISO(iso, { zone: practiceTz });
  return dt.isValid ? dt.toFormat('MMMM d, yyyy') : iso;
}

function PetCareNeedsSection({
  pets,
  practiceTz,
}: {
  pets: SlotOfferConfirmPetCareNeeds[];
  practiceTz: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (pets.length === 0) return null;

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div className="slot-offer-confirm__care-needs">
      {pets.map((pet) => {
        const key = pet.name.trim() || 'pet';
        const isOpen = Boolean(expanded[key]);
        const hasPastDue = pet.pastDue.length > 0;
        const hasUpcoming = pet.upcoming.length > 0;
        return (
          <div key={key} className="slot-offer-confirm__care-needs-pet">
            <button
              type="button"
              className="slot-offer-confirm__care-needs-toggle"
              aria-expanded={isOpen}
              onClick={() => toggle(key)}
            >
              <span>See what {pet.name} needs</span>
              <span className="slot-offer-confirm__care-needs-icon" aria-hidden>
                {isOpen ? '−' : '+'}
              </span>
            </button>
            {isOpen ? (
              <div className="slot-offer-confirm__care-needs-panel">
                {!hasPastDue && !hasUpcoming ? (
                  <p className="slot-offer-confirm__care-needs-empty">
                    Nothing due in the next few months.
                  </p>
                ) : null}
                {hasPastDue ? (
                  <div className="slot-offer-confirm__care-needs-group">
                    <p className="slot-offer-confirm__care-needs-group-label">Past due</p>
                    <ul className="slot-offer-confirm__care-needs-list">
                      {pet.pastDue.map((item, idx) => (
                        <li key={`past-${idx}`}>
                          <strong>{item.description}</strong>
                          <span className="slot-offer-confirm__care-needs-due">
                            Due {formatReminderDueDate(item.dueDate, practiceTz)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {hasUpcoming ? (
                  <div className="slot-offer-confirm__care-needs-group">
                    <p className="slot-offer-confirm__care-needs-group-label">Coming up</p>
                    <ul className="slot-offer-confirm__care-needs-list">
                      {pet.upcoming.map((item, idx) => (
                        <li key={`up-${idx}`}>
                          <strong>{item.description}</strong>
                          <span className="slot-offer-confirm__care-needs-due">
                            Due {formatReminderDueDate(item.dueDate, practiceTz)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function AppointmentSummary({
  doctorName,
  windowParts,
  pets,
}: {
  doctorName?: string | null;
  windowParts: { dateLabel: string; timeRange: string } | null;
  pets: string[];
}) {
  if (!doctorName?.trim() && !windowParts && pets.length === 0) return null;
  return (
    <div className="slot-offer-confirm__summary">
      {windowParts ? (
        <p>
          <span className="slot-offer-confirm__summary-label">When</span>
          <br />
          <strong>{windowParts.dateLabel}</strong>
          <br />
          {windowParts.timeRange}
        </p>
      ) : null}
      {doctorName?.trim() ? (
        <p style={{ marginTop: windowParts ? 10 : 0 }}>
          <span className="slot-offer-confirm__summary-label">With</span>
          <br />
          <strong>{doctorName.trim()}</strong>
        </p>
      ) : null}
      {pets.length > 0 ? (
        <p style={{ marginTop: 10 }}>
          <span className="slot-offer-confirm__summary-label">{pets.length === 1 ? 'Pet' : 'Pets'}</span>
          <br />
          {pets.join(', ')}
        </p>
      ) : null}
    </div>
  );
}

export default function SlotOfferConfirmPage() {
  const { token = '' } = useParams<{ token: string }>();
  const practiceTz = practiceTimeZoneOrDefault(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SlotOfferConfirmResponse | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineNote, setDeclineNote] = useState('');

  const load = useCallback(async () => {
    const t = token.trim();
    if (!t) {
      setError('This link is missing a confirmation code.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSlotOfferConfirm(t);
      setData(next);
      if (next.canSubmitDeclineNote || next.status === 'unavailable') {
        setShowDeclineForm(true);
      }
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not load this offer.';
      setError(String(msg));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onConfirm = async () => {
    const t = token.trim();
    if (!t) return;
    setBusy('confirm');
    setError(null);
    try {
      await tapSlotOffer(t);
      setResultMessage(null);
      setShowDeclineForm(false);
      await load();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not confirm this time.';
      setError(String(msg));
    } finally {
      setBusy(null);
    }
  };

  const onSubmitDecline = async () => {
    const t = token.trim();
    const message = declineNote.trim();
    if (!t) return;
    if (!message) {
      setError('Please tell us what days and times work better for you.');
      return;
    }
    setBusy('decline');
    setError(null);
    try {
      const res = await declineSlotOffer(t, message);
      setResultMessage(res.message?.trim() || null);
      setShowDeclineForm(false);
      setDeclineNote('');
      await load();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not submit your response.';
      setError(String(msg));
    } finally {
      setBusy(null);
    }
  };

  const windowParts = formatArrivalWindowParts(data?.arrivalWindow, practiceTz);
  const windowLabel = windowParts?.combined ?? null;
  const pets = data?.pets?.filter((p) => p?.trim()) ?? [];
  const petCareNeeds = data?.petCareNeeds ?? [];
  const inDeclineForm =
    Boolean(
      data?.canSubmitDeclineNote ||
        data?.status === 'unavailable' ||
        (data?.canDecline && showDeclineForm)
    ) && !resultMessage;
  const showPrimaryActions =
    Boolean(data?.canConfirm || (data?.canDecline && data?.status !== 'unavailable')) &&
    !inDeclineForm &&
    !resultMessage;
  const showAppointmentSummary =
    data?.status !== 'unavailable' &&
    !inDeclineForm &&
    Boolean(windowParts || data?.doctorName?.trim() || pets.length > 0);
  const showUnavailableMessage =
    data?.status === 'unavailable' && Boolean(data.message?.trim()) && !resultMessage;
  const showPetCareNeeds =
    petCareNeeds.length > 0 && (showAppointmentSummary || inDeclineForm);
  const declineFormHasContextMessage =
    showUnavailableMessage ||
    Boolean(data?.message?.trim() && data.status !== 'pending');

  return (
    <div className="survey-page">
      <div className="survey-card survey-success">
        <div className="slot-offer-confirm__logo-wrap">
          <img
            src={VAYD_LOGO_SRC}
            alt="Vet At Your Door"
            className="slot-offer-confirm__logo"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        {loading ? (
          <p className="survey-success-blurb" style={{ textAlign: 'center' }}>
            Loading…
          </p>
        ) : error && !data ? (
          <p className="survey-success-blurb" style={{ textAlign: 'center', color: '#b91c1c' }}>
            {error}
          </p>
        ) : data ? (
          <>
            <h2 className="slot-offer-confirm__headline">
              {statusHeadline(data, inDeclineForm, pets)}
            </h2>

            {showAppointmentSummary ? (
              <>
                <AppointmentSummary
                  doctorName={data.doctorName}
                  windowParts={windowParts}
                  pets={pets}
                />
                {showPetCareNeeds ? (
                  <PetCareNeedsSection pets={petCareNeeds} practiceTz={practiceTz} />
                ) : null}
              </>
            ) : null}

            {resultMessage ? (
              <p className="survey-success-blurb" style={{ textAlign: 'center', lineHeight: 1.6 }}>
                {resultMessage}
              </p>
            ) : data.status === 'accepted' ? (
              <p className="survey-success-blurb" style={{ textAlign: 'center', lineHeight: 1.6, marginTop: 16 }}>
                See you then!
              </p>
            ) : showUnavailableMessage ? (
              <p className="survey-success-blurb" style={{ textAlign: 'center', lineHeight: 1.6 }}>
                {data.message!.trim()}
              </p>
            ) : data.message?.trim() && data.status !== 'pending' && !inDeclineForm ? (
              <p className="survey-success-blurb" style={{ textAlign: 'center', lineHeight: 1.6 }}>
                {data.message.trim()}
              </p>
            ) : null}

            {inDeclineForm ? (
              <>
                {windowLabel ? (
                  <p className="slot-offer-confirm__hint">
                    Offered: {windowLabel}
                    {pets.length > 0 ? ` · ${pets.join(', ')}` : ''}
                  </p>
                ) : null}
                {showPetCareNeeds && !showAppointmentSummary ? (
                  <PetCareNeedsSection pets={petCareNeeds} practiceTz={practiceTz} />
                ) : null}
                <div className="slot-offer-confirm__form">
                  {!declineFormHasContextMessage && data.declineMessage?.trim() ? (
                    <p className="slot-offer-confirm__form-prompt">{data.declineMessage.trim()}</p>
                  ) : null}
                  <label className="slot-offer-confirm__sr-only" htmlFor="slot-offer-decline-note">
                    {data.declineMessage?.trim() || 'What times work for you?'}
                  </label>
                  <textarea
                    id="slot-offer-decline-note"
                    className="survey-textarea"
                    rows={4}
                    value={declineNote}
                    onChange={(e) => setDeclineNote(e.target.value)}
                    placeholder="Example: Mornings work best — any day except Wednesday."
                  />
                </div>
              </>
            ) : null}

            {error ? (
              <p role="alert" style={{ color: '#b91c1c', textAlign: 'center', marginTop: 12 }}>
                {error}
              </p>
            ) : null}

            {showPrimaryActions ? (
              <div className="slot-offer-confirm__actions">
                {data.canConfirm ? (
                  <button
                    type="button"
                    className="slot-offer-confirm__primary-btn"
                    disabled={busy != null}
                    onClick={() => void onConfirm()}
                  >
                    {busy === 'confirm' ? 'Confirming…' : 'Confirm this time'}
                  </button>
                ) : null}
                {data.canDecline ? (
                  <button
                    type="button"
                    className="slot-offer-confirm__text-btn"
                    disabled={busy != null}
                    onClick={() => {
                      setError(null);
                      setShowDeclineForm(true);
                    }}
                  >
                    Need a different time?
                  </button>
                ) : null}
              </div>
            ) : null}

            {inDeclineForm ? (
              <div className="slot-offer-confirm__actions">
                <button
                  type="button"
                  className="slot-offer-confirm__primary-btn"
                  disabled={busy != null}
                  onClick={() => void onSubmitDecline()}
                >
                  {busy === 'decline' ? 'Sending…' : 'Send request'}
                </button>
                {data.canDecline && !data.canSubmitDeclineNote && data.status !== 'unavailable' ? (
                  <button
                    type="button"
                    className="slot-offer-confirm__text-btn"
                    disabled={busy != null}
                    onClick={() => {
                      setShowDeclineForm(false);
                      setDeclineNote('');
                      setError(null);
                    }}
                  >
                    Back to confirm
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
