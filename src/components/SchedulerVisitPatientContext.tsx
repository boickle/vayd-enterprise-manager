import { Cat, Dog, Heart } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
  appointmentZoneFullName,
  appointmentZoneShortLabel,
} from '../api/appointments';
import type { Provider } from '../api/employee';
import type { Appointment, Patient } from '../api/roomLoader';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import {
  appointmentChartPrimaryProviderDiffersFromAssignee,
  appointmentPatientChartPrimaryProviderLabel,
  appointmentPatientMember,
  clientAddressMultiline,
  clientAddressOneLine,
  clientEmailsLine,
  clientPhonesLine,
  fullClientHouseholdName,
  googleMapsUrlForAppointment,
  patientAgeYearsMonthsDisplay,
  patientBreedDisplayOnly,
  patientLastWeightDisplay,
  patientSexAbbrevDisplay,
  patientSexHighlightTone,
  patientSpeciesIconKind,
  pickStr,
  providerLabel,
} from '../utils/schedulerVisitDisplay';

const SCHEDULER_ZONE_BADGE_COLORS = [
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#86198f',
  '#0369a1',
  '#047857',
  '#7c3aed',
  '#be185d',
];

function schedulerZoneBadgeTextColor(zoneKey: string): string {
  let h = 2166136261;
  const s = zoneKey.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return SCHEDULER_ZONE_BADGE_COLORS[Math.abs(h) % SCHEDULER_ZONE_BADGE_COLORS.length];
}

function SchedulerZoneBadgeInline({
  zoneShort,
  title,
  compact,
}: {
  zoneShort: string;
  title?: string | null;
  compact?: boolean;
}) {
  const color = schedulerZoneBadgeTextColor(zoneShort);
  return (
    <span
      className={
        compact
          ? 'scheduler-client-zone-badge scheduler-client-zone-badge--compact'
          : 'scheduler-client-zone-badge'
      }
      style={{ color, borderColor: color }}
      title={title ?? undefined}
    >
      {zoneShort}
    </span>
  );
}

function VisitHighlightsRow({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === '') return null;
  return (
    <div className="scheduler-tooltip-vh-row">
      <div className="scheduler-tooltip-vh-k">{label}</div>
      <div className="scheduler-tooltip-vh-v">{children}</div>
    </div>
  );
}

type Props = {
  appt: Appointment;
  providers?: readonly Provider[] | null;
  practiceTz: string;
  /** When set, show these patients instead of the appointment's saved patient(s). */
  patientsOverride?: Patient[];
  /** e.g. View Patient Details link on the patient name line (edit visit). */
  patientDetailsAction?: ReactNode;
  /** When false, omit membership row (e.g. previewing another pet on the same visit). */
  showMembership?: boolean;
};

export function SchedulerVisitPatientContext({
  appt,
  providers,
  practiceTz,
  patientsOverride,
  patientDetailsAction,
  showMembership = true,
}: Props) {
  const patients = patientsOverride ?? patientsForAppointment(appt);
  const member = appointmentPatientMember(appt);
  const chartPrimaryProviderLabel = appointmentPatientChartPrimaryProviderLabel(appt, providers);
  const providerMismatch =
    chartPrimaryProviderLabel != null &&
    appointmentChartPrimaryProviderDiffersFromAssignee(appt, chartPrimaryProviderLabel);

  if (patients.length === 0 && !member.isMember && !chartPrimaryProviderLabel) {
    return null;
  }

  return (
    <div className="scheduler-tooltip-vh-block scheduler-visit-context-block">
      <div className="scheduler-tooltip-vh-block-title">Patient</div>
      {patients.map((p, idx) => {
        const pid = p.pimsId != null && String(p.pimsId).trim() !== '' ? p.pimsId : p.id;
        const pAlerts = p.alerts?.trim();
        const sexAbbr = patientSexAbbrevDisplay(p);
        const ageStr = patientAgeYearsMonthsDisplay(p, practiceTz);
        const breedOnly = patientBreedDisplayOnly(p);
        const breedShort =
          breedOnly && breedOnly.length > 42 ? `${breedOnly.slice(0, 40).trim()}…` : breedOnly;
        const sexTone = patientSexHighlightTone(p);
        const speciesIcon = patientSpeciesIconKind(p);
        return (
          <div key={p.id} className={idx > 0 ? 'scheduler-tooltip-vh-patient-entry' : undefined}>
            <div
              className={`scheduler-tooltip-vh-patient-highlight scheduler-tooltip-vh-patient-highlight--${sexTone}`}
            >
              {patients.length > 1 ? (
                <div className="scheduler-tooltip-vh-patient-subtitle">Patient {idx + 1}</div>
              ) : null}
              <div className="scheduler-tooltip-vh-patient-line scheduler-tooltip-vh-patient-line--with-icon">
                {speciesIcon === 'dog' ? (
                  <Dog
                    size={18}
                    strokeWidth={2}
                    className="scheduler-tooltip-vh-patient-species-icon scheduler-tooltip-vh-dog-lucide"
                    aria-hidden
                  />
                ) : speciesIcon === 'cat' ? (
                  <Cat
                    size={18}
                    strokeWidth={2}
                    className="scheduler-tooltip-vh-patient-species-icon"
                    aria-hidden
                  />
                ) : null}
                <div className="scheduler-tooltip-vh-patient-line-text">
                  <strong>{p.name}</strong>
                  {ageStr ? (
                    <span className="scheduler-tooltip-vh-patient-meta"> · {ageStr}</span>
                  ) : null}
                  {sexAbbr ? (
                    <span className="scheduler-tooltip-vh-patient-meta"> · {sexAbbr}</span>
                  ) : null}
                  {breedShort ? (
                    <span className="scheduler-tooltip-vh-patient-breed"> · {breedShort}</span>
                  ) : null}
                  <span className="scheduler-tooltip-vh-id"> (#{pid})</span>
                </div>
              </div>
              {idx === 0 && patientDetailsAction ? (
                <div className="scheduler-tooltip-vh-patient-details-row">{patientDetailsAction}</div>
              ) : null}
              <VisitHighlightsRow label="Last weight">{patientLastWeightDisplay(p)}</VisitHighlightsRow>
              {pAlerts ? (
                <div className="scheduler-tooltip-vh-alerts scheduler-tooltip-vh-alerts--patient">
                  <span className="scheduler-tooltip-vh-alerts-title">Patient alerts</span>
                  {pAlerts}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      {chartPrimaryProviderLabel ? (
        <div className={patients.length > 0 ? 'scheduler-tooltip-vh-patient-block-pcp' : undefined}>
          <VisitHighlightsRow label="Primary Provider">{chartPrimaryProviderLabel}</VisitHighlightsRow>
        </div>
      ) : null}
      {providerMismatch ? (
        <div className="scheduler-modal-provider-mismatch scheduler-visit-provider-mismatch" role="status">
          <span className="scheduler-modal-provider-mismatch-title">Different from appointment provider</span>
          This visit is assigned to <strong>{providerLabel(appt.primaryProvider)}</strong>; the Primary
          Provider on chart is <strong>{chartPrimaryProviderLabel}</strong>.
        </div>
      ) : null}
      {showMembership && member.isMember ? (
        <div className="scheduler-tooltip-vh-patient-membership">
          <div className="scheduler-tooltip-vh-patient-membership-label">Membership</div>
          <div className="scheduler-tooltip-vh-membership">
            <Heart size={11} fill="#dc2626" color="#dc2626" strokeWidth={1.75} aria-hidden />
            <span>{member.membershipName?.trim() || 'Member'}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SchedulerVisitClientZoneBadge({ appt, compact }: { appt: Appointment; compact?: boolean }) {
  const zone = appointmentZoneShortLabel(appt);
  if (!zone) return null;
  return (
    <SchedulerZoneBadgeInline
      zoneShort={zone}
      title={appointmentZoneFullName(appt)}
      compact={compact}
    />
  );
}

type ClientContextProps = {
  appt: Appointment;
};

export function clientAlertsTextForAppointment(appt: Appointment): string | null {
  const fromClient = pickStr(appt.client?.alerts)?.trim();
  if (fromClient) return fromClient;
  const row = appt as Appointment & Record<string, unknown>;
  return pickStr(row.clientAlert)?.trim() ?? null;
}

/** Client alerts directly under the modal title client name (view + edit). */
export function SchedulerVisitClientHeaderAlerts({ appt }: ClientContextProps) {
  const clientAlerts = clientAlertsTextForAppointment(appt);
  if (!clientAlerts) return null;
  return (
    <div className="scheduler-modal-client-header-alerts" role="alert">
      <span className="scheduler-modal-client-header-alerts-title">Client alerts</span>
      {clientAlerts}
    </div>
  );
}

export function SchedulerVisitClientContext({ appt }: ClientContextProps) {
  const c = appt.client;
  if (!c) return null;

  const addrLine = clientAddressOneLine(c);
  const addrMultiline = clientAddressMultiline(c);
  const phoneLine = clientPhonesLine(c);
  const emailLine = clientEmailsLine(c);
  const mapsUrl = googleMapsUrlForAppointment(appt);
  const hasAlternateLocation = appointmentHasAlternateLocation(appt);
  const alternateAddress = appointmentAlternateAddressText(appt);

  return (
    <section className="scheduler-modal-section scheduler-visit-client-section">
      <div className="scheduler-tooltip-vh-block scheduler-visit-context-block">
        <div className="scheduler-tooltip-vh-block-title">Client</div>
        <div className="scheduler-tooltip-vh-client-line">
          <strong>{fullClientHouseholdName(c)}</strong>
          <SchedulerVisitClientZoneBadge appt={appt} />
          <span className="scheduler-tooltip-vh-id"> (#{c.id})</span>
        </div>
        {phoneLine ? (
          <VisitHighlightsRow label="Phone">{phoneLine}</VisitHighlightsRow>
        ) : null}
        {emailLine ? (
          <VisitHighlightsRow label="Email">{emailLine}</VisitHighlightsRow>
        ) : null}
        {addrMultiline ? (
          <VisitHighlightsRow label="Address">
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scheduler-visit-context-link"
              >
                <span className="scheduler-modal-multiline">{addrMultiline}</span>
              </a>
            ) : (
              <span className="scheduler-modal-multiline">{addrMultiline}</span>
            )}
          </VisitHighlightsRow>
        ) : addrLine ? (
          <VisitHighlightsRow label="Address">
            {mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="scheduler-visit-context-link"
              >
                {addrLine}
              </a>
            ) : (
              addrLine
            )}
          </VisitHighlightsRow>
        ) : null}
        {pickStr(c.county) ? <VisitHighlightsRow label="County">{pickStr(c.county)}</VisitHighlightsRow> : null}
        {pickStr(c.username) ? (
          <VisitHighlightsRow label="Username">{pickStr(c.username)}</VisitHighlightsRow>
        ) : null}
      </div>
      {hasAlternateLocation ? (
        <div className="scheduler-tooltip-vh-alternate-alert scheduler-visit-alternate-alert" role="alert">
          <span className="scheduler-tooltip-vh-alternate-alert-title">Alternate location</span>
          {alternateAddress ? (
            <span className="scheduler-tooltip-vh-alternate-alert-address">{alternateAddress}</span>
          ) : (
            <span className="scheduler-tooltip-vh-alternate-alert-address scheduler-tooltip-vh-alternate-alert-address--pending">
              Loading alternate address…
            </span>
          )}
          <span className="scheduler-tooltip-vh-alternate-alert-hint">
            Routing and drive time use this address instead of the client&apos;s home address.
          </span>
        </div>
      ) : null}
    </section>
  );
}
