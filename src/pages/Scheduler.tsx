// src/pages/Scheduler.tsx — Practice-wide appointment calendar (GET /appointments/range)
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';
import { DateTime } from 'luxon';
import { AlertTriangle, Cat, Dog, Heart, Printer, X } from 'lucide-react';
import {
  appointmentZoneFullName,
  appointmentZoneShortLabel,
  depotOfficeTownLabel,
  fetchAppointmentById,
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
  appointmentWithoutAlternateRoutingAddress,
  fetchAppointmentsRange,
  isAppointmentCancelledOnPracticeCalendar,
  isAppointmentNoLocation,
  cancelAppointment,
  patchAppointment,
  putAppointmentAlternateAddress,
  isFlexBlockItem,
  isPracticeCalendarBlockAppointment,
  truthyApiFlag,
  previewRoutingAppointmentLabel,
  type DoctorDayPatientPrimaryProvider,
} from '../api/appointments';
import { fetchSchedulingOutreachSmsFrom } from '../api/clientSms';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { http } from '../api/http';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import {
  fetchEmployeeGoals,
  formatPointsAgainstGoal,
  getGoalForDate,
  goalDayOfWeekFromLuxonWeekday,
  schedulerPointsGoalClassName,
  type EmployeeGoalsResponseDto,
} from '../api/employeeGoals';
import { fetchForwardBookingCalendarIndex } from '../api/forwardBooking';
import {
  fetchAllAppointmentTypes,
  fetchEmployee,
  fetchManualBookableAppointmentTypes,
  type AppointmentType,
  type EmployeeWeeklySchedule,
} from '../api/appointmentSettings';
import {
  filterAppointmentTypesByIds,
  rolesIncludeAdminBypass,
} from '../utils/manualBookingPermissions';
import { buildAppointmentTypeCatalog, appointmentFormFlags } from '../utils/appointmentTypeSettings';
import { appointmentIsCalendarOnlyStaffItem } from '../utils/calendarOnlyStaffAppointment';
import { searchRoomLoaders, type Appointment, type Client, type Patient } from '../api/roomLoader';
import {
  computeEditPreviewPopoverPosition,
  computeVisitHighlightsPopoverPosition,
  fallbackEditPreviewPopoverPosition,
  rectFromElement,
  type HoverPopoverPositionResult,
} from '../utils/hoverPopoverPosition';
import { useAuth } from '../auth/useAuth';
import {
  fetchSchedulerDoctorDayBundle,
  dropAppointmentFromDriveDayData,
  fetchSchedulerDriveEtasForDayBundle,
  schedulerDriveScheduleOnlyFromBundle,
  type DriveIsoPair,
  type SchedulerDoctorDayAppointmentZones,
  type SchedulerDoctorDayEffectiveWindow,
  type SchedulerDoctorDayMembership,
} from '../utils/schedulerDriveEta';
import {
  buildRoomLoaderPreApptStatusByAppointmentId,
  mergeAppointmentPreserveRoomLoaderConfirmStatus,
  preferRoomLoaderPreApptStatus,
  ROOM_LOADER_SENT_STATUS_CHANGED_EVENT,
  roomLoaderPreApptUiStatus,
  type RoomLoaderPreApptUiStatus,
} from '../utils/roomLoaderPreApptDisplay';
import { summarizeReconciledDayWindowWarnings } from '../utils/routingCardWindowWarning';
import { computeDepotReturnOverrunSeconds } from '../utils/depotReturnOverrun';
import {
  driveSlotForAppointmentId,
  findFormerFirstAppointmentForPreFirstBook,
  resolvePreFirstNeighborBumpTarget,
} from '../utils/preFirstNeighborBump';
import {
  buildGoogleMapsLinksForDay,
  householdsInRoutingDisplayOrder,
  openUrlInNewTab,
  type Stop,
} from '../utils/maps';
import { DEFAULT_APPOINTMENT_BUFFER_MINUTES } from '../api/routing';
import { colorForDrive } from '../utils/statsFormat';
import { formatIsoInPracticeZone, formatIsoTimeShortInPracticeZone } from '../utils/practiceTimezone';
import { formatPointsPerDriveHour, pointsPerDriveHour } from '../utils/pointsPerDriveHour';
import {
  buildMyWeekDriveSegmentsFromLayout,
  computeMyWeekDayColumnLayout,
  dayPoints,
  dayTotalDriveSeconds,
  timeStrToMinutesFromMidnight,
  doctorDayIsOff,
  type DayData,
  type WeekGridMetrics,
} from './MyWeek';
import {
  schedulerHouseholdUsesDoctorDayClockForLayout,
} from '../utils/schedulerWindowWarning';
import { arrivalWindowIsZeroWidth, computeDriveTimeWindowWarning } from '../utils/windowWarning';
import {
  evetAddCommunicationLink,
  evetCheckoutLink,
  evetClientLink,
  evetMedicalNoteLink,
  evetPatientLink,
  evetQuickInvoicingLink,
} from '../utils/evet';
import { buildPhoneDialHref, buildPhoneSmsHref, resolveQuoFromLine } from '../utils/quoContact';
import {
  loadRoutingPreviewClientContact,
  previewClientContactFromAppointment,
} from '../utils/schedulerPreviewClientContact';
import { ClientContactLogReadout } from '../components/ClientContactLogEditor';
import type { PreviewPopoverClientContact } from '../components/PreviewPopoverClientContact';
import ScheduleOverrideModal from '../components/ScheduleOverrideModal';
import { SchedulerReconcileModal } from '../components/SchedulerReconcileModal';
import { SchedulerOptimizeModal } from '../components/SchedulerOptimizeModal';
import {
  fetchEmployeeWorkdayActualsRange,
  type EmployeeWorkdayActual,
} from '../api/employeeWorkdayActuals';
import { EditVisitPreviewPopover } from '../components/EditVisitPreviewPopover';
import { AppointmentRequestStaffConfirmPopover } from '../components/AppointmentRequestStaffConfirmPopover';
import OnHoldVisitConvertedPopover from '../components/OnHoldVisitConvertedPopover';
import OnHoldVisitPreviewPopover from '../components/OnHoldVisitPreviewPopover';
import OnHoldVisitRemovePopover from '../components/OnHoldVisitRemovePopover';
import SlotOfferReviewPopover from '../components/SlotOfferReviewPopover';
import { RoutingPreviewSlotPopover } from '../components/RoutingPreviewSlotPopover';
import { ScheduleCalendarBlockedNotice } from '../components/ScheduleCalendarBlockedNotice';
import {
  SchedulerVisitClientContext,
  SchedulerVisitClientHeaderAlerts,
  SchedulerVisitClientZoneBadge,
  SchedulerVisitPatientContext,
} from '../components/SchedulerVisitPatientContext';
import type { HoverAnchorRect } from '../utils/hoverPopoverPosition';
import {
  normalizeScheduleOverrideLocalTime,
  scheduleOverrideIsOff,
  type ScheduleOverride,
} from '../api/appointmentSettings';
import {
  applyScheduleOverrideToDayBundle,
  fetchScheduleOverridesByDate,
} from '../utils/scheduleOverrideMerge';
import { effectiveWindowForScheduledStart } from '../utils/appointmentArrivalWindow';
import { resolveArrivalWindowIsos } from '../utils/appointmentRoutedArrivalWindow';
import {
  buildEditVisitTimePreview,
  computeEditVisitTypePreviewWindowWarning,
  effectiveWindowForTypePreview,
  type EditVisitTimePreview,
} from '../utils/editVisitTimePreview';
import {
  clearEditVisitTimePreview,
  readEditVisitTimePreview,
  writeEditVisitTimePreview,
} from '../utils/editVisitTimePreviewStorage';
import {
  resolveAppointmentChangeActorFromAuth,
  detectEditVisitChanges,
  formatEmployeeFirstNameLastInitial,
} from '../utils/appointmentChangeAuditNote';
import {
  commitEditVisit,
  commitLinkClientFromEditVisitSelection,
  editVisitTimesMatchAtPracticeMinute,
  resolveEditVisitAssignPatient,
  validateEditVisitAppointmentTypeClientConflict,
  validateEditVisitLinkSelection,
  validateEditVisitPatientSelection,
  type EditVisitFormSnapshot,
} from '../utils/editVisitCommit';
import {
  fetchEditVisitTypeScoreCompare,
  type EditVisitPreviewScoreCompare,
} from '../utils/editVisitTypeScoreCompare';
import { fetchEditVisitTimeScoreCompare } from '../utils/editVisitTimeScoreCompare';
import { extractHttpErrorMessage } from '../utils/httpErrorMessage';
import { appointmentPracticeDateKey } from '../utils/editVisitTimeFields';
import {
  buildTypeFillMap,
  colorsForAppointment,
} from '../utils/schedulerAppointmentColors';
import type { SchedulerHoverDriveHint } from '../utils/schedulerHoverTypes';
import { submitEditVisitPreviewAcceptedFeedback } from '../utils/routingBookFeedback';
import {
  alignSiblingVisitScheduledTimes,
  appointmentPatientLabel,
  findHouseholdVisitsNeedingTimeAlign,
} from '../utils/householdVisitTimeAlign';
import {
  HouseholdVisitTimeAlignModal,
  type HouseholdTimeAlignChoice,
} from '../components/HouseholdVisitTimeAlignModal';
import {
  SchedulerBookModal,
  isSchedulerRoutingBookPrefill,
  type SchedulerBookPrefill,
  type SchedulerBookSlot,
} from './SchedulerBookModal';
import {
  SchedulerAppointmentContextMenu,
  type SchedulerContextMenuAction,
} from './SchedulerContextMenu';
import {
  SchedulerEditVisitModal,
  type SchedulerEditVisitModalHandle,
} from './SchedulerEditVisitModal';
import type { EditVisitPatientSelection } from '../components/EditVisitAddPatientPanel';
import type { EditVisitLinkSelection } from '../components/EditVisitLinkClientPanel';
import {
  appointmentAlternateMatchesClientHome,
  editVisitLinkClearsAlternateAddress,
  appointmentResolvedClientId,
  visitAddressForLinkMatching,
} from '../utils/visitAddressMatch';
import { OnMyWaySmsModal } from '../components/OnMyWaySmsModal';
import { ClientContactComposeModal } from '../components/ClientContactComposeModal';
import { WorkZonesMapModal } from '../components/WorkZonesMapModal';
import { etaMinutesAwayFromNow } from '../utils/onMyWaySmsMessage';
import { SchedulerActualVisitTimeModal } from './SchedulerActualVisitTimeModal';
import { SchedulerRemoveVisitModal } from './SchedulerRemoveVisitModal';
import {
  SchedulerRoomLoaderPdfModal,
  schedulerRoomLoaderMenuLabel,
  schedulerRoomLoaderMenuMode,
} from './SchedulerRoomLoaderModal';
import { resolveRoomLoaderIdForAppointment } from '../utils/schedulerRoomLoaderResolve';

const RoomLoaderPage = lazy(() => import('./RoomLoader'));
import {
  clearRoutingCalendarPreview,
  isManualBookCalendarPreview,
  isScheduleLoaderCalendarPreview,
  isScheduleOptimizeCalendarPreview,
  isWaitlistCalendarPreview,
  readRoutingCalendarPreview,
  scheduleLoaderReturnHref,
  scheduleOptimizeReturnHref,
  waitlistReturnHref,
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
  ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT,
  SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
  notifyRoutingPreviewEtaWindowWarnings,
  routingCalendarPreviewOptionKey,
  writeRoutingCalendarPreview,
  type ManualBookPreviewDraft,
  type RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import {
  buildManualBookCalendarPreviewPayload,
  manualBookPrefillFromDraft,
} from '../utils/manualBookCalendarPreview';
import { commitManualBookPreviewDraft } from '../utils/commitManualBookPreview';
import HouseholdScheduledVisitsWarningModal from '../components/HouseholdScheduledVisitsWarningModal';
import EuthanasiaFutureAppointmentsModal from '../components/EuthanasiaFutureAppointmentsModal';
import ExploreAlternativesHoldPrompt from '../components/ExploreAlternativesHoldPrompt';
import {
  buildBookingAppointmentTypeCatalog,
  findHouseholdScheduledVisitConflicts,
  parseRoutingFocusHouseholdVisitEvent,
  ROUTING_FOCUS_HOUSEHOLD_VISIT_EVENT,
  ROUTING_HOUSEHOLD_VISIT_FOCUS_UNPIN_EVENT,
  shouldWarnHouseholdVisitsOnBook,
  type HouseholdScheduledVisitConflict,
} from '../utils/bookingHouseholdVisitWarning';
import {
  cancelEuthanasiaFutureAppointments,
  findFutureAppointmentsForPatients,
  isEuthanasiaAppointmentType,
  type EuthanasiaFutureAppointmentRow,
} from '../utils/euthanasiaFutureAppointments';
import {
  EDIT_VISIT_CALENDAR_BLOCKED_MESSAGE,
  EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE,
  getScheduleCalendarPreviewBlockedMessage,
  hasActiveRoutingCalendarPreview,
  RESCHEDULE_CALENDAR_BLOCKED_MESSAGE,
  FORWARD_BOOKING_CALENDAR_BLOCKED_MESSAGE,
  ROUTING_PREVIEW_CALENDAR_BLOCKED_EVENT,
} from '../utils/routingCalendarPreviewGuard';
import {
  activeClientPetsFromPayload,
  addPetMenuTitle,
  appointmentSupportsAddPet,
  excludePatientIdsAtSlot,
  filterSlotExcludeForRoutingBook,
  excludePatientIdsForAddPet,
  hasAddPetChoices,
  appointmentHasNoPatient,
  appointmentsInClientVisitClump,
  householdAppointmentIdsInVisitClump,
  petEditChoiceLabelForAppointment,
  resolveHouseholdVisitAppointments,
  patientsForAppointment,
} from '../utils/schedulerAddPet';
import {
  appointmentLinkedClientLabel,
  patientSexAbbrevDisplay,
  patientSexHighlightTone,
} from '../utils/schedulerVisitDisplay';
import { enrichAppointmentPatientProfiles } from '../utils/schedulerPatientEnrich';
import {
  buildRescheduleVisitPatches,
  buildRoutingRescheduleIntentFromAppointment,
  clearRoutingRescheduleIntent,
  dismissRoutingRescheduleWorkspace,
  readRoutingRescheduleIntent,
  returnFromRescheduleWorkspace,
  rescheduleCalendarFocusFromIntent,
  rescheduleScopeTargets,
  resolveRoutingBookAlternateAddress,
  ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT,
  ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT,
  writeRoutingRescheduleIntent,
  type RescheduleSameDayVisit,
} from '../utils/routingRescheduleIntent';
import {
  fetchAndCacheRescheduleSourcePlacementSnapshot,
} from '../utils/routingRescheduleScoreCompare';
import {
  addScheduleOptimizeToQueue,
  findScheduleOptimizeQueueItem,
  formatScheduleOptimizeQueueActionNote,
  mergeOptimizeNotesIntoStaffInstructions,
  creditScheduleOptimizeSavingsWhenOriginalRemoved,
  resolveScheduleOptimizeQueueItems,
  scheduleOptimizeNotesForAppointmentIds,
  markScheduleOptimizeQueueTexted,
} from '../utils/scheduleOptimizeQueue';
import { scheduleOptimizeSavingsStaff } from '../utils/scheduleOptimizeSavings';
import { buildScheduleOptimizeSmsMessage } from '../utils/scheduleOptimizeSmsMessage';
import type { ScheduleOptimizeSmsKind } from '../utils/scheduleOptimizeSmsMessage';
import {
  beginScheduleOptimizeApplyInCalendar,
  openScheduleOptimizeCurrentAppointment,
} from '../utils/scheduleOptimizeCalendarPreview';
import {
  abandonListOriginatedForwardBookingWorkspace,
  clearRoutingForwardBookingIntent,
  dismissRoutingForwardBookingWorkspace,
  forwardBookingScopeTargets,
  forwardBookingWorkspaceIsActive,
  readRoutingForwardBookingIntent,
  ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT,
} from '../utils/routingForwardBookingIntent';
import {
  forwardBookingEntriesForChipSelection,
  rescheduleTargetsForChipSelection,
} from '../utils/routingPatientSelection';
import {
  appointmentShowsVisitTimesClock,
  buildForwardBookingCalendarIndexSets,
} from '../utils/appointmentVisitTimesBadge';
import {
  buildForwardBookingBookSuccessToast,
  forwardBookingBookedPatientNames,
  isHoldAppointmentTypeForBook,
} from '../utils/forwardBookingBookToast';
import { FORWARD_BOOKING_LIST_PATH, writeForwardBookingReturnSession, CARE_OUTREACH_LIST_PATH, schedulingReturnPathAfterBook } from '../utils/forwardBookingReturnSession';
import { providerLastNameFromDisplayName } from '../utils/scheduleLoaderSmsMessage';
import { slotOfferFlowActive } from '../utils/slotOfferFromRouting';
import { notifySchedulingToolsNavCountsRefresh } from '../hooks/useSchedulingToolsNavCounts';
import { writeWaitlistReturnSession } from '../utils/waitlistReturnSession';
import { writeForwardBookingLocalLink } from '../utils/forwardBookingLocalLinks';
import {
  buildForwardBookingWorkspaceContext,
  forwardBookingWorkspaceContextBarLine,
} from '../utils/forwardBookingRoutingContext';
import { returnToAppointmentRequestsList } from '../utils/appointmentRequestListReturnTab';
import {
  writeAppointmentRequestReturnSession,
} from '../utils/appointmentRequestReturnSession';
import {
  clearAppointmentRequestStaffConfirmSession,
  readAppointmentRequestStaffConfirmSession,
  writeAppointmentRequestStaffConfirmReturnSession,
  type AppointmentRequestStaffConfirmSessionV1,
} from '../utils/appointmentRequestStaffConfirmSession';
import { appointmentRequestNeedsStaffConfirmation } from '../utils/appointmentRequestStaffConfirm';
import { submissionIdFromOnlineHoldPimsId } from '../utils/holdsOpenInScheduler';
import {
  clearNotBookedRemoveSession,
  readNotBookedRemoveSession,
  writeNotBookedRemoveReturnSession,
  type NotBookedRemoveSessionV1,
} from '../utils/appointmentRequestNotBookedRemoveSession';
import {
  clearOnHoldVisitEditSession,
  readOnHoldVisitEditSession,
  writeOnHoldVisitEditReturnSession,
  type OnHoldVisitEditSessionV1,
} from '../utils/onHoldVisitEditSession';
import {
  clearSlotOfferReviewSession,
  readSlotOfferReviewSession,
  TEXTED_OFFERS_TO_REVIEW_PATH,
  type SlotOfferReviewSessionV1,
} from '../utils/slotOfferReviewSession';
import { writeSlotOfferReviewReturnSession } from '../utils/slotOfferReviewReturnSession';
import { isHoldsBoardReturnPath } from '../holds-nav';
import { writeHoldsBoardReturnSession } from '../utils/holdsBoardReturnSession';
import { NotBookedRemoveGateOverlay } from '../components/NotBookedRemoveGateOverlay';
import { ON_HOLD_LIST_PATH } from '../utils/forwardBookingReturnSession';
import { writeCareOutreachFocusClient } from '../utils/careOutreachFocusSession';
import { opsPointsForAppointment } from '../utils/forwardBookingListVisibility';
import { confirmSlotOffer } from '../api/slotOffers';
import {
  patchAppointmentRequestSubmission,
  fetchAppointmentRequestSubmission,
} from '../api/appointmentRequestSubmissions';
import {
  appointmentRequestWorkspaceIsActive,
  clearRoutingAppointmentRequestIntent,
  dismissRoutingAppointmentRequestWorkspace,
  readRoutingAppointmentRequestIntent,
  returnFromAppointmentRequestWorkspace,
  ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
} from '../utils/routingAppointmentRequestIntent';
import {
  applyAppointmentRequestTypesToStaffConfirmVisits,
  appointmentRequestPetNameForVisit,
  staffConfirmHouseholdEditChoiceLabels,
  staffConfirmHoldVisitBlockedMessage,
  staffConfirmVisitTypeUpgradeBlockedMessage,
} from '../utils/appointmentRequestStaffConfirmApplyTypes';
import {
  resolveStaffConfirmRecommendedLength,
  type StaffConfirmRecommendedLength,
} from '../utils/appointmentRequestStaffConfirmRecommendedLength';
import {
  resolveHouseholdHoldExitKind,
  type HouseholdHoldExitKind,
} from '../utils/appointmentRequestHouseholdHold';
import { clearApptRequestGmailOnHoldLabel } from '../utils/gmailAppointmentRequestLabels';
import { buildAppointmentRequestBookVisitPatches, buildAppointmentRequestBookVisitPatchesFromRequestData } from '../utils/routingAppointmentRequestVisitPets';
import {
  subscribePracticeCalendar,
  type AppointmentCalendarPayload,
} from '../utils/calendarRealtime';
import {
  clearRoutingPersistenceAfterSchedulerBook,
  readRoutingUiBootstrap,
  ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT,
} from '../utils/routingUiSnapshot';
import {
  appointmentTypeForRoutingStatsKey,
  resolveRoutingChosenAppointmentTypeId,
} from '../utils/routingCalculateTimeType';
import {
  readSchedulerCalendarHandoff,
  writeSchedulerCalendarHandoff,
} from '../utils/schedulerCalendarHandoff';
import {
  buildSchedulerFocusAppointmentUrl,
  clearSchedulerFocusSession,
  clearSchedulerFocusReturnSession,
  readSchedulerFocusRequest,
  readSchedulerFocusReturnSession,
  returnFromSchedulerFocusToGmail,
  returnFromSchedulerFocusToOptimize,
  SCHEDULER_FOCUS_APPOINTMENT_PARAM,
  SCHEDULER_FOCUS_DATE_PARAM,
  SCHEDULER_FOCUS_PROVIDER_PARAM,
  SCHEDULER_FOCUS_RETURN_UPDATED_EVENT,
  schedulerAppointmentIdsEqual,
  schedulerCalendarFocusFromAppointment,
  type SchedulerFocusRequest,
} from '../utils/schedulerFocusAppointment';
import {
  buildMyDayVisualPdfExportPayloadFromDayData,
  enrichWeekHouseholdsFromRangeAppointments,
} from '../utils/myDayVisualPdfFromDayData';
import { fetchAppointmentsRangeForLocalDay } from '../api/appointments';
import { exportMyDayVisualPdf } from '../utils/myDayVisualPdfExport';
import './Scheduler.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;
const PRACTICE_TZ =
  (import.meta.env.VITE_PRACTICE_TIMEZONE as string | undefined)?.trim() || 'America/New_York';

/** Admin double-click on practice calendar — distinct from routing / reschedule book flows. */
const MANUAL_CALENDAR_BOOK_MODAL_TITLE = 'Book appointment - MANUAL OVERIDE';

/** True when the timed grid itself scrolls (embedded routing column). */
function timedGridScrollRoot(el: HTMLElement): HTMLElement | null {
  const root = el.closest('.scheduler-calendar-scroll');
  if (!(root instanceof HTMLElement)) return null;
  const oy = getComputedStyle(root).overflowY;
  return oy === 'auto' || oy === 'scroll' ? root : null;
}

function scheduleOutletScrollRoot(el: HTMLElement): HTMLElement | null {
  const outlet = el.closest('.schedule-app__outlet--flush-scroll-y');
  return outlet instanceof HTMLElement ? outlet : null;
}

/** Space below the outlet top so a focused visit clears sticky week/day headers. */
function schedulerFocusTopInset(outlet: HTMLElement): number {
  const stickyHead = outlet.querySelector('.scheduler-sticky-practice-week-head');
  if (stickyHead instanceof HTMLElement) {
    const outletRect = outlet.getBoundingClientRect();
    const headRect = stickyHead.getBoundingClientRect();
    const belowSticky = headRect.bottom - outletRect.top + 12;
    if (belowSticky > 48) return belowSticky;
  }
  return 120;
}

function isFocusVisitVisibleInScheduler(
  el: HTMLElement,
  outlet: HTMLElement | null,
  topInset: number,
  marginBottom = 24,
): boolean {
  const elRect = el.getBoundingClientRect();
  if (outlet) {
    const outletRect = outlet.getBoundingClientRect();
    const visibleTop = outletRect.top + topInset;
    const visibleBottom = outletRect.bottom - marginBottom;
    return elRect.top >= visibleTop && elRect.bottom <= visibleBottom;
  }
  const scrollRoot = timedGridScrollRoot(el);
  if (scrollRoot) {
    const rootRect = scrollRoot.getBoundingClientRect();
    const margin = 28;
    return (
      elRect.top >= rootRect.top + margin &&
      elRect.bottom <= rootRect.bottom - margin &&
      elRect.height > 0
    );
  }
  return true;
}

/** True when the slot is already mostly inside the timed grid scrollport (skip hover auto-scroll). */
function timedGridElementMostlyVisible(el: HTMLElement, marginPx = 28): boolean {
  const scrollRoot = timedGridScrollRoot(el) ?? el.closest('.scheduler-calendar-scroll');
  if (!(scrollRoot instanceof HTMLElement)) return true;
  const rootRect = scrollRoot.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return (
    elRect.top >= rootRect.top + marginPx &&
    elRect.bottom <= rootRect.bottom - marginPx &&
    elRect.height > 0
  );
}

/**
 * Scroll the timed grid (embedded routing column) so a slot is visible.
 * `align` is the fraction of the leftover viewport placed above the element: 0.5 centers.
 */
function scrollTimedGridElementIntoView(
  el: HTMLElement,
  behavior: ScrollBehavior = 'auto',
  align = 0.5,
) {
  const scrollRoot = timedGridScrollRoot(el);
  if (scrollRoot) {
    const rootRect = scrollRoot.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const targetTop =
      scrollRoot.scrollTop +
      (elRect.top - rootRect.top) -
      (rootRect.height - elRect.height) * align;
    scrollRoot.scrollTo({ top: Math.max(0, targetTop), behavior });
    return;
  }
  el.scrollIntoView({ block: 'nearest', behavior, inline: 'nearest' });
}

/**
 * Scroll a focused visit into view. Full-page practice calendar scrolls the schedule
 * outlet (not the timed grid) and clears sticky week/day headers. Embedded routing
 * scrolls the inner timed grid only.
 */
function scrollAppointmentElementIntoView(el: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  const outlet = scheduleOutletScrollRoot(el);
  if (outlet) {
    const topInset = schedulerFocusTopInset(outlet);
    if (isFocusVisitVisibleInScheduler(el, outlet, topInset)) return;

    const outletRect = outlet.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    outlet.scrollTo({
      top: Math.max(0, outlet.scrollTop + elRect.top - outletRect.top - topInset),
      behavior,
    });
    return;
  }

  const innerScroll = timedGridScrollRoot(el);
  if (innerScroll && !timedGridElementMostlyVisible(el)) {
    scrollTimedGridElementIntoView(el, behavior, 0.35);
    return;
  }

  if (!isFocusVisitVisibleInScheduler(el, null, 0)) {
    el.scrollIntoView({ block: 'nearest', behavior, inline: 'nearest' });
  }
}

function refreshRoutingPreviewAnchorAfterScroll(
  refresh: () => void,
  behavior: ScrollBehavior = 'auto'
) {
  refresh();
  requestAnimationFrame(() => {
    refresh();
    requestAnimationFrame(refresh);
  });
  window.setTimeout(refresh, behavior === 'smooth' ? 400 : 120);
}

/** Extra line for last drive hatched band (depot return), when not already in segment title from layout. */
function schedulerDriveHoverExtraLine(
  seg: { title: string; kind: 'buffer' | 'drive' },
  segIndex: number,
  segs: { title: string; kind: 'buffer' | 'drive' }[],
  dayData: DayData
): string | null {
  if (seg.kind !== 'drive') return null;
  let lastDriveIdx = -1;
  for (let j = segs.length - 1; j >= 0; j--) {
    if (segs[j].kind === 'drive') {
      lastDriveIdx = j;
      break;
    }
  }
  if (segIndex !== lastDriveIdx) return null;
  if (seg.title.includes('Arrival:')) return null;
  const tz = (dayData.timezone && dayData.timezone.trim()) || PRACTICE_TZ;
  const iso = dayData.backToDepotIso?.trim();
  if (iso) {
    const dt = DateTime.fromISO(iso);
    if (dt.isValid) {
      const t = formatIsoInPracticeZone(iso, tz);
      if (t) return `Back at depot: ${t}`;
    }
  }
  const edt = dayData.endDepotTime?.trim();
  if (edt) return `Scheduled depot return: ${edt}`;
  return null;
}

type SchedulerProps = {
  /** Calendar pane beside Routing; preview sync does not navigate away from `/schedule/routing`. */
  embedInRoutingWorkspace?: boolean;
};

/** Delay before the visit hover card appears (avoids popover noise on quick passes). */
const SCHEDULER_HOVER_POPOVER_DELAY_MS = 750;
/** Grace period to move pointer from appointment block onto the Visit Highlights card (scroll). */
const SCHEDULER_HOVER_DISMISS_MS = 150;
/** Match My Week column layout / drive segment math (`MyWeek.tsx` PPM). */
const PPM = 1.1;
/** Timed visits at or below this length show client/patient on the time row. */
const SCHEDULER_EVENT_COMPACT_MAX_MINUTES = 22;
/** Spacer under nav + height of `.scheduler-day-header` (must stay in sync with CSS). */
const SCHEDULER_DAY_HEADER_STACK_PX = 96;
const SLOT_MINUTES = 15;
const DEFAULT_GRID_START = 7 * 60;
/** Match My Week — practice calendar shows through a typical field day even without routed ETAs. */
const DEFAULT_GRID_END = 21 * 60;
/** Minutes of grid past depot and past first/last timed item (same as My Week depot lead-in). */
const SCHEDULER_GRID_EDGE_BUFFER_MIN = 30;

/** Workday start/end for grid bounds — independent of routed-timeline visit placement. */
function schedulerWorkDayMinutesForDate(
  dayKey: string,
  driveDayByDate: Map<string, DayData> | null | undefined,
  scheduleOverridesByDate: Map<string, ScheduleOverride>,
  providerWeeklySchedules: EmployeeWeeklySchedule[] | null
): { startMin: number | null; endMin: number | null } {
  let startMin: number | null = null;
  let endMin: number | null = null;

  const considerStart = (timeStr: string | null | undefined) => {
    const s = typeof timeStr === 'string' ? timeStr.trim() : '';
    if (!s) return;
    const m = timeStrToMinutesFromMidnight(s);
    startMin = startMin === null ? m : Math.min(startMin, m);
  };
  const considerEnd = (timeStr: string | null | undefined) => {
    const s = typeof timeStr === 'string' ? timeStr.trim() : '';
    if (!s) return;
    const m = timeStrToMinutesFromMidnight(s);
    endMin = endMin === null ? m : Math.max(endMin, m);
  };

  const row = driveDayByDate?.get(dayKey);
  considerStart(row?.startDepotTime);
  considerEnd(row?.endDepotTime);

  const override = scheduleOverridesByDate.get(dayKey);
  if (override && !scheduleOverrideIsOff(override)) {
    considerStart(normalizeScheduleOverrideLocalTime(override.workStartLocal));
    considerEnd(normalizeScheduleOverrideLocalTime(override.workEndLocal));
  } else if (providerWeeklySchedules?.length) {
    const dow = goalDayOfWeekFromLuxonWeekday(
      DateTime.fromISO(dayKey, { zone: PRACTICE_TZ }).weekday
    );
    const schedule = providerWeeklySchedules.find((s) => s.dayOfWeek === dow);
    considerStart(schedule?.workStartLocal);
    considerEnd(schedule?.workEndLocal);
  }

  return { startMin, endMin };
}

/**
 * Practice calendar "off" day: explicit schedule override (Settings → Override), not a weekly
 * workday (unless override adds a shift), or no depot shift and no timed range visits.
 * OFF overrides still show timed visits on top of the Off marking.
 */
function formatUsdWholeDollars(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function schedulerPracticeCalendarDayOff(
  dayData: DayData | null | undefined,
  dayAppointments: Appointment[],
  weeklySchedules?: EmployeeWeeklySchedule[] | null,
  dayKey?: string,
  scheduleOverride?: ScheduleOverride | null
): boolean {
  if (scheduleOverride) {
    return scheduleOverrideIsOff(scheduleOverride);
  }

  if (weeklySchedules && dayKey) {
    const dow = goalDayOfWeekFromLuxonWeekday(
      DateTime.fromISO(dayKey, { zone: PRACTICE_TZ }).weekday
    );
    const schedule = weeklySchedules.find((s) => s.dayOfWeek === dow);
    if (schedule && !schedule.isWorkday) {
      if (!dayData || doctorDayIsOff(dayData)) {
        return true;
      }
    }
  }

  if (!doctorDayIsOff(dayData)) return false;
  return !dayAppointments.some((a) => !a.allDay);
}

/** Scheduled shift or calendar activity — not an off day (may have zero located stops). */
function schedulerDayIsWorking(
  dayKey: string,
  dayData: DayData | null | undefined,
  appointmentsByDay: Map<string, Appointment[]>,
  weeklySchedules?: EmployeeWeeklySchedule[] | null,
  scheduleOverridesByDate?: Map<string, ScheduleOverride> | null
): boolean {
  const dayAppts = appointmentsByDay.get(dayKey) ?? [];
  const scheduleOverride = scheduleOverridesByDate?.get(dayKey) ?? null;
  if (
    schedulerPracticeCalendarDayOff(
      dayData,
      dayAppts,
      weeklySchedules,
      dayKey,
      scheduleOverride
    )
  ) {
    return false;
  }
  if (dayData) return true;
  return dayAppts.length > 0;
}

/**
 * Count toward daily/weekly point goals when the day is a normal scheduled shift — not an off day.
 * Uses schedule override when present, otherwise weekly isWorkday (historical doctor-day rows
 * often omit depot shift times even for days that had routed visits).
 */
function schedulerDayCountsForPointGoal(
  dayData: DayData | null | undefined,
  dayAppointments: Appointment[],
  weeklySchedules?: EmployeeWeeklySchedule[] | null,
  dayKey?: string,
  scheduleOverride?: ScheduleOverride | null
): boolean {
  if (
    schedulerPracticeCalendarDayOff(
      dayData,
      dayAppointments,
      weeklySchedules,
      dayKey,
      scheduleOverride
    )
  ) {
    return false;
  }
  if (!dayData) return false;

  if (scheduleOverride) {
    return !scheduleOverrideIsOff(scheduleOverride);
  }

  if (weeklySchedules && dayKey) {
    const dow = goalDayOfWeekFromLuxonWeekday(
      DateTime.fromISO(dayKey, { zone: PRACTICE_TZ }).weekday
    );
    const schedule = weeklySchedules.find((s) => s.dayOfWeek === dow);
    if (schedule) {
      return schedule.isWorkday;
    }
  }

  return !doctorDayIsOff(dayData);
}

/** Stronger divider when two consecutive off days would otherwise read as one gray block. */
function schedulerOffDayAdjoinsNext(
  dayIdx: number,
  dayColumnDates: DateTime[],
  driveDayByDate: Map<string, DayData> | null | undefined,
  appointmentsByDay: Map<string, Appointment[]>,
  isCurrentOff: boolean,
  weeklySchedules?: EmployeeWeeklySchedule[] | null,
  scheduleOverridesByDate?: Map<string, ScheduleOverride> | null
): boolean {
  if (!isCurrentOff || dayIdx >= dayColumnDates.length - 1) return false;
  const nextKey = dayColumnDates[dayIdx + 1]?.toISODate();
  if (!nextKey) return false;
  return schedulerPracticeCalendarDayOff(
    driveDayByDate?.get(nextKey),
    appointmentsByDay.get(nextKey) ?? [],
    weeklySchedules,
    nextKey,
    scheduleOverridesByDate?.get(nextKey) ?? null
  );
}

/** Unified all-day strip: row height, vertical padding, max visible rows (then scroll inside strip). */
const SCHEDULER_ALL_DAY_ROW_PX = 22;
const SCHEDULER_ALL_DAY_PAD_Y = 6;
const SCHEDULER_ALL_DAY_MAX_VISIBLE_ROWS = 8;

function clientLabel(c: Appointment['client']): string {
  if (!c) return '—';
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.join(' ').trim() || '—';
}

/** Client name for calendar titles — omits the placeholder dash when no client is linked. */
function appointmentClientTitleName(c: Appointment['client']): string | null {
  if (!c) return null;
  const label = clientLabel(c);
  return label === '—' ? null : label;
}

function appointmentTypeTitleName(appt: Appointment): string | null {
  return (
    appt.appointmentType?.prettyName?.trim() ||
    appt.appointmentType?.name?.trim() ||
    null
  );
}

/** Title when a visit has no linked patients (client name, else type, else description). */
function schedulerEventTitleWhenNoPets(appt: Appointment): string {
  return (
    appointmentClientTitleName(appt.client) ||
    appointmentTypeTitleName(appt) ||
    pickStr(appt.description) ||
    'Appointment'
  );
}

/**
 * Membership for calendar cards: appointment + optional `patients[]` + client (matches room loader /
 * range payloads; truthy flags; plan name without booleans).
 */
function appointmentPatientMember(appt: Appointment): {
  isMember: boolean;
  membershipName: string | null;
} {
  const clin = appt.client as { isMember?: unknown; membershipName?: string | null } | undefined;

  let membershipName: string | null = null;
  let isMember = false;

  const consider = (flag: unknown, raw: unknown) => {
    if (truthyApiFlag(flag)) isMember = true;
    const name =
      typeof raw === 'string' && raw.trim()
        ? raw.trim()
        : raw != null && String(raw).trim()
          ? String(raw).trim()
          : null;
    if (name) {
      isMember = true;
      if (!membershipName) membershipName = name;
    }
  };

  consider(appt.isMember, appt.membershipName);
  consider(clin?.isMember, clin?.membershipName);
  for (const p of patientsForAppointment(appt)) {
    consider(p.isMember, p.membershipName);
  }

  return { isMember, membershipName };
}

function providerLabel(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || '—';
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

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
  title: titleAttr,
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
      title={titleAttr ?? undefined}
    >
      {zoneShort}
    </span>
  );
}

function SchedulerClientZoneBadge({
  appt,
  compact,
}: {
  appt: Appointment;
  compact?: boolean;
}) {
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

function SchedulerAlternateLocationBadge({ compact }: { compact?: boolean }) {
  return (
    <span
      className={[
        'scheduler-alt-location-badge',
        compact ? 'scheduler-alt-location-badge--compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title="Alternate routing address (overrides client home for drive time)"
      aria-label="Alternate location"
    >
      ALT
    </span>
  );
}

function SchedulerAlternateLocationBadgeForAppt({
  appt,
  compact,
}: {
  appt: Appointment;
  compact?: boolean;
}) {
  if (!appointmentHasAlternateLocation(appt)) return null;
  return <SchedulerAlternateLocationBadge compact={compact} />;
}

function SchedulerNoPatientBadge({ compact }: { compact?: boolean }) {
  return (
    <span
      className={[
        'scheduler-no-patient-badge',
        compact ? 'scheduler-no-patient-badge--compact' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title="No patient linked to this visit"
      aria-label="No patient"
    >
      NO PATIENT
    </span>
  );
}

function SchedulerNoPatientBadgeForAppt({
  appt,
  compact,
}: {
  appt: Appointment;
  compact?: boolean;
}) {
  if (!appointmentHasNoPatient(appt)) return null;
  return <SchedulerNoPatientBadge compact={compact} />;
}

/** Plain-text label for aria-label / context (avoid `title` on grid events — native tooltips clash with Visit Highlights). */
function schedulerEventAppointmentTitle(appt: Appointment): string {
  const c = appt.client;
  const clientLast = pickStr(c?.lastName);
  const pats = patientsForAppointment(appt);
  const petNames = pats.map((p) => pickStr(p.name)).filter((s): s is string => Boolean(s));
  if (petNames.length === 0) {
    return schedulerEventTitleWhenNoPets(appt);
  }
  let petPart: string;
  if (petNames.length === 1) petPart = petNames[0];
  else if (petNames.length === 2) petPart = `${petNames[0]} & ${petNames[1]}`;
  else petPart = `${petNames[0]} +${petNames.length - 1}`;
  const tail = clientLast ? ` ${clientLast}` : '';
  const out = `${petPart}${tail}`.trim();
  return out || 'Appointment';
}

function appointmentTypeIsArchived(appt: Appointment): boolean {
  const at = appt.appointmentType;
  return at?.isDeleted === true;
}

function SchedulerTypeArchivedPill() {
  return <span className="scheduler-type-archived-pill">Archived</span>;
}

function appointmentActualVisitTimesTitle(appt: Appointment, practiceTz: string): string | null {
  const startIso = pickStr(appt.appointmentStartActual);
  const endIso = pickStr(appt.appointmentEndActual);
  if (!startIso || !endIso) return null;
  const fmt = (iso: string) => {
    const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
    return dt.isValid ? dt.toFormat('h:mm a') : '—';
  };
  return `Visit: ${fmt(startIso)} – ${fmt(endIso)}`;
}

/** Clock when visit start/end are recorded and follow-up disposition is complete (any End Visit option). */
function SchedulerApptVisitTimesBadge({
  appt,
  forwardBookingSourceAppointmentIds,
  variant = 'card',
}: {
  appt: Appointment;
  forwardBookingSourceAppointmentIds: ReadonlySet<number>;
  variant?: 'card' | 'hover';
}) {
  if (!appointmentShowsVisitTimesClock(appt, forwardBookingSourceAppointmentIds)) return null;
  const title = appointmentActualVisitTimesTitle(appt, PRACTICE_TZ);
  if (!title) return null;
  return (
    <span
      className={[
        'scheduler-appt-visit-times-badge',
        variant === 'hover' ? 'scheduler-appt-visit-times-badge--hover' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
      aria-label={title}
    >
      ⏰
    </span>
  );
}

function workdayActualTimesTitle(
  row: EmployeeWorkdayActual | undefined,
  practiceTz: string
): string | null {
  const startIso = row?.workdayStartActual?.trim();
  const endIso = row?.workdayEndActual?.trim();
  if (!startIso || !endIso) return null;
  const fmt = (iso: string) => {
    const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
    return dt.isValid ? dt.toFormat('h:mm a') : '—';
  };
  return `Day: ${fmt(startIso)} – ${fmt(endIso)}`;
}

function dayHasRecordedWorkdayBounds(row: EmployeeWorkdayActual | undefined): boolean {
  return Boolean(row?.workdayStartActual?.trim() && row?.workdayEndActual?.trim());
}

/** Progress / day actuals only for today or past days (practice-local). */
function isScheduleDayOnOrBeforeToday(dateIso: string, practiceTz: string): boolean {
  const day = DateTime.fromISO(dateIso, { zone: practiceTz }).startOf('day');
  const today = DateTime.now().setZone(practiceTz).startOf('day');
  if (!day.isValid || !today.isValid) return false;
  return day <= today;
}

function SchedulerDayHeaderProgressButton({
  dayLabel,
  workday,
  onClick,
  disabled = false,
}: {
  dayLabel: string;
  workday: EmployeeWorkdayActual | undefined;
  onClick: () => void;
  disabled?: boolean;
}) {
  const timesTitle = workdayActualTimesTitle(workday, PRACTICE_TZ);
  const showTimesBadge = dayHasRecordedWorkdayBounds(workday);
  const title = disabled
    ? `Progress is available for today and past days only (${dayLabel})`
    : `Progress: predicted vs actual for ${dayLabel}`;
  return (
    <button
      type="button"
      className="scheduler-day-header-btn scheduler-day-header-adjust scheduler-day-header-btn--progress"
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      Progress
      {showTimesBadge ? (
        <span
          className="scheduler-appt-visit-times-badge"
          title={timesTitle ?? undefined}
          aria-label={timesTitle ?? 'Day start and end recorded'}
        >
          ⏰
        </span>
      ) : null}
    </button>
  );
}

function SchedulerMemberHeartInline({ membershipName }: { membershipName: string | null }) {
  return (
    <span className="scheduler-appt-member-heart" title={membershipName?.trim() || 'Member'} aria-hidden>
      <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
    </span>
  );
}

/** Timed calendar chip: zone is on the time row; title is pet names + client. All-day: zone may appear in the title chip. */
function SchedulerEventTitleBlock({
  appt,
  variant = 'timed',
  forwardBookingSourceAppointmentIds,
}: {
  appt: Appointment;
  variant?: 'timed' | 'allDay';
  forwardBookingSourceAppointmentIds?: ReadonlySet<number>;
}) {
  const visitTimesBadge =
    forwardBookingSourceAppointmentIds != null ? (
      <SchedulerApptVisitTimesBadge
        appt={appt}
        forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
      />
    ) : null;
  const c = appt.client;
  const member = appointmentPatientMember(appt);
  const clientLast = pickStr(c?.lastName);
  const pats = patientsForAppointment(appt);
  const pets = pats
    .map((p) => ({ id: p.id, name: pickStr(p.name) }))
    .filter((x): x is { id: number; name: string } => Boolean(x.name));
  const zone = appointmentZoneShortLabel(appt);
  const zoneTitle = appointmentZoneFullName(appt);
  const zoneInTitle = variant === 'allDay';

  const Shell = variant === 'allDay' ? 'span' : 'div';
  const rootClass =
    variant === 'allDay'
      ? 'scheduler-all-day-span-bar-text scheduler-event-title scheduler-event-title--structured scheduler-event-title--all-day-chip'
      : 'scheduler-event-title scheduler-event-title--structured';

  const desc = pickStr(appt.description);
  if (variant === 'allDay' && desc) {
    return (
      <Shell className={rootClass}>
        {member.isMember ? <SchedulerMemberHeartInline membershipName={member.membershipName} /> : null}
        <span className="scheduler-event-title-fallback">{desc}</span>
        {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        {visitTimesBadge}
      </Shell>
    );
  }

  if (pets.length === 0) {
    const fallback = schedulerEventTitleWhenNoPets(appt);
    return (
      <Shell className={rootClass}>
        {appointmentHasNoPatient(appt) ? <SchedulerNoPatientBadge compact /> : null}
        {member.isMember ? <SchedulerMemberHeartInline membershipName={member.membershipName} /> : null}
        <span className="scheduler-event-title-fallback">{fallback}</span>
        {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        {visitTimesBadge}
      </Shell>
    );
  }

  return (
    <Shell className={rootClass}>
      {pets.map((pet, idx) => (
        <span key={pet.id} className="scheduler-event-title-pet">
          {idx > 0 ? (
            <span className="scheduler-event-title-sep">{pets.length === 2 ? ' & ' : ', '}</span>
          ) : member.isMember ? (
            <SchedulerMemberHeartInline membershipName={member.membershipName} />
          ) : null}
          <span className="scheduler-event-title-pet-name">{pet.name}</span>
          {zoneInTitle && zone ? <SchedulerZoneBadgeInline zoneShort={zone} title={zoneTitle} compact /> : null}
        </span>
      ))}
      {clientLast ? (
        <>
          <span className="scheduler-event-title-client-last"> {clientLast}</span>
          {visitTimesBadge}
        </>
      ) : (
        visitTimesBadge
      )}
    </Shell>
  );
}

/** Provider line for hover: "Julie Greenlaw, BVMS" */
function providerLabelFormal(p: Appointment['primaryProvider']): string {
  if (!p) return '—';
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  if (suffix && name) return `${name}, ${suffix}`;
  return name || '—';
}

function clientAddressOneLine(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const tail = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const parts = [line1, line2, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Primary + secondary household names when present */
function fullClientHouseholdName(c: Client | undefined): string {
  if (!c) return '—';
  const primary = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  const second = [c.secondFirstName, c.secondLastName].filter(Boolean).join(' ').trim();
  if (primary && second) return `${primary} · ${second}`;
  return primary || second || '—';
}

function clientPhonesLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.phone1), pickStr(c.phone2)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function clientEmailsLine(c: Client | undefined): string | null {
  if (!c) return null;
  const parts = [pickStr(c.email), pickStr(c.secondEmail)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function clientAddressMultiline(c: Client | undefined): string | null {
  if (!c) return null;
  const line1 = pickStr(c.address1);
  const line2 = pickStr(c.address2);
  const cityState = [pickStr(c.city), pickStr(c.state)].filter(Boolean).join(', ');
  const zip = pickStr(c.zipcode);
  const line3 = [cityState, zip].filter(Boolean).join(cityState && zip ? ' ' : '');
  const lines = [line1, line2, line3].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/** Single-stop Google Maps link from client address or coordinates. */
function googleMapsUrlForAppointment(a: Appointment): string | null {
  const c = a.client;
  if (!c) return null;
  if (typeof c.lat === 'number' && typeof c.lon === 'number') {
    return `https://www.google.com/maps?q=${c.lat},${c.lon}`;
  }
  const line = clientAddressOneLine(c);
  if (!line) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(line)}`;
}

function patientSpeciesBreed(p: Patient): string | null {
  const species = pickStr(p.speciesEntity?.name) ?? pickStr(p.species);
  const breed = pickStr(p.breedEntity?.name) ?? pickStr(p.breed);
  if (species && breed) return `${species} · ${breed}`;
  return species || breed || null;
}

/** Breed name only (Visit Highlights patient line — no leading species). */
function patientBreedDisplayOnly(p: Patient): string | null {
  return pickStr(p.breedEntity?.name) ?? pickStr(p.breed) ?? null;
}

/** Age from DOB at practice-local "today", e.g. `9y 1m`, `6m`, `3w`. */
function patientAgeYearsMonthsDisplay(p: Patient): string | null {
  const dobIso = pickStr(p.dob);
  if (!dobIso) return null;
  const birth = DateTime.fromISO(dobIso);
  if (!birth.isValid) return null;
  const ref = DateTime.now().setZone(PRACTICE_TZ).startOf('day');
  const b = birth.setZone(PRACTICE_TZ).startOf('day');
  if (!b.isValid || ref < b) return null;
  let years = ref.year - b.year;
  let months = ref.month - b.month;
  const dayDiff = ref.day - b.day;
  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0 || (years === 0 && months < 0)) return null;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  if (parts.length > 0) return parts.join(' ');
  const ageDays = Math.floor(ref.diff(b, 'days').days);
  if (ageDays < 0) return null;
  if (ageDays < 7) return ageDays <= 0 ? '<1d' : `${ageDays}d`;
  const w = Math.floor(ageDays / 7);
  return `${Math.max(1, w)}w`;
}

/** e.g. `3yo`, `9mo`, `2wk` for modal patient one-liner. */
function patientAgeCompactYoDisplay(p: Patient): string | null {
  const dobIso = pickStr(p.dob);
  if (!dobIso) return null;
  const birth = DateTime.fromISO(dobIso);
  if (!birth.isValid) return null;
  const ref = DateTime.now().setZone(PRACTICE_TZ).startOf('day');
  const b = birth.setZone(PRACTICE_TZ).startOf('day');
  if (!b.isValid || ref < b) return null;
  let years = ref.year - b.year;
  let months = ref.month - b.month;
  const dayDiff = ref.day - b.day;
  if (dayDiff < 0) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  if (years < 0 || (years === 0 && months < 0)) return null;
  if (years > 0 && months > 0) return `${years}yo ${months}mo`;
  if (years > 0) return `${years}yo`;
  if (months > 0) return `${months}mo`;
  const ageDays = Math.floor(ref.diff(b, 'days').days);
  if (ageDays < 0) return null;
  if (ageDays < 7) return ageDays <= 0 ? '<1d' : `${ageDays}d`;
  const wk = Math.floor(ageDays / 7);
  return `${Math.max(1, wk)}wk`;
}

function titleCaseWords(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  return t
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

function patientBreedTitleCase(p: Patient): string | null {
  return titleCaseWords(patientBreedDisplayOnly(p));
}

/** Dog vs cat icon in Visit Highlights when species is canine / feline. */
function patientSpeciesIconKind(p: Patient): 'dog' | 'cat' | null {
  const spec = (pickStr(p.speciesEntity?.name) ?? pickStr(p.species) ?? '').toLowerCase();
  if (!spec) return null;
  if (spec.includes('canine') || spec.includes('dog')) return 'dog';
  if (spec.includes('feline') || spec.includes('cat')) return 'cat';
  return null;
}

function userLikeLabel(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t || null;
  }
  if (typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const combined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  return pickStr(o.name) ?? pickStr(o.displayName) ?? (combined || null);
}

function employeeIdProviderLabel(
  employeeId: number | null | undefined,
  providers?: readonly Provider[] | null
): string | null {
  if (employeeId == null || !Number.isFinite(Number(employeeId)) || !providers?.length) return null;
  const id = Number(employeeId);
  const match = providers.find((p) => Number(p.id) === id);
  return match?.name?.trim() || null;
}

function appointmentCreatedByPerson(
  appt: Appointment,
  providers?: readonly Provider[] | null
): string | null {
  const o = appt as unknown as Record<string, unknown>;
  return (
    pickStr(appt.createdByName) ??
    userLikeLabel(appt.createdByUser) ??
    userLikeLabel(appt.createdByEmployee) ??
    (typeof appt.createdBy === 'string' ? pickStr(appt.createdBy) : userLikeLabel(appt.createdBy)) ??
    pickStr(o.createdByUserName) ??
    pickStr(o.createdByUsername) ??
    userLikeLabel(o.createdByUser) ??
    userLikeLabel(o.createdByEmployee) ??
    employeeIdProviderLabel(appt.createdByEmployeeId, providers)
  );
}

/** ISO instant for "last modified" — prefers `modified`, then legacy `updated`. */
function appointmentModifiedAtIso(appt: Appointment): string | undefined {
  return pickStr(appt.modified) ?? pickStr(appt.updated) ?? undefined;
}

function appointmentModifiedByPerson(
  appt: Appointment,
  providers?: readonly Provider[] | null
): string | null {
  const o = appt as unknown as Record<string, unknown>;
  return (
    pickStr(appt.modifiedByName) ??
    pickStr(appt.updatedByName) ??
    userLikeLabel(appt.modifiedByUser) ??
    userLikeLabel(appt.updatedByUser) ??
    userLikeLabel(appt.modifiedByEmployee) ??
    userLikeLabel(appt.updatedByEmployee) ??
    (typeof appt.updatedBy === 'string' ? pickStr(appt.updatedBy) : userLikeLabel(appt.updatedBy)) ??
    pickStr(o.modifiedByName as string | undefined) ??
    pickStr(o.updatedByUserName as string | undefined) ??
    pickStr(o.updatedByUsername as string | undefined) ??
    userLikeLabel(o.modifiedByUser) ??
    userLikeLabel(o.updatedByUser) ??
    userLikeLabel(o.modifiedByEmployee) ??
    userLikeLabel(o.updatedByEmployee) ??
    employeeIdProviderLabel(appt.modifiedByEmployeeId, providers)
  );
}

function formatAppointmentWhenDisplay(iso: string | undefined): string | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return null;
  return dt.toLocaleString(DateTime.DATETIME_MED);
}

function formatAppointmentAuditWhenByLine(when: string | null, byPerson: string | null): string | null {
  if (when && byPerson) return `${when} by ${byPerson}`;
  return when ?? byPerson;
}

/** Resolve chart patient's PIMS primary provider from flexible range/detail payloads. */
function primaryProviderFromPatientRecord(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const flat =
    pickStr(o.primaryProviderName) ??
    pickStr(o.primaryProviderFullName) ??
    pickStr(o.primaryCareProviderName) ??
    pickStr(o.pimsPrimaryProviderName) ??
    pickStr(o.primary_provider_name);
  if (flat) return flat;

  const raw =
    o.primaryProvider ??
    o.primary_provider ??
    o.primaryCareProvider ??
    /** Some integrations attach the vet as `employee` on the patient. */
    o.employee;
  if (!raw || typeof raw !== 'object') return null;
  const pr = raw as Record<string, unknown>;
  const first = pickStr(pr.firstName);
  const last = pickStr(pr.lastName);
  const byParts = [first, last].filter(Boolean).join(' ').trim();
  if (byParts) {
    return providerNameWithSignatorySuffix({
      firstName: first,
      lastName: last,
      designation: pickStr(pr.designation),
      title: pickStr(pr.title),
    });
  }
  const composed =
    pickStr(pr.name) ??
    pickStr(pr.fullName) ??
    pickStr(pr.displayName) ??
    '';
  if (!composed) return null;
  const suffix = pickStr(pr.designation) ?? pickStr(pr.credentials) ?? pickStr(pr.title);
  if (suffix && !composed.toLowerCase().includes(suffix.toLowerCase())) return `${composed}, ${suffix}`;
  return composed;
}

/**
 * Patient record primary provider (not {@link Appointment.primaryProvider}, which is the visit assignee).
 * Range payloads often hydrate `patient` on the appointment but send a slimmer `patients[]` — merge from the matching singular row.
 */
function patientPrimaryProviderDisplay(p: Patient, appt: Appointment): string | null {
  const fromPet = primaryProviderFromPatientRecord(p);
  if (fromPet) return fromPet;
  const sing = appt.patient;
  if (sing && String(sing.id) === String(p.id)) {
    return primaryProviderFromPatientRecord(sing);
  }
  return null;
}

/** Name segment before first comma (strip ", D.V.M." etc.) for assignee vs chart PCP comparison. */
function primaryProviderLabelNameOnlyForCompare(label: string): string {
  const idx = label.indexOf(',');
  return (idx >= 0 ? label.slice(0, idx) : label).trim();
}

function providerNameWithSignatorySuffix(args: {
  firstName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  title?: string | null;
}): string | null {
  const name = [pickStr(args.firstName), pickStr(args.lastName)].filter(Boolean).join(' ').trim();
  if (!name) return null;
  const suffix = pickStr(args.designation) ?? pickStr(args.title);
  return suffix ? `${name}, ${suffix}` : name;
}

function labelFromAppointmentPatientPrimaryProvider(
  ref: Appointment['patientPrimaryProvider'] | null | undefined
): string | null {
  if (!ref) return null;
  return providerNameWithSignatorySuffix({
    firstName: ref.firstName,
    lastName: ref.lastName,
    designation: ref.designation,
    title: ref.title,
  });
}

function findProviderRowForChartPcp(
  providers: readonly Provider[] | undefined,
  ref: NonNullable<Appointment['patientPrimaryProvider']>
): Provider | null {
  if (!providers?.length) return null;
  const rid = ref.id;
  if (rid == null || !Number.isFinite(Number(rid))) return null;
  const n = Number(rid);
  return (
    providers.find((p) => Number(p.id) === n) ??
    providers.find((p) => p.pimsId != null && Number(p.pimsId) === n) ??
    providers.find((p) => String(p.id) === String(rid)) ??
    null
  );
}

/** "First Last, DVM" from `/employees/providers` row — same pattern as {@link providerLabelFormal} for assignees. */
function providerLabelFormalFromProviderRow(p: Provider): string | null {
  const name =
    [pickStr(p.firstName), pickStr(p.lastName)].filter(Boolean).join(' ').trim() || pickStr(p.name);
  if (!name) return null;
  const suffix = pickStr(p.designation) ?? pickStr(p.title);
  return suffix ? `${name}, ${suffix}` : name;
}

/** Embedded routing calendar bar, e.g. `Brian Quinn, DVM's Schedule`. */
function embeddedCalendarProviderScheduleLabel(
  providerRow: Provider | null | undefined,
  fallbackName?: string | null
): string {
  const formal = providerRow ? providerLabelFormalFromProviderRow(providerRow) : null;
  if (formal) return `${formal}'s Schedule`;
  const name = fallbackName?.trim();
  if (name) return `${name}'s Schedule`;
  return "Provider's Schedule";
}

function chartPrimaryProviderLabelFromRefAndProviders(
  ref: Appointment['patientPrimaryProvider'] | null | undefined,
  providers: readonly Provider[] | undefined
): string | null {
  if (!ref) return null;
  const row = findProviderRowForChartPcp(providers, ref);
  if (!row) return null;
  return providerLabelFormalFromProviderRow(row);
}

/**
 * Chart primary provider: resolve by id from `/employees/providers` when possible, else doctor-day ref
 * fields, else patient payload.
 */
function appointmentPatientChartPrimaryProviderLabel(
  appt: Appointment,
  providers?: readonly Provider[] | null
): string | null {
  const fromEmployees = chartPrimaryProviderLabelFromRefAndProviders(
    appt.patientPrimaryProvider,
    providers ?? undefined
  );
  if (fromEmployees) return fromEmployees;
  const fromDoctor = labelFromAppointmentPatientPrimaryProvider(appt.patientPrimaryProvider);
  if (fromDoctor) return fromDoctor;
  for (const p of patientsForAppointment(appt)) {
    const v = patientPrimaryProviderDisplay(p, appt);
    if (v) return v;
  }
  return null;
}

function appointmentNamesRoughlyEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');
}

function appointmentChartPrimaryProviderDiffersFromAssignee(
  appt: Appointment,
  chartLabel: string
): boolean {
  const assignee = providerLabel(appt.primaryProvider);
  if (!assignee || assignee === '—') return false;
  if (appointmentNamesRoughlyEqual(assignee, primaryProviderLabelNameOnlyForCompare(chartLabel)))
    return false;
  const aid = appt.primaryProvider?.id;
  const pref = appt.patientPrimaryProvider;
  if (aid != null && pref && Number(pref.id) === Number(aid)) return false;
  return true;
}

/** Last recorded weight when the range payload includes it (`weight`, `lastWeight`, `weightLbs`, etc.). */
function patientLastWeightDisplay(p: Patient): string | null {
  const o = p as unknown as Record<string, unknown>;
  const raw =
    p.weight ??
    p.lastWeight ??
    p.weightLbs ??
    p.lastWeightLbs ??
    o.lastRecordedWeight ??
    o.last_weight ??
    o.weight_lbs;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const hasUnit = /\b(kg|lbs?)\b/i.test(s) || s.includes('/');
  const weightPart = hasUnit ? s : `${s} lbs`;
  const dateRaw =
    pickStr(p.lastWeightDate ?? undefined) ??
    pickStr(p.weightDate ?? undefined) ??
    pickStr(o.lastWeightDate as string | undefined) ??
    pickStr(o.last_weight_date as string | undefined);
  if (dateRaw) {
    const d = DateTime.fromISO(dateRaw);
    if (d.isValid) return `${weightPart} (${d.toFormat('M/d/yyyy')})`;
  }
  return weightPart;
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

/** Single-line "Label: value" for modal sections; `fullWidth` spans both columns in a 2-col grid. */
function SchedulerModalKvCondensed({
  label,
  value,
  fullWidth,
}: {
  label: string;
  value: ReactNode;
  /** Use for long / multiline values so they do not share a row with another field. */
  fullWidth?: boolean;
}) {
  if (value == null || value === '' || value === '—') return null;
  return (
    <div
      className={
        fullWidth
          ? 'scheduler-modal-kv-condensed scheduler-modal-kv-condensed--full'
          : 'scheduler-modal-kv-condensed'
      }
      role="group"
    >
      <span className="scheduler-modal-kv-condensed-k">{label}:</span>{' '}
      <span className="scheduler-modal-kv-condensed-v">{value}</span>
    </div>
  );
}

const DRIVE_STRIPE_BG =
  'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
/** Match My Week — soft yellow horizontal stripes for buffer vs diagonal gray drive. */
const BUFFER_STRIPE_BG =
  'repeating-linear-gradient(90deg, rgba(253, 224, 71, 0.45) 0px, rgba(253, 224, 71, 0.45) 5px, rgba(254, 249, 195, 0.55) 5px, rgba(254, 249, 195, 0.55) 10px)';
const BUFFER_STRIPE_BORDER = '1px dashed #ca8a04';

function schedulerHouseholdFixedTimeApprox(h: {
  isPersonalBlock?: boolean;
  primary?: unknown;
  patients?: { type?: string | null }[];
}): boolean {
  if (h.isPersonalBlock && !isFlexBlockItem(h.primary as { blockLabel?: string; title?: string })) return true;
  const primary = h.primary as Record<string, unknown> | undefined;
  const at = primary?.appointmentType as { name?: string; prettyName?: string } | undefined;
  const nested = at && typeof at === 'object' ? String(at.name ?? at.prettyName ?? '').toLowerCase() : '';
  const flat = String(primary?.appointmentTypeName ?? primary?.appointmentType ?? '').toLowerCase();
  const typeLower = nested || flat;
  if (typeLower === 'fixed time' || typeLower.includes('fixed time')) return true;
  return (h.patients?.[0]?.type || '').toLowerCase() === 'fixed time';
}

/** Routed timeline placement — prefer merged `/routing/eta` slot times over PIMS schedule. */
function driveDisplayRangeForAppointment(
  a: Appointment,
  showByDriveTime: boolean,
  resolvedPrimaryProviderId: string,
  driveDayByDate: Map<string, DayData> | null | undefined,
  driveIsoByApptId: Map<string, DriveIsoPair> | null | undefined
): { startIso: string; endIso: string } {
  const scheduled = { startIso: a.appointmentStart, endIso: a.appointmentEnd };
  if (!showByDriveTime || !resolvedPrimaryProviderId.trim()) return scheduled;

  const dayKey = dayKeyFromIso(a.appointmentStart);
  const dayData = dayKey ? driveDayByDate?.get(dayKey) : null;
  const row = dayData ? driveHouseholdAndSlotForAppointment(dayData, a.id) : null;
  if (row?.slot?.eta && row.slot?.etd) {
    const useScheduledClock = schedulerHouseholdUsesDoctorDayClockForLayout(
      row.h,
      row.slot,
      true,
      (p) => isFlexBlockItem(p as { blockLabel?: string; title?: string } | null | undefined)
    );
    if (!useScheduledClock) {
      return { startIso: row.slot.eta, endIso: row.slot.etd };
    }
  }

  const fromMap = driveIsoByApptId?.get(String(a.id));
  if (fromMap) return fromMap;

  return scheduled;
}

function driveHouseholdAndSlotForAppointment(
  dayData: DayData,
  apptId: string | number
): { h: DayData['households'][number]; slot: DayData['timeline'][number] } | null {
  const apptKey = String(apptId);
  const households = dayData.households;
  for (let j = 0; j < households.length; j++) {
    const hx = households[j] as { sourceAppointmentIds?: (string | number)[] };
    const ids = hx.sourceAppointmentIds;
    if (!ids?.some((id) => String(id) === apptKey)) continue;
    const slot = dayData.timeline[j] ?? {};
    return { h: households[j], slot };
  }
  return null;
}

function dayKeyFromIso(iso: string): string | null {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return dt.isValid ? dt.toISODate() : null;
}

function buildSchedulerDriveHintForAppt(
  appt: Appointment,
  showByDriveTime: boolean,
  resolvedPrimaryProviderId: string,
  driveDayByDate: Map<string, DayData> | null | undefined
): SchedulerHoverDriveHint | null {
  if (!showByDriveTime || !resolvedPrimaryProviderId.trim()) return null;
  const dk = dayKeyFromIso(appt.appointmentStart);
  if (!dk) return null;
  const dayData = driveDayByDate?.get(dk);
  if (!dayData) return null;
  const row = driveHouseholdAndSlotForAppointment(dayData, appt.id);
  if (!row) return null;
  const { h, slot } = row;
  const practiceTz = dayData.timezone || PRACTICE_TZ;
  const isFixedTime = schedulerHouseholdFixedTimeApprox(h);
  const etaIso = slot?.eta ?? null;
  const etdIso = slot?.etd ?? null;
  const resolvedWindow = resolveArrivalWindowIsos({
    apptEffectiveWindow: appt.effectiveWindow ?? null,
    household: h,
    slot,
    scheduledStartIso: appt.appointmentStart,
    appointmentType: appt.appointmentType,
    appointmentEndIso: appt.appointmentEnd,
    practiceTz,
  });
  const windowStartIso = resolvedWindow?.startIso ?? null;
  const windowEndIso = resolvedWindow?.endIso ?? null;
  // Match Visit Highlights promised window vs ETA (same sources as the displayed times).
  // Household/slot-only lookup can miss type-fallback windows and hide a deserved badge.
  const windowWarning =
    showByDriveTime && !h.isPersonalBlock
      ? computeDriveTimeWindowWarning({
          etaIso,
          windowEndIso,
          windowStartIso,
          isClientFixedTime: isFixedTime,
          scheduledStartIso: h.startIso ?? appt.appointmentStart,
        })
      : false;
  return {
    practiceTz,
    etaIso,
    etdIso,
    windowStartIso,
    windowEndIso,
    schedStartIso: h.startIso ?? null,
    schedEndIso: h.endIso ?? null,
    isPersonalBlock: Boolean(h.isPersonalBlock),
    isFixedTime,
    windowWarning,
  };
}

function SchedulerWindowWarningBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`scheduler-window-warning-badge${compact ? ' scheduler-window-warning-badge--compact' : ''}`}
      title="Window Warning"
      aria-label="Window Warning"
      role="img"
    >
      <AlertTriangle size={compact ? 12 : 14} strokeWidth={2.25} aria-hidden />
      {!compact ? <span className="scheduler-window-warning-badge__label">Window Warning</span> : null}
    </span>
  );
}

function visitDetailsEtaEtdLine(driveHint: SchedulerHoverDriveHint | null | undefined): string | null {
  if (!driveHint) return null;
  if (!(driveHint.etaIso || driveHint.etdIso)) return null;
  const tz = driveHint.practiceTz;
  const e = driveHint.etaIso ? formatIsoTimeShortInPracticeZone(driveHint.etaIso, tz) : '—';
  const d = driveHint.etdIso ? formatIsoTimeShortInPracticeZone(driveHint.etdIso, tz) : '—';
  return `${e} – ${d}`;
}

function visitTimeDeltaMinutes(
  actualIso: string,
  referenceIso: string,
  practiceTz: string
): number | null {
  const actual = DateTime.fromISO(actualIso, { zone: 'utc' }).setZone(practiceTz);
  const reference = DateTime.fromISO(referenceIso, { zone: 'utc' }).setZone(practiceTz);
  if (!actual.isValid || !reference.isValid) return null;
  return Math.round(actual.diff(reference, 'minutes').minutes);
}

function formatVisitTimeDeltaLabel(deltaMinutes: number): string {
  const abs = Math.abs(deltaMinutes);
  const unit = abs === 1 ? 'minute' : 'minutes';
  if (deltaMinutes === 0) return 'ON TIME';
  if (deltaMinutes < 0) return `${abs} ${unit} EARLY`;
  return `${abs} ${unit} LATE`;
}

function visitDetailsActualTimeValue(
  actualIso: string,
  referenceIso: string | null | undefined,
  practiceTz: string
): ReactNode {
  const time = formatIsoTimeShortInPracticeZone(actualIso, practiceTz);
  if (!referenceIso) return time;
  const delta = visitTimeDeltaMinutes(actualIso, referenceIso, practiceTz);
  if (delta == null) return time;
  const label = formatVisitTimeDeltaLabel(delta);
  const tone = delta === 0 ? 'on-time' : delta < 0 ? 'early' : 'late';
  return (
    <>
      {time}
      {' · '}
      <span className={`scheduler-visit-time-delta scheduler-visit-time-delta--${tone}`}>{label}</span>
    </>
  );
}

/** Format arrival window for Visit Highlights (appointment-type windows, not booked slot). */
function formatSchedulerArrivalWindowLine(hint: SchedulerHoverDriveHint): string {
  const tz = hint.practiceTz;
  if (hint.windowStartIso || hint.windowEndIso) {
    const a = hint.windowStartIso
      ? formatIsoTimeShortInPracticeZone(hint.windowStartIso, tz)
      : '—';
    const b = hint.windowEndIso
      ? formatIsoTimeShortInPracticeZone(hint.windowEndIso, tz)
      : '—';
    return `${a} – ${b}`;
  }
  if (hint.isFixedTime && !hint.isPersonalBlock) {
    const a = hint.schedStartIso
      ? formatIsoTimeShortInPracticeZone(hint.schedStartIso, tz)
      : '—';
    const b = hint.schedEndIso
      ? formatIsoTimeShortInPracticeZone(hint.schedEndIso, tz)
      : '—';
    return `${a} – ${b}`;
  }
  return '— – —';
}

/** Window / arrival range: drive-day slot when available, else appointment `arrivalWindow`. */
function visitDetailsWindowLine(
  appt: Appointment,
  driveHint: SchedulerHoverDriveHint | null | undefined
): string | null {
  const practiceTz = driveHint?.practiceTz ?? PRACTICE_TZ;
  const scheduledRange = () => {
    const a = formatIsoTimeShortInPracticeZone(appt.appointmentStart, practiceTz);
    const b = formatIsoTimeShortInPracticeZone(appt.appointmentEnd, practiceTz);
    if (!a || !b) return null;
    return `${a} – ${b}`;
  };

  if (driveHint) {
    const showWindow =
      !!(driveHint.windowStartIso || driveHint.windowEndIso) ||
      (driveHint.isFixedTime && !driveHint.isPersonalBlock && !!(driveHint.schedStartIso || driveHint.schedEndIso));
    if (showWindow && !(driveHint.isPersonalBlock && driveHint.isFixedTime)) {
      // Zero-width (HOLD in-office / Fixed Time 0±0): show booked visit span, not "3:30 – 3:30".
      if (
        driveHint.windowStartIso &&
        driveHint.windowEndIso &&
        arrivalWindowIsZeroWidth(driveHint.windowStartIso, driveHint.windowEndIso)
      ) {
        return scheduledRange();
      }
      return formatSchedulerArrivalWindowLine(driveHint);
    }
  }
  const ew = appt.effectiveWindow;
  if (ew?.startIso && ew?.endIso) {
    if (arrivalWindowIsZeroWidth(ew.startIso, ew.endIso)) {
      return scheduledRange();
    }
    return `${formatIsoTimeShortInPracticeZone(ew.startIso, PRACTICE_TZ)} – ${formatIsoTimeShortInPracticeZone(ew.endIso, PRACTICE_TZ)}`;
  }
  const aw = appt.arrivalWindow;
  if (aw?.windowStartLocal && aw?.windowEndLocal) {
    if (aw.windowStartLocal === aw.windowEndLocal) {
      return scheduledRange();
    }
    return `${aw.windowStartLocal} – ${aw.windowEndLocal}`;
  }
  const ws = pickStr(aw?.windowStartIso);
  const we = pickStr(aw?.windowEndIso);
  if (ws && we) {
    if (arrivalWindowIsZeroWidth(ws, we)) {
      return scheduledRange();
    }
    return `${formatIsoTimeShortInPracticeZone(ws, PRACTICE_TZ)} – ${formatIsoTimeShortInPracticeZone(we, PRACTICE_TZ)}`;
  }
  return null;
}

/** Compact appointment-card header: `🪟 8:50 AM – 10:50 AM` (or booked span when window is 0±0). */
function schedulerEventWindowCardLabel(
  appt: Appointment,
  driveHint: SchedulerHoverDriveHint | null | undefined
): string | null {
  const range = visitDetailsWindowLine(appt, driveHint);
  if (range) return `🪟 ${range}`;

  const practiceTz = driveHint?.practiceTz ?? PRACTICE_TZ;
  const resolved = resolveArrivalWindowIsos({
    apptEffectiveWindow: appt.effectiveWindow ?? null,
    household: null,
    slot: null,
    scheduledStartIso: appt.appointmentStart,
    appointmentType: appt.appointmentType,
    appointmentEndIso: appt.appointmentEnd,
    practiceTz,
  });
  if (resolved?.startIso && resolved?.endIso) {
    if (arrivalWindowIsZeroWidth(resolved.startIso, resolved.endIso)) {
      const a = formatIsoTimeShortInPracticeZone(appt.appointmentStart, practiceTz);
      const b = formatIsoTimeShortInPracticeZone(appt.appointmentEnd, practiceTz);
      if (a && b) return `🪟 ${a} – ${b}`;
    }
    return `🪟 ${formatIsoTimeShortInPracticeZone(resolved.startIso, practiceTz)} – ${formatIsoTimeShortInPracticeZone(resolved.endIso, practiceTz)}`;
  }
  return null;
}

export function SchedulerHoverContent({
  appt,
  driveHint,
  providers,
  forwardBookingSourceAppointmentIds,
}: {
  appt: Appointment;
  driveHint?: SchedulerHoverDriveHint | null;
  /** Practice provider list (`/employees/providers`) — used to resolve chart Primary Provider by id. */
  providers?: readonly Provider[] | null;
  forwardBookingSourceAppointmentIds: ReadonlySet<number>;
}) {
  const c = appt.client;
  const patients = patientsForAppointment(appt);
  const member = appointmentPatientMember(appt);
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeRaw =
    pickStr(appt.appointmentType?.name) ??
    pickStr(appt.appointmentType?.prettyName) ??
    null;
  const desc = appt.description?.trim() || null;
  const instr = appt.instructions?.trim() || null;
  const clientAlerts = c?.alerts?.trim() || null;
  const hasAlternateLocation = appointmentHasAlternateLocation(appt);
  const alternateAddress = appointmentAlternateAddressText(appt);
  const addrLine = clientAddressOneLine(c ?? undefined);
  const phoneLine = clientPhonesLine(c ?? undefined);
  const providerLine = providerLabelFormal(appt.primaryProvider);
  const chartPrimaryProviderLabel = appointmentPatientChartPrimaryProviderLabel(appt, providers);
  const appointmentVsChartProviderMismatch =
    !!chartPrimaryProviderLabel &&
    appointmentChartPrimaryProviderDiffersFromAssignee(appt, chartPrimaryProviderLabel);
  const createdBy = appointmentCreatedByPerson(appt, providers);
  const modifiedBy = appointmentModifiedByPerson(appt, providers);
  const createdWhen = formatAppointmentWhenDisplay(pickStr(appt.created) ?? undefined);
  const modifiedWhen = formatAppointmentWhenDisplay(appointmentModifiedAtIso(appt));
  const createdLine = formatAppointmentAuditWhenByLine(createdWhen, createdBy);
  const modifiedLine = formatAppointmentAuditWhenByLine(modifiedWhen, modifiedBy);
  const showAuditFooter = !!(createdLine || modifiedLine);
  const showVisitTimesClock = appointmentShowsVisitTimesClock(
    appt,
    forwardBookingSourceAppointmentIds
  );

  return (
    <>
      <div className="scheduler-tooltip-vh-header">Visit Highlights</div>
      <div className="scheduler-tooltip-vh-body">
        <div className="scheduler-tooltip-vh-preamble">
          {typeRaw || appointmentTypeIsArchived(appt) || showVisitTimesClock ? (
            <div className="scheduler-tooltip-vh-type-row">
              {typeRaw ? <div className="scheduler-tooltip-vh-type">{typeRaw}</div> : null}
              {appointmentTypeIsArchived(appt) ? <SchedulerTypeArchivedPill /> : null}
              {showVisitTimesClock ? (
                <SchedulerApptVisitTimesBadge
                  appt={appt}
                  forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
                  variant="hover"
                />
              ) : null}
            </div>
          ) : null}
          {desc ? <div className="scheduler-tooltip-vh-desc">{desc}</div> : null}
          {instr ? (
            <div className="scheduler-tooltip-vh-staff-notes">
              <span className="scheduler-tooltip-vh-staff-notes-k">Staff notes</span>
              {instr}
            </div>
          ) : null}
          <div className="scheduler-tooltip-vh-provider-row">
            <span className="scheduler-tooltip-vh-provider">{providerLine}</span>
            {appointmentVsChartProviderMismatch ? (
              <span
                className="scheduler-tooltip-vh-provider-pcp-mismatch"
                role="status"
                title={
                  chartPrimaryProviderLabel
                    ? `Primary Provider on chart: ${chartPrimaryProviderLabel}`
                    : undefined
                }
              >
                <AlertTriangle
                  size={12}
                  strokeWidth={2.25}
                  className="scheduler-tooltip-vh-provider-pcp-mismatch__icon"
                  aria-hidden
                />
                <span>≠ chart PCP</span>
              </span>
            ) : null}
          </div>
          {driveHint?.windowWarning ? (
            <div className="scheduler-tooltip-vh-window-warning">
              <SchedulerWindowWarningBadge />
            </div>
          ) : null}
        </div>
        <hr className="scheduler-tooltip-vh-divider" />

        {hasAlternateLocation ? (
          <div className="scheduler-tooltip-vh-alternate-alert" role="alert">
            <span className="scheduler-tooltip-vh-alternate-alert-title">Alternate location</span>
            {alternateAddress ? (
              <span className="scheduler-tooltip-vh-alternate-alert-address">{alternateAddress}</span>
            ) : (
              <span className="scheduler-tooltip-vh-alternate-alert-address scheduler-tooltip-vh-alternate-alert-address--pending">
                Loading alternate address…
              </span>
            )}
            <span className="scheduler-tooltip-vh-alternate-alert-hint">
              Routing and drive time use this address instead of the client's home address.
            </span>
          </div>
        ) : null}

        <VisitHighlightsRow label="Scheduled">
          {start.isValid && end.isValid
            ? `${start.toFormat('M/d/yyyy h:mm a')} – ${end.toFormat('h:mm a')}`
            : null}
        </VisitHighlightsRow>
        {driveHint ? (
          (() => {
            const showArrive = !!(driveHint.etaIso || driveHint.etdIso);
            const showWindow =
              !!(driveHint.windowStartIso || driveHint.windowEndIso) ||
              (driveHint.isFixedTime &&
                !driveHint.isPersonalBlock &&
                !!(driveHint.schedStartIso || driveHint.schedEndIso));
            if (!showArrive && !showWindow) return null;
            return (
              <div className="scheduler-tooltip-drive-block">
                {showWindow && !(driveHint.isPersonalBlock && driveHint.isFixedTime) ? (
                  <VisitHighlightsRow label="🪟 Promised Window of Arrival">
                    {formatSchedulerArrivalWindowLine(driveHint)}
                  </VisitHighlightsRow>
                ) : null}
                {showArrive ? (
                  <VisitHighlightsRow label="Expected time of arrival & departure">
                    {driveHint.etaIso
                      ? formatIsoTimeShortInPracticeZone(driveHint.etaIso, driveHint.practiceTz)
                      : '—'}
                    {' – '}
                    {driveHint.etdIso
                      ? formatIsoTimeShortInPracticeZone(driveHint.etdIso, driveHint.practiceTz)
                      : '—'}
                  </VisitHighlightsRow>
                ) : null}
              </div>
            );
          })()
        ) : null}

        {c ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Client</div>
            <div className="scheduler-tooltip-vh-client-line">
              <strong>{clientLabel(c)}</strong>
              <SchedulerClientZoneBadge appt={appt} />
              <span className="scheduler-tooltip-vh-id"> (#{c.id})</span>
            </div>
            {addrLine ? (
              <div className="scheduler-tooltip-vh-detail">
                {alternateAddress ? <span className="scheduler-tooltip-vh-home-label">Home: </span> : null}
                {addrLine}
              </div>
            ) : null}
            {phoneLine ? (
              <div className="scheduler-tooltip-vh-detail">
                Phone: {phoneLine}
              </div>
            ) : null}
            {clientEmailsLine(c) ? (
              <div className="scheduler-tooltip-vh-detail">{clientEmailsLine(c)}</div>
            ) : null}
            {clientAlerts ? (
              <div className="scheduler-tooltip-vh-alerts" role="status">
                <span className="scheduler-tooltip-vh-alerts-title">Client alerts</span>
                {clientAlerts}
              </div>
            ) : null}
          </div>
        ) : null}

        {appointmentHasNoPatient(appt) ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Patient</div>
            <SchedulerNoPatientBadge />
          </div>
        ) : null}

        {patients.length > 0 || member.isMember || chartPrimaryProviderLabel ? (
          <div className="scheduler-tooltip-vh-block">
            <div className="scheduler-tooltip-vh-block-title">Patient</div>
            {patients.map((p, idx) => {
              const pid = p.pimsId != null && String(p.pimsId).trim() !== '' ? p.pimsId : p.id;
              const pAlerts = p.alerts?.trim();
              const sexAbbr = patientSexAbbrevDisplay(p);
              const ageStr = patientAgeYearsMonthsDisplay(p);
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
              <div
                className={
                  patients.length > 0 ? 'scheduler-tooltip-vh-patient-block-pcp' : undefined
                }
              >
                <VisitHighlightsRow label="Primary Provider">{chartPrimaryProviderLabel}</VisitHighlightsRow>
              </div>
            ) : null}
            {member.isMember ? (
              <div className="scheduler-tooltip-vh-patient-membership">
                <div className="scheduler-tooltip-vh-patient-membership-label">Membership</div>
                <div className="scheduler-tooltip-vh-membership">
                  <Heart size={11} fill="#dc2626" color="#dc2626" strokeWidth={1.75} aria-hidden />
                  <span>{member.membershipName?.trim() || 'Member'}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {showAuditFooter ? (
          <>
            <hr className="scheduler-tooltip-vh-divider" />
            {createdLine ? (
              <VisitHighlightsRow label="Created:">{createdLine}</VisitHighlightsRow>
            ) : null}
            {modifiedLine ? (
              <VisitHighlightsRow label="Last Modified by:">{modifiedLine}</VisitHighlightsRow>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

function SchedulerAppointmentModal({
  appt,
  driveHint,
  accentColor,
  onClose,
  providers,
}: {
  appt: Appointment;
  driveHint?: SchedulerHoverDriveHint | null;
  accentColor: string;
  onClose: () => void;
  providers?: readonly Provider[] | null;
}) {
  const c = appt.client;
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
  const typeName = appt.appointmentType?.name || appt.appointmentType?.prettyName || 'Appointment';
  const etaLine = visitDetailsEtaEtdLine(driveHint ?? null);
  const windowLine = visitDetailsWindowLine(appt, driveHint ?? null);
  const actualStartIso = pickStr(appt.appointmentStartActual);
  const actualEndIso = pickStr(appt.appointmentEndActual);
  const additionalEmployeeLabels = (appt.additionalEmployees ?? [])
    .map((emp) => providerLabel(emp))
    .filter((label) => label && label !== '—');

  return (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="scheduler-modal scheduler-modal--view"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">
              <span className="scheduler-modal-eyebrow-type">{typeName}</span>
              {appointmentTypeIsArchived(appt) ? <SchedulerTypeArchivedPill /> : null}
            </p>
            <h2 id="scheduler-modal-title" className="scheduler-modal-title-h">
              <span className="scheduler-modal-title-client">{fullClientHouseholdName(c)}</span>
              <SchedulerVisitClientZoneBadge appt={appt} compact />
            </h2>
            <SchedulerVisitClientHeaderAlerts appt={appt} />
            <SchedulerVisitPatientContext appt={appt} providers={providers} practiceTz={PRACTICE_TZ} />
            {start.isValid && end.isValid ? (
              <p className="scheduler-modal-subtitle">
                {appt.allDay ? (
                  (() => {
                    const endInclusive = allDayLocalStartEndExclusive(appt)?.endExclusive.minus({ days: 1 });
                    const startLabel = start.startOf('day').toFormat('EEEE, MMMM d, yyyy');
                    const endLabel = endInclusive?.toFormat('EEEE, MMMM d, yyyy') ?? startLabel;
                    return startLabel === endLabel
                      ? `${startLabel} · All day`
                      : `${startLabel} – ${endLabel} · All day`;
                  })()
                ) : (
                  <>
                    {start.toFormat('EEEE, MMMM d, yyyy')}
                    <span className="scheduler-modal-subtitle-sep">·</span>
                    {start.toFormat('h:mm a')} – {end.toFormat('h:mm a')}
                  </>
                )}
              </p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          <section className="scheduler-modal-section">
            <h3 className="scheduler-modal-h3">Visit details</h3>
            <div className="scheduler-modal-kv-grid">
              <SchedulerModalKvCondensed
                label="Appointment ID"
                value={appt.id != null ? String(appt.id) : null}
              />
              <SchedulerModalKvCondensed
                label="Appointment provider"
                value={providerLabel(appt.primaryProvider)}
              />
              <SchedulerModalKvCondensed label="All day" value={appt.allDay ? 'Yes' : null} />
              <SchedulerModalKvCondensed
                label={appt.allDay ? 'Additional providers' : 'Additional employees'}
                value={additionalEmployeeLabels.length > 0 ? additionalEmployeeLabels.join(', ') : null}
              />
              <SchedulerModalKvCondensed label="Status" value={pickStr(appt.statusName)} />
              <SchedulerModalKvCondensed label="Confirm status" value={pickStr(appt.confirmStatusName)} />
              {etaLine ? (
                <SchedulerModalKvCondensed label="ETA/ETD" value={etaLine} />
              ) : null}
              {actualStartIso ? (
                <SchedulerModalKvCondensed
                  label="Actual arrival"
                  value={visitDetailsActualTimeValue(actualStartIso, driveHint?.etaIso, PRACTICE_TZ)}
                />
              ) : null}
              {actualEndIso ? (
                <SchedulerModalKvCondensed
                  label="Actual leave"
                  value={visitDetailsActualTimeValue(actualEndIso, driveHint?.etdIso, PRACTICE_TZ)}
                />
              ) : null}
              {windowLine ? (
                <SchedulerModalKvCondensed label="Window" value={windowLine} />
              ) : null}
              <SchedulerModalKvCondensed label="Booked date" value={pickStr(appt.bookedDate ?? undefined)} />
              <SchedulerModalKvCondensed
                label="Description"
                fullWidth
                value={appt.description?.trim() || null}
              />
              <SchedulerModalKvCondensed
                label="Staff notes"
                fullWidth
                value={appt.instructions?.trim() || null}
              />
              <SchedulerModalKvCondensed
                label="Alternate address (routing)"
                fullWidth
                value={appointmentAlternateAddressText(appt)}
              />
              <SchedulerModalKvCondensed label="Equipment" fullWidth value={appt.equipment?.trim() || null} />
              <SchedulerModalKvCondensed label="Medications" fullWidth value={appt.medications?.trim() || null} />
              <SchedulerModalKvCondensed
                label="External record"
                value={appt.externallyCreated ? 'Yes' : null}
              />
              <SchedulerModalKvCondensed
                label="Created"
                fullWidth
                value={formatAppointmentAuditWhenByLine(
                  formatAppointmentWhenDisplay(pickStr(appt.created) ?? undefined),
                  appointmentCreatedByPerson(appt, providers)
                )}
              />
              <SchedulerModalKvCondensed
                label="Last Modified by"
                fullWidth
                value={formatAppointmentAuditWhenByLine(
                  formatAppointmentWhenDisplay(appointmentModifiedAtIso(appt)),
                  appointmentModifiedByPerson(appt, providers)
                )}
              />
            </div>
          </section>

          <SchedulerVisitClientContext appt={appt} />
        </div>
      </div>
    </div>
  );
}

function sundayWeekStart(d: DateTime): DateTime {
  const day = d.setZone(PRACTICE_TZ).startOf('day');
  const dow = day.weekday; // 1=Mon … 7=Sun
  const daysSinceSun = dow === 7 ? 0 : dow;
  return day.minus({ days: daysSinceSun });
}

function wallMinutes(iso: string): number {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(PRACTICE_TZ);
  if (!dt.isValid) return 0;
  return dt.hour * 60 + dt.minute + dt.second / 60;
}

function snapSchedulerMinutes(rawMin: number, gridStartMin: number, gridEndMin: number, durationMin: number): number {
  const snapped = Math.round(rawMin / SLOT_MINUTES) * SLOT_MINUTES;
  const maxStart = Math.max(gridStartMin, gridEndMin - Math.max(SLOT_MINUTES, durationMin));
  return Math.max(gridStartMin, Math.min(maxStart, snapped));
}

type StaffCalendarDragState = {
  apptId: number | string;
  dayKey: string;
  durationMin: number;
  grabOffsetMin: number;
  liveStartMin: number;
  originStartMin: number;
  moved: boolean;
};

/** Pixels from grid top for depot HH:mm line; matches My Week `depotTimeToPx` + half-line vertical centering. */
const SCHEDULER_DEPOT_LINE_PX = 5;

function schedulerDepotLineTopPx(
  gridStartMin: number,
  totalMin: number,
  timeStr: string | null | undefined
): number | null {
  const s = typeof timeStr === 'string' ? timeStr.trim() : '';
  if (!s) return null;
  const m = timeStrToMinutesFromMidnight(s);
  const fromStart = m - gridStartMin;
  const clampedMin = Math.max(0, Math.min(totalMin, fromStart));
  return clampedMin * PPM - Math.floor(SCHEDULER_DEPOT_LINE_PX / 2);
}

/** Practice-local week column key for routing preview (`option.date` may omit TZ). */
function routingPreviewPracticeDateKey(
  opt: { date?: unknown; suggestedStartIso?: unknown } | null | undefined
): string | null {
  if (!opt) return null;
  const dateRaw =
    typeof opt.date === 'string'
      ? opt.date.trim()
      : opt.date != null
        ? String(opt.date).trim()
        : '';
  if (dateRaw) {
    const d = DateTime.fromISO(dateRaw.includes('T') ? dateRaw : `${dateRaw}T12:00:00`, {
      zone: PRACTICE_TZ,
    });
    if (d.isValid) return d.toISODate();
  }
  const startRaw =
    typeof opt.suggestedStartIso === 'string'
      ? opt.suggestedStartIso.trim()
      : opt.suggestedStartIso != null
        ? String(opt.suggestedStartIso).trim()
        : '';
  if (!startRaw) return null;
  const d = DateTime.fromISO(startRaw, { zone: 'utc' }).setZone(PRACTICE_TZ);
  return d.isValid ? d.toISODate() : null;
}

/** Practice-calendar day of the visit is today or later (past visits cannot use Reschedule here). */
function appointmentIsTodayOrFuture(appt: Appointment, practiceTz: string): boolean {
  const startRaw = appt.appointmentStart;
  if (!startRaw) return false;
  const apptDay = DateTime.fromISO(startRaw, { zone: 'utc' }).setZone(practiceTz).startOf('day');
  if (!apptDay.isValid) return false;
  const today = DateTime.now().setZone(practiceTz).startOf('day');
  return apptDay.toMillis() >= today.toMillis();
}

/** Visit is on a calendar day after today — Start / End Visit is not available yet. */
function appointmentIsFutureVisit(appt: Appointment, practiceTz: string): boolean {
  const startRaw = appt.appointmentStart;
  if (!startRaw) return false;
  const apptDay = DateTime.fromISO(startRaw, { zone: 'utc' }).setZone(practiceTz).startOf('day');
  if (!apptDay.isValid) return false;
  const today = DateTime.now().setZone(practiceTz).startOf('day');
  return apptDay.toMillis() > today.toMillis();
}

/** Visits being rescheduled (routing workspace, before a purple preview slot is chosen). */
function rescheduleSourceHighlightAppointmentIds(
  embedInRoutingWorkspace: boolean,
  routingPreview: RoutingCalendarPreviewPayloadV1 | null
): Set<number> | null {
  if (!embedInRoutingWorkspace || routingPreview) return null;
  const ri = readRoutingRescheduleIntent();
  if (!ri) return null;
  const { appointmentIds } = rescheduleScopeTargets(ri);
  return appointmentIds.length > 0 ? new Set(appointmentIds) : null;
}

/** While a reschedule preview is on the calendar, hide the visits being moved (show purple preview only).
 * Explore Alternatives keeps the original, so never hide those visits.
 * Co-visit add-pet with align: hide siblings that will move to the new times (one combined red slot). */
function routingRescheduleHiddenAppointmentIds(
  preview: RoutingCalendarPreviewPayloadV1
): Set<number> | null {
  const ri = readRoutingRescheduleIntent();
  if (ri?.exploreAlternatives || preview.exploreAlternatives) return null;

  const fromPreview =
    preview.rescheduleAppointmentIds
      ?.filter((id) => Number.isFinite(Number(id)))
      .map((id) => Number(id)) ??
    (preview.rescheduleAppointmentId != null && Number.isFinite(Number(preview.rescheduleAppointmentId))
      ? [Number(preview.rescheduleAppointmentId)]
      : []);
  if (fromPreview.length > 0) return new Set(fromPreview);

  const coVisitAlign =
    preview.previewSource === 'manual-book'
      ? (preview.manualBookDraft?.coVisitAlignAppointmentIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      : [];
  if (coVisitAlign.length > 0) return new Set(coVisitAlign);

  if (!ri) return null;
  const { appointmentIds } = rescheduleScopeTargets(ri);
  return appointmentIds.length > 0 ? new Set(appointmentIds) : null;
}

function clientLastNameFromDisplayLabel(label: string | undefined): string | null {
  const raw = label?.trim();
  if (!raw) return null;
  if (raw.includes(',')) {
    const before = raw.split(',')[0]?.trim();
    return before || null;
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1]! : null;
}

/** Timed routing preview participates in `assignColumnsForDay` so real visits reflow like overlap layout. */
function buildRoutingPreviewSyntheticAppointment(
  preview: RoutingCalendarPreviewPayloadV1,
  types: AppointmentType[]
): Appointment | null {
  const opt = preview.option;
  const startRaw = String(opt.suggestedStartIso ?? '').trim();
  if (!startRaw) return null;
  const startUtc = DateTime.fromISO(startRaw, { zone: 'utc' });
  if (!startUtc.isValid) return null;
  const mins = Math.max(1, Math.floor(preview.serviceMinutes) || 30);
  const startIso = startUtc.toUTC().toISO()!;
  const endIso = startUtc.plus({ minutes: mins }).toUTC().toISO()!;
  const appointmentType = types.find((t) => t.id === preview.appointmentTypeId);
  const typeLabel =
    appointmentType?.prettyName?.trim() || appointmentType?.name?.trim() || null;
  const isManualBook = isManualBookCalendarPreview(preview);
  const manualDraft = preview.manualBookDraft;
  const label = isManualBook
    ? typeLabel || preview.clientDisplayLabel?.trim() || 'Manual book preview'
    : preview.clientDisplayLabel?.trim() ||
      (typeof (opt as { clientName?: string }).clientName === 'string'
        ? (opt as { clientName?: string }).clientName
        : null) ||
      'Proposed visit';
  const previewDescription = isManualBook
    ? [manualDraft?.description?.trim(), manualDraft?.patientLabel?.trim()]
        .filter(Boolean)
        .join(' · ') || label
    : label;
  const zOpt = opt as {
    clientZone?: Appointment['clientZone'];
    effectiveZone?: Appointment['effectiveZone'];
  };

  let previewPatientRows = preview.previewPatients ?? [];
  if (previewPatientRows.length === 0) {
    const ri = readRoutingRescheduleIntent();
    if (ri) {
      // A no-patient client visit (ash drop-off) has no anchor pet — do not borrow a household
      // pet from the same day, or the preview ghost claims the wrong patient.
      const anchorPatientId = ri.patientId?.trim() ?? '';
      const visits: RescheduleSameDayVisit[] =
        ri.rescheduleScope === 'household_day'
          ? (ri.sameDayVisits ?? [])
          : anchorPatientId && ri.sameDayVisits?.length
            ? [
                ri.sameDayVisits.find((v) => v.patientId === anchorPatientId) ??
                  ri.sameDayVisits[0]!,
              ]
            : [];
      previewPatientRows = visits.map((v) => ({
        id: v.patientId,
        name: v.patientName?.trim() || `Pet ${v.patientId}`,
      }));
    }
  }
  const patients: Patient[] = previewPatientRows
    .map((p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) return null;
      const name = String(p.name ?? '').trim();
      if (!name) return null;
      return { id, name } as Patient;
    })
    .filter((p): p is Patient => p != null);

  const clientIdRaw = preview.newApptMeta?.clientId?.trim();
  const clientId = clientIdRaw && Number.isFinite(Number(clientIdRaw)) ? Number(clientIdRaw) : null;
  const clientLast = clientLastNameFromDisplayLabel(preview.clientDisplayLabel);
  const clientStub =
    clientId != null
      ? ({
          id: clientId,
          ...(clientLast ? { lastName: clientLast } : {}),
        } as Appointment['client'])
      : undefined;

  /** Alternate stop when routing without a client, or reschedule at an explicit alternate address. */
  const routingAlt = (() => {
    const addr = preview.newApptMeta?.address?.trim();
    if (!addr) return null;
    if (clientId == null) return addr;
    if (preview.routingUsesAlternateAddress) return addr;
    return null;
  })();

  const optArrivalWindow = (opt as { arrivalWindow?: { windowStartIso?: string; windowEndIso?: string } })
    .arrivalWindow;
  const effectiveWindow =
    optArrivalWindow?.windowStartIso && optArrivalWindow?.windowEndIso
      ? { startIso: optArrivalWindow.windowStartIso, endIso: optArrivalWindow.windowEndIso }
      : effectiveWindowForScheduledStart(startIso, appointmentType, PRACTICE_TZ, {
          appointmentEndIso: endIso,
        });

  return {
    id: SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID,
    isActive: true,
    isDeleted: false,
    isComplete: false,
    allDay: false,
    appointmentStart: startIso,
    appointmentEnd: endIso,
    appointmentType,
    description: previewDescription,
    pimsId: null,
    confirmStatusName: null,
    statusName: null,
    ...(clientStub ? { client: clientStub } : {}),
    ...(patients.length > 0 ? { patients, patient: patients[0] } : {}),
    ...(zOpt.clientZone != null ? { clientZone: zOpt.clientZone } : {}),
    ...(zOpt.effectiveZone != null ? { effectiveZone: zOpt.effectiveZone } : {}),
    ...(routingAlt
      ? {
          isAlternateStop: true,
          alternateAddress: { addressText: routingAlt },
          alternateAddressText: routingAlt,
        }
      : {}),
    ...(effectiveWindow ? { effectiveWindow } : {}),
  } as Appointment;
}

/**
 * All-day span in practice TZ: half-open [start, end) by local start-of-day — `appointmentEnd` at
 * local midnight is the first day NOT included (e.g. Apr 20 … Apr 28 end → Apr 20–27).
 */
function allDayLocalStartEndExclusive(a: Appointment): {
  start: DateTime;
  endExclusive: DateTime;
} | null {
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ).startOf('day');
  const endExclusive = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ).startOf('day');
  if (!start.isValid) return null;
  return { start, endExclusive };
}

function allDayRangeContainsLocalDate(a: Appointment, dateIso: string): boolean {
  const bounds = allDayLocalStartEndExclusive(a);
  if (!bounds) return false;
  const { start, endExclusive } = bounds;
  const d = DateTime.fromISO(dateIso, { zone: PRACTICE_TZ }).startOf('day');
  if (!d.isValid) return false;
  if (!endExclusive.isValid || endExclusive <= start) return d.equals(start);
  return d >= start && d < endExclusive;
}

function appointmentCoversPracticeLocalDate(a: Appointment, dateIso: string): boolean {
  if (a.allDay) return allDayRangeContainsLocalDate(a, dateIso);
  return dayKeyFromIso(a.appointmentStart) === dateIso;
}

function dayKeysForAllDayRange(a: Appointment): string[] {
  const bounds = allDayLocalStartEndExclusive(a);
  if (!bounds) return [];
  const { start, endExclusive } = bounds;
  if (!endExclusive.isValid || endExclusive <= start) {
    return [start.toISODate()!];
  }
  const keys: string[] = [];
  for (let d = start; d < endExclusive; d = d.plus({ days: 1 })) {
    keys.push(d.toISODate()!);
  }
  return keys;
}

type ViewMode = 'month' | 'week' | 'day';

type PlacedAppt = {
  appt: Appointment;
  col: number;
  colCount: number;
};

function assignColumns(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): PlacedAppt[] {
  const sorted = [...appointments].sort(
    (a, b) =>
      new Date(displayRange(a).startIso).getTime() - new Date(displayRange(b).startIso).getTime()
  );
  const colEnds: number[] = [];
  const placed: PlacedAppt[] = [];
  for (const appt of sorted) {
    const { startIso, endIso } = displayRange(appt);
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = Math.max(colEnds[col], end);
    }
    placed.push({ appt, col, colCount: 0 });
  }
  const n = Math.max(colEnds.length, 1);
  for (const p of placed) p.colCount = n;
  return placed;
}

function intervalsOverlapMs(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

/** Split into connected overlap groups so non-overlapping visits each get full column width. */
function buildOverlapComponents(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): Appointment[][] {
  if (appointments.length === 0) return [];
  const items = appointments.map((appt) => {
    const { startIso, endIso } = displayRange(appt);
    return {
      appt,
      start: new Date(startIso).getTime(),
      end: new Date(endIso).getTime(),
    };
  });
  const n = items.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlapMs(items[i], items[j])) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }
  const visited = new Array(n).fill(false);
  const components: Appointment[][] = [];
  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const stack = [i];
    visited[i] = true;
    const comp: Appointment[] = [];
    while (stack.length) {
      const u = stack.pop()!;
      comp.push(items[u].appt);
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          stack.push(v);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

function assignColumnsForDay(
  appointments: Appointment[],
  displayRange: (a: Appointment) => { startIso: string; endIso: string }
): PlacedAppt[] {
  const components = buildOverlapComponents(appointments, displayRange);
  const out: PlacedAppt[] = [];
  for (const comp of components) {
    out.push(...assignColumns(comp, displayRange));
  }
  return out;
}

function isAppointmentVisible(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

/** Calendar range vs appointment interval (both ISO UTC). */
function appointmentOverlapsUtcRange(
  startIso: string,
  endIso: string,
  rangeStartUtc: string,
  rangeEndUtc: string
): boolean {
  const s = DateTime.fromISO(startIso, { zone: 'utc' }).toMillis();
  const e = DateTime.fromISO(endIso, { zone: 'utc' }).toMillis();
  const rs = DateTime.fromISO(rangeStartUtc, { zone: 'utc' }).toMillis();
  const re = DateTime.fromISO(rangeEndUtc, { zone: 'utc' }).toMillis();
  if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(rs) || !Number.isFinite(re)) return false;
  return s < re && e > rs;
}

function isCalendarBlockAppointment(a: Appointment): boolean {
  return isPracticeCalendarBlockAppointment(a);
}

/** Room-loader / pre-appt icon: patient visits only — skip blocks, staff notes, all-day, and non-patient rows. */
function showPreApptRoomLoaderIcon(a: Appointment): boolean {
  if (a.allDay) return false;
  if (isCalendarBlockAppointment(a)) return false;
  if (patientsForAppointment(a).length === 0) return false;
  const typeLabel = [a.appointmentType?.prettyName, a.appointmentType?.name].filter(Boolean).join(' ');
  if (typeLabel.toLowerCase().includes('note to staff')) return false;
  return true;
}

const PRE_APPT_STATUS_COLOR: Record<RoomLoaderPreApptUiStatus, string> = {
  none: '#dc2626',
  sent: '#ffc72c',
  complete: '#16a34a',
};

function resolveSchedulerRlStatus(
  confirmStatusName: string | null | undefined,
  scoutUiStatus?: RoomLoaderPreApptUiStatus | null
): RoomLoaderPreApptUiStatus {
  return preferRoomLoaderPreApptStatus(
    roomLoaderPreApptUiStatus(confirmStatusName),
    scoutUiStatus ?? 'none'
  );
}

function SchedulerPreApptRlIcon({
  confirmStatusName,
  scoutUiStatus,
}: {
  confirmStatusName?: string | null;
  scoutUiStatus?: RoomLoaderPreApptUiStatus | null;
}) {
  const st = resolveSchedulerRlStatus(confirmStatusName, scoutUiStatus);
  const title =
    st === 'complete'
      ? 'Room loader / pre-appt: client submitted form (completed)'
      : st === 'sent'
        ? 'Room loader / pre-appt: email sent'
        : 'Room loader / pre-appt: not sent';
  return (
    <span
      className={[
        'scheduler-preappt-rl-icon',
        st === 'sent' ? 'scheduler-preappt-rl-icon--sent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={title}
      aria-hidden
      style={{ backgroundColor: PRE_APPT_STATUS_COLOR[st] }}
    >
      RL
    </span>
  );
}

/** Matches ScheduleLayout mobile breakpoint (rail stacks at 900px). */
function isSchedulerMobileViewport(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
}

/** Practice calendar default — day on mobile, week on desktop. */
function defaultSchedulerCalendarView(): ViewMode {
  return isSchedulerMobileViewport() ? 'day' : 'week';
}

/** Initial view for the practice calendar (not routing embed). Mobile always starts on day. */
function initialPracticeCalendarView(handoffView?: ViewMode): ViewMode {
  if (isSchedulerMobileViewport()) return 'day';
  return handoffView ?? 'week';
}

function initialSchedulerCalendarState(embedInRoutingWorkspace: boolean): {
  anchorDate: string;
  view: ViewMode;
  providerFilter: string;
} {
  const today = DateTime.now().setZone(PRACTICE_TZ).toISODate()!;

  if (embedInRoutingWorkspace) {
    const preview = readRoutingCalendarPreview();
    if (preview?.option?.date) {
      return {
        anchorDate: String(preview.option.date),
        view: 'week',
        providerFilter: preview.option.doctorPimsId ? String(preview.option.doctorPimsId) : '',
      };
    }
    const intent = readRoutingRescheduleIntent();
    if (intent?.practiceDateKey?.trim()) {
      const handoff = readSchedulerCalendarHandoff();
      const providerFromIntent =
        intent.sourceProviderInternalId?.trim() || intent.primaryProviderInternalId?.trim();
      const providerFromHandoff = handoff?.providerFilter?.trim();
      return {
        anchorDate: intent.practiceDateKey.trim(),
        view: 'week',
        providerFilter: providerFromIntent || providerFromHandoff || '',
      };
    }
  }

  const handoff = readSchedulerCalendarHandoff();
  if (handoff) {
    return {
      anchorDate: handoff.anchorDate,
      view: initialPracticeCalendarView(handoff.view),
      providerFilter: handoff.providerFilter ?? '',
    };
  }

  return { anchorDate: today, view: initialPracticeCalendarView(), providerFilter: '' };
}

type SchedulerMountState = {
  anchorDate: string;
  view: ViewMode;
  providerFilter: string;
  focusRequest: SchedulerFocusRequest | null;
};

function readSchedulerMountState(embedInRoutingWorkspace: boolean): SchedulerMountState {
  const today = DateTime.now().setZone(PRACTICE_TZ).toISODate()!;
  if (embedInRoutingWorkspace) {
    const base = initialSchedulerCalendarState(true);
    return { ...base, focusRequest: null };
  }
  const search = typeof window !== 'undefined' ? window.location.search : '';
  const focusRequest = readSchedulerFocusRequest(search, PRACTICE_TZ);
  if (focusRequest) {
    return {
      anchorDate: focusRequest.dateHint ?? today,
      view: defaultSchedulerCalendarView(),
      providerFilter: focusRequest.providerHint ?? '',
      focusRequest,
    };
  }
  const base = initialSchedulerCalendarState(false);
  return { ...base, focusRequest: null };
}

export default function Scheduler({ embedInRoutingWorkspace = false }: SchedulerProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mountState = useMemo(
    () => readSchedulerMountState(embedInRoutingWorkspace),
    [embedInRoutingWorkspace]
  );
  const [view, setView] = useState<ViewMode>(() => mountState.view);
  const [anchorDate, setAnchorDate] = useState(() => mountState.anchorDate);
  const [providerFilter, setProviderFilter] = useState<string>(() => mountState.providerFilter);
  const [typeFilter, setTypeFilter] = useState<string>('');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoadState, setProvidersLoadState] = useState<'pending' | 'resolved'>('pending');
  const [providerGoals, setProviderGoals] = useState<EmployeeGoalsResponseDto | null>(null);
  const [providerWeeklySchedules, setProviderWeeklySchedules] = useState<
    EmployeeWeeklySchedule[] | null
  >(null);
  const [typeList, setTypeList] = useState<AppointmentType[]>([]);
  const typeCatalog = useMemo(() => buildAppointmentTypeCatalog(typeList), [typeList]);
  const holdAppointmentTypes = useMemo(
    () => typeList.filter((t) => t.isHold === true),
    [typeList]
  );
  /** After "Explore alternatives" books a second appointment, offer to keep both on hold. */
  const [exploreHoldPrompt, setExploreHoldPrompt] = useState<{
    newAppointmentId: number;
    sourceNeedsHold: boolean;
    newNeedsHold: boolean;
    nonHoldAppointmentIds: number[];
    sourceAppointmentIds: number[];
  } | null>(null);
  const [convertingExploreHold, setConvertingExploreHold] = useState(false);
  const [exploreHoldConvertError, setExploreHoldConvertError] = useState<string | null>(null);
  const [optimizeSmsPrompt, setOptimizeSmsPrompt] = useState<{
    kind: ScheduleOptimizeSmsKind;
    clientId: number;
    client: string;
    petNames: string[];
    fromDate: string;
    toDate: string;
    fromTimeLabel: string;
    toTimeLabel: string;
    fromWindowLabel: string | null;
    toWindowLabel: string | null;
    originalStartIso: string;
    newStartIso: string;
    doctorName: string;
    queueItemId: string | null;
  } | null>(null);
  const [optimizeSmsFromLine, setOptimizeSmsFromLine] = useState<string | null>(null);
  const [optimizePreviewListTick, setOptimizePreviewListTick] = useState(0);
  const [manualBookableTypeIds, setManualBookableTypeIds] = useState<number[] | null>(null);
  const [rawAppointments, setRawAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  /** After the first in-flight range fetch, keep the calendar mounted so outlet scroll is not reset on prev/next week. */
  const appointmentRangeBlockingLoadDone = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const [modalAppt, setModalAppt] = useState<Appointment | null>(null);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);
  const [editTimePreview, setEditTimePreview] = useState<EditVisitTimePreview | null>(null);
  const [editPlacementMode, setEditPlacementMode] = useState(false);
  const [editSidebarMountEl, setEditSidebarMountEl] = useState<HTMLDivElement | null>(null);
  const editSidebarMountRef = useCallback((node: HTMLDivElement | null) => {
    setEditSidebarMountEl(node);
  }, []);
  const editVisitModalRef = useRef<SchedulerEditVisitModalHandle>(null);
  const editVisitFormSnapshotRef = useRef<{
    appointmentId: number;
    snapshot: EditVisitFormSnapshot;
  } | null>(null);
  const [editVisitLinkSelection, setEditVisitLinkSelection] = useState<EditVisitLinkSelection | null>(null);
  const [editVisitPatientSelection, setEditVisitPatientSelection] =
    useState<EditVisitPatientSelection | null>(null);
  const [editPreviewScoreCompare, setEditPreviewScoreCompare] =
    useState<EditVisitPreviewScoreCompare | null>(null);
  const [editPreviewScoreLoading, setEditPreviewScoreLoading] = useState(false);
  const [editPreviewScoreError, setEditPreviewScoreError] = useState<string | null>(null);
  const [editPreviewConfirming, setEditPreviewConfirming] = useState(false);
  const [editTimeAlignPrompt, setEditTimeAlignPrompt] = useState<{
    siblings: Appointment[];
    startIso: string;
    endIso: string;
  } | null>(null);
  const editTimeAlignChoiceRef = useRef<HouseholdTimeAlignChoice | null>(null);
  const [staffConfirmPreview, setStaffConfirmPreview] =
    useState<AppointmentRequestStaffConfirmSessionV1 | null>(null);
  const [staffConfirmPreviewConfirming, setStaffConfirmPreviewConfirming] = useState(false);
  const [staffConfirmPreviewError, setStaffConfirmPreviewError] = useState<string | null>(null);
  const [staffConfirmEditing, setStaffConfirmEditing] = useState(false);
  const [staffConfirmEditingApptId, setStaffConfirmEditingApptId] = useState<number | null>(
    null,
  );
  const [staffConfirmRequestData, setStaffConfirmRequestData] = useState<
    Record<string, unknown> | null
  >(null);
  const [staffConfirmRequestDataReady, setStaffConfirmRequestDataReady] = useState(false);
  const [staffConfirmLinkSelection, setStaffConfirmLinkSelection] =
    useState<EditVisitLinkSelection | null>(null);
  const [onHoldVisitPreview, setOnHoldVisitPreview] =
    useState<OnHoldVisitEditSessionV1 | null>(null);
  const [onHoldVisitRemoveConfirming, setOnHoldVisitRemoveConfirming] = useState(false);
  const [onHoldVisitRemoveError, setOnHoldVisitRemoveError] = useState<string | null>(null);
  const [slotOfferReviewPreview, setSlotOfferReviewPreview] =
    useState<SlotOfferReviewSessionV1 | null>(null);
  const [slotOfferReviewConfirming, setSlotOfferReviewConfirming] = useState(false);
  const [slotOfferReviewError, setSlotOfferReviewError] = useState<string | null>(null);
  const [notBookedRemoveGate, setNotBookedRemoveGate] =
    useState<NotBookedRemoveSessionV1 | null>(null);
  const [onHoldVisitConvertedExitKind, setOnHoldVisitConvertedExitKind] =
    useState<Extract<HouseholdHoldExitKind, 'booked' | 'removed'> | null>(null);
  const [onHoldVisitEditing, setOnHoldVisitEditing] = useState(false);
  const [onHoldVisitEditingApptId, setOnHoldVisitEditingApptId] = useState<number | null>(null);
  const [onHoldVisitLinkSelection, setOnHoldVisitLinkSelection] =
    useState<EditVisitLinkSelection | null>(null);
  const [onHoldVisitRequestData, setOnHoldVisitRequestData] = useState<
    Record<string, unknown> | null
  >(null);
  const [editVisitHighlightIds, setEditVisitHighlightIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [pendingFocusApptId, setPendingFocusApptId] = useState<number | null>(
    () => mountState.focusRequest?.appointmentId ?? null
  );
  const [pendingFocusHighlightApptId, setPendingFocusHighlightApptId] = useState<number | null>(
    () =>
      mountState.focusRequest?.dateHint?.trim()
        ? mountState.focusRequest.appointmentId
        : null
  );
  const calendarFocusActiveRef = useRef(Boolean(mountState.focusRequest));
  const pendingFocusDateHintRef = useRef<string | null>(mountState.focusRequest?.dateHint ?? null);
  const pendingFocusProviderHintRef = useRef<string | null>(
    mountState.focusRequest?.providerHint ?? null
  );
  const editVisitHighlightTimerRef = useRef<number | null>(null);
  const editVisitHighlightDurationMsRef = useRef(2600);
  const householdVisitHighlightPinnedRef = useRef(false);
  const editVisitPostBookScrollSigRef = useRef<string>('');
  const staffConfirmTypesAppliedRef = useRef<string | null>(null);
  const [schedulerFocusReturnTick, setSchedulerFocusReturnTick] = useState(0);
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false);
  useEffect(() => {
    if (!optimizeSmsPrompt) return;
    void fetchSchedulingOutreachSmsFrom().then((phone) => {
      if (phone) setOptimizeSmsFromLine(phone);
    });
  }, [optimizeSmsPrompt]);
  useEffect(() => {
    const sync = () => setSchedulerFocusReturnTick((n) => n + 1);
    window.addEventListener(SCHEDULER_FOCUS_RETURN_UPDATED_EVENT, sync);
    return () => window.removeEventListener(SCHEDULER_FOCUS_RETURN_UPDATED_EVENT, sync);
  }, []);
  const schedulerFocusReturnSession = useMemo(
    () => (embedInRoutingWorkspace ? null : readSchedulerFocusReturnSession()),
    [embedInRoutingWorkspace, schedulerFocusReturnTick],
  );
  const returnToGmailFromSchedulerFocus = useCallback(() => {
    if (returnFromSchedulerFocusToGmail(navigate)) {
      setSchedulerFocusReturnTick((n) => n + 1);
    }
  }, [navigate]);
  const returnToOptimizeFromCurrentView = useCallback(() => {
    const result = returnFromSchedulerFocusToOptimize(navigate);
    setEditVisitHighlightIds(new Set());
    setSchedulerFocusReturnTick((n) => n + 1);
    if (result === 'modal') setOptimizeModalOpen(true);
  }, [navigate]);
  const dismissSchedulerFocusReturn = useCallback(() => {
    clearSchedulerFocusReturnSession();
    setEditVisitHighlightIds(new Set());
    setSchedulerFocusReturnTick((n) => n + 1);
  }, []);
  const openOptimizedAppointmentFromCurrentView = useCallback(async () => {
    const opt = readSchedulerFocusReturnSession()?.returnToOptimize;
    const move = opt?.move;
    const doctorId = opt?.doctorId?.trim();
    const queueItemId = opt?.queueItemId?.trim();
    if (!move || !doctorId || !queueItemId) {
      setToast('Could not open the optimized time for this visit.');
      return;
    }
    const result = await beginScheduleOptimizeApplyInCalendar({
      move,
      doctorId,
      doctorName: opt.doctorName?.trim() || 'Provider',
      practiceId: opt.practiceId ?? PRACTICE_ID,
      practiceTz: PRACTICE_TZ,
      navigate,
      returnPath: opt.returnHref || '/schedule/scheduler',
      queueItemId,
      fromCurrentView: true,
    });
    if (!result.ok) {
      setToast(result.reason);
    }
  }, [navigate]);
  useLayoutEffect(() => {
    if (!editPlacementMode || embedInRoutingWorkspace) {
      setEditSidebarMountEl(null);
    }
  }, [editPlacementMode, embedInRoutingWorkspace]);

  /** Practice calendar only: inline sidebar during View Placement. Routing workspace uses body modal like View appointment. */
  const editVisitInlinePaneMode = Boolean(
    editPlacementMode && !embedInRoutingWorkspace && editSidebarMountEl
  );
  const [contextMenu, setContextMenu] = useState<{ appt: Appointment; x: number; y: number } | null>(
    null
  );
  const [actualVisitModal, setActualVisitModal] = useState<Appointment | null>(null);
  const [removeVisitModal, setRemoveVisitModal] = useState<Appointment | null>(null);
  const [onMyWaySmsAppt, setOnMyWaySmsAppt] = useState<Appointment | null>(null);
  const [embeddedRoomLoaderId, setEmbeddedRoomLoaderId] = useState<number | null>(null);
  const [roomLoaderPdfModalAppt, setRoomLoaderPdfModalAppt] = useState<Appointment | null>(null);
  /** Scout room-loader sentStatus → RL badge color when PIMS confirmStatusName lags behind. */
  const [roomLoaderStatusByApptId, setRoomLoaderStatusByApptId] = useState<
    Map<number, RoomLoaderPreApptUiStatus>
  >(() => new Map());
  const [workZonesMapOpen, setWorkZonesMapOpen] = useState(false);
  const [roomLoaderOpening, setRoomLoaderOpening] = useState(false);
  /** null = not applicable or loading; true = at least one pet can be added; false = none left */
  const [addAnotherPetMenuReady, setAddAnotherPetMenuReady] = useState<boolean | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastDismissMsRef = useRef(6000);
  const [calendarBlockedNotice, setCalendarBlockedNotice] = useState<string | null>(null);
  /** YYYY-MM-DD of the day column while its My Day — Visual PDF is generating. */
  const [practicePdfExportingKey, setPracticePdfExportingKey] = useState<string | null>(null);
  /** When true and a single provider is selected, timed events use ETA/ETD from /appointments/doctor + /routing/eta (same as My Week). */
  const [showByDriveTime, setShowByDriveTime] = useState(true);
  const [driveIsoByApptId, setDriveIsoByApptId] = useState<Map<string, DriveIsoPair> | null>(null);
  const [driveDayByDate, setDriveDayByDate] = useState<Map<string, DayData> | null>(null);
  const [driveEtaLoading, setDriveEtaLoading] = useState(false);
  /** From GET /appointments/doctor — range payload often omits `isMember` / `membershipName`. */
  const [doctorDayMembershipByApptId, setDoctorDayMembershipByApptId] = useState<
    Map<string, SchedulerDoctorDayMembership>
  >(() => new Map());
  /** From GET /appointments/doctor — range payload often omits `clientZone` / `effectiveZone`. */
  const [doctorDayZonesByApptId, setDoctorDayZonesByApptId] = useState<
    Map<string, SchedulerDoctorDayAppointmentZones>
  >(() => new Map());
  const [doctorDayPatientPcpByApptId, setDoctorDayPatientPcpByApptId] = useState<
    Map<string, DoctorDayPatientPrimaryProvider | null>
  >(() => new Map());
  /** From GET /appointments/doctor — range payload often omits `effectiveWindow`. */
  const [doctorDayEffectiveWindowByApptId, setDoctorDayEffectiveWindowByApptId] = useState<
    Map<string, SchedulerDoctorDayEffectiveWindow>
  >(() => new Map());
  /** From GET /appointments/doctor — range payload often omits `isComplete`. */
  const [doctorDayIsCompleteByApptId, setDoctorDayIsCompleteByApptId] = useState<Map<string, boolean>>(
    () => new Map()
  );
  const [scheduleOverridesByDate, setScheduleOverridesByDate] = useState<
    Map<string, ScheduleOverride>
  >(() => new Map());
  /** Bump after mutations that change route order so drive/ETA refetches (avoids tying drive load to every `rawAppointments` refresh). */
  const [driveRefreshNonce, setDriveRefreshNonce] = useState(0);
  const [scheduleOverrideModal, setScheduleOverrideModal] = useState<{
    open: boolean;
    date?: string;
  }>({ open: false });
  const [reconcileModal, setReconcileModal] = useState<{
    open: boolean;
    date?: string;
  }>({ open: false });
  const [workdayActualsByDate, setWorkdayActualsByDate] = useState<
    Map<string, EmployeeWorkdayActual>
  >(() => new Map());
  /** When set before a drive refresh, maps are not cleared and the drive overlay is skipped (realtime soft update). */
  const driveSoftRefreshRef = useRef(false);
  const [bookSlot, setBookSlot] = useState<SchedulerBookSlot | null>(null);
  const [bookPrefill, setBookPrefill] = useState<SchedulerBookPrefill | null>(null);
  /** Routing → My Week: proposed slot until booked or dismissed. */
  const [routingPreview, setRoutingPreview] = useState<RoutingCalendarPreviewPayloadV1 | null>(null);
  const [routingPreviewClientContact, setRoutingPreviewClientContact] =
    useState<PreviewPopoverClientContact | null>(null);
  /** Bumped when session reschedule intent changes (scope, clear, new visit). */
  const [rescheduleIntentTick, setRescheduleIntentTick] = useState(0);
  /** Bumped when source-doctor placement score is cached for cross-provider compare. */
  const [rescheduleSourceScoreTick, setRescheduleSourceScoreTick] = useState(0);
  const [hover, setHover] = useState<{
    appt: Appointment;
    x: number;
    y: number;
    el: HTMLElement | null;
    /** Freeze timed-grid bar placement while Visit Highlights is open (ETA reflow won't yank the chip). */
    pinnedRange?: { startIso: string; endIso: string };
  } | null>(null);

  const [driveHoverCard, setDriveHoverCard] = useState<{
    segmentKey: string;
    x: number;
    y: number;
    heading: string;
    body: string;
    extraLine?: string | null;
  } | null>(null);

  const hoverRevealTimerRef = useRef<number | null>(null);
  const hoverDismissTimerRef = useRef<number | null>(null);
  const hoverPinnedRef = useRef(false);
  const hoverRevealPendingRef = useRef<{
    appt: Appointment;
    el: HTMLElement;
    x: number;
    y: number;
  } | null>(null);
  const hoverTooltipRef = useRef<HTMLDivElement>(null);
  const suppressHoverScrollDismissRef = useRef(false);
  const [hoverTooltipLayout, setHoverTooltipLayout] = useState<{
    pos: HoverPopoverPositionResult;
    ready: boolean;
  } | null>(null);

  const cancelHoverDismiss = useCallback(() => {
    if (hoverDismissTimerRef.current != null) {
      clearTimeout(hoverDismissTimerRef.current);
      hoverDismissTimerRef.current = null;
    }
  }, []);

  const cancelScheduledHoverPopover = useCallback(() => {
    if (hoverRevealTimerRef.current != null) {
      clearTimeout(hoverRevealTimerRef.current);
      hoverRevealTimerRef.current = null;
    }
    hoverRevealPendingRef.current = null;
  }, []);

  const dismissHoverPopover = useCallback(() => {
    cancelScheduledHoverPopover();
    cancelHoverDismiss();
    hoverPinnedRef.current = false;
    setHover(null);
    setHoverTooltipLayout(null);
  }, [cancelScheduledHoverPopover, cancelHoverDismiss]);

  const scheduleHoverDismiss = useCallback(
    (apptId?: string | number) => {
      cancelHoverDismiss();
      hoverDismissTimerRef.current = window.setTimeout(() => {
        hoverDismissTimerRef.current = null;
        if (hoverPinnedRef.current) return;
        setHover((prev) => {
          if (apptId == null) return null;
          return prev?.appt.id === apptId ? null : prev;
        });
        setHoverTooltipLayout((prev) => (prev ? null : prev));
      }, SCHEDULER_HOVER_DISMISS_MS);
    },
    [cancelHoverDismiss]
  );

  const armHoverPopover = useCallback(
    (appt: Appointment, ev: MouseEvent<HTMLElement>) => {
      if (staffCalendarDragRef.current) return;
      cancelScheduledHoverPopover();
      cancelHoverDismiss();
      hoverPinnedRef.current = false;
      const el = ev.currentTarget;
      hoverRevealPendingRef.current = {
        appt,
        el,
        x: ev.clientX,
        y: ev.clientY,
      };
      hoverRevealTimerRef.current = window.setTimeout(() => {
        hoverRevealTimerRef.current = null;
        const pending = hoverRevealPendingRef.current;
        hoverRevealPendingRef.current = null;
        if (!pending) return;
        setHover({
          appt: pending.appt,
          x: pending.x,
          y: pending.y,
          el: pending.el,
        });
      }, SCHEDULER_HOVER_POPOVER_DELAY_MS);
    },
    [cancelScheduledHoverPopover, cancelHoverDismiss]
  );

  const trackHoverPopoverMove = useCallback((appt: Appointment, ev: MouseEvent<HTMLElement>) => {
    const p = hoverRevealPendingRef.current;
    if (p && p.appt.id === appt.id) {
      p.x = ev.clientX;
      p.y = ev.clientY;
      p.el = ev.currentTarget;
    }
    /** Once the popover is visible, ignore mousemove — placement stays tied to the appointment chip. */
  }, []);

  const endHoverPopoverForAppt = useCallback(
    (apptId: string | number) => {
      cancelScheduledHoverPopover();
      scheduleHoverDismiss(apptId);
    },
    [cancelScheduledHoverPopover, scheduleHoverDismiss]
  );

  useEffect(
    () => () => {
      cancelScheduledHoverPopover();
      cancelHoverDismiss();
    },
    [cancelScheduledHoverPopover, cancelHoverDismiss]
  );

  /** Close Visit Highlights when clicking elsewhere, scrolling, or pressing Escape. */
  useEffect(() => {
    if (!hover) return;

    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (hoverTooltipRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-schedule-preview-allow]')) return;
      const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
      if (anchorEl?.contains(target)) return;
      dismissHoverPopover();
    };

    const onScroll = () => {
      if (suppressHoverScrollDismissRef.current) return;
      dismissHoverPopover();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismissHoverPopover();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [hover, dismissHoverPopover]);

  /** Range rows may omit alternate text while `isAlternateStop` is set — hydrate from GET /appointments/:id on hover. */
  useEffect(() => {
    const appt = hover?.appt;
    if (!appt?.id || appt.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID) return;
    if (!appointmentHasAlternateLocation(appt) || appointmentAlternateAddressText(appt)) return;

    let cancelled = false;
    void fetchAppointmentById(appt.id, { practiceId: PRACTICE_ID }).then((full) => {
      if (cancelled || !full) return;
      const text = appointmentAlternateAddressText(full);
      if (!text) return;
      const patch = {
        alternateAddress: { addressText: text },
        alternateAddressText: text,
        isAlternateStop: true,
      } as const;
      setHover((prev) =>
        prev?.appt.id === appt.id ? { ...prev, appt: { ...prev.appt, ...patch } } : prev
      );
      setRawAppointments((prev) => {
        const idx = prev.findIndex((a) => a.id === appt.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [hover?.appt?.id, hover?.appt]);

  /** Persist-clear a stale ALT that matches the linked client's home (badge already hidden). */
  useEffect(() => {
    const appt = hover?.appt;
    if (!appt?.id || appt.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID) return;
    if (!appointmentAlternateMatchesClientHome(appt)) return;

    let cancelled = false;
    void putAppointmentAlternateAddress(appt.id, { addressText: '' })
      .then(() => {
        if (cancelled) return;
        const cleared = appointmentWithoutAlternateRoutingAddress(appt);
        setHover((prev) =>
          prev?.appt.id === appt.id ? { ...prev, appt: { ...prev.appt, ...cleared } } : prev
        );
        setRawAppointments((prev) => {
          const idx = prev.findIndex((a) => a.id === appt.id);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], ...cleared };
          return next;
        });
      })
      .catch(() => {
        /* non-fatal — UI already treats matching ALT as home */
      });
    return () => {
      cancelled = true;
    };
  }, [
    hover?.appt?.id,
    hover?.appt ? appointmentAlternateAddressText(hover.appt) : null,
    hover?.appt?.client?.id,
  ]);

  /** Range rows may omit patient sex — hydrate from GET /appointments/:id on hover. */
  useEffect(() => {
    const appt = hover?.appt;
    if (!appt?.id || appt.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID) return;
    const pts = patientsForAppointment(appt);
    if (pts.length === 0) return;
    if (!pts.some((p) => !patientSexAbbrevDisplay(p))) return;

    let cancelled = false;
    void (async () => {
      let full: Appointment = appt;
      if (!patientsForAppointment(full).some((p) => patientSexAbbrevDisplay(p))) {
        full = await enrichAppointmentPatientProfiles(full);
      }
      if (!patientsForAppointment(full).some((p) => patientSexAbbrevDisplay(p))) {
        const fetched = await fetchAppointmentById(appt.id, { practiceId: PRACTICE_ID });
        if (cancelled || !fetched) return;
        full = await enrichAppointmentPatientProfiles(fetched);
      }

      const hydratedPts = patientsForAppointment(full);
      if (!hydratedPts.some((p) => patientSexAbbrevDisplay(p))) return;
      setHover((prev) =>
        prev?.appt.id === appt.id ? { ...prev, appt: full! } : prev
      );
      setRawAppointments((prev) => {
        const idx = prev.findIndex((a) => a.id === appt.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = full!;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [hover?.appt?.id, hover?.appt]);

  /** Practice-local "now" for the current-time indicator on the grid (updates on an interval). */
  const [practiceClock, setPracticeClock] = useState(() => DateTime.now().setZone(PRACTICE_TZ));
  const [forwardBookingSourceAppointmentIds, setForwardBookingSourceAppointmentIds] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const [forwardBookingSavedPatientIds, setForwardBookingSavedPatientIds] = useState<
    ReadonlySet<number>
  >(() => new Set());

  const refreshForwardBookingSourceIds = useCallback(async () => {
    try {
      const index = await fetchForwardBookingCalendarIndex(PRACTICE_ID);
      const sets = buildForwardBookingCalendarIndexSets(index);
      setForwardBookingSourceAppointmentIds(sets.sourceAppointmentIds);
      setForwardBookingSavedPatientIds(sets.patientIds);
    } catch {
      /* keep prior set */
    }
  }, []);

  const {
    token: authToken,
    doctorId: authDoctorId,
    employeeId: authEmployeeId,
    userEmail: authUserEmail,
    role,
    assignedDoctorIds: authAssignedDoctorIds,
  } = useAuth() as {
    token: string | null;
    doctorId: string | null;
    employeeId?: string | null;
    userEmail?: string | null;
    role?: string | string[];
    assignedDoctorIds?: string[];
  };

  const appointmentChangeActor = useMemo(
    () =>
      resolveAppointmentChangeActorFromAuth({
        token: authToken,
        userEmail: authUserEmail,
        doctorId: authDoctorId,
        providers,
      }),
    [authToken, authUserEmail, authDoctorId, providers]
  );

  const scheduleOptimizeSavingsActor = useMemo(
    () =>
      scheduleOptimizeSavingsStaff({
        staffName: formatEmployeeFirstNameLastInitial(appointmentChangeActor),
        staffKey: authUserEmail,
      }),
    [appointmentChangeActor, authUserEmail]
  );

  const rolesLower = useMemo(() => {
    const arr = Array.isArray(role) ? role : role != null ? [role] : [];
    return arr.map((r) => String(r).toLowerCase().trim()).filter(Boolean);
  }, [role]);
  const isAdminOrSuper = useMemo(() => rolesIncludeAdminBypass(rolesLower), [rolesLower]);
  const canManualBookOnCalendar = useMemo(() => {
    if (isAdminOrSuper) return true;
    return rolesLower.includes('employee');
  }, [rolesLower, isAdminOrSuper]);
  const canDragCalendarOnlyStaffItems = canManualBookOnCalendar;
  const [staffCalendarDrag, setStaffCalendarDrag] = useState<StaffCalendarDragState | null>(null);
  const staffCalendarDragRef = useRef<StaffCalendarDragState | null>(null);
  const staffCalendarDragMovedRef = useRef(false);
  const staffCalendarDragSavingRef = useRef(false);
  const canManageScheduleOverrides = isAdminOrSuper;
  const manualBookingAppointmentTypes = useMemo(() => {
    if (isAdminOrSuper) return typeList;
    if (manualBookableTypeIds === null) return [];
    return filterAppointmentTypesByIds(typeList, manualBookableTypeIds);
  }, [isAdminOrSuper, typeList, manualBookableTypeIds]);
  const bookModalAppointmentTypes = useMemo(() => {
    if (isSchedulerRoutingBookPrefill(bookPrefill)) return typeList;
    return manualBookingAppointmentTypes;
  }, [bookPrefill, typeList, manualBookingAppointmentTypes]);
  /** Edit visit — full active catalog (not limited to role manual-book permissions). */
  const editModalAppointmentTypes = useMemo((): AppointmentType[] => {
    const cur = editAppt?.appointmentType;
    if (!cur?.id || typeList.some((t) => t.id === cur.id)) return typeList;
    const archived: AppointmentType = {
      id: cur.id,
      name: cur.name,
      prettyName: cur.prettyName ?? cur.name,
      showInApptRequestForm: cur.showInApptRequestForm ?? false,
      newPatientAllowed: cur.newPatientAllowed ?? true,
      isBoardingType: cur.isBoardingType ?? false,
      hasExtraInstructions: cur.hasExtraInstructions ?? false,
      defaultDuration: typeof cur.defaultDuration === 'number' ? cur.defaultDuration : 30,
      defaultStartTime: 'PT0S',
      isActive: cur.isActive,
      isDeleted: cur.isDeleted,
      pimsId: String(cur.pimsId ?? ''),
      pimsType: cur.pimsType ?? 'EVET',
    };
    return [...typeList, archived];
  }, [typeList, editAppt?.appointmentType]);
  const showEmployeeAddCoVisitPet = useMemo(
    () =>
      rolesLower.includes('employee') ||
      rolesLower.includes('admin') ||
      rolesLower.includes('superadmin'),
    [rolesLower]
  );

  useEffect(() => {
    if (!contextMenu) {
      setAddAnotherPetMenuReady(null);
      return;
    }
    const appt = contextMenu.appt;
    if (!showEmployeeAddCoVisitPet || !appointmentSupportsAddPet(appt)) {
      setAddAnotherPetMenuReady(null);
      return;
    }
    const clientId = appt.client!.id;
    const exclude = excludePatientIdsForAddPet(appt, rawAppointments, PRACTICE_TZ);
    let cancelled = false;
    setAddAnotherPetMenuReady(null);
    (async () => {
      try {
        const payload = await fetchClientByIdStaff(String(clientId));
        if (cancelled) return;
        const pets = activeClientPetsFromPayload(payload);
        setAddAnotherPetMenuReady(hasAddPetChoices(pets, exclude));
      } catch {
        if (!cancelled) setAddAnotherPetMenuReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [contextMenu, showEmployeeAddCoVisitPet, rawAppointments]);

  const applyRoutingCalendarPreviewFromStorage = useCallback(() => {
    const p = readRoutingCalendarPreview();
    if (!p?.option?.suggestedStartIso || !p.option.doctorPimsId || !p.option.date) {
      if (p) clearRoutingCalendarPreview();
      setRoutingPreview(null);
      return;
    }
    setRoutingPreview(p);
    setProviderFilter(String(p.option.doctorPimsId));
    setAnchorDate(String(p.option.date));
    setView('week');
    setShowByDriveTime(true);
  }, []);

  useEffect(() => {
    if (searchParams.get('routingPreview') !== '1') return;
    applyRoutingCalendarPreviewFromStorage();
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, applyRoutingCalendarPreviewFromStorage]);

  useEffect(() => {
    const onPreview = () => {
      applyRoutingCalendarPreviewFromStorage();
    };
    window.addEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, onPreview);
    return () => window.removeEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, onPreview);
  }, [applyRoutingCalendarPreviewFromStorage]);

  /** Restore a leftover preview even without `?routingPreview=1` (refresh / stripped query). */
  useEffect(() => {
    if (readRoutingCalendarPreview()) {
      applyRoutingCalendarPreviewFromStorage();
    }
  }, [applyRoutingCalendarPreviewFromStorage]);

  const applyRescheduleCalendarFocusFromIntent = useCallback(() => {
    const intent = readRoutingRescheduleIntent();
    if (!intent) return;
    const focus = rescheduleCalendarFocusFromIntent(intent, providers);
    if (!focus) return;
    setAnchorDate(focus.anchorDate);
    setView(focus.viewMode);
    if (focus.providerFilter) setProviderFilter(focus.providerFilter);
    setShowByDriveTime(true);
  }, [providers]);

  /** Reschedule from calendar → keep source visit week/doctor until a placement preview opens. */
  useEffect(() => {
    if (!embedInRoutingWorkspace) return;
    const onRescheduleIntent = () => {
      if (!readRoutingCalendarPreview()) {
        applyRescheduleCalendarFocusFromIntent();
      }
      setRescheduleIntentTick((n) => n + 1);
    };
    onRescheduleIntent();
    window.addEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, onRescheduleIntent);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, onRescheduleIntent);
  }, [embedInRoutingWorkspace, applyRescheduleCalendarFocusFromIntent]);

  useEffect(() => {
    const onSourceScore = () => setRescheduleSourceScoreTick((n) => n + 1);
    window.addEventListener(ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT, onSourceScore);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT, onSourceScore);
  }, []);

  useEffect(() => {
    if (!embedInRoutingWorkspace || providersLoadState !== 'resolved') return;
    if (readRoutingCalendarPreview()) return;
    applyRescheduleCalendarFocusFromIntent();
  }, [embedInRoutingWorkspace, providersLoadState, applyRescheduleCalendarFocusFromIntent]);

  /** Routing preview only supports week/day — leave month if preview opens while on month. */
  useEffect(() => {
    if (routingPreview && view === 'month') setView('week');
  }, [routingPreview, view]);

  /** My Day → Practice calendar: `?fromMyDay=1&date=YYYY-MM-DD&provider=<id>` (provider optional). */
  useEffect(() => {
    if (searchParams.get('fromMyDay') !== '1') return;
    const dateQ = searchParams.get('date');
    const providerQ = (searchParams.get('provider') ?? '').trim();
    const d =
      dateQ && DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).isValid
        ? DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).toISODate()!
        : null;
    if (d) setAnchorDate(d);
    if (providersLoadState !== 'resolved') return;

    const next = new URLSearchParams(searchParams);
    next.delete('fromMyDay');
    next.delete('date');
    next.delete('provider');
    setSearchParams(next, { replace: true });

    if (providerQ && providers.some((p) => String(p.id) === providerQ)) {
      setProviderFilter(providerQ);
    }
  }, [searchParams, providers, providersLoadState, setSearchParams]);

  /** Tasks / deep links: `?focusAppt=<id>` — fetch appointment, jump to date/provider, highlight. */
  useEffect(() => {
    const focusRaw = searchParams.get(SCHEDULER_FOCUS_APPOINTMENT_PARAM);
    if (!focusRaw) return;
    const apptId = Number(focusRaw);
    if (!Number.isFinite(apptId) || apptId <= 0) return;

    calendarFocusActiveRef.current = true;

    const dateQ = searchParams.get(SCHEDULER_FOCUS_DATE_PARAM);
    pendingFocusDateHintRef.current =
      dateQ && DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).isValid
        ? DateTime.fromISO(dateQ, { zone: PRACTICE_TZ }).toISODate()
        : null;
    if (pendingFocusDateHintRef.current) {
      setAnchorDate(pendingFocusDateHintRef.current);
      setView(defaultSchedulerCalendarView());
      setPendingFocusHighlightApptId(apptId);
    }

    const providerQ = (searchParams.get(SCHEDULER_FOCUS_PROVIDER_PARAM) ?? '').trim();
    pendingFocusProviderHintRef.current = providerQ || null;
    if (providerQ && providers.some((p) => String(p.id) === providerQ)) {
      setProviderFilter(providerQ);
    }

    const next = new URLSearchParams(searchParams);
    next.delete(SCHEDULER_FOCUS_APPOINTMENT_PARAM);
    next.delete(SCHEDULER_FOCUS_DATE_PARAM);
    next.delete(SCHEDULER_FOCUS_PROVIDER_PARAM);
    setSearchParams(next, { replace: true });
    setPendingFocusApptId(apptId);
  }, [searchParams, setSearchParams, providers]);

  useEffect(() => {
    if (providersLoadState !== 'resolved') return;
    const providerQ = pendingFocusProviderHintRef.current;
    if (!providerQ) return;
    if (!providers.some((p) => String(p.id) === providerQ)) return;
    setProviderFilter(providerQ);
    pendingFocusProviderHintRef.current = null;
  }, [providers, providersLoadState]);

  /** Calendar always scopes to one primary provider — never "(Show all)". */
  useLayoutEffect(() => {
    if (providers.length === 0) return;
    setProviderFilter((current) => {
      const t = current.trim();
      if (routingPreview && t && providers.some((p) => String(p.id) === t)) return current;

      const ri = readRoutingRescheduleIntent();
      if (ri && embedInRoutingWorkspace && !routingPreview) {
        const focus = rescheduleCalendarFocusFromIntent(ri, providers);
        if (
          focus?.providerFilter &&
          providers.some((p) => String(p.id) === focus.providerFilter)
        ) {
          return focus.providerFilter;
        }
      }

      if (calendarFocusActiveRef.current) {
        if (t && providers.some((p) => String(p.id) === t)) return current;
        const hint = pendingFocusProviderHintRef.current;
        if (hint && providers.some((p) => String(p.id) === hint)) return hint;
      }

      if (t && providers.some((p) => String(p.id) === t)) return current;

      const raw = authDoctorId?.trim();
      if (raw && providers.some((p) => String(p.id) === String(raw))) return String(raw);
      return String(providers[0].id);
    });
  }, [providers, authDoctorId, routingPreview, embedInRoutingWorkspace]);

  /** Stable provider id for range + drive APIs so we do not double-fetch when `providerFilter` syncs from "" to the same doctor. */
  const resolvedPrimaryProviderId = useMemo(() => {
    if (providers.length === 0) return '';
    if (routingPreview) {
      const previewProv = providerFilter.trim();
      if (previewProv && providers.some((p) => String(p.id) === previewProv)) {
        return previewProv;
      }
    }
    if (embedInRoutingWorkspace && !routingPreview) {
      const ri = readRoutingRescheduleIntent();
      if (ri) {
        const focus = rescheduleCalendarFocusFromIntent(ri, providers);
        if (
          focus?.providerFilter &&
          providers.some((p) => String(p.id) === focus.providerFilter)
        ) {
          return focus.providerFilter;
        }
      }
    }
    const t = providerFilter.trim();
    if (t && providers.some((p) => String(p.id) === t)) return t;
    const raw = authDoctorId?.trim();
    if (raw && providers.some((p) => String(p.id) === String(raw))) return String(raw);
    return String(providers[0].id);
  }, [providers, providerFilter, authDoctorId, routingPreview, embedInRoutingWorkspace]);

  const selectedPrimaryProvider = useMemo(
    () => providers.find((p) => String(p.id) === resolvedPrimaryProviderId.trim()) ?? null,
    [providers, resolvedPrimaryProviderId]
  );

  /**
   * Variable VSD/pt: admins always; otherwise when viewing a calendar for a doctor
   * linked on the user row (users.doctorId / assignedDoctorIds) or the user's own
   * employee record (users.employeeId — the doctor themselves).
   */
  const canViewVariableVsd = useMemo(() => {
    if (isAdminOrSuper) return true;
    const authIds = new Set<string>();
    const push = (v: string | null | undefined) => {
      const t = v?.trim();
      if (t) authIds.add(t);
    };
    push(authDoctorId);
    push(authEmployeeId ?? null);
    for (const id of authAssignedDoctorIds ?? []) {
      push(String(id ?? ''));
    }
    if (authIds.size === 0) return false;
    const p = selectedPrimaryProvider;
    if (!p) return false;
    const id = String(p.id ?? '').trim();
    const pims = p.pimsId != null ? String(p.pimsId).trim() : '';
    return (id !== '' && authIds.has(id)) || (pims !== '' && authIds.has(pims));
  }, [
    isAdminOrSuper,
    authDoctorId,
    authEmployeeId,
    authAssignedDoctorIds,
    selectedPrimaryProvider,
  ]);

  /** Provider shown on the embedded routing calendar bar (preview or reschedule source). */
  const embeddedCalendarProviderLabel = useMemo(() => {
    if (!embedInRoutingWorkspace) return null;

    let providerRow = selectedPrimaryProvider;
    if (!providerRow && routingPreview) {
      const previewId = String(routingPreview.option.doctorPimsId ?? '').trim();
      if (previewId) {
        providerRow = providers.find((p) => String(p.id) === previewId) ?? null;
      }
    }
    if (!providerRow) {
      const ri = readRoutingRescheduleIntent();
      const sourceId =
        ri?.sourceProviderInternalId?.trim() || ri?.primaryProviderInternalId?.trim() || '';
      if (sourceId) {
        providerRow = providers.find((p) => String(p.id) === sourceId) ?? null;
      }
    }

    const fallbackName = routingPreview
      ? String(routingPreview.option.doctorName ?? '').trim()
      : readRoutingRescheduleIntent()?.sourceDoctorDisplayName?.trim() ||
        readRoutingRescheduleIntent()?.primaryDoctorDisplayName?.trim() ||
        selectedPrimaryProvider?.name?.trim() ||
        '';

    return embeddedCalendarProviderScheduleLabel(providerRow, fallbackName);
  }, [
    embedInRoutingWorkspace,
    routingPreview,
    rescheduleIntentTick,
    selectedPrimaryProvider,
    providers,
  ]);

  const goalFetchPeriod = useMemo(() => {
    if (!anchorDate) return null;
    const anchor = DateTime.fromISO(anchorDate, { zone: PRACTICE_TZ }).startOf('day');
    if (view === 'day') {
      const d = anchor.toISODate()!;
      return { startDate: d, endDate: d };
    }
    if (view === 'week') {
      const startL = sundayWeekStart(anchor);
      const endL = startL.plus({ days: 6 });
      return { startDate: startL.toISODate()!, endDate: endL.toISODate()! };
    }
    const startL = anchor.startOf('month');
    const endL = startL.endOf('month');
    return { startDate: startL.toISODate()!, endDate: endL.toISODate()! };
  }, [anchorDate, view]);

  useEffect(() => {
    const id = resolvedPrimaryProviderId.trim();
    if (!id) {
      setProviderGoals(null);
      setProviderWeeklySchedules(null);
      return;
    }
    const empId = Number(id);
    if (!Number.isFinite(empId)) {
      setProviderGoals(null);
      setProviderWeeklySchedules(null);
      return;
    }
    let cancelled = false;
    void fetchEmployeeGoals(empId, goalFetchPeriod ?? undefined)
      .then((goals) => {
        if (!cancelled) setProviderGoals(goals);
      })
      .catch(() => {
        if (!cancelled) setProviderGoals(null);
      });
    void fetchEmployee(empId)
      .then((emp) => {
        if (!cancelled) setProviderWeeklySchedules(emp?.weeklySchedules ?? []);
      })
      .catch(() => {
        if (!cancelled) setProviderWeeklySchedules(null);
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedPrimaryProviderId, goalFetchPeriod]);

  const pointGoalForDay = useCallback(
    (dayDt: DateTime): number => {
      const dateStr = dayDt.toISODate()!;
      if (providerGoals) {
        return getGoalForDate(
          providerGoals,
          dateStr,
          goalDayOfWeekFromLuxonWeekday(dayDt.weekday)
        ).pointGoal;
      }
      const fallback = selectedPrimaryProvider?.dailyPointGoal;
      if (fallback != null && Number.isFinite(Number(fallback)) && Number(fallback) > 0) {
        return Number(fallback);
      }
      return 0;
    },
    [providerGoals, selectedPrimaryProvider]
  );

  const revenueGoalForDay = useCallback(
    (dayDt: DateTime): number => {
      const dateStr = dayDt.toISODate()!;
      if (providerGoals) {
        return getGoalForDate(
          providerGoals,
          dateStr,
          goalDayOfWeekFromLuxonWeekday(dayDt.weekday)
        ).revenueGoal;
      }
      const fallback = selectedPrimaryProvider?.dailyRevenueGoal;
      if (fallback != null && Number.isFinite(Number(fallback)) && Number(fallback) > 0) {
        return Number(fallback);
      }
      return 0;
    },
    [providerGoals, selectedPrimaryProvider]
  );

  useEffect(() => {
    const provider = selectedPrimaryProvider;
    const pimsRaw = provider?.pimsId != null ? String(provider.pimsId).trim() : '';
    writeSchedulerCalendarHandoff({
      anchorDate: anchorDate ?? '',
      view,
      providerFilter,
      routingDoctorPimsId: pimsRaw || undefined,
      routingDoctorLabel: provider?.name?.trim() || undefined,
    });
  }, [anchorDate, view, providerFilter, selectedPrimaryProvider]);

  /** Match routing preview doctor to provider list (internal id or PIMS); fall back to employee APIs. */
  useEffect(() => {
    if (!routingPreview?.option) return;
    const raw = String(routingPreview.option.doctorPimsId ?? '').trim();
    if (!raw || providers.length === 0) return;

    if (providers.some((p) => String(p.id) === raw)) {
      setProviderFilter((f) => (f === raw ? f : raw));
      return;
    }
    const byPims = providers.find((p) => p.pimsId != null && String(p.pimsId) === raw);
    if (byPims) {
      const resolved = String(byPims.id);
      setProviderFilter((f) => (f === resolved ? f : resolved));
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let emp: unknown;
        try {
          const { data } = await http.get(`/employees/pims/${encodeURIComponent(raw)}`);
          emp = Array.isArray(data) ? data[0] : data;
        } catch {
          const { data } = await http.get(`/employees/${encodeURIComponent(raw)}`);
          emp = Array.isArray(data) ? data[0] : data;
        }
        if (cancelled || !emp || typeof emp !== 'object') return;
        const e = emp as Record<string, unknown>;
        const internal =
          (e.id != null ? String(e.id) : undefined) ??
          (e.employee && typeof e.employee === 'object' && (e.employee as { id?: unknown }).id != null
            ? String((e.employee as { id?: unknown }).id)
            : undefined);
        const empRec = e.employee && typeof e.employee === 'object' ? (e.employee as Record<string, unknown>) : null;
        const pimsStr =
          e.pimsId != null
            ? String(e.pimsId)
            : empRec?.pimsId != null
              ? String(empRec.pimsId)
              : undefined;
        if (cancelled) return;
        const match =
          internal && providers.some((p) => String(p.id) === internal)
            ? providers.find((p) => String(p.id) === internal)
            : pimsStr
              ? providers.find((p) => p.pimsId != null && String(p.pimsId) === pimsStr)
              : undefined;
        if (match) {
          const resolved = String(match.id);
          setProviderFilter((f) => (f === resolved ? f : resolved));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routingPreview, providers]);

  useEffect(() => {
    const tick = () => setPracticeClock(DateTime.now().setZone(PRACTICE_TZ));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const typeFillMap = useMemo(() => buildTypeFillMap(typeList), [typeList]);

  const rangeUtc = useMemo(() => {
    const anchor = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('day');
    let startL: DateTime;
    let endL: DateTime;
    if (view === 'day') {
      startL = anchor;
      endL = anchor.plus({ days: 1 });
    } else if (view === 'week') {
      startL = sundayWeekStart(anchor);
      endL = startL.plus({ days: 7 });
    } else {
      startL = anchor.startOf('month');
      endL = startL.plus({ months: 1 });
    }
    return {
      startUtc: startL.toUTC().toISO()!,
      endUtc: endL.toUTC().toISO()!,
      startLocal: startL,
      endLocalExclusive: endL,
    };
  }, [anchorDate, view]);

  const weekDays = useMemo(() => {
    const start = sundayWeekStart(DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }));
    return Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  }, [anchorDate]);

  const optimizeWeekDates = useMemo(
    () => weekDays.map((d) => d.toISODate()).filter((d): d is string => Boolean(d)),
    [weekDays]
  );

  const dayColumnDates = useMemo(() => {
    if (view === 'month') return [];
    if (view === 'day') {
      return [DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('day')];
    }
    return weekDays;
  }, [view, anchorDate, weekDays]);

  const driveFetchKey = useMemo(
    () => dayColumnDates.map((d) => d.toISODate()).join(','),
    [dayColumnDates]
  );

  useEffect(() => {
    const empId = resolvedPrimaryProviderId.trim();
    if (!empId || !Number.isFinite(Number(empId)) || !driveFetchKey) {
      setWorkdayActualsByDate(new Map());
      return;
    }
    const dates = driveFetchKey.split(',').filter(Boolean);
    if (dates.length === 0) {
      setWorkdayActualsByDate(new Map());
      return;
    }
    const startDate = dates[0]!;
    const endDate = dates[dates.length - 1]!;
    let cancelled = false;
    void fetchEmployeeWorkdayActualsRange(empId, startDate, endDate)
      .then((rows) => {
        if (cancelled) return;
        const next = new Map<string, EmployeeWorkdayActual>();
        for (const row of rows) {
          if (row.date) next.set(row.date, row);
        }
        setWorkdayActualsByDate(next);
      })
      .catch(() => {
        if (!cancelled) setWorkdayActualsByDate(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedPrimaryProviderId, driveFetchKey]);

  const routingPreviewColumnKey = useMemo(
    () => routingPreviewPracticeDateKey(routingPreview?.option ?? null),
    [routingPreview]
  );

  const routingPreviewFocusDim = useMemo(
    () => Boolean(routingPreview && routingPreviewColumnKey),
    [routingPreview, routingPreviewColumnKey]
  );

  const editTimePreviewColumnKey = editTimePreview?.practiceDateKey ?? null;

  const editTimePreviewFocusDim = useMemo(
    () => Boolean(editTimePreview && editTimePreviewColumnKey),
    [editTimePreview, editTimePreviewColumnKey]
  );

  const editVisitColumnKey = useMemo(() => {
    if (!editAppt || editTimePreview) return null;
    return appointmentPracticeDateKey(editAppt.appointmentStart, PRACTICE_TZ);
  }, [editAppt, editTimePreview]);

  const editVisitFocusDim = useMemo(
    () => Boolean(editAppt && !editTimePreview),
    [editAppt, editTimePreview]
  );

  /** Block calendar/toolbar until edit visit is closed (placement preview keeps calendar interactive for the popover). */
  const editVisitCalendarLock = useMemo(
    () => Boolean(editAppt && !editPlacementMode && !editTimePreview),
    [editAppt, editPlacementMode, editTimePreview]
  );

  const showCalendarBlockedNotice = useCallback((msg: string) => {
    setCalendarBlockedNotice(msg);
  }, []);

  const notifyEditVisitCalendarLocked = useCallback(() => {
    showCalendarBlockedNotice(EDIT_VISIT_CALENDAR_BLOCKED_MESSAGE);
  }, [showCalendarBlockedNotice]);

  const rescheduleSourceHighlightIds = useMemo(
    () => rescheduleSourceHighlightAppointmentIds(embedInRoutingWorkspace, routingPreview),
    [embedInRoutingWorkspace, routingPreview, rescheduleIntentTick]
  );

  const rescheduleSourceColumnKey = useMemo(() => {
    if (!embedInRoutingWorkspace || routingPreview || !rescheduleSourceHighlightIds?.size) return null;
    return readRoutingRescheduleIntent()?.practiceDateKey?.trim() || null;
  }, [embedInRoutingWorkspace, routingPreview, rescheduleSourceHighlightIds, rescheduleIntentTick]);

  const rescheduleSourceFocusDim = useMemo(
    () => Boolean(rescheduleSourceColumnKey),
    [rescheduleSourceColumnKey]
  );

  const rescheduleWorkspaceActive = useMemo(
    () =>
      Boolean(
        embedInRoutingWorkspace && !routingPreview && rescheduleSourceHighlightIds?.size
      ),
    [embedInRoutingWorkspace, routingPreview, rescheduleSourceHighlightIds]
  );

  /** Reschedule opened from the Holds board — "Dismiss" returns there, so label it accordingly. */
  const rescheduleReturnsToHolds = useMemo(() => {
    if (!rescheduleWorkspaceActive) return false;
    const returnPath = readRoutingRescheduleIntent()?.returnPath;
    return Boolean(returnPath && isHoldsBoardReturnPath(returnPath));
  }, [rescheduleWorkspaceActive, rescheduleIntentTick]);

  /** Explore-alternatives intent — keep original booked. Used for badge + book/preview copy. */
  const exploreAlternativesActive = useMemo(() => {
    return Boolean(readRoutingRescheduleIntent()?.exploreAlternatives);
  }, [rescheduleIntentTick]);

  const [forwardBookingIntentTick, setForwardBookingIntentTick] = useState(0);
  useEffect(() => {
    const sync = () => setForwardBookingIntentTick((n) => n + 1);
    sync();
    window.addEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, sync);
    return () => window.removeEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, sync);
  }, []);

  const [appointmentRequestIntentTick, setAppointmentRequestIntentTick] = useState(0);
  useEffect(() => {
    const sync = () => setAppointmentRequestIntentTick((n) => n + 1);
    sync();
    window.addEventListener(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT, sync);
    return () => window.removeEventListener(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT, sync);
  }, []);

  const forwardBookingLockActive = useMemo(() => {
    void forwardBookingIntentTick;
    return Boolean(embedInRoutingWorkspace && forwardBookingWorkspaceIsActive());
  }, [embedInRoutingWorkspace, forwardBookingIntentTick]);

  const appointmentRequestLockActive = useMemo(() => {
    void appointmentRequestIntentTick;
    return Boolean(embedInRoutingWorkspace && appointmentRequestWorkspaceIsActive());
  }, [embedInRoutingWorkspace, appointmentRequestIntentTick]);

  const forwardBookingBarContext = useMemo(() => {
    void forwardBookingIntentTick;
    const intent = readRoutingForwardBookingIntent();
    if (!intent) return null;
    return buildForwardBookingWorkspaceContext(intent, PRACTICE_TZ);
  }, [forwardBookingIntentTick]);

  const appointmentRequestBarLabel = useMemo(() => {
    void appointmentRequestIntentTick;
    const intent = readRoutingAppointmentRequestIntent();
    if (!intent) return 'Appointment request';
    const client = intent.clientDisplayLabel?.trim() || 'Client';
    const howSoon = intent.howSoon?.trim();
    return howSoon ? `${client} · ${howSoon}` : client;
  }, [appointmentRequestIntentTick]);

  const scheduleCalendarInteractionLock = useMemo(
    () =>
      Boolean(
        routingPreview ||
          editTimePreview ||
          editVisitCalendarLock ||
          rescheduleWorkspaceActive ||
          forwardBookingLockActive ||
          appointmentRequestLockActive
      ),
    [
      routingPreview,
      editTimePreview,
      editVisitCalendarLock,
      rescheduleWorkspaceActive,
      forwardBookingLockActive,
      appointmentRequestLockActive,
    ]
  );

  const notifyScheduleCalendarLocked = useCallback(() => {
    if (editVisitCalendarLock) {
      notifyEditVisitCalendarLocked();
      return;
    }
    if (rescheduleWorkspaceActive) {
      showCalendarBlockedNotice(RESCHEDULE_CALENDAR_BLOCKED_MESSAGE);
      return;
    }
    if (forwardBookingLockActive) {
      showCalendarBlockedNotice(FORWARD_BOOKING_CALENDAR_BLOCKED_MESSAGE);
      return;
    }
    if (appointmentRequestLockActive) {
      showCalendarBlockedNotice(FORWARD_BOOKING_CALENDAR_BLOCKED_MESSAGE);
      return;
    }
    if (editTimePreview) {
      showCalendarBlockedNotice(EDIT_VISIT_TIME_PREVIEW_BLOCKED_MESSAGE);
      return;
    }
    showCalendarBlockedNotice(getScheduleCalendarPreviewBlockedMessage());
  }, [
    editVisitCalendarLock,
    rescheduleWorkspaceActive,
    forwardBookingLockActive,
    appointmentRequestLockActive,
    editTimePreview,
    notifyEditVisitCalendarLocked,
    showCalendarBlockedNotice,
  ]);

  useEffect(() => {
    const onBlocked = () => showCalendarBlockedNotice(getScheduleCalendarPreviewBlockedMessage());
    window.addEventListener(ROUTING_PREVIEW_CALENDAR_BLOCKED_EVENT, onBlocked);
    return () => window.removeEventListener(ROUTING_PREVIEW_CALENDAR_BLOCKED_EVENT, onBlocked);
  }, [showCalendarBlockedNotice]);

  const embeddedRoutingCalendarLocked = Boolean(
    embedInRoutingWorkspace &&
      (routingPreview || rescheduleWorkspaceActive || forwardBookingLockActive)
  );

  const calendarFocusDim =
    routingPreviewFocusDim ||
    editTimePreviewFocusDim ||
    rescheduleSourceFocusDim ||
    editVisitFocusDim;

  const routingPreviewIsReschedule = useMemo(
    () =>
      routingPreview?.rescheduleAppointmentId != null &&
      Number.isFinite(Number(routingPreview.rescheduleAppointmentId)),
    [routingPreview?.rescheduleAppointmentId]
  );

  const routingPreviewIsScheduleLoader = useMemo(
    () => isScheduleLoaderCalendarPreview(routingPreview),
    [routingPreview],
  );

  const routingPreviewIsManualBook = useMemo(
    () => isManualBookCalendarPreview(routingPreview),
    [routingPreview],
  );

  const routingPreviewIsOptimize = useMemo(
    () => isScheduleOptimizeCalendarPreview(routingPreview),
    [routingPreview],
  );

  const routingPreviewFromCurrentView = Boolean(
    routingPreviewIsOptimize && routingPreview?.scheduleOptimizeReturn?.fromCurrentView,
  );

  const routingPreviewIsWaitlist = useMemo(
    () => isWaitlistCalendarPreview(routingPreview),
    [routingPreview],
  );

  const routingPreviewSlotOfferFlow = useMemo(() => {
    if (!routingPreview || routingPreviewIsReschedule || routingPreviewIsManualBook) return false;
    const fbi = readRoutingForwardBookingIntent();
    return slotOfferFlowActive(
      {
        routingPreviewBook: true,
        forwardBookingCreatedVia:
          fbi?.origin === 'care_outreach'
            ? 'care_outreach'
            : fbi?.origin === 'schedule_loader'
              ? 'schedule_loader'
              : fbi?.origin === 'waitlist'
                ? 'waitlist'
                : undefined,
      },
      routingPreview
    );
  }, [routingPreview, routingPreviewIsReschedule, routingPreviewIsManualBook, forwardBookingIntentTick]);

  const [manualBookPreviewCommitting, setManualBookPreviewCommitting] = useState(false);
  const manualBookPreviewCommittingRef = useRef(false);
  const [manualBookHouseholdConflicts, setManualBookHouseholdConflicts] = useState<
    HouseholdScheduledVisitConflict[] | null
  >(null);
  const manualBookHouseholdBypassRef = useRef(false);
  const [manualBookEuthanasiaFutureRows, setManualBookEuthanasiaFutureRows] = useState<
    EuthanasiaFutureAppointmentRow[] | null
  >(null);
  const manualBookEuthanasiaChoiceRef = useRef<'delete' | 'keep' | null>(null);
  const pendingManualBookEuthanasiaDeletesRef = useRef<EuthanasiaFutureAppointmentRow[] | null>(
    null,
  );

  const reschedulePreviewSourceVisit = useMemo(() => {
    if (!routingPreviewIsReschedule) return null;
    const fromPreview = routingPreview?.rescheduleSourceVisitSnapshot;
    if (fromPreview?.found && typeof fromPreview.score === 'number') return fromPreview;
    const intent = readRoutingRescheduleIntent();
    const cached = intent?.sourcePlacementVisitSnapshot;
    if (cached?.found && typeof cached.score === 'number') return cached;
    return fromPreview ?? cached ?? null;
  }, [routingPreview, routingPreviewIsReschedule, rescheduleIntentTick, rescheduleSourceScoreTick]);

  const reschedulePreviewOriginalTimes = useMemo(() => {
    if (!routingPreviewIsReschedule) {
      return { start: null as string | null, end: null as string | null };
    }
    const intent = readRoutingRescheduleIntent();
    return {
      start: intent?.originalStartIso?.trim() || null,
      end: intent?.originalEndIso?.trim() || null,
    };
  }, [routingPreviewIsReschedule, rescheduleIntentTick, routingPreview]);

  useEffect(() => {
    if (!routingPreview) {
      setRoutingPreviewClientContact(null);
      return;
    }
    let cancelled = false;
    void loadRoutingPreviewClientContact({
      preview: routingPreview,
      isReschedule: routingPreviewIsReschedule,
      rawAppointments,
      providers,
      practiceId: PRACTICE_ID,
    }).then((contact) => {
      if (!cancelled) setRoutingPreviewClientContact(contact);
    });
    return () => {
      cancelled = true;
    };
  }, [
    routingPreview,
    routingPreviewIsReschedule,
    rawAppointments,
    providers,
    rescheduleIntentTick,
  ]);

  useEffect(() => {
    if (!routingPreviewIsReschedule) return;
    const fromPreview = routingPreview?.rescheduleSourceVisitSnapshot;
    if (fromPreview?.found && typeof fromPreview.score === 'number') return;
    const intent = readRoutingRescheduleIntent();
    if (!intent) return;
    const cached = intent.sourcePlacementVisitSnapshot;
    if (cached?.found && typeof cached.score === 'number') return;
    let cancelled = false;
    void fetchAndCacheRescheduleSourcePlacementSnapshot(intent).then(() => {
      if (!cancelled) setRescheduleSourceScoreTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [routingPreview, routingPreviewIsReschedule]);

  const reschedulePreviewHiddenApptIds = useMemo(() => {
    if (!routingPreview) return null;
    return routingRescheduleHiddenAppointmentIds(routingPreview);
  }, [routingPreview]);

  const rangeTitle = useMemo(() => {
    if (view === 'day') {
      const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
      return d.toFormat('MMMM d, yyyy');
    }
    if (view === 'month') {
      const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
      return d.toFormat('MMMM yyyy');
    }
    const a = weekDays[0];
    const b = weekDays[6];
    return `${a.toFormat('MMMM d, yyyy')} – ${b.toFormat('MMMM d, yyyy')}`;
  }, [view, anchorDate, weekDays]);

  useEffect(() => {
    let on = true;
    Promise.all([fetchPrimaryProviders(), fetchAllAppointmentTypes(PRACTICE_ID, { activeOnly: true })])
      .then(([providerRows, typeRows]) => {
        if (!on) return;
        setProviders(Array.isArray(providerRows) ? providerRows : []);
        setTypeList(Array.isArray(typeRows) ? typeRows : []);
      })
      .catch(() => {
        if (!on) return;
        setProviders([]);
        setTypeList([]);
      })
      .finally(() => {
        if (on) setProvidersLoadState('resolved');
      });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (isAdminOrSuper) {
      setManualBookableTypeIds([]);
      return;
    }
    let on = true;
    void fetchManualBookableAppointmentTypes(PRACTICE_ID)
      .then(({ appointmentTypeIds }) => {
        if (on) setManualBookableTypeIds(appointmentTypeIds);
      })
      .catch(() => {
        if (on) setManualBookableTypeIds([]);
      });
    return () => {
      on = false;
    };
  }, [isAdminOrSuper]);

  /** Align calendar RL badges with Scout room-loader sentStatus for the visible date range. */
  const loadRoomLoaderStatusesForRange = useCallback(async () => {
    const from = rangeUtc.startLocal.toISODate();
    const toExclusive = rangeUtc.endLocalExclusive.toISODate();
    if (!from || !toExclusive) {
      setRoomLoaderStatusByApptId(new Map());
      return;
    }
    const toInclusive = rangeUtc.endLocalExclusive.minus({ days: 1 }).toISODate() ?? from;
    try {
      const rows = await searchRoomLoaders({
        practiceId: PRACTICE_ID,
        appointmentFrom: from,
        appointmentTo: toInclusive,
        activeOnly: true,
      });
      setRoomLoaderStatusByApptId(buildRoomLoaderPreApptStatusByAppointmentId(rows ?? []));
    } catch {
      // Keep prior map on transient failures so badges don't flash red.
    }
  }, [rangeUtc.startLocal, rangeUtc.endLocalExclusive]);

  const loadRange = useCallback(
    async (opts?: { refreshDrive?: boolean; silent?: boolean; refreshDriveSoft?: boolean }) => {
      if (providers.length === 0) {
        setRawAppointments([]);
        if (providersLoadState === 'resolved') setLoading(false);
        return;
      }
      const primaryId = resolvedPrimaryProviderId.trim() || String(providers[0].id);
      if (!opts?.silent) {
        setLoading(true);
      }
      setError(null);
      try {
        const rows = await fetchAppointmentsRange({
          practiceId: PRACTICE_ID,
          start: rangeUtc.startUtc,
          end: rangeUtc.endUtc,
          primaryProviderId: primaryId,
        });
        if (!Array.isArray(rows)) {
          setRawAppointments([]);
          return;
        }
        setRawAppointments(rows);
        if (opts?.refreshDriveSoft) {
          driveSoftRefreshRef.current = true;
          setDriveRefreshNonce((n) => n + 1);
        } else if (opts?.refreshDrive) {
          driveSoftRefreshRef.current = false;
          setDriveRefreshNonce((n) => n + 1);
        }
        void refreshForwardBookingSourceIds();
        void loadRoomLoaderStatusesForRange();
      } catch (e: unknown) {
        const msg = e && typeof e === 'object' && 'message' in e ? String((e as Error).message) : 'Failed to load';
        setError(msg);
        setRawAppointments([]);
      } finally {
        appointmentRangeBlockingLoadDone.current = true;
        if (!opts?.silent) {
          setLoading(false);
        }
      }
    },
    [
      rangeUtc.startUtc,
      rangeUtc.endUtc,
      resolvedPrimaryProviderId,
      providers,
      providersLoadState,
      refreshForwardBookingSourceIds,
      loadRoomLoaderStatusesForRange,
    ]
  );

  const commitStaffCalendarDrag = useCallback(
    async (drag: StaffCalendarDragState) => {
      if (staffCalendarDragSavingRef.current) return;
      if (Math.abs(drag.liveStartMin - drag.originStartMin) < 0.5) return;
      const dayStart = DateTime.fromISO(drag.dayKey, { zone: PRACTICE_TZ }).startOf('day');
      if (!dayStart.isValid) return;
      const start = dayStart.plus({ minutes: drag.liveStartMin });
      const end = start.plus({ minutes: Math.max(SLOT_MINUTES, drag.durationMin) });
      const startUtc = start.toUTC().toISO();
      const endUtc = end.toUTC().toISO();
      if (!startUtc || !endUtc) return;
      staffCalendarDragSavingRef.current = true;
      try {
        await patchAppointment(
          drag.apptId,
          { appointmentStart: startUtc, appointmentEnd: endUtc },
          { practiceId: PRACTICE_ID }
        );
        resolveScheduleOptimizeQueueItems(PRACTICE_ID, {
          appointmentIds: [Number(drag.apptId)].filter((id) => Number.isFinite(id) && id > 0),
          outcome: 'rescheduled',
          note: formatScheduleOptimizeQueueActionNote({
            kind: 'rescheduled',
            whenLabel: start.toFormat('ccc M/d h:mm a'),
          }),
          savingsStaff: scheduleOptimizeSavingsActor,
        });
        setRawAppointments((prev) => {
          const idx = prev.findIndex((a) => String(a.id) === String(drag.apptId));
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], appointmentStart: startUtc, appointmentEnd: endUtc };
          return next;
        });
        await loadRange({ silent: true, refreshDrive: true });
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not move the calendar item.';
        setToast(Array.isArray(msg) ? msg.join(', ') : String(msg));
        await loadRange({ silent: true, refreshDrive: true });
      } finally {
        staffCalendarDragSavingRef.current = false;
      }
    },
    [loadRange, scheduleOptimizeSavingsActor]
  );

  useEffect(() => {
    if (providers.length === 0) return;
    void refreshForwardBookingSourceIds();
  }, [providers.length, refreshForwardBookingSourceIds]);

  const applyRealtimeCalendarBatch = useCallback(
    async (batch: AppointmentCalendarPayload[]) => {
      if (providers.length === 0) return;

      const primaryId = resolvedPrimaryProviderId.trim();
      const bumpsDrive =
        Boolean(primaryId) && showByDriveTime && (view === 'week' || view === 'day');

      const bumpDriveSoft = () => {
        if (bumpsDrive) {
          driveSoftRefreshRef.current = true;
          setDriveRefreshNonce((n) => n + 1);
        }
      };

      const dels = batch.filter((p) => p.action === 'deleted');
      const nonDels = batch.filter((p) => p.action !== 'deleted');

      if (dels.length > 0) {
        const delSet = new Set(dels.map((d) => d.appointmentId));
        setRawAppointments((prev) => prev.filter((a) => !delSet.has(a.id)));
      }

      if (nonDels.length === 0) {
        if (dels.length > 0) {
          bumpDriveSoft();
          void loadRoomLoaderStatusesForRange();
        }
        return;
      }

      const rows = await Promise.all(
        nonDels.map((p) => fetchAppointmentById(p.appointmentId, { practiceId: PRACTICE_ID }))
      );

      if (rows.some((r) => r == null)) {
        await loadRange({ silent: true, refreshDriveSoft: true });
        return;
      }

      setRawAppointments((prev) => {
        let next = [...prev];
        for (let i = 0; i < nonDels.length; i++) {
          const row = rows[i]!;
          const prov = row.primaryProvider?.id != null ? String(row.primaryProvider.id) : '';
          if (primaryId && prov && prov !== primaryId) {
            next = next.filter((a) => a.id !== row.id);
            continue;
          }
          if (
            !appointmentOverlapsUtcRange(
              row.appointmentStart,
              row.appointmentEnd,
              rangeUtc.startUtc,
              rangeUtc.endUtc
            )
          ) {
            next = next.filter((a) => a.id !== row.id);
            continue;
          }
          const idx = next.findIndex((a) => a.id === row.id);
          const merged = mergeAppointmentPreserveRoomLoaderConfirmStatus(
            idx >= 0 ? next[idx] : null,
            row
          );
          if (idx === -1) next.push(merged);
          else next[idx] = merged;
        }
        return next;
      });

      if (dels.length > 0 || nonDels.length > 0) bumpDriveSoft();
      // Scout sentStatus can lead PIMS confirmStatusName; refresh RL badges on every calendar socket batch.
      void loadRoomLoaderStatusesForRange();
    },
    [
      providers.length,
      resolvedPrimaryProviderId,
      showByDriveTime,
      view,
      rangeUtc.startUtc,
      rangeUtc.endUtc,
      loadRange,
      loadRoomLoaderStatusesForRange,
    ]
  );

  useEffect(() => {
    loadRange();
  }, [loadRange]);

  /** Socket.IO — merge rows locally; soft-refresh drive (no loading flash). Fallback: silent full range if GET by id fails. */
  useEffect(() => {
    if (!authToken?.trim()) return;
    return subscribePracticeCalendar({
      practiceId: PRACTICE_ID,
      visibleProviderId: resolvedPrimaryProviderId,
      onBatch: (payloads) => {
        void applyRealtimeCalendarBatch(payloads);
      },
      onReconnect: () => {
        void loadRoomLoaderStatusesForRange();
      },
    });
  }, [authToken, resolvedPrimaryProviderId, applyRealtimeCalendarBatch, loadRoomLoaderStatusesForRange]);

  /** Same-tab: Room Loader send/update should flip calendar RL badges without waiting on PIMS/socket. */
  useEffect(() => {
    const onSentStatusChanged = () => {
      void loadRoomLoaderStatusesForRange();
    };
    window.addEventListener(ROOM_LOADER_SENT_STATUS_CHANGED_EVENT, onSentStatusChanged);
    return () => window.removeEventListener(ROOM_LOADER_SENT_STATUS_CHANGED_EVENT, onSentStatusChanged);
  }, [loadRoomLoaderStatusesForRange]);

  useEffect(() => {
    const docId = resolvedPrimaryProviderId.trim();
    const loadDoctorDaySidecar = Boolean(docId) && (view === 'week' || view === 'day');
    if (!loadDoctorDaySidecar) {
      setDriveIsoByApptId(null);
      setDriveDayByDate(null);
      setDoctorDayMembershipByApptId(new Map());
      setDoctorDayZonesByApptId(new Map());
      setDoctorDayPatientPcpByApptId(new Map());
      setDoctorDayEffectiveWindowByApptId(new Map());
      setDoctorDayIsCompleteByApptId(new Map());
      setScheduleOverridesByDate(new Map());
      setDriveEtaLoading(false);
      return;
    }
    const dates = driveFetchKey.split(',').filter(Boolean);
    if (dates.length === 0) {
      setDriveIsoByApptId(null);
      setDriveDayByDate(null);
      setDoctorDayMembershipByApptId(new Map());
      setDoctorDayZonesByApptId(new Map());
      setDoctorDayPatientPcpByApptId(new Map());
      setDoctorDayEffectiveWindowByApptId(new Map());
      setDoctorDayIsCompleteByApptId(new Map());
      setScheduleOverridesByDate(new Map());
      setDriveEtaLoading(false);
      return;
    }

    const canDrive = showByDriveTime;

    let cancelled = false;
    let pending = dates.length;
    let firstDataLanded = false;

    setDoctorDayMembershipByApptId(new Map());
    setDoctorDayZonesByApptId(new Map());
    setDoctorDayPatientPcpByApptId(new Map());
    setDoctorDayEffectiveWindowByApptId(new Map());
    setDoctorDayIsCompleteByApptId(new Map());

    const softDriveUpdate = driveSoftRefreshRef.current;
    driveSoftRefreshRef.current = false;

    if (!softDriveUpdate) {
      if (canDrive) {
        setDriveIsoByApptId(new Map());
        setDriveDayByDate(new Map());
        setDriveEtaLoading(true);
      } else {
        setDriveIsoByApptId(null);
        setDriveEtaLoading(false);
      }
    } else if (canDrive) {
      setDriveEtaLoading(true);
    }

    const markFirstData = () => {
      if (cancelled || firstDataLanded) return;
      firstDataLanded = true;
      setDriveEtaLoading(false);
    };

    const bumpDone = () => {
      if (cancelled) return;
      pending -= 1;
      if (pending <= 0 && !firstDataLanded) {
        setDriveEtaLoading(false);
      }
    };

    const driveRoutingOpts =
      routingPreview && routingPreviewColumnKey
        ? {
            routingPreview,
            previewPracticeDateKey: routingPreviewColumnKey,
            previewAppointmentType:
              typeList.find((t) => t.id === routingPreview.appointmentTypeId) ?? null,
            rescheduleIntent: readRoutingRescheduleIntent(),
          }
        : editTimePreview
          ? {
              editTimePreview,
              editPreviewDraftType:
                editTimePreview.appointmentTypeId != null
                  ? typeList.find((t) => t.id === editTimePreview.appointmentTypeId) ?? null
                  : editAppt?.appointmentType?.id != null
                    ? typeList.find((t) => t.id === editAppt.appointmentType?.id) ?? null
                    : null,
            }
          : null;

    void (async () => {
      const empNum = Number(docId);
      const overridesByDate =
        Number.isFinite(empNum) && dates.length > 0
          ? await fetchScheduleOverridesByDate(empNum, dates).catch(() => new Map<string, ScheduleOverride>())
          : new Map<string, ScheduleOverride>();

      if (cancelled) return;
      setScheduleOverridesByDate(overridesByDate);

      await Promise.all(
        dates.map(async (date) => {
          try {
            const { bundle: rawBundle, membershipByApptId, zonesByApptId, effectiveWindowByApptId, patientPrimaryProviderByApptId, isCompleteByApptId } =
              await fetchSchedulerDoctorDayBundle(date, docId, driveRoutingOpts);
            if (cancelled) return;

            const dayIn = applyScheduleOverrideToDayBundle(
              rawBundle,
              overridesByDate.get(date) ?? null
            );

            setDoctorDayMembershipByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of membershipByApptId) {
                m.set(k, v);
              }
              return m;
            });
            setDoctorDayZonesByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of zonesByApptId) {
                m.set(k, v);
              }
              return m;
            });
            setDoctorDayPatientPcpByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of patientPrimaryProviderByApptId) {
                m.set(k, v);
              }
              return m;
            });
            setDoctorDayEffectiveWindowByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of effectiveWindowByApptId) {
                m.set(k, v);
              }
              return m;
            });
            setDoctorDayIsCompleteByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of isCompleteByApptId) {
                m.set(k, v);
              }
              return m;
            });

            if (!dayIn) {
              markFirstData();
              return;
            }

            const interim = schedulerDriveScheduleOnlyFromBundle(dayIn);
            setDriveDayByDate((prev) => new Map(prev).set(interim.date, interim.dayData));

            if (!canDrive) {
              markFirstData();
              return;
            }

            setDriveIsoByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of interim.isoPairs) {
                m.set(k, v);
              }
              return m;
            });
            markFirstData();

            const r = await fetchSchedulerDriveEtasForDayBundle(dayIn, docId, driveRoutingOpts);
            if (cancelled) return;
            setDriveDayByDate((prev) => new Map(prev).set(r.date, r.dayData));
            setDriveIsoByApptId((prev) => {
              const m = new Map(prev);
              for (const [k, v] of r.isoPairs) {
                m.set(k, v);
              }
              return m;
            });

            if (
              routingPreview &&
              routingPreviewColumnKey &&
              r.date === routingPreviewColumnKey
            ) {
              const etaWindowSummary = summarizeReconciledDayWindowWarnings(r.dayData);
              const reconciledOverrunSeconds = computeDepotReturnOverrunSeconds(r.dayData);
              notifyRoutingPreviewEtaWindowWarnings({
                optionKey:
                  routingPreview.listOptionKey?.trim() ||
                  routingCalendarPreviewOptionKey(routingPreview),
                // Placement-relevant only (candidate or at/after it) — not upstream pre-existing.
                hasWindowWarning: etaWindowSummary.hasPlacementRelevantWarning,
                warningStopCount: etaWindowSummary.warningStopCount,
                candidateHasWarning: etaWindowSummary.candidateHasWarning,
                reconciledOverrunSeconds,
              });
            }
          } catch {
            /* skip day — other dates may still succeed */
          } finally {
            bumpDone();
          }
        })
      );
    })();

    return () => {
      cancelled = true;
      setDriveEtaLoading(false);
    };
  }, [
    driveFetchKey,
    resolvedPrimaryProviderId,
    showByDriveTime,
    view,
    driveRefreshNonce,
    routingPreview,
    routingPreviewColumnKey,
    editTimePreview,
    editAppt?.appointmentType?.id,
    typeList,
  ]);

  const filteredAppointments = useMemo(() => {
    const filtered = rawAppointments.filter((a) => {
      if (!isAppointmentVisible(a)) return false;
      if (typeFilter) {
        const id = String(a.appointmentType?.id ?? '');
        if (id !== typeFilter) return false;
      }
      return true;
    });
    if (
      doctorDayMembershipByApptId.size === 0 &&
      doctorDayZonesByApptId.size === 0 &&
      doctorDayPatientPcpByApptId.size === 0 &&
      doctorDayEffectiveWindowByApptId.size === 0 &&
      doctorDayIsCompleteByApptId.size === 0
    ) {
      return filtered;
    }
    return filtered.map((a) => {
      let next: Appointment = a;
      const doc = doctorDayMembershipByApptId.get(String(a.id));
      if (doc) {
        const isMember = Boolean(a.isMember || doc.isMember);
        const nameFromAppt = pickStr(a.membershipName);
        const membershipName = nameFromAppt ?? doc.membershipName;
        if (isMember || membershipName || a.isMember || pickStr(a.membershipName)) {
          next = { ...next, isMember, membershipName: membershipName ?? null };
        }
      }
      const z = doctorDayZonesByApptId.get(String(a.id));
      if (z && (z.clientZone != null || z.effectiveZone != null)) {
        next = {
          ...next,
          clientZone: z.clientZone ?? next.clientZone,
          effectiveZone: z.effectiveZone ?? next.effectiveZone,
        };
      }
      if (doctorDayPatientPcpByApptId.has(String(a.id))) {
        next = {
          ...next,
          patientPrimaryProvider: doctorDayPatientPcpByApptId.get(String(a.id)) ?? null,
        };
      }
      const doctorDayWindow = doctorDayEffectiveWindowByApptId.get(String(a.id));
      if (doctorDayWindow) {
        next = { ...next, effectiveWindow: doctorDayWindow };
      }
      if (doctorDayIsCompleteByApptId.has(String(a.id))) {
        const doctorComplete = doctorDayIsCompleteByApptId.get(String(a.id)) === true;
        next = { ...next, isComplete: doctorComplete || next.isComplete === true };
      }
      return next;
    });
  }, [
    rawAppointments,
    typeFilter,
    doctorDayMembershipByApptId,
    doctorDayZonesByApptId,
    doctorDayPatientPcpByApptId,
    doctorDayEffectiveWindowByApptId,
    doctorDayIsCompleteByApptId,
  ]);

  const calendarAppointments = useMemo(() => {
    let base = filteredAppointments;
    if (reschedulePreviewHiddenApptIds?.size) {
      base = base.filter((a) => {
        const id = a.id;
        return !(typeof id === 'number' && reschedulePreviewHiddenApptIds.has(id));
      });
    }
    if (!editTimePreview) return base;
    const draftType =
      editTimePreview.kind === 'type' && editTimePreview.appointmentTypeId != null
        ? typeList.find((t) => t.id === editTimePreview.appointmentTypeId)
        : undefined;
    const arrivalAfter =
      editPreviewScoreCompare?.arrivalWindowAfter ??
      (draftType
        ? effectiveWindowForTypePreview(
            editTimePreview,
            draftType,
            PRACTICE_TZ,
            editPreviewScoreCompare?.arrivalWindowAfter
          )
        : null);
    return base.map((a) => {
      if (a.id !== editTimePreview.appointmentId) return a;
      let merged: Appointment = {
        ...a,
        appointmentStart: editTimePreview.appointmentStart,
        appointmentEnd: editTimePreview.appointmentEnd,
        ...(draftType ? { appointmentType: draftType } : {}),
        ...(arrivalAfter ? { effectiveWindow: arrivalAfter } : {}),
      };
      if (
        editAppt &&
        editVisitLinkClearsAlternateAddress(editAppt, editVisitLinkSelection)
      ) {
        merged = appointmentWithoutAlternateRoutingAddress(merged);
      }
      return merged;
    });
  }, [
    filteredAppointments,
    editTimePreview,
    reschedulePreviewHiddenApptIds,
    typeList,
    editPreviewScoreCompare?.arrivalWindowAfter,
    editAppt,
    editVisitLinkSelection,
  ]);

  /** Routed timeline range for the visit that opened reschedule — keeps household highlights aligned at ETA. */
  const rescheduleAnchorDriveRange = useMemo(() => {
    if (!rescheduleSourceHighlightIds?.size) return null;
    const intent = readRoutingRescheduleIntent();
    if (!intent) return null;
    if (!showByDriveTime || !resolvedPrimaryProviderId.trim()) return null;
    const anchor = driveIsoByApptId?.get(String(intent.appointmentId));
    return anchor ?? null;
  }, [
    rescheduleSourceHighlightIds,
    rescheduleIntentTick,
    showByDriveTime,
    resolvedPrimaryProviderId,
    driveIsoByApptId,
  ]);

  const displayRangeForAppt = useMemo(() => {
    return (a: Appointment) => {
      if (hover?.appt.id === a.id && hover.pinnedRange) {
        return hover.pinnedRange;
      }
      const inRescheduleHighlight =
        rescheduleSourceHighlightIds != null &&
        typeof a.id === 'number' &&
        rescheduleSourceHighlightIds.has(a.id);
      if (inRescheduleHighlight && rescheduleAnchorDriveRange) {
        return rescheduleAnchorDriveRange;
      }
      return driveDisplayRangeForAppointment(
        a,
        showByDriveTime,
        resolvedPrimaryProviderId,
        driveDayByDate,
        driveIsoByApptId
      );
    };
  }, [
    hover?.appt.id,
    hover?.pinnedRange,
    showByDriveTime,
    resolvedPrimaryProviderId,
    driveIsoByApptId,
    driveDayByDate,
    rescheduleSourceHighlightIds,
    rescheduleAnchorDriveRange,
  ]);

  const gridBounds = useMemo(() => {
    const buf = SCHEDULER_GRID_EDGE_BUFFER_MIN;

    let earliestApptMin: number | null = null;
    let latestApptMin: number | null = null;
    for (const a of calendarAppointments) {
      if (a.allDay) continue;
      const { startIso, endIso } = displayRangeForAppt(a);
      const sm = wallMinutes(startIso);
      const em = wallMinutes(endIso);
      earliestApptMin = earliestApptMin === null ? sm : Math.min(earliestApptMin, sm);
      latestApptMin = latestApptMin === null ? em : Math.max(latestApptMin, em);
    }

    if (routingPreview?.option?.suggestedStartIso) {
      const previewKey = routingPreviewPracticeDateKey(routingPreview.option);
      const syn =
        previewKey && dayColumnDates.some((d) => d.toISODate() === previewKey)
          ? buildRoutingPreviewSyntheticAppointment(routingPreview, typeList)
          : null;
      if (syn) {
        const sm = wallMinutes(syn.appointmentStart);
        const em = wallMinutes(syn.appointmentEnd);
        earliestApptMin = earliestApptMin === null ? sm : Math.min(earliestApptMin, sm);
        latestApptMin = latestApptMin === null ? em : Math.max(latestApptMin, em);
      }
    }

    const fromAppts =
      earliestApptMin !== null
        ? Math.max(0, Math.floor(earliestApptMin / SLOT_MINUTES) * SLOT_MINUTES - buf)
        : null;
    const toAppts =
      latestApptMin !== null
        ? Math.min(24 * 60, Math.ceil(latestApptMin / SLOT_MINUTES) * SLOT_MINUTES + buf)
        : null;

    let fromDepot: number | null = null;
    let toDepot: number | null = null;
    if (resolvedPrimaryProviderId.trim()) {
      for (const dayDt of dayColumnDates) {
        const key = dayDt.toISODate()!;
        const { startMin, endMin } = schedulerWorkDayMinutesForDate(
          key,
          driveDayByDate,
          scheduleOverridesByDate,
          providerWeeklySchedules
        );
        if (startMin != null) {
          const candidate = Math.max(0, Math.floor(startMin / SLOT_MINUTES) * SLOT_MINUTES - buf);
          fromDepot = fromDepot === null ? candidate : Math.min(fromDepot, candidate);
        }
        if (endMin != null) {
          const candidate = Math.min(
            24 * 60,
            Math.ceil(endMin / SLOT_MINUTES) * SLOT_MINUTES + buf
          );
          toDepot = toDepot === null ? candidate : Math.max(toDepot, candidate);
        }
      }
    }

    const startCandidates: number[] = [];
    if (fromAppts !== null) startCandidates.push(fromAppts);
    if (fromDepot !== null) startCandidates.push(fromDepot);
    let start =
      startCandidates.length > 0
        ? Math.min(...startCandidates)
        : Math.max(0, DEFAULT_GRID_START - SLOT_MINUTES);
    start = Math.max(0, Math.floor(start / SLOT_MINUTES) * SLOT_MINUTES);

    const endCandidates: number[] = [DEFAULT_GRID_END];
    if (toAppts !== null) endCandidates.push(toAppts);
    if (toDepot !== null) endCandidates.push(toDepot);
    let end = Math.min(24 * 60, Math.max(...endCandidates));
    end = Math.min(24 * 60, Math.ceil(end / SLOT_MINUTES) * SLOT_MINUTES);
    if (end <= start) end = start + 60;
    return { gridStartMin: start, gridEndMin: end, totalMin: end - start };
  }, [
    calendarAppointments,
    displayRangeForAppt,
    driveDayByDate,
    resolvedPrimaryProviderId,
    scheduleOverridesByDate,
    providerWeeklySchedules,
    editTimePreview,
    dayColumnDates,
    routingPreview,
    typeList,
  ]);

  const gridHeightPx = gridBounds.totalMin * PPM;

  const weekGridMetrics: WeekGridMetrics = useMemo(
    () => ({
      gridStartMinutesFromMidnight: gridBounds.gridStartMin,
      totalMinutes: gridBounds.totalMin,
    }),
    [gridBounds.gridStartMin, gridBounds.totalMin]
  );

  const timeLabels = useMemo(() => {
    const out: { min: number; label: string; major: boolean }[] = [];
    for (let m = gridBounds.gridStartMin; m < gridBounds.gridEndMin; m += SLOT_MINUTES) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const dt = DateTime.fromObject({ hour: h, minute: mm }, { zone: PRACTICE_TZ });
      out.push({
        min: m,
        label: mm === 0 ? dt.toFormat('h:mm a') : '',
        major: mm === 0,
      });
    }
    return out;
  }, [gridBounds.gridStartMin, gridBounds.gridEndMin]);

  const appointmentsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const d of dayColumnDates) {
      const key = d.toISODate()!;
      map.set(key, []);
    }
    for (const a of calendarAppointments) {
      if (a.allDay) {
        for (const key of dayKeysForAllDayRange(a)) {
          if (map.has(key)) map.get(key)!.push(a);
        }
      } else {
        const key = dayKeyFromIso(a.appointmentStart);
        if (key && map.has(key)) map.get(key)!.push(a);
      }
    }
    return map;
  }, [calendarAppointments, dayColumnDates]);

  /**
   * Week view: off days use half width; scheduled days stay full width even with no visits yet.
   * All-day bar positions use the same weights so spanning bars align with headers/bodies.
   */
  const dayTimeColumnLayout = useMemo(() => {
    const n = dayColumnDates.length;
    const keys = dayColumnDates.map((d) => d.toISODate()!);
    if (n === 0) {
      return {
        flexStyleForIndex: (_i: number) => ({ flex: '1 1 0' as const, minWidth: 90 }),
        barLeftPct: (_s: number) => 0,
        barWidthPct: (_s: number, _e: number) => 0,
      };
    }
    if (view !== 'week') {
      return {
        flexStyleForIndex: (_i: number) => ({
          flex: '1 1 0' as const,
          minWidth: n === 1 ? 200 : 90,
        }),
        barLeftPct: (s: number) => (s / n) * 100,
        barWidthPct: (s: number, e: number) => ((e - s + 1) / n) * 100,
      };
    }
    const flexGrow = keys.map((k) => {
      const dayData = driveDayByDate?.get(k);
      const dayAppts = appointmentsByDay.get(k) ?? [];
      const scheduleOverride = scheduleOverridesByDate.get(k) ?? null;
      if (
        schedulerPracticeCalendarDayOff(
          dayData,
          dayAppts,
          providerWeeklySchedules,
          k,
          scheduleOverride
        )
      ) {
        return 1;
      }
      if (routingPreview && routingPreviewColumnKey === k) return 2;
      if (editTimePreview && editTimePreviewColumnKey === k) return 2;
      if (editVisitColumnKey === k) return 2;
      if (rescheduleSourceColumnKey === k) return 2;
      if (
        schedulerDayIsWorking(
          k,
          dayData,
          appointmentsByDay,
          providerWeeklySchedules,
          scheduleOverridesByDate
        )
      ) {
        return 2;
      }
      return 1;
    });
    const total = flexGrow.reduce((a, b) => a + b, 0);
    const colWidthFrac = flexGrow.map((w) => w / total);
    const cumLeftFrac: number[] = [];
    let acc = 0;
    for (const frac of colWidthFrac) {
      cumLeftFrac.push(acc);
      acc += frac;
    }
    return {
      flexStyleForIndex: (i: number) => ({
        flex: `${flexGrow[i]} 1 0` as const,
        minWidth: flexGrow[i] >= 2 ? 90 : 48,
      }),
      barLeftPct: (s: number) => cumLeftFrac[s] * 100,
      barWidthPct: (s: number, e: number) =>
        colWidthFrac.slice(s, e + 1).reduce((a, b) => a + b, 0) * 100,
    };
  }, [
    dayColumnDates,
    view,
    appointmentsByDay,
    driveDayByDate,
    providerWeeklySchedules,
    scheduleOverridesByDate,
    routingPreview,
    routingPreviewColumnKey,
    editTimePreview,
    editTimePreviewColumnKey,
    editVisitColumnKey,
    rescheduleSourceColumnKey,
  ]);

  /** Spanning all-day bars + lane stacking; visible strip height capped at 8 rows with internal scroll. */
  const allDaySpanLayout = useMemo(() => {
    const visibleDayIsos = dayColumnDates.map((d) => d.toISODate()!);
    const n = visibleDayIsos.length;
    if (n === 0) {
      return { bars: [] as Array<{ appt: Appointment; s: number; e: number; lane: number }>, visibleHeightPx: 28, contentHeightPx: 28 };
    }

    const segments: { appt: Appointment; s: number; e: number }[] = [];
    for (const a of filteredAppointments) {
      if (!a.allDay) continue;
      const keys = new Set(dayKeysForAllDayRange(a));
      let s = -1;
      let e = -1;
      for (let i = 0; i < n; i++) {
        if (!keys.has(visibleDayIsos[i])) continue;
        if (s < 0) s = i;
        e = i;
      }
      if (s < 0) continue;
      segments.push({ appt: a, s, e });
    }

    function intervalsOverlap(x: { s: number; e: number }, y: { s: number; e: number }) {
      return x.s <= y.e && y.s <= x.e;
    }

    segments.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));

    const lastOnLane: { s: number; e: number }[] = [];
    const bars: Array<{ appt: Appointment; s: number; e: number; lane: number }> = [];

    for (const seg of segments) {
      let lane = 0;
      for (; ; lane++) {
        if (lane === lastOnLane.length) {
          lastOnLane.push({ s: seg.s, e: seg.e });
          bars.push({ appt: seg.appt, s: seg.s, e: seg.e, lane });
          break;
        }
        const prev = lastOnLane[lane];
        if (!intervalsOverlap(prev, seg)) {
          lastOnLane[lane] = { s: seg.s, e: seg.e };
          bars.push({ appt: seg.appt, s: seg.s, e: seg.e, lane });
          break;
        }
      }
    }

    const laneCount = lastOnLane.length;
    const innerPad = SCHEDULER_ALL_DAY_PAD_Y;
    const contentHeightPx =
      segments.length === 0 ? 28 : innerPad + laneCount * SCHEDULER_ALL_DAY_ROW_PX;
    const maxContent =
      innerPad + SCHEDULER_ALL_DAY_MAX_VISIBLE_ROWS * SCHEDULER_ALL_DAY_ROW_PX;
    const visibleHeightPx = Math.min(Math.max(28, contentHeightPx), Math.max(28, maxContent));

    return { bars, visibleHeightPx, contentHeightPx };
  }, [calendarAppointments, dayColumnDates]);

  const monthCells = useMemo(() => {
    if (view !== 'month') return [];
    const monthStart = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ }).startOf('month');
    const gridStart = sundayWeekStart(monthStart);
    const cells: { date: DateTime; inMonth: boolean; count: number }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = gridStart.plus({ days: i });
      const inMonth = d.month === monthStart.month;
      const key = d.toISODate()!;
      const count = filteredAppointments.filter((a) => appointmentCoversPracticeLocalDate(a, key)).length;
      cells.push({ date: d, inMonth, count });
    }
    return cells;
  }, [view, anchorDate, filteredAppointments]);

  const goPrev = () => {
    if (scheduleCalendarInteractionLock) {
      notifyScheduleCalendarLocked();
      return;
    }
    const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
    if (view === 'day') setAnchorDate(d.minus({ days: 1 }).toISODate()!);
    else if (view === 'week') setAnchorDate(d.minus({ weeks: 1 }).toISODate()!);
    else setAnchorDate(d.minus({ months: 1 }).toISODate()!);
  };

  const goNext = () => {
    if (scheduleCalendarInteractionLock) {
      notifyScheduleCalendarLocked();
      return;
    }
    const d = DateTime.fromISO(anchorDate!, { zone: PRACTICE_TZ });
    if (view === 'day') setAnchorDate(d.plus({ days: 1 }).toISODate()!);
    else if (view === 'week') setAnchorDate(d.plus({ weeks: 1 }).toISODate()!);
    else setAnchorDate(d.plus({ months: 1 }).toISODate()!);
  };

  const goToday = () => {
    if (scheduleCalendarInteractionLock) {
      notifyScheduleCalendarLocked();
      return;
    }
    setAnchorDate(DateTime.now().setZone(PRACTICE_TZ).toISODate()!);
  };

  const onPickGoToDate = (iso: string) => {
    if (!iso) return;
    if (scheduleCalendarInteractionLock) {
      notifyScheduleCalendarLocked();
      return;
    }
    setAnchorDate(iso);
  };

  const hoverAppt = useMemo(() => {
    if (!hover) return null;
    return calendarAppointments.find((a) => a.id === hover.appt.id) ?? hover.appt;
  }, [hover, calendarAppointments]);

  const modalApptResolved = useMemo(() => {
    if (!modalAppt) return null;
    return calendarAppointments.find((a) => a.id === modalAppt.id) ?? modalAppt;
  }, [modalAppt, calendarAppointments]);

  const editApptForModal = useMemo(() => {
    if (!editAppt) return null;
    return calendarAppointments.find((a) => a.id === editAppt.id) ?? editAppt;
  }, [editAppt, calendarAppointments]);

  const hoverDriveHint = useMemo((): SchedulerHoverDriveHint | null => {
    if (!hoverAppt) return null;
    return buildSchedulerDriveHintForAppt(
      hoverAppt,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
  }, [hoverAppt, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  const onMyWaySmsDefaultMinutes = useMemo(() => {
    if (!onMyWaySmsAppt) return undefined;
    const hint = buildSchedulerDriveHintForAppt(
      onMyWaySmsAppt,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
    return etaMinutesAwayFromNow(hint?.etaIso ?? null, PRACTICE_TZ) ?? undefined;
  }, [onMyWaySmsAppt, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  const modalDriveHint = useMemo((): SchedulerHoverDriveHint | null => {
    if (!modalApptResolved) return null;
    return buildSchedulerDriveHintForAppt(
      modalApptResolved,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
  }, [modalApptResolved, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  const editArrivalWindowLine = useMemo((): string | null => {
    if (!editApptForModal) return null;
    const hint = buildSchedulerDriveHintForAppt(
      editApptForModal,
      showByDriveTime,
      resolvedPrimaryProviderId,
      driveDayByDate
    );
    return visitDetailsWindowLine(editApptForModal, hint);
  }, [editApptForModal, showByDriveTime, resolvedPrimaryProviderId, driveDayByDate]);

  useLayoutEffect(() => {
    if (!hover) {
      setHoverTooltipLayout(null);
      return;
    }
    const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
    if (!hover.pinnedRange) {
      const liveRange = driveDisplayRangeForAppointment(
        hover.appt,
        showByDriveTime,
        resolvedPrimaryProviderId,
        driveDayByDate,
        driveIsoByApptId
      );
      setHover((prev) =>
        prev?.appt.id === hover.appt.id ? { ...prev, pinnedRange: liveRange } : prev
      );
    }
    if (
      anchorEl &&
      !embedInRoutingWorkspace &&
      !timedGridElementMostlyVisible(anchorEl)
    ) {
      suppressHoverScrollDismissRef.current = true;
      scrollTimedGridElementIntoView(anchorEl, 'auto');
      requestAnimationFrame(() => {
        suppressHoverScrollDismissRef.current = false;
      });
    }
    setHoverTooltipLayout({
      pos: computeVisitHighlightsPopoverPosition({
        anchorEl,
        x: hover.x,
        y: hover.y,
      }),
      ready: false,
    });
  }, [hover?.appt.id, hover?.el, embedInRoutingWorkspace]);

  useLayoutEffect(() => {
    if (!hover || !hoverTooltipLayout || hoverTooltipLayout.ready) return;
    const anchorEl = hover.el instanceof HTMLElement ? hover.el : null;
    const el = hoverTooltipRef.current;
    const measuredH = el ? Math.max(el.scrollHeight, el.getBoundingClientRect().height) : 0;
    const vwH = window.innerHeight;
    const fallbackEstH = Math.min(520, Math.max(400, Math.floor(vwH * 0.42)));
    const pos = computeVisitHighlightsPopoverPosition({
      anchorEl,
      x: hover.x,
      y: hover.y,
      cardEstH: measuredH > 120 ? measuredH : fallbackEstH,
    });
    setHoverTooltipLayout({ pos, ready: true });
  }, [hover, hoverAppt, hoverTooltipLayout]);

  /** As Visit Highlights content loads (alternate address, patient sex), grow scroll area only — do not re-anchor. */
  useLayoutEffect(() => {
    if (!hover || !hoverTooltipLayout?.ready) return;
    const el = hoverTooltipRef.current;
    const measuredH = el ? Math.max(el.scrollHeight, el.getBoundingClientRect().height) : 0;
    if (measuredH <= 120) return;
    const vwH = window.innerHeight;
    const fallbackEstH = Math.min(520, Math.max(400, Math.floor(vwH * 0.42)));
    const nextMaxCardH = Math.max(measuredH, fallbackEstH, hoverTooltipLayout.pos.maxCardH);
    const clampedMaxH = Math.min(nextMaxCardH, vwH - 16);
    setHoverTooltipLayout((prev) => {
      if (!prev?.ready) return prev;
      if (prev.pos.maxCardH === clampedMaxH) return prev;
      return { pos: { ...prev.pos, maxCardH: clampedMaxH }, ready: true };
    });
  }, [hover?.appt.id, hoverAppt, hoverTooltipLayout?.ready]);

  const showTimeGrid = view === 'week' || view === 'day';

  const [editPreviewAnchorRect, setEditPreviewAnchorRect] = useState<HoverAnchorRect | null>(null);
  const [editPreviewDayColumnRect, setEditPreviewDayColumnRect] =
    useState<HoverAnchorRect | null>(null);
  const [routingPreviewAnchorRect, setRoutingPreviewAnchorRect] =
    useState<HoverAnchorRect | null>(null);
  const [routingPreviewDayColumnRect, setRoutingPreviewDayColumnRect] =
    useState<HoverAnchorRect | null>(null);

  const refreshEditPreviewAnchor = useCallback(() => {
    let slotEl = document.querySelector('[data-edit-time-preview="1"]');
    if (!(slotEl instanceof HTMLElement) && editTimePreview?.appointmentId != null) {
      const byId = document.querySelector(
        `[data-appt-id="${CSS.escape(String(editTimePreview.appointmentId))}"]`
      );
      if (byId instanceof HTMLElement) slotEl = byId;
    }
    const columnEl = slotEl instanceof HTMLElement ? slotEl.closest('.scheduler-day-col') : null;
    setEditPreviewAnchorRect(rectFromElement(slotEl instanceof HTMLElement ? slotEl : null));
    setEditPreviewDayColumnRect(
      rectFromElement(columnEl instanceof HTMLElement ? columnEl : null)
    );
  }, [editTimePreview?.appointmentId]);

  const refreshRoutingPreviewAnchor = useCallback(() => {
    const el = document.querySelector('[data-routing-preview-slot="1"]');
    const slotEl = el instanceof HTMLElement ? el : null;
    const columnEl = slotEl?.closest('.scheduler-day-col');
    setRoutingPreviewAnchorRect(rectFromElement(slotEl));
    setRoutingPreviewDayColumnRect(
      rectFromElement(columnEl instanceof HTMLElement ? columnEl : null)
    );
  }, []);

  useLayoutEffect(() => {
    if (!editTimePreview) {
      setEditPreviewAnchorRect(null);
      return;
    }
    refreshEditPreviewAnchor();
    const onScrollOrResize = () => refreshEditPreviewAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const raf = requestAnimationFrame(refreshEditPreviewAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [
    editTimePreview,
    editPreviewScoreCompare,
    editPreviewScoreLoading,
    loading,
    showTimeGrid,
    refreshEditPreviewAnchor,
  ]);

  const staffConfirmAppt = useMemo(() => {
    if (!staffConfirmPreview) return null;
    const targetId = staffConfirmPreview.bookedAppointmentId;
    return (
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      null
    );
  }, [staffConfirmPreview, rawAppointments, calendarAppointments]);

  const [staffConfirmApptResolved, setStaffConfirmApptResolved] = useState<Appointment | null>(
    null,
  );

  useEffect(() => {
    if (!staffConfirmPreview) {
      setStaffConfirmApptResolved(null);
      return;
    }
    if (staffConfirmAppt) {
      setStaffConfirmApptResolved(staffConfirmAppt);
      return;
    }
    let cancelled = false;
    void fetchAppointmentById(staffConfirmPreview.bookedAppointmentId, {
      practiceId: PRACTICE_ID,
    }).then((appt) => {
      if (!cancelled && appt) setStaffConfirmApptResolved(appt);
    });
    return () => {
      cancelled = true;
    };
  }, [staffConfirmPreview, staffConfirmAppt]);

  useEffect(() => {
    if (!staffConfirmPreview) {
      setStaffConfirmRequestData(null);
      setStaffConfirmRequestDataReady(false);
      return;
    }
    let cancelled = false;
    setStaffConfirmRequestDataReady(false);
    void fetchAppointmentRequestSubmission(staffConfirmPreview.submissionId)
      .then((submission) => {
        if (!cancelled) setStaffConfirmRequestData(submission.requestData ?? {});
      })
      .catch(() => {
        if (!cancelled) setStaffConfirmRequestData({});
      })
      .finally(() => {
        if (!cancelled) setStaffConfirmRequestDataReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [staffConfirmPreview?.submissionId]);

  const staffConfirmApptForPopover = staffConfirmApptResolved ?? staffConfirmAppt;

  const calendarApptsForHouseholdLookup = useMemo(
    () => (calendarAppointments.length > 0 ? calendarAppointments : rawAppointments),
    [calendarAppointments, rawAppointments],
  );

  const staffConfirmHouseholdAppts = useMemo(() => {
    if (!staffConfirmApptForPopover) return [];
    return resolveHouseholdVisitAppointments(
      staffConfirmApptForPopover,
      calendarApptsForHouseholdLookup,
      PRACTICE_TZ,
      { clientLabel: staffConfirmPreview?.clientLabel },
    );
  }, [
    staffConfirmApptForPopover,
    calendarApptsForHouseholdLookup,
    staffConfirmPreview?.clientLabel,
  ]);

  const staffConfirmHouseholdEditChoices = useMemo(
    () =>
      staffConfirmHouseholdEditChoiceLabels(
        staffConfirmHouseholdAppts,
        staffConfirmRequestData,
        petEditChoiceLabelForAppointment,
      ),
    [staffConfirmHouseholdAppts, staffConfirmRequestData],
  );

  const staffConfirmEditingAppt = useMemo(() => {
    if (!staffConfirmEditing) return staffConfirmApptForPopover;
    const targetId = staffConfirmEditingApptId ?? staffConfirmPreview?.bookedAppointmentId;
    if (targetId == null) return staffConfirmApptForPopover;
    return (
      staffConfirmHouseholdAppts.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      staffConfirmApptForPopover
    );
  }, [
    staffConfirmEditing,
    staffConfirmEditingApptId,
    staffConfirmPreview?.bookedAppointmentId,
    staffConfirmHouseholdAppts,
    rawAppointments,
    calendarAppointments,
    staffConfirmApptForPopover,
  ]);

  const staffConfirmLinkPreferredPatientName = useMemo(() => {
    if (!staffConfirmEditingAppt || !staffConfirmRequestData) return null;
    return appointmentRequestPetNameForVisit(staffConfirmEditingAppt, staffConfirmRequestData);
  }, [staffConfirmEditingAppt, staffConfirmRequestData]);

  const staffConfirmClientContact = useMemo(
    () => previewClientContactFromAppointment(staffConfirmApptForPopover, providers),
    [staffConfirmApptForPopover, providers]
  );

  const staffConfirmLinkedClientLabel = useMemo(
    () => appointmentLinkedClientLabel(staffConfirmApptForPopover),
    [staffConfirmApptForPopover]
  );

  const staffConfirmHouseholdApptIds = useMemo(
    () => staffConfirmHouseholdAppts.map((a) => String(a.id)).join(','),
    [staffConfirmHouseholdAppts],
  );

  const staffConfirmHouseholdApptTypeIds = useMemo(
    () =>
      staffConfirmHouseholdAppts
        .map(
          (a) =>
            a.appointmentType?.id ??
            (a as { appointmentTypeId?: number }).appointmentTypeId ??
            '',
        )
        .join(','),
    [staffConfirmHouseholdAppts],
  );

  const staffConfirmHouseholdApptSlotTimes = useMemo(
    () =>
      staffConfirmHouseholdAppts
        .map((a) => `${a.appointmentStart ?? ''}|${a.appointmentEnd ?? ''}`)
        .join(','),
    [staffConfirmHouseholdAppts],
  );

  const [staffConfirmRecommendedLength, setStaffConfirmRecommendedLength] =
    useState<StaffConfirmRecommendedLength | null>(null);
  const [staffConfirmRecommendedLengthLoading, setStaffConfirmRecommendedLengthLoading] =
    useState(false);

  useEffect(() => {
    if (!staffConfirmPreview || !staffConfirmApptForPopover || !staffConfirmRequestDataReady) {
      setStaffConfirmRecommendedLength(null);
      setStaffConfirmRecommendedLengthLoading(false);
      return;
    }

    let cancelled = false;
    setStaffConfirmRecommendedLengthLoading(true);

    void resolveStaffConfirmRecommendedLength({
      practiceId: PRACTICE_ID,
      requestData: staffConfirmRequestData ?? {},
      appt: staffConfirmApptForPopover,
      householdAppts: staffConfirmHouseholdAppts,
      isNewClient: staffConfirmPreview.isNewClient === true,
      appointmentTypes: typeList,
      appointmentTypeCatalog: typeCatalog,
      providers,
    })
      .then((result) => {
        if (!cancelled) setStaffConfirmRecommendedLength(result);
      })
      .catch(() => {
        if (!cancelled) setStaffConfirmRecommendedLength(null);
      })
      .finally(() => {
        if (!cancelled) setStaffConfirmRecommendedLengthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    staffConfirmPreview?.submissionId,
    staffConfirmPreview?.isNewClient,
    staffConfirmRequestDataReady,
    staffConfirmRequestData,
    staffConfirmApptForPopover?.id,
    staffConfirmApptForPopover?.appointmentEnd,
    staffConfirmHouseholdApptIds,
    staffConfirmHouseholdApptTypeIds,
    staffConfirmHouseholdApptSlotTimes,
    typeList,
    typeCatalog,
    providers,
    staffConfirmApptForPopover,
    staffConfirmHouseholdAppts,
    staffConfirmPreview,
  ]);

  const editPreviewBookedAppt = useMemo(() => {
    if (!editTimePreview) return null;
    if (editAppt?.id === editTimePreview.appointmentId) return editAppt;
    return rawAppointments.find((a) => a.id === editTimePreview.appointmentId) ?? null;
  }, [editTimePreview, editAppt, rawAppointments]);

  const editPreviewClientContact = useMemo(
    () => previewClientContactFromAppointment(editPreviewBookedAppt, providers),
    [editPreviewBookedAppt, providers]
  );

  const editPreviewPopoverPos = useMemo(() => {
    if (!editTimePreview) return null;
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    if (editPreviewAnchorRect) {
      return computeEditPreviewPopoverPosition({
        slotAnchor: editPreviewAnchorRect,
        dayColumnAnchor: editPreviewDayColumnRect,
        vwW,
        vwH,
        cardW: 300,
        cardEstH: 420,
        padding: 12,
        gutter: 10,
      });
    }
    return fallbackEditPreviewPopoverPosition({
      vwW,
      vwH,
      cardW: 300,
      cardEstH: 420,
      padding: 12,
    });
  }, [editTimePreview, editPreviewAnchorRect, editPreviewDayColumnRect, editPreviewScoreCompare]);

  /** Preview slot may mount after drive refresh — retry anchor until the calendar paints. */
  useEffect(() => {
    if (!editTimePreview || editPreviewAnchorRect) return;
    if (!showTimeGrid) return;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      refreshEditPreviewAnchor();
    };
    tick();
    const id = window.setInterval(() => {
      if (attempts >= 24) {
        window.clearInterval(id);
        return;
      }
      tick();
    }, 100);
    return () => window.clearInterval(id);
  }, [
    editTimePreview,
    editPreviewAnchorRect,
    loading,
    showTimeGrid,
    refreshEditPreviewAnchor,
  ]);

  useLayoutEffect(() => {
    if (!routingPreview) {
      setRoutingPreviewAnchorRect(null);
      return;
    }
    refreshRoutingPreviewAnchor();
    const onScrollOrResize = () => refreshRoutingPreviewAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const raf = requestAnimationFrame(refreshRoutingPreviewAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [routingPreview, loading, showTimeGrid, refreshRoutingPreviewAnchor]);

  const routingPreviewPopoverPos = useMemo(() => {
    if (!routingPreview) return null;
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    if (routingPreviewAnchorRect) {
      return computeEditPreviewPopoverPosition({
        slotAnchor: routingPreviewAnchorRect,
        dayColumnAnchor: routingPreviewDayColumnRect,
        vwW,
        vwH,
        cardW: 300,
        cardEstH: 360,
        padding: 12,
        gutter: 10,
      });
    }
    return {
      left: Math.max(12, (vwW - 300) / 2),
      top: 72,
      width: 300,
      maxCardH: Math.min(400, Math.max(220, vwH - 160)),
    };
  }, [routingPreview, routingPreviewAnchorRect, routingPreviewDayColumnRect]);

  const [staffConfirmAnchorRect, setStaffConfirmAnchorRect] = useState<HoverAnchorRect | null>(
    null,
  );
  const [staffConfirmDayColumnRect, setStaffConfirmDayColumnRect] =
    useState<HoverAnchorRect | null>(null);

  const refreshStaffConfirmAnchor = useCallback(() => {
    const apptId = staffConfirmPreview?.bookedAppointmentId;
    if (apptId == null) {
      setStaffConfirmAnchorRect(null);
      setStaffConfirmDayColumnRect(null);
      return;
    }
    const slotEl = document.querySelector(
      `[data-appt-id="${CSS.escape(String(apptId))}"]`,
    );
    const columnEl = slotEl instanceof HTMLElement ? slotEl.closest('.scheduler-day-col') : null;
    setStaffConfirmAnchorRect(rectFromElement(slotEl instanceof HTMLElement ? slotEl : null));
    setStaffConfirmDayColumnRect(
      rectFromElement(columnEl instanceof HTMLElement ? columnEl : null),
    );
  }, [staffConfirmPreview?.bookedAppointmentId]);

  useLayoutEffect(() => {
    if (!staffConfirmPreview) {
      setStaffConfirmAnchorRect(null);
      setStaffConfirmDayColumnRect(null);
      return;
    }
    refreshStaffConfirmAnchor();
    const onScrollOrResize = () => refreshStaffConfirmAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const raf = requestAnimationFrame(refreshStaffConfirmAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [
    staffConfirmPreview,
    staffConfirmApptForPopover?.id,
    staffConfirmApptForPopover?.appointmentStart,
    loading,
    showTimeGrid,
    refreshStaffConfirmAnchor,
  ]);

  useEffect(() => {
    if (!staffConfirmPreview || staffConfirmAnchorRect) return;
    if (!showTimeGrid) return;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      refreshStaffConfirmAnchor();
    };
    tick();
    const id = window.setInterval(() => {
      if (attempts >= 24) {
        window.clearInterval(id);
        return;
      }
      tick();
    }, 100);
    return () => window.clearInterval(id);
  }, [
    staffConfirmPreview,
    staffConfirmAnchorRect,
    loading,
    showTimeGrid,
    refreshStaffConfirmAnchor,
  ]);

  const staffConfirmPopoverPos = useMemo(() => {
    if (!staffConfirmPreview) return null;
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const cardW = staffConfirmEditing ? 720 : 380;
    const cardEstH = staffConfirmEditing
      ? Math.min(680, Math.max(360, vwH - 32))
      : 420;
    if (staffConfirmAnchorRect) {
      return computeEditPreviewPopoverPosition({
        slotAnchor: staffConfirmAnchorRect,
        dayColumnAnchor: staffConfirmDayColumnRect,
        vwW,
        vwH,
        cardW,
        cardEstH,
        padding: 12,
        gutter: 10,
      });
    }
    return fallbackEditPreviewPopoverPosition({ vwW, vwH, cardW, cardEstH, padding: 12 });
  }, [
    staffConfirmPreview,
    staffConfirmEditing,
    staffConfirmAnchorRect,
    staffConfirmDayColumnRect,
  ]);

  const onHoldVisitAppt = useMemo(() => {
    if (!onHoldVisitPreview) return null;
    const targetId = onHoldVisitPreview.bookedAppointmentId;
    return (
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      null
    );
  }, [onHoldVisitPreview, rawAppointments, calendarAppointments]);

  const [onHoldVisitApptResolved, setOnHoldVisitApptResolved] = useState<Appointment | null>(null);

  useEffect(() => {
    if (!onHoldVisitPreview) {
      setOnHoldVisitApptResolved(null);
      return;
    }
    if (onHoldVisitAppt) {
      setOnHoldVisitApptResolved(onHoldVisitAppt);
      return;
    }
    let cancelled = false;
    void fetchAppointmentById(onHoldVisitPreview.bookedAppointmentId, {
      practiceId: PRACTICE_ID,
    }).then((appt) => {
      if (!cancelled && appt) setOnHoldVisitApptResolved(appt);
    });
    return () => {
      cancelled = true;
    };
  }, [onHoldVisitPreview, onHoldVisitAppt]);

  useEffect(() => {
    if (!onHoldVisitPreview || onHoldVisitPreview.listKind !== 'appointment_request') {
      setOnHoldVisitRequestData(null);
      return;
    }
    let cancelled = false;
    void fetchAppointmentRequestSubmission(onHoldVisitPreview.listEntryId)
      .then((submission) => {
        if (!cancelled) setOnHoldVisitRequestData(submission.requestData ?? {});
      })
      .catch(() => {
        if (!cancelled) setOnHoldVisitRequestData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onHoldVisitPreview?.listEntryId, onHoldVisitPreview?.listKind]);

  const onHoldVisitApptForPopover = onHoldVisitApptResolved ?? onHoldVisitAppt;

  const onHoldVisitHouseholdAppts = useMemo(() => {
    if (!onHoldVisitApptForPopover) return [];
    return resolveHouseholdVisitAppointments(
      onHoldVisitApptForPopover,
      calendarApptsForHouseholdLookup,
      PRACTICE_TZ,
      { clientLabel: onHoldVisitPreview?.clientLabel },
    );
  }, [
    onHoldVisitApptForPopover,
    calendarApptsForHouseholdLookup,
    onHoldVisitPreview?.clientLabel,
  ]);

  const onHoldVisitHouseholdEditChoices = useMemo(
    () =>
      onHoldVisitRequestData
        ? staffConfirmHouseholdEditChoiceLabels(
            onHoldVisitHouseholdAppts,
            onHoldVisitRequestData,
            petEditChoiceLabelForAppointment,
          )
        : onHoldVisitHouseholdAppts
            .map((visitAppt) => ({
              appointmentId: Number(visitAppt.id),
              label: petEditChoiceLabelForAppointment(visitAppt),
            }))
            .filter((row) => Number.isFinite(row.appointmentId) && row.appointmentId > 0),
    [onHoldVisitHouseholdAppts, onHoldVisitRequestData],
  );

  const onHoldVisitEditingAppt = useMemo(() => {
    if (!onHoldVisitEditing) return onHoldVisitApptForPopover;
    const targetId = onHoldVisitEditingApptId ?? onHoldVisitPreview?.bookedAppointmentId;
    if (targetId == null) return onHoldVisitApptForPopover;
    return (
      onHoldVisitHouseholdAppts.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      onHoldVisitApptForPopover
    );
  }, [
    onHoldVisitEditing,
    onHoldVisitEditingApptId,
    onHoldVisitPreview?.bookedAppointmentId,
    onHoldVisitHouseholdAppts,
    rawAppointments,
    calendarAppointments,
    onHoldVisitApptForPopover,
  ]);

  const onHoldVisitLinkPreferredPatientName = useMemo(() => {
    if (!onHoldVisitEditingAppt || !onHoldVisitRequestData) return null;
    return appointmentRequestPetNameForVisit(onHoldVisitEditingAppt, onHoldVisitRequestData);
  }, [onHoldVisitEditingAppt, onHoldVisitRequestData]);

  const onHoldVisitClientContact = useMemo(
    () => previewClientContactFromAppointment(onHoldVisitApptForPopover, providers),
    [onHoldVisitApptForPopover, providers],
  );

  const onHoldVisitLinkedClientLabel = useMemo(
    () => appointmentLinkedClientLabel(onHoldVisitApptForPopover),
    [onHoldVisitApptForPopover],
  );

  const onHoldVisitHouseholdApptTypeIds = useMemo(
    () =>
      onHoldVisitHouseholdAppts
        .map(
          (a) =>
            a.appointmentType?.id ??
            (a as { appointmentTypeId?: number }).appointmentTypeId ??
            '',
        )
        .join(','),
    [onHoldVisitHouseholdAppts],
  );

  const onHoldVisitHouseholdApptSlotTimes = useMemo(
    () =>
      onHoldVisitHouseholdAppts
        .map((a) => `${a.appointmentStart ?? ''}|${a.appointmentEnd ?? ''}`)
        .join(','),
    [onHoldVisitHouseholdAppts],
  );

  const [onHoldVisitConvertedRecommendedLength, setOnHoldVisitConvertedRecommendedLength] =
    useState<StaffConfirmRecommendedLength | null>(null);
  const [onHoldVisitConvertedRecommendedLengthLoading, setOnHoldVisitConvertedRecommendedLengthLoading] =
    useState(false);

  useEffect(() => {
    if (onHoldVisitConvertedExitKind !== 'booked' || !onHoldVisitApptForPopover) {
      setOnHoldVisitConvertedRecommendedLength(null);
      setOnHoldVisitConvertedRecommendedLengthLoading(false);
      return;
    }

    let cancelled = false;
    setOnHoldVisitConvertedRecommendedLengthLoading(true);

    void resolveStaffConfirmRecommendedLength({
      practiceId: PRACTICE_ID,
      requestData: onHoldVisitRequestData ?? {},
      appt: onHoldVisitApptForPopover,
      householdAppts: onHoldVisitHouseholdAppts,
      appointmentTypes: typeList,
      appointmentTypeCatalog: typeCatalog,
      providers,
    })
      .then((result) => {
        if (!cancelled) setOnHoldVisitConvertedRecommendedLength(result);
      })
      .catch(() => {
        if (!cancelled) setOnHoldVisitConvertedRecommendedLength(null);
      })
      .finally(() => {
        if (!cancelled) setOnHoldVisitConvertedRecommendedLengthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    onHoldVisitConvertedExitKind,
    onHoldVisitApptForPopover?.id,
    onHoldVisitApptForPopover?.appointmentEnd,
    onHoldVisitApptForPopover?.appointmentStart,
    onHoldVisitHouseholdAppts,
    onHoldVisitHouseholdApptTypeIds,
    onHoldVisitHouseholdApptSlotTimes,
    onHoldVisitRequestData,
    typeList,
    typeCatalog,
    providers,
    onHoldVisitApptForPopover,
  ]);

  const [onHoldVisitAnchorRect, setOnHoldVisitAnchorRect] = useState<HoverAnchorRect | null>(null);
  const [onHoldVisitDayColumnRect, setOnHoldVisitDayColumnRect] =
    useState<HoverAnchorRect | null>(null);

  const refreshOnHoldVisitAnchor = useCallback(() => {
    const apptId = onHoldVisitPreview?.bookedAppointmentId;
    if (apptId == null) {
      setOnHoldVisitAnchorRect(null);
      setOnHoldVisitDayColumnRect(null);
      return;
    }
    const slotEl = document.querySelector(
      `[data-appt-id="${CSS.escape(String(apptId))}"]`,
    );
    const columnEl = slotEl instanceof HTMLElement ? slotEl.closest('.scheduler-day-col') : null;
    setOnHoldVisitAnchorRect(rectFromElement(slotEl instanceof HTMLElement ? slotEl : null));
    setOnHoldVisitDayColumnRect(
      rectFromElement(columnEl instanceof HTMLElement ? columnEl : null),
    );
  }, [onHoldVisitPreview?.bookedAppointmentId]);

  useLayoutEffect(() => {
    if (!onHoldVisitPreview) {
      setOnHoldVisitAnchorRect(null);
      setOnHoldVisitDayColumnRect(null);
      return;
    }
    refreshOnHoldVisitAnchor();
    const onScrollOrResize = () => refreshOnHoldVisitAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const raf = requestAnimationFrame(refreshOnHoldVisitAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [
    onHoldVisitPreview,
    onHoldVisitApptForPopover?.id,
    onHoldVisitApptForPopover?.appointmentStart,
    loading,
    showTimeGrid,
    refreshOnHoldVisitAnchor,
  ]);

  useEffect(() => {
    if (!onHoldVisitPreview || onHoldVisitAnchorRect) return;
    if (!showTimeGrid) return;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      refreshOnHoldVisitAnchor();
    };
    tick();
    const id = window.setInterval(() => {
      if (attempts >= 24) {
        window.clearInterval(id);
        return;
      }
      tick();
    }, 100);
    return () => window.clearInterval(id);
  }, [
    onHoldVisitPreview,
    onHoldVisitAnchorRect,
    loading,
    showTimeGrid,
    refreshOnHoldVisitAnchor,
  ]);

  const onHoldVisitPopoverPos = useMemo(() => {
    if (!onHoldVisitPreview) return null;
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const cardW = onHoldVisitEditing ? 720 : 380;
    const cardEstH = onHoldVisitEditing
      ? Math.min(680, Math.max(360, vwH - 32))
      : onHoldVisitConvertedExitKind === 'booked'
        ? 560
        : 420;
    if (onHoldVisitAnchorRect) {
      return computeEditPreviewPopoverPosition({
        slotAnchor: onHoldVisitAnchorRect,
        dayColumnAnchor: onHoldVisitDayColumnRect,
        vwW,
        vwH,
        cardW,
        cardEstH,
        padding: 12,
        gutter: 10,
      });
    }
    return fallbackEditPreviewPopoverPosition({ vwW, vwH, cardW, cardEstH, padding: 12 });
  }, [
    onHoldVisitPreview,
    onHoldVisitEditing,
    onHoldVisitConvertedExitKind,
    onHoldVisitAnchorRect,
    onHoldVisitDayColumnRect,
  ]);

  const slotOfferReviewAppt = useMemo(() => {
    if (!slotOfferReviewPreview) return null;
    const targetId = slotOfferReviewPreview.bookedAppointmentId;
    return (
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      null
    );
  }, [slotOfferReviewPreview, rawAppointments, calendarAppointments]);

  const [slotOfferReviewApptResolved, setSlotOfferReviewApptResolved] = useState<Appointment | null>(
    null,
  );

  useEffect(() => {
    if (!slotOfferReviewPreview) {
      setSlotOfferReviewApptResolved(null);
      return;
    }
    if (slotOfferReviewAppt) {
      setSlotOfferReviewApptResolved(slotOfferReviewAppt);
      return;
    }
    let cancelled = false;
    void fetchAppointmentById(slotOfferReviewPreview.bookedAppointmentId, {
      practiceId: PRACTICE_ID,
    }).then((appt) => {
      if (!cancelled && appt) setSlotOfferReviewApptResolved(appt);
    });
    return () => {
      cancelled = true;
    };
  }, [slotOfferReviewPreview, slotOfferReviewAppt]);

  const slotOfferReviewApptForPopover = slotOfferReviewApptResolved ?? slotOfferReviewAppt;

  const [slotOfferReviewAnchorRect, setSlotOfferReviewAnchorRect] = useState<HoverAnchorRect | null>(
    null,
  );
  const [slotOfferReviewDayColumnRect, setSlotOfferReviewDayColumnRect] =
    useState<HoverAnchorRect | null>(null);

  const refreshSlotOfferReviewAnchor = useCallback(() => {
    const apptId = slotOfferReviewPreview?.bookedAppointmentId;
    if (apptId == null) {
      setSlotOfferReviewAnchorRect(null);
      setSlotOfferReviewDayColumnRect(null);
      return;
    }
    const slotEl = document.querySelector(`[data-appt-id="${CSS.escape(String(apptId))}"]`);
    const columnEl = slotEl instanceof HTMLElement ? slotEl.closest('.scheduler-day-col') : null;
    setSlotOfferReviewAnchorRect(rectFromElement(slotEl instanceof HTMLElement ? slotEl : null));
    setSlotOfferReviewDayColumnRect(
      rectFromElement(columnEl instanceof HTMLElement ? columnEl : null),
    );
  }, [slotOfferReviewPreview?.bookedAppointmentId]);

  useLayoutEffect(() => {
    if (!slotOfferReviewPreview) {
      setSlotOfferReviewAnchorRect(null);
      setSlotOfferReviewDayColumnRect(null);
      return;
    }
    refreshSlotOfferReviewAnchor();
    const onScrollOrResize = () => refreshSlotOfferReviewAnchor();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    const raf = requestAnimationFrame(refreshSlotOfferReviewAnchor);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [
    slotOfferReviewPreview,
    slotOfferReviewApptForPopover?.id,
    slotOfferReviewApptForPopover?.appointmentStart,
    loading,
    showTimeGrid,
    refreshSlotOfferReviewAnchor,
  ]);

  useEffect(() => {
    if (!slotOfferReviewPreview || slotOfferReviewAnchorRect) return;
    if (!showTimeGrid) return;
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      refreshSlotOfferReviewAnchor();
    };
    tick();
    const id = window.setInterval(() => {
      if (attempts >= 24) {
        window.clearInterval(id);
        return;
      }
      tick();
    }, 100);
    return () => window.clearInterval(id);
  }, [
    slotOfferReviewPreview,
    slotOfferReviewAnchorRect,
    loading,
    showTimeGrid,
    refreshSlotOfferReviewAnchor,
  ]);

  const slotOfferReviewPopoverPos = useMemo(() => {
    if (!slotOfferReviewPreview) return null;
    const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const cardW = 380;
    const cardEstH = 420;
    if (slotOfferReviewAnchorRect) {
      return computeEditPreviewPopoverPosition({
        slotAnchor: slotOfferReviewAnchorRect,
        dayColumnAnchor: slotOfferReviewDayColumnRect,
        vwW,
        vwH,
        cardW,
        cardEstH,
        padding: 12,
        gutter: 10,
      });
    }
    return fallbackEditPreviewPopoverPosition({ vwW, vwH, cardW, cardEstH, padding: 12 });
  }, [slotOfferReviewPreview, slotOfferReviewAnchorRect, slotOfferReviewDayColumnRect]);

  /** Scroll to the proposed slot once per routing preview candidate (after grid paint). */
  const routingPreviewScrollSigRef = useRef<string>('');
  useEffect(() => {
    if (loading) routingPreviewScrollSigRef.current = '';
  }, [loading]);

  useLayoutEffect(() => {
    if (!routingPreview?.option?.suggestedStartIso) {
      routingPreviewScrollSigRef.current = '';
      return;
    }
    if (!showTimeGrid || loading || driveEtaLoading) return;

    const opt = routingPreview.option;
    const sig = [
      String(opt.suggestedStartIso),
      String(opt.date ?? ''),
      String(opt.doctorPimsId ?? ''),
      routingPreviewColumnKey ?? '',
      anchorDate ?? '',
    ].join('|');

    if (routingPreviewScrollSigRef.current === sig) {
      refreshRoutingPreviewAnchor();
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24;

    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;
      const el = document.querySelector('[data-routing-preview-slot="1"]');
      if (!(el instanceof HTMLElement)) {
        if (attempts < maxAttempts) {
          requestAnimationFrame(tryScroll);
        }
        return;
      }

      scrollTimedGridElementIntoView(el, 'auto');
      routingPreviewScrollSigRef.current = sig;
      refreshRoutingPreviewAnchorAfterScroll(refreshRoutingPreviewAnchor, 'auto');
    };

    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [
    routingPreview,
    loading,
    driveEtaLoading,
    showTimeGrid,
    routingPreviewColumnKey,
    anchorDate,
    calendarAppointments,
    refreshRoutingPreviewAnchor,
  ]);

  const editTimePreviewScrollSigRef = useRef<string>('');
  useLayoutEffect(() => {
    if (!editTimePreview) {
      editTimePreviewScrollSigRef.current = '';
      return;
    }
    if (loading || !showTimeGrid) return;
    const sig = `${editTimePreview.appointmentId}|${editTimePreview.appointmentStart}|${editTimePreview.appointmentEnd}`;
    if (editTimePreviewScrollSigRef.current === sig) return;
    const el = document.querySelector('[data-edit-time-preview="1"]');
    if (!(el instanceof HTMLElement)) return;
    editTimePreviewScrollSigRef.current = sig;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
      });
    });
  }, [editTimePreview, loading, showTimeGrid]);

  const rescheduleSourceScrollSigRef = useRef<string>('');
  useLayoutEffect(() => {
    if (!embedInRoutingWorkspace || routingPreview || !rescheduleSourceHighlightIds?.size) {
      rescheduleSourceScrollSigRef.current = '';
      return;
    }
    if (loading || !showTimeGrid) return;
    const sig = [...rescheduleSourceHighlightIds].sort((a, b) => a - b).join(',');
    if (rescheduleSourceScrollSigRef.current === sig) return;
    const el = document.querySelector('[data-reschedule-source="1"]');
    if (!(el instanceof HTMLElement)) return;
    rescheduleSourceScrollSigRef.current = sig;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth', inline: 'nearest' });
      });
    });
  }, [
    embedInRoutingWorkspace,
    routingPreview,
    rescheduleSourceHighlightIds,
    loading,
    showTimeGrid,
    rescheduleIntentTick,
  ]);

  const practiceTodayIso = practiceClock.toISODate()!;
  const nowWallMinutes =
    practiceClock.hour * 60 + practiceClock.minute + practiceClock.second / 60;

  const handleDayBodyDoubleClick = useCallback(
    (e: MouseEvent<HTMLDivElement>, dayDt: DateTime) => {
      if (scheduleCalendarInteractionLock) {
        notifyScheduleCalendarLocked();
        return;
      }
      if (!canManualBookOnCalendar) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const rawMin = gridBounds.gridStartMin + y / PPM;
      const snapped = Math.round(rawMin / SLOT_MINUTES) * SLOT_MINUTES;
      const clamped = Math.max(
        gridBounds.gridStartMin,
        Math.min(gridBounds.gridEndMin - SLOT_MINUTES, snapped)
      );
      const dayStart = dayDt.setZone(PRACTICE_TZ).startOf('day');
      const start = dayStart.plus({ minutes: clamped });
      const end = start.plus({ minutes: 30 });
      setBookPrefill({ modalTitle: MANUAL_CALENDAR_BOOK_MODAL_TITLE });
      setBookSlot({ start, end });
    },
    [
      scheduleCalendarInteractionLock,
      notifyScheduleCalendarLocked,
      gridBounds.gridStartMin,
      gridBounds.gridEndMin,
      canManualBookOnCalendar,
    ]
  );

  const handleAllDayDoubleClick = useCallback(
    (dayDt: DateTime) => {
      if (scheduleCalendarInteractionLock) {
        notifyScheduleCalendarLocked();
        return;
      }
      if (!canManualBookOnCalendar) return;
      const start = dayDt.setZone(PRACTICE_TZ).startOf('day');
      const end = start.plus({ days: 1 });
      setBookPrefill({ allDay: true, modalTitle: MANUAL_CALENDAR_BOOK_MODAL_TITLE });
      setBookSlot({ start, end });
    },
    [scheduleCalendarInteractionLock, notifyScheduleCalendarLocked, canManualBookOnCalendar]
  );

  const focusRescheduleSourceOnCalendar = useCallback(() => {
    clearRoutingCalendarPreview();
    setRoutingPreview(null);
    setBookSlot(null);
    setBookPrefill(null);
    applyRescheduleCalendarFocusFromIntent();
    rescheduleSourceScrollSigRef.current = '';
    setRescheduleIntentTick((n) => n + 1);
    driveSoftRefreshRef.current = true;
    setDriveRefreshNonce((n) => n + 1);
  }, [applyRescheduleCalendarFocusFromIntent]);

  const dismissRoutingPreview = useCallback(() => {
    const activePreview = routingPreview ?? readRoutingCalendarPreview();
    if (isManualBookCalendarPreview(activePreview) && activePreview?.manualBookDraft) {
      const draft = activePreview.manualBookDraft;
      clearRoutingCalendarPreview();
      setRoutingPreview(null);
      const start = DateTime.fromISO(draft.appointmentStartIso, { zone: 'utc' }).setZone(PRACTICE_TZ);
      const end = DateTime.fromISO(draft.appointmentEndIso, { zone: 'utc' }).setZone(PRACTICE_TZ);
      setBookPrefill(manualBookPrefillFromDraft(draft));
      setBookSlot(start.isValid && end.isValid ? { start, end } : null);
      return;
    }
    const returnToScheduleLoader = scheduleLoaderReturnHref(activePreview);
    const returnToWaitlist = waitlistReturnHref(activePreview);
    const returnToOptimize = scheduleOptimizeReturnHref(activePreview);
    const returnToRescheduleSource = embedInRoutingWorkspace && readRoutingRescheduleIntent() != null;
    clearRoutingCalendarPreview();
    setRoutingPreview(null);
    setBookSlot(null);
    setBookPrefill(null);
    if (returnToScheduleLoader) {
      navigate(returnToScheduleLoader);
      return;
    }
    if (returnToWaitlist) {
      navigate(returnToWaitlist);
      return;
    }
    if (returnToOptimize) {
      clearRoutingRescheduleIntent();
      if (
        returnToOptimize !== '/schedule/scheduler' &&
        !returnToOptimize.startsWith('/schedule/scheduler?')
      ) {
        navigate(returnToOptimize);
      }
      return;
    }
    if (returnToRescheduleSource) {
      focusRescheduleSourceOnCalendar();
      return;
    }
    if (!embedInRoutingWorkspace) {
      navigate('/schedule/routing');
    }
  }, [navigate, embedInRoutingWorkspace, focusRescheduleSourceOnCalendar, routingPreview]);

  const returnToOptimizeFromPreview = useCallback(() => {
    const activePreview = routingPreview ?? readRoutingCalendarPreview();
    const fromCurrentView = Boolean(activePreview?.scheduleOptimizeReturn?.fromCurrentView);
    const currentView = readSchedulerFocusReturnSession()?.returnToOptimize;
    dismissRoutingPreview();
    if (fromCurrentView && currentView?.move && currentView.doctorId) {
      openScheduleOptimizeCurrentAppointment({
        move: currentView.move,
        listMove: activePreview?.scheduleOptimizeReturn?.listMove,
        fromDate: currentView.move.fromDate,
        doctorId: currentView.doctorId,
        doctorName: currentView.doctorName || 'Provider',
        practiceId: currentView.practiceId ?? PRACTICE_ID,
        queueItemId: currentView.queueItemId || currentView.move.id,
        navigate,
        returnHref: currentView.returnHref,
        reopenModal: currentView.reopenModal,
      });
      return;
    }
    const returnHref = scheduleOptimizeReturnHref(activePreview);
    if (
      isScheduleOptimizeCalendarPreview(activePreview) &&
      (!returnHref ||
        returnHref === '/schedule/scheduler' ||
        returnHref.startsWith('/schedule/scheduler?'))
    ) {
      setOptimizeModalOpen(true);
    }
  }, [dismissRoutingPreview, routingPreview, navigate]);

  const handleManualBookPreview = useCallback(
    (draft: ManualBookPreviewDraft) => {
      const doctorName =
        providers.find((p) => String(p.id) === String(draft.primaryProviderId))?.name ?? 'Provider';
      const payload = buildManualBookCalendarPreviewPayload({
        draft,
        doctorName,
        appointments: rawAppointments,
        practiceTz: PRACTICE_TZ,
      });
      writeRoutingCalendarPreview(payload);
      setRoutingPreview(payload);
      setProviderFilter(String(draft.primaryProviderId));
      const dayKey = DateTime.fromISO(draft.appointmentStartIso, { zone: 'utc' })
        .setZone(PRACTICE_TZ)
        .toISODate();
      if (dayKey) setAnchorDate(dayKey);
      setView('week');
      setShowByDriveTime(true);
      setBookSlot(null);
      setBookPrefill(null);
      driveSoftRefreshRef.current = true;
      setDriveRefreshNonce((n) => n + 1);
    },
    [providers, rawAppointments],
  );

  const dismissForwardBookingWorkspace = useCallback(() => {
    const intent = readRoutingForwardBookingIntent();
    const returnPath =
      intent?.origin === 'care_outreach'
        ? CARE_OUTREACH_LIST_PATH
        : intent?.origin === 'schedule_loader'
          ? intent.scheduleLoaderReturn?.returnHref?.trim() ||
            '/schedule/scheduling-tools/schedule-loader'
          : intent?.origin === 'waitlist'
            ? intent.waitlistReturn?.returnHref?.trim() ||
              '/schedule/scheduling-tools/waitlist'
            : FORWARD_BOOKING_LIST_PATH;
    const finishDismiss = () => {
      dismissRoutingForwardBookingWorkspace();
      setRoutingPreview(null);
      setForwardBookingIntentTick((n) => n + 1);
      setBookSlot(null);
      setBookPrefill(null);
      driveSoftRefreshRef.current = true;
      setDriveRefreshNonce((n) => n + 1);
      navigate(returnPath);
      notifySchedulingToolsNavCountsRefresh();
    };
    if (intent?.workspaceActive) {
      void abandonListOriginatedForwardBookingWorkspace(intent, PRACTICE_ID).finally(finishDismiss);
      return;
    }
    finishDismiss();
  }, [navigate]);

  const dismissAppointmentRequestWorkspace = useCallback(() => {
    const intent = readRoutingAppointmentRequestIntent();
    dismissRoutingAppointmentRequestWorkspace();
    setAppointmentRequestIntentTick((n) => n + 1);
    setBookSlot(null);
    setBookPrefill(null);
    driveSoftRefreshRef.current = true;
    setDriveRefreshNonce((n) => n + 1);
    returnFromAppointmentRequestWorkspace(navigate, intent);
  }, [navigate]);

  const dismissRescheduleWorkspace = useCallback(() => {
    const intent = readRoutingRescheduleIntent();
    const returningToGmail = Boolean(
      intent?.returnToGmail?.mailbox?.trim() && intent.returnToGmail.threadId?.trim()
    );
    if (intent && !returningToGmail) {
      const focus = rescheduleCalendarFocusFromIntent(intent, providers);
      if (focus?.anchorDate) setAnchorDate(focus.anchorDate);
      if (focus?.providerFilter) setProviderFilter(focus.providerFilter);
      setView('week');
      setShowByDriveTime(true);
    }
    dismissRoutingRescheduleWorkspace();
    setRescheduleIntentTick((n) => n + 1);
    setBookSlot(null);
    setBookPrefill(null);
    driveSoftRefreshRef.current = true;
    setDriveRefreshNonce((n) => n + 1);
    returnFromRescheduleWorkspace(navigate, intent);
  }, [navigate, providers]);

  useEffect(() => {
    if (!embedInRoutingWorkspace) return;
    const onFocusRescheduleSource = () => {
      focusRescheduleSourceOnCalendar();
    };
    window.addEventListener(ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT, onFocusRescheduleSource);
    return () =>
      window.removeEventListener(ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT, onFocusRescheduleSource);
  }, [embedInRoutingWorkspace, focusRescheduleSourceOnCalendar]);

  const exportPracticeDayMyDayPdf = useCallback(
    async (dayIso: string) => {
      const docId = resolvedPrimaryProviderId.trim();
      if (!docId) return;
      const day = driveDayByDate?.get(dayIso);
      if (!day?.households?.length) return;
      setPracticePdfExportingKey(dayIso);
      try {
        const doctorName = providers.find((p) => String(p.id) === docId)?.name ?? 'Provider';
        const tz = (day.timezone && day.timezone.trim()) || PRACTICE_TZ;
        let exportDay = day;
        let apptsById: Map<string, unknown> | undefined;
        try {
          const range = await fetchAppointmentsRangeForLocalDay({
            dateIso: dayIso,
            practiceTimeZone: tz,
            primaryProviderId: docId,
          });
          apptsById = new Map(range.map((a) => [String(a.id), a]));
          exportDay = {
            ...day,
            households: enrichWeekHouseholdsFromRangeAppointments(day.households, range),
          };
        } catch {
          /* range enrichment is optional */
        }
        const { stats, rows } = buildMyDayVisualPdfExportPayloadFromDayData({
          day: exportDay,
          showByDriveTime,
          practiceTimeZone: tz,
          dateIso: dayIso,
          apptsById,
        });
        const dateLabel = DateTime.fromISO(dayIso).toLocaleString(DateTime.DATE_MED);
        const safeName = doctorName.replace(/\s+/g, '_').replace(/[^\w.-]+/g, '');
        await exportMyDayVisualPdf({
          doctorName,
          dateLabel,
          showByDriveTime,
          practiceTimeZone: tz,
          stats,
          rows,
          filenameStem: `MyDay_Visual_${safeName}_${dayIso}`,
        });
      } catch (e) {
        console.error(e);
        setToast('Could not create PDF. Try again.');
      } finally {
        setPracticePdfExportingKey(null);
      }
    },
    [driveDayByDate, resolvedPrimaryProviderId, providers, showByDriveTime]
  );

  const openRoutingBookForm = useCallback((opts?: { exploreAlternatives?: boolean }) => {
    if (!routingPreview) return;
    const routingAddress = routingPreview.newApptMeta?.address?.trim();
    if (!routingAddress) {
      setToast('Missing address for this routing preview.');
      return;
    }
    const storedForwardBookingIntent = readRoutingForwardBookingIntent();
    const clientIdRaw =
      routingPreview.newApptMeta?.clientId?.trim() ||
      storedForwardBookingIntent?.clientId?.trim() ||
      (routingPreview.scheduleLoaderReturn?.clientId != null
        ? String(routingPreview.scheduleLoaderReturn.clientId)
        : '');
    const hasLinkedClient = Boolean(clientIdRaw) && Number.isFinite(Number(clientIdRaw));
    if (clientIdRaw && !Number.isFinite(Number(clientIdRaw))) {
      setToast('Invalid client on routing preview.');
      return;
    }
    const opt = routingPreview.option;
    const startUtc = DateTime.fromISO(String(opt.suggestedStartIso), { zone: 'utc' });
    if (!startUtc.isValid) {
      setToast('Invalid suggested start time.');
      return;
    }
    const mins = Math.max(1, Math.floor(routingPreview.serviceMinutes) || 30);
    const start = startUtc.setZone(PRACTICE_TZ);
    const end = start.plus({ minutes: mins });
    const isAdminOrSuper = rolesLower.includes('admin') || rolesLower.includes('superadmin');
    const ari = appointmentRequestWorkspaceIsActive() ? readRoutingAppointmentRequestIntent() : null;
    // Appointment-request Book is always a new visit. Ignore leftover reschedule
    // session/preview ids so we never PATCH another household appointment.
    const ri = ari ? null : readRoutingRescheduleIntent();
    const fbi = ari
      ? null
      : forwardBookingWorkspaceIsActive()
        ? storedForwardBookingIntent
        : isScheduleLoaderCalendarPreview(routingPreview) &&
            storedForwardBookingIntent?.origin === 'schedule_loader'
          ? storedForwardBookingIntent
          : isWaitlistCalendarPreview(routingPreview) &&
              storedForwardBookingIntent?.origin === 'waitlist'
            ? storedForwardBookingIntent
            : null;
    const previewPatientIds =
      routingPreview.previewPatients?.map((p) => String(p.id)).filter(Boolean) ?? [];
    const rescheduleTargets = ri
      ? previewPatientIds.length > 0
        ? rescheduleTargetsForChipSelection(ri, previewPatientIds)
        : rescheduleScopeTargets(ri)
      : null;
    const rescheduleIds = ari
      ? []
      : routingPreview.rescheduleAppointmentIds?.filter((id) => Number.isFinite(Number(id))) ??
        (routingPreview.rescheduleAppointmentId != null &&
        Number.isFinite(Number(routingPreview.rescheduleAppointmentId))
          ? [Number(routingPreview.rescheduleAppointmentId)]
          : rescheduleTargets?.appointmentIds ?? []);
    const routingUi = readRoutingUiBootstrap();
    const routingStatsTypeKey =
      routingPreview.routingStatsTypeKey?.trim() ||
      routingUi.routingApptStatsTypeKey?.trim() ||
      '';
    const chosenRoutingTypeId = resolveRoutingChosenAppointmentTypeId({
      statsTypeKey: routingStatsTypeKey,
      scheduleBookTypeId: routingUi.scheduleBookTypeId,
      types: typeList,
      previewTypeId: routingPreview.appointmentTypeId,
      previewTypeChosenInRouting: routingPreview.appointmentTypeChosenInRouting,
    });
    const rescheduleTypeOverride =
      routingStatsTypeKey.trim() && (rescheduleTargets?.visits.length ?? 0) <= 1
        ? chosenRoutingTypeId
        : undefined;
    const rescheduleVisitPatches =
      rescheduleTargets && rescheduleTargets.visits.length > 0
        ? buildRescheduleVisitPatches(
            rescheduleTargets.visits,
            rawAppointments,
            PRACTICE_TZ,
            rescheduleTypeOverride,
            typeList
          )
        : undefined;
    const rescheduleId = rescheduleIds[0];
    const isReschedule = rescheduleId != null && Number.isFinite(Number(rescheduleId));
    const exploreBook = Boolean(opts?.exploreAlternatives ?? ri?.exploreAlternatives);
    const fbiTargets =
      fbi && !isReschedule
        ? previewPatientIds.length > 0
          ? forwardBookingEntriesForChipSelection(fbi, previewPatientIds)
          : forwardBookingScopeTargets(fbi)
        : null;
    const fbiGroupBook = fbiTargets != null && fbiTargets.entries.length > 1;
    /** Internal id from the chosen routing slot — target doctor when rescheduling cross-doctor. */
    const routingSlotProviderId = String(opt.doctorPimsId ?? '').trim() || undefined;
    const rescheduleSourceAppt = isReschedule
      ? rawAppointments.find((a) => a.id === Number(rescheduleId))
      : undefined;
    const routingBookKeepPatientIds = [
      ...previewPatientIds,
      ...(fbiTargets?.entries.map((row) => String(row.patientId)) ?? []),
      ...(fbi?.patientId ? [String(fbi.patientId)] : []),
      ...(ri?.patientId ? [String(ri.patientId)] : []),
    ].filter(Boolean);
    const slotExclude = hasLinkedClient
      ? filterSlotExcludeForRoutingBook(
          excludePatientIdsAtSlot(
            clientIdRaw!,
            start.toMillis(),
            end.toMillis(),
            rawAppointments
          ),
          routingBookKeepPatientIds
        )
      : undefined;
    void (async () => {
      let ariVisitPatches: ReturnType<typeof buildAppointmentRequestBookVisitPatches> | undefined;
      if (ari && !isReschedule) {
        const selectedIds = previewPatientIds.length > 0 ? previewPatientIds : [];
        try {
          const submission = await fetchAppointmentRequestSubmission(
            ari.appointmentRequestSubmissionId,
          );
          ariVisitPatches = buildAppointmentRequestBookVisitPatchesFromRequestData(
            ari.appointmentRequestSubmissionId,
            submission.requestData ?? {},
            selectedIds,
            typeList,
            ari.description,
          );
        } catch {
          ariVisitPatches = buildAppointmentRequestBookVisitPatches(
            ari,
            selectedIds,
            typeList,
            ari.description,
          );
        }
      }
    const ariMultiPetBook = (ariVisitPatches?.length ?? 0) > 1;
    const routingPreviewPatientRows =
      routingPreview.previewPatients?.map((p) => ({
        id: String(p.id),
        name: String(p.name ?? '').trim() || `Patient ${p.id}`,
      })) ??
      (ariVisitPatches?.length
        ? ariVisitPatches.map((row) => ({
            id: row.patientId,
            name: row.patientName,
          }))
        : fbi?.patientId
        ? [
            {
              id: String(fbi.patientId),
              name: fbi.patientName?.trim() || `Patient ${fbi.patientId}`,
            },
          ]
        : undefined);
    const preferredPatientIdsForBook = !isReschedule
      ? ariMultiPetBook && ariVisitPatches?.length
        ? ariVisitPatches.map((row) => row.patientId).filter(Boolean)
        : fbiGroupBook
        ? fbiTargets!.entries.map((row) => row.patientId)
        : previewPatientIds.length > 0
          ? previewPatientIds
          : fbi?.patientId
            ? [String(fbi.patientId)]
            : ariVisitPatches?.length === 1
              ? [ariVisitPatches[0]!.patientId]
              : undefined
      : undefined;
    const routingAlternateForBook = resolveRoutingBookAlternateAddress({
      hasLinkedClient,
      routingAddress,
      intent: ri,
      previewUsesAlternateAddress: routingPreview.routingUsesAlternateAddress,
      sourceAppt: rescheduleSourceAppt,
    });
    const forwardBookingCreatedVia =
      fbi?.origin === 'care_outreach'
        ? ('care_outreach' as const)
        : routingPreview.previewSource === 'schedule-loader'
          ? ('schedule_loader' as const)
          : routingPreview.previewSource === 'waitlist'
            ? ('waitlist' as const)
            : undefined;
    const insertionIndexRaw = opt.insertionIndex;
    const insertionIndex =
      typeof insertionIndexRaw === 'number' && Number.isFinite(insertionIndexRaw)
        ? Math.floor(insertionIndexRaw)
        : Number(insertionIndexRaw);
    let preFirstNeighborBump:
      | {
          appointmentId: number;
          appointmentStart: string;
          appointmentEnd: string;
        }
      | undefined;
    if (
      !isReschedule &&
      insertionIndex === 0 &&
      routingSlotProviderId &&
      start.isValid &&
      end.isValid
    ) {
      const dayIso = start.toISODate();
      const startIso = start.toUTC().toISO();
      const endIso = end.toUTC().toISO();
      if (dayIso && startIso && endIso) {
        const dayData = driveDayByDate?.get(dayIso) ?? null;
        const formerFirst = findFormerFirstAppointmentForPreFirstBook({
          appointments: rawAppointments,
          providerId: routingSlotProviderId,
          dayIso,
          practiceTz: PRACTICE_TZ,
        });
        const formerSlot = formerFirst
          ? driveSlotForAppointmentId(dayData, formerFirst.id)
          : null;
        const bump = resolvePreFirstNeighborBumpTarget({
          insertionIndex: 0,
          suggestedStartIso: startIso,
          suggestedEndIso: endIso,
          practiceTz: PRACTICE_TZ,
          providerId: routingSlotProviderId,
          appointments: rawAppointments,
          formerFirstDriveSlot: formerSlot,
        });
        if (bump) preFirstNeighborBump = bump;
      }
    }
    setBookPrefill({
      ...(hasLinkedClient
        ? {
            clientId: clientIdRaw,
            clientLabel:
              routingPreview.clientDisplayLabel?.trim() ||
              fbi?.clientDisplayLabel?.trim() ||
              undefined,
            lockClient: !isAdminOrSuper,
            disableClientSearch: true,
            excludePatientIds: !isReschedule ? slotExclude : undefined,
            preferredPatientIds: preferredPatientIdsForBook,
            ...(routingPreviewPatientRows?.length
              ? { routingPreviewPatients: routingPreviewPatientRows }
              : {}),
          }
        : {
            disableClientSearch: false,
          }),
      ...(routingAlternateForBook ? { routingAlternateAddress: routingAlternateForBook } : {}),
      ...(isReschedule
        ? {
            appointmentTypeId:
              (routingStatsTypeKey.trim() && chosenRoutingTypeId != null
                ? chosenRoutingTypeId
                : undefined) ??
              (rescheduleSourceAppt?.appointmentType?.id != null
                ? Number(rescheduleSourceAppt.appointmentType.id)
                : undefined) ??
              (ri?.appointmentTypeId != null && Number.isFinite(Number(ri.appointmentTypeId))
                ? Number(ri.appointmentTypeId)
                : undefined),
          }
        : routingStatsTypeKey.trim() && chosenRoutingTypeId != null
          ? { appointmentTypeId: chosenRoutingTypeId }
          : {}),
      preserveDurationFromSlot: true,
      defaultDescription:
        isReschedule && (rescheduleVisitPatches?.length ?? 0) <= 1
          ? rescheduleVisitPatches?.[0]?.description?.trim() || ri?.description?.trim()
          : undefined,
      rescheduleAppointmentId: isReschedule ? Number(rescheduleId) : undefined,
      rescheduleAppointmentIds: isReschedule && rescheduleIds.length > 0 ? rescheduleIds : undefined,
      rescheduleVisitPatches:
        isReschedule && rescheduleVisitPatches?.length ? rescheduleVisitPatches : undefined,
      ...(isReschedule && exploreBook ? { exploreAlternatives: true } : {}),
      preferredPatientId:
        routingPreview.reschedulePatientId?.trim() || ri?.patientId || fbi?.patientId || ari?.patientId,
      routingPreviewBook: !isReschedule,
      lockProvider: Boolean(routingSlotProviderId) || !isReschedule,
      lockSlotTimes: !isReschedule,
      providerId:
        routingSlotProviderId ??
        (isReschedule ? ri?.primaryProviderInternalId?.trim() : undefined),
      modalTitle: isReschedule
        ? exploreBook
          ? 'Add Alternative Appointment'
          : 'Reschedule appointment'
        : undefined,
      defaultInstructions: isReschedule
        ? rescheduleSourceAppt?.instructions?.trim()
        : undefined,
      ...(preFirstNeighborBump ? { preFirstNeighborBump } : {}),
      ...(fbi && !isReschedule
        ? {
            forwardBookingTrackingToken: fbi.trackingToken,
            forwardBookingEntryId: fbi.forwardBookingId,
            ...(fbiTargets && fbiTargets.entries.length > 1
              ? {
                  forwardBookingVisitCompletes: fbiTargets.entries.map((row) => ({
                    forwardBookingEntryId: row.forwardBookingId,
                    forwardBookingTrackingToken: row.trackingToken,
                    patientId: row.patientId,
                    patientName: row.patientName,
                  })),
                }
              : {}),
          }
        : {}),
      ...(ari && !isReschedule && !fbi
        ? {
            appointmentRequestSubmissionId: ari.appointmentRequestSubmissionId,
            ...(ariVisitPatches?.length
              ? { appointmentRequestVisitPatches: ariVisitPatches }
              : {}),
          }
        : {}),
      ...(forwardBookingCreatedVia ? { forwardBookingCreatedVia } : {}),
      ...(routingStatsTypeKey ? { routingStatsTypeKey } : {}),
      ...(isScheduleOptimizeCalendarPreview(routingPreview)
        ? {
            scheduleOptimizeMove: true,
            ...(!exploreBook
              ? {
                  scheduleOptimizeDriveDeltaMin:
                    findScheduleOptimizeQueueItem(
                      PRACTICE_ID,
                      routingPreview.scheduleOptimizeReturn?.queueItemId ?? ''
                    )?.driveDeltaMin ??
                    routingPreview.scheduleOptimizeReturn?.listMove?.driveDeltaMin ??
                    null,
                }
              : {}),
          }
        : {}),
    });
    setBookSlot({ start, end });
    })();
  }, [routingPreview, rolesLower, rawAppointments, typeList, driveDayByDate]);

  const openOptimizePreviewBook = useCallback(
    (explore: boolean) => {
      const intent = readRoutingRescheduleIntent();
      if (intent) {
        const { v: _v, appliedToRoutingForm: _applied, ...rest } = intent;
        writeRoutingRescheduleIntent({
          ...rest,
          exploreAlternatives: explore,
        });
        setRescheduleIntentTick((n) => n + 1);
      }
      const preview = routingPreview ?? readRoutingCalendarPreview();
      if (preview && isScheduleOptimizeCalendarPreview(preview)) {
        const next = { ...preview, exploreAlternatives: explore };
        writeRoutingCalendarPreview(next);
        setRoutingPreview(next);
      }
      openRoutingBookForm({ exploreAlternatives: explore });
    },
    [openRoutingBookForm, routingPreview]
  );

  const addOptimizePreviewToList = useCallback(() => {
    const preview = routingPreview ?? readRoutingCalendarPreview();
    const listMove = preview?.scheduleOptimizeReturn?.listMove;
    const doctorId = String(preview?.option.doctorPimsId ?? '').trim();
    const doctorName = String(preview?.option.doctorName ?? '').trim() || 'Provider';
    if (!listMove || !doctorId) {
      setToast('Could not add this suggestion to the list.');
      return;
    }
    addScheduleOptimizeToQueue({
      move: listMove,
      practiceId: PRACTICE_ID,
      doctorId,
      doctorName,
    });
    setOptimizePreviewListTick((n) => n + 1);
    setToast('Added to the Schedule optimization list.');
  }, [routingPreview]);

  const optimizePreviewOnList = useMemo(() => {
    const id =
      routingPreview?.scheduleOptimizeReturn?.queueItemId?.trim() ||
      routingPreview?.scheduleOptimizeReturn?.listMove?.id?.trim();
    if (!id) return false;
    const row = findScheduleOptimizeQueueItem(PRACTICE_ID, id);
    return row?.status === 'queued' || row?.status === 'moved';
  }, [routingPreview, optimizePreviewListTick]);

  const closeBookModal = useCallback(() => {
    setBookSlot(null);
    setBookPrefill(null);
  }, []);

  const handleSlotOfferSent = useCallback(
    (detail?: { outreachNotesWarning?: string }) => {
    const fbi = readRoutingForwardBookingIntent();
    const previewAtSend = routingPreview ?? readRoutingCalendarPreview();
    closeBookModal();
    clearRoutingPersistenceAfterSchedulerBook();
    clearRoutingCalendarPreview();
    setRoutingPreview(null);
    clearRoutingForwardBookingIntent();
    const toastBase = 'Text offer sent to client.';
    setToast(
      detail?.outreachNotesWarning ? `${toastBase} ${detail.outreachNotesWarning}` : toastBase
    );
    notifySchedulingToolsNavCountsRefresh();
    const returnToScheduleLoader = scheduleLoaderReturnHref(previewAtSend);
    if (returnToScheduleLoader) {
      navigate(returnToScheduleLoader);
      return;
    }
    const returnToWaitlist = waitlistReturnHref(previewAtSend);
    if (returnToWaitlist) {
      navigate(returnToWaitlist);
      return;
    }
    if (fbi?.origin === 'care_outreach') {
      if (fbi.careOutreachClientKey) writeCareOutreachFocusClient(fbi.careOutreachClientKey);
      navigate(CARE_OUTREACH_LIST_PATH);
      return;
    }
    if (!embedInRoutingWorkspace) {
      navigate(FORWARD_BOOKING_LIST_PATH);
    }
  },
    [closeBookModal, routingPreview, navigate, embedInRoutingWorkspace]
  );

  const clearEditVisitHighlightTimer = useCallback(() => {
    if (editVisitHighlightTimerRef.current != null) {
      window.clearTimeout(editVisitHighlightTimerRef.current);
      editVisitHighlightTimerRef.current = null;
    }
  }, []);

  const startEditVisitHighlightClearTimer = useCallback(
    (durationMs: number) => {
      clearEditVisitHighlightTimer();
      editVisitHighlightTimerRef.current = window.setTimeout(() => {
        setEditVisitHighlightIds(new Set());
        editVisitPostBookScrollSigRef.current = '';
        editVisitHighlightTimerRef.current = null;
      }, durationMs);
    },
    [clearEditVisitHighlightTimer]
  );

  const pulseEditVisitHighlight = useCallback(
    (appointmentId: number | readonly number[], durationMs = 2600) => {
      const ids = (Array.isArray(appointmentId) ? appointmentId : [appointmentId]).filter(
        (id) => Number.isFinite(id) && id > 0,
      );
      if (ids.length === 0) return;
      clearEditVisitHighlightTimer();
      editVisitHighlightDurationMsRef.current = durationMs;
      editVisitPostBookScrollSigRef.current = '';
      setEditVisitHighlightIds(new Set(ids));
    },
    [clearEditVisitHighlightTimer]
  );

  const focusHouseholdConflictOnCalendar = useCallback(
    (
      conflict: HouseholdScheduledVisitConflict,
      options?: { pinHighlight?: boolean },
    ) => {
      if (conflict.practiceDateKey) {
        setAnchorDate(conflict.practiceDateKey);
        setView('week');
      }
      const providerId = conflict.primaryProviderId?.trim();
      if (providerId && providers.some((p) => String(p.id) === providerId)) {
        setProviderFilter(providerId);
      }
      calendarFocusActiveRef.current = true;
      setPendingFocusHighlightApptId(conflict.appointmentId);
      if (options?.pinHighlight) {
        householdVisitHighlightPinnedRef.current = true;
        clearEditVisitHighlightTimer();
      }
      pulseEditVisitHighlight(
        conflict.appointmentId,
        options?.pinHighlight ? 86_400_000 : 8000,
      );
    },
    [providers, pulseEditVisitHighlight, clearEditVisitHighlightTimer],
  );

  useEffect(() => {
    if (!embedInRoutingWorkspace) return;
    const onFocusHouseholdVisit = (event: Event) => {
      const parsed = parseRoutingFocusHouseholdVisitEvent(event);
      if (!parsed?.conflict?.appointmentId) return;
      focusHouseholdConflictOnCalendar(parsed.conflict, {
        pinHighlight: parsed.pinHighlight,
      });
    };
    window.addEventListener(ROUTING_FOCUS_HOUSEHOLD_VISIT_EVENT, onFocusHouseholdVisit);
    return () =>
      window.removeEventListener(ROUTING_FOCUS_HOUSEHOLD_VISIT_EVENT, onFocusHouseholdVisit);
  }, [embedInRoutingWorkspace, focusHouseholdConflictOnCalendar]);

  useEffect(() => {
    if (!embedInRoutingWorkspace) return;
    const onUnpinHouseholdVisitHighlight = () => {
      householdVisitHighlightPinnedRef.current = false;
      if (editVisitHighlightIds.size > 0) {
        editVisitHighlightDurationMsRef.current = 12_000;
        startEditVisitHighlightClearTimer(12_000);
      }
    };
    window.addEventListener(
      ROUTING_HOUSEHOLD_VISIT_FOCUS_UNPIN_EVENT,
      onUnpinHouseholdVisitHighlight,
    );
    return () =>
      window.removeEventListener(
        ROUTING_HOUSEHOLD_VISIT_FOCUS_UNPIN_EVENT,
        onUnpinHouseholdVisitHighlight,
      );
  }, [embedInRoutingWorkspace, editVisitHighlightIds.size, startEditVisitHighlightClearTimer]);

  const confirmManualBookFromPreview = useCallback(async () => {
    const draft = routingPreview?.manualBookDraft;
    if (!draft) {
      setToast('Manual book preview is missing form data.');
      return;
    }
    // Ref guard — React state alone races on double-click Book.
    if (manualBookPreviewCommittingRef.current) return;

    const catalog = buildBookingAppointmentTypeCatalog(typeList);
    const clientId = draft.clientId?.trim();
    // Co-visit add-pet already sits with household pets on purpose — skip the other-day warning
    // gate the form skips for the same flow (avoids a second Book click after the modal).
    if (
      !draft.coVisitAddPet &&
      !manualBookHouseholdBypassRef.current &&
      clientId &&
      shouldWarnHouseholdVisitsOnBook({
        catalog,
        appointmentTypeIds: [draft.appointmentTypeId],
        clientId,
      })
    ) {
      manualBookPreviewCommittingRef.current = true;
      setManualBookPreviewCommitting(true);
      try {
        const conflicts = await findHouseholdScheduledVisitConflicts({
          practiceId: draft.practiceId,
          clientId,
          placementStartIso: draft.appointmentStartIso,
          practiceTz: PRACTICE_TZ,
          catalog,
          bookingPatientIds: draft.patientId?.trim() ? [draft.patientId.trim()] : [],
        });
        if (conflicts.length > 0) {
          setManualBookHouseholdConflicts(conflicts);
          return;
        }
      } finally {
        manualBookPreviewCommittingRef.current = false;
        setManualBookPreviewCommitting(false);
      }
    }

    const euthanasiaType = typeList.find((t) => Number(t.id) === Number(draft.appointmentTypeId));
    const alreadyChoseEuthanasia =
      draft.euthanasiaDeleteFutureAppointments === true ||
      manualBookEuthanasiaChoiceRef.current != null;
    if (
      !alreadyChoseEuthanasia &&
      draft.patientId?.trim() &&
      isEuthanasiaAppointmentType(euthanasiaType)
    ) {
      manualBookPreviewCommittingRef.current = true;
      setManualBookPreviewCommitting(true);
      try {
        const futureRows = await findFutureAppointmentsForPatients({
          practiceId: draft.practiceId,
          practiceTz: PRACTICE_TZ,
          patients: [
            {
              patientId: draft.patientId.trim(),
              patientName: draft.patientLabel?.trim() || null,
            },
          ],
          asOfIso: draft.appointmentStartIso,
        });
        if (futureRows.length > 0) {
          pendingManualBookEuthanasiaDeletesRef.current = futureRows;
          setManualBookEuthanasiaFutureRows(futureRows);
          return;
        }
      } finally {
        manualBookPreviewCommittingRef.current = false;
        setManualBookPreviewCommitting(false);
      }
    }

    // Past all pre-commit warning gates — clear one-shot bypass for the next book attempt.
    manualBookHouseholdBypassRef.current = false;
    const euthanasiaChoice =
      draft.euthanasiaDeleteFutureAppointments === true
        ? 'delete'
        : manualBookEuthanasiaChoiceRef.current;
    manualBookEuthanasiaChoiceRef.current = null;
    let euthanasiaRowsToDelete: EuthanasiaFutureAppointmentRow[] | null =
      euthanasiaChoice === 'delete' ? pendingManualBookEuthanasiaDeletesRef.current : null;
    pendingManualBookEuthanasiaDeletesRef.current = null;
    setManualBookEuthanasiaFutureRows(null);
    if (
      euthanasiaChoice === 'delete' &&
      (!euthanasiaRowsToDelete || euthanasiaRowsToDelete.length === 0) &&
      draft.patientId?.trim()
    ) {
      euthanasiaRowsToDelete = await findFutureAppointmentsForPatients({
        practiceId: draft.practiceId,
        practiceTz: PRACTICE_TZ,
        patients: [
          {
            patientId: draft.patientId.trim(),
            patientName: draft.patientLabel?.trim() || null,
          },
        ],
        asOfIso: draft.appointmentStartIso,
      });
    }

    manualBookPreviewCommittingRef.current = true;
    setManualBookPreviewCommitting(true);
    const draftSnapshot = { ...draft };
    setManualBookHouseholdConflicts(null);
    try {
      // Older/in-flight co-visit previews may have used the anchor ALT address for routing without
      // persisting it in the draft. Commit must inherit that address too or the saved pet routes
      // back to client home after refresh.
      const coVisitAnchorId = Number(draftSnapshot.coVisitAnchorAppointmentId);
      const coVisitAnchor =
        draftSnapshot.coVisitAddPet && Number.isFinite(coVisitAnchorId) && coVisitAnchorId > 0
          ? rawAppointments.find((a) => Number(a.id) === coVisitAnchorId)
          : undefined;
      const inheritedAlt =
        draftSnapshot.alternateAddressText?.trim() ||
        (coVisitAnchor ? appointmentAlternateAddressText(coVisitAnchor)?.trim() : '') ||
        '';
      const commitDraft =
        inheritedAlt && !draftSnapshot.alternateAddressText?.trim()
          ? { ...draftSnapshot, alternateAddressText: inheritedAlt }
          : draftSnapshot;

      const savedId = await commitManualBookPreviewDraft(commitDraft, {
        providers,
        practiceTz: PRACTICE_TZ,
        token: authToken,
        userEmail: authUserEmail,
        doctorId: authDoctorId,
        appointmentTypes: typeList,
        existingAppointments: rawAppointments,
      });

      let euthanasiaCancelHadErrors = false;
      if (euthanasiaRowsToDelete?.length) {
        const cancelResult = await cancelEuthanasiaFutureAppointments({
          rows: euthanasiaRowsToDelete,
          practiceId: draftSnapshot.practiceId,
        });
        if (cancelResult.errors.length > 0) {
          euthanasiaCancelHadErrors = true;
          setToast(
            cancelResult.cancelledIds.length > 0
              ? `Appointment saved. Removed ${cancelResult.cancelledIds.length} future visit(s), but ${cancelResult.errors.length} could not be cancelled.`
              : `Appointment saved, but future appointments could not be cancelled. ${cancelResult.errors[0]}`,
          );
        }
      }

      // Dismiss preview only after a successful create (failed Book used to leave a blank calendar).
      clearRoutingCalendarPreview();
      setRoutingPreview(null);
      const alignIds = (draftSnapshot.coVisitAlignAppointmentIds ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
      if (alignIds.length > 0) {
        const siblings = rawAppointments.filter((a) => alignIds.includes(Number(a.id)));
        if (siblings.length > 0) {
          await alignSiblingVisitScheduledTimes({
            siblings,
            startIso: draftSnapshot.appointmentStartIso,
            endIso: draftSnapshot.appointmentEndIso,
            practiceId: draftSnapshot.practiceId,
          });
        }
      }
      await loadRange({ refreshDrive: true });
      pulseEditVisitHighlight(
        alignIds.length > 0 ? [savedId, ...alignIds] : savedId,
        5000
      );
      if (!euthanasiaCancelHadErrors) {
        setToast(
          alignIds.length > 0
            ? `Appointment saved · aligned ${alignIds.length + 1} household pets.`
            : 'Appointment saved to the schedule.',
        );
      }
    } catch (e) {
      console.error(e);
      setToast(extractHttpErrorMessage(e) || 'Could not book appointment.');
    } finally {
      manualBookPreviewCommittingRef.current = false;
      setManualBookPreviewCommitting(false);
    }
  }, [
    routingPreview?.manualBookDraft,
    providers,
    typeList,
    authToken,
    authUserEmail,
    authDoctorId,
    loadRange,
    pulseEditVisitHighlight,
    rawAppointments,
  ]);

  const handleSchedulerBooked = useCallback(
    async (detail?: {
      routingFeedbackWarning?: string;
      forwardBookingWarning?: string;
      appointmentRequestWarning?: string;
      euthanasiaFutureWarning?: string;
      schedulingOverrideWarning?: string;
      schedulingOverridesApplied?: boolean;
      savedAppointmentId?: number;
      primaryProviderId?: string;
      anchorDate?: string;
      bookedAppointmentTypeId?: number;
      exploreAlternatives?: boolean;
      exploreSourceAppointmentIds?: number[];
      exploreCreatedAppointmentIds?: number[];
      exploreCreatedAppointmentTypeId?: number;
    }) => {
      const prefillAtBook = bookPrefill;
      const wasReschedule = prefillAtBook?.rescheduleAppointmentId != null;
      const wasExplore = Boolean(detail?.exploreAlternatives);
      const previewAtBook = routingPreview ?? readRoutingCalendarPreview();
      const focusReturnAtBook = readSchedulerFocusReturnSession();
      const wasOptimizeFlow =
        Boolean(prefillAtBook?.scheduleOptimizeMove) ||
        isScheduleOptimizeCalendarPreview(previewAtBook) ||
        Boolean(focusReturnAtBook?.returnToOptimize);
      const wasForwardBooking = prefillAtBook?.forwardBookingTrackingToken != null;
      const wasAppointmentRequest = prefillAtBook?.appointmentRequestSubmissionId != null;
      const fbiAtBook =
        wasForwardBooking ||
        isScheduleLoaderCalendarPreview(previewAtBook) ||
        isWaitlistCalendarPreview(previewAtBook)
          ? readRoutingForwardBookingIntent()
          : null;
      const ariAtBook = wasAppointmentRequest ? readRoutingAppointmentRequestIntent() : null;
      const savedId = detail?.savedAppointmentId;
      const returnToForwardBookingList =
        wasForwardBooking &&
        fbiAtBook?.returnToListAfterBook !== false &&
        prefillAtBook?.forwardBookingEntryId != null &&
        savedId != null &&
        bookSlot?.start?.isValid;

      closeBookModal();

      const scheduleLoaderBookReturn =
        isScheduleLoaderCalendarPreview(previewAtBook) &&
        savedId != null &&
        bookSlot?.start?.isValid &&
        !wasReschedule;

      if (scheduleLoaderBookReturn) {
        const startIso = bookSlot!.start.toUTC().toISO();
        if (startIso) {
          const petNames =
            previewAtBook!.previewPatients
              ?.map((p) => String(p.name ?? '').trim())
              .filter(Boolean) ?? [];
          const typeId =
            detail?.bookedAppointmentTypeId ?? prefillAtBook?.appointmentTypeId;
          const typeRow =
            typeId != null ? typeList.find((t) => Number(t.id) === Number(typeId)) : undefined;
          const typeName =
            typeRow?.name?.trim() ||
            typeRow?.prettyName?.trim() ||
            null;
          const isHold = isHoldAppointmentTypeForBook(typeCatalog, { typeId, typeName });
          writeForwardBookingReturnSession({
            ...(prefillAtBook?.forwardBookingEntryId != null
              ? { forwardBookingEntryId: Number(prefillAtBook.forwardBookingEntryId) }
              : fbiAtBook?.forwardBookingId != null
                ? { forwardBookingEntryId: fbiAtBook.forwardBookingId }
                : {}),
            bookedAppointmentId: savedId!,
            bookedAppointmentStart: startIso,
            bookedAppointmentEnd: bookSlot!.end?.isValid ? bookSlot!.end.toUTC().toISO() : null,
            smsTemplate: 'schedule_loader',
            scheduleLoaderPetNames: petNames,
            scheduleLoaderClientDisplayName: previewAtBook!.clientDisplayLabel?.trim() || null,
            scheduleLoaderProviderLastName: providerLastNameFromDisplayName(
              String(previewAtBook!.option.doctorName ?? '')
            ),
            scheduleLoaderAnyPastDue: fbiAtBook?.scheduleLoaderAnyPastDue !== false,
            targetWorkflowTab: isHold ? 'onHold' : 'booked',
            returnOrigin: 'schedule_loader',
          });
          clearRoutingPersistenceAfterSchedulerBook();
          clearRoutingCalendarPreview();
          setRoutingPreview(null);
          clearRoutingRescheduleIntent();
          clearRoutingForwardBookingIntent();
          navigate(
            schedulingReturnPathAfterBook({
              isHold,
              origin: 'schedule_loader',
              scheduleLoaderReturnHref: scheduleLoaderReturnHref(previewAtBook),
            }),
          );
          return;
        }
      }

      const waitlistBookReturn =
        isWaitlistCalendarPreview(previewAtBook) &&
        savedId != null &&
        bookSlot?.start?.isValid &&
        !wasReschedule;

      if (wasReschedule || wasExplore) {
        const relatedIds = [
          ...(prefillAtBook?.rescheduleAppointmentIds ?? []),
          ...(prefillAtBook?.rescheduleAppointmentId != null
            ? [prefillAtBook.rescheduleAppointmentId]
            : []),
          ...(detail?.exploreSourceAppointmentIds ?? []),
        ].filter((id) => Number.isFinite(id) && id > 0);
        const queueId = isScheduleOptimizeCalendarPreview(previewAtBook)
          ? previewAtBook?.scheduleOptimizeReturn?.queueItemId?.trim() || null
          : null;
        const whenLabel =
          bookSlot?.start?.isValid
            ? bookSlot.start.setZone(PRACTICE_TZ).toFormat('ccc M/d h:mm a')
            : '';
        const optimizePreview = isScheduleOptimizeCalendarPreview(previewAtBook)
          ? previewAtBook
          : null;
        const listMove = optimizePreview?.scheduleOptimizeReturn?.listMove;
        if (listMove) {
          const doctorId = String(optimizePreview?.option.doctorPimsId ?? '').trim();
          const doctorName = String(optimizePreview?.option.doctorName ?? '').trim() || 'Provider';
          if (doctorId && !findScheduleOptimizeQueueItem(PRACTICE_ID, listMove.id)) {
            addScheduleOptimizeToQueue({
              move: listMove,
              practiceId: PRACTICE_ID,
              doctorId,
              doctorName,
            });
          }
        }
        resolveScheduleOptimizeQueueItems(PRACTICE_ID, {
          queueItemId: queueId,
          appointmentIds: relatedIds,
          outcome: wasExplore ? 'alternative' : 'rescheduled',
          note: formatScheduleOptimizeQueueActionNote({
            kind: wasExplore ? 'alternative' : 'rescheduled',
            whenLabel,
          }),
          savingsStaff: scheduleOptimizeSavingsActor,
          ...(wasExplore
            ? {
                alternativeAppointmentIds: [
                  ...(detail?.exploreCreatedAppointmentIds ?? []),
                  ...(savedId != null ? [savedId] : []),
                ],
              }
            : {}),
        });
        const intentClientId = Number(readRoutingRescheduleIntent()?.clientId ?? 0);
        const smsClientIdRaw =
          listMove?.clientId ??
          Number(optimizePreview?.newApptMeta?.clientId ?? 0);
        const smsClientId =
          smsClientIdRaw != null && Number.isFinite(smsClientIdRaw) && smsClientIdRaw > 0
            ? smsClientIdRaw
            : Number.isFinite(intentClientId) && intentClientId > 0
              ? intentClientId
              : 0;
        const smsPets =
          listMove?.petNames?.length
            ? listMove.petNames
            : (optimizePreview?.previewPatients ?? [])
                .map((p) => String(p.name ?? '').trim())
                .filter(Boolean);
        if (
          Boolean(prefillAtBook?.scheduleOptimizeMove || optimizePreview) &&
          Number.isFinite(smsClientId) &&
          smsClientId > 0
        ) {
          setOptimizeSmsPrompt({
            kind: wasExplore ? 'ask' : 'moved',
            clientId: smsClientId,
            client:
              listMove?.client?.trim() ||
              previewAtBook?.clientDisplayLabel?.trim() ||
              'the client',
            petNames: smsPets,
            fromDate: listMove?.fromDate ?? '',
            toDate:
              listMove?.toDate ||
              String(optimizePreview?.option.date ?? '') ||
              '',
            fromTimeLabel: listMove?.fromTimeLabel ?? '',
            toTimeLabel: listMove?.toTimeLabel ?? '',
            fromWindowLabel: listMove?.fromWindowLabel ?? null,
            toWindowLabel: listMove?.toWindowLabel ?? null,
            originalStartIso: listMove?.originalStartIso ?? '',
            newStartIso:
              listMove?.newStartIso ||
              String(optimizePreview?.option.suggestedStartIso ?? ''),
            doctorName: String(optimizePreview?.option.doctorName ?? ''),
            queueItemId:
              optimizePreview?.scheduleOptimizeReturn?.queueItemId?.trim() ||
              listMove?.id ||
              null,
          });
        }
      }

      if (waitlistBookReturn) {
        const startIso = bookSlot!.start.toUTC().toISO();
        if (startIso) {
          const petNames =
            previewAtBook!.previewPatients
              ?.map((p) => String(p.name ?? '').trim())
              .filter(Boolean) ?? [];
          const typeId =
            detail?.bookedAppointmentTypeId ?? prefillAtBook?.appointmentTypeId;
          const typeRow =
            typeId != null ? typeList.find((t) => Number(t.id) === Number(typeId)) : undefined;
          const typeName =
            typeRow?.name?.trim() ||
            typeRow?.prettyName?.trim() ||
            null;
          const isHold = isHoldAppointmentTypeForBook(typeCatalog, { typeId, typeName });
          const waitlistEntryId =
            fbiAtBook?.waitlistEntryId ?? previewAtBook!.waitlistReturn?.entryId ?? null;
          if (waitlistEntryId != null) {
            writeWaitlistReturnSession({
              waitlistEntryId,
              clientId:
                fbiAtBook?.waitlistReturn?.clientId ??
                previewAtBook!.waitlistReturn?.clientId ??
                Number(fbiAtBook?.clientId) ??
                0,
              bookedAppointmentId: savedId!,
              bookedAppointmentStart: startIso,
              bookedAppointmentEnd: bookSlot!.end?.isValid ? bookSlot!.end.toUTC().toISO() : null,
              petNames,
              clientDisplayName: previewAtBook!.clientDisplayLabel?.trim() || null,
              providerLastName: providerLastNameFromDisplayName(
                String(previewAtBook!.option.doctorName ?? ''),
              ),
              isHold,
              openSms: true,
            });
          }
          clearRoutingPersistenceAfterSchedulerBook();
          clearRoutingCalendarPreview();
          setRoutingPreview(null);
          clearRoutingRescheduleIntent();
          clearRoutingForwardBookingIntent();
          navigate(
            schedulingReturnPathAfterBook({
              isHold,
              origin: 'waitlist',
              waitlistReturnHref: waitlistReturnHref(previewAtBook),
            }),
          );
          return;
        }
      }

      if (returnToForwardBookingList) {
        const startIso = bookSlot!.start.toUTC().toISO();
        const bookTypeId = detail?.bookedAppointmentTypeId ?? prefillAtBook?.appointmentTypeId;
        const bookTypeRow =
          bookTypeId != null
            ? typeList.find((t) => Number(t.id) === Number(bookTypeId))
            : undefined;
        const bookTypeName =
          bookTypeRow?.name?.trim() ||
          bookTypeRow?.prettyName?.trim() ||
          fbiAtBook?.appointmentTypeName?.trim() ||
          null;
        const isHold = isHoldAppointmentTypeForBook(typeCatalog, {
          typeId: bookTypeId,
          typeName: bookTypeName,
        });
        if (startIso) {
          const forwardBookingPetNames = forwardBookingBookedPatientNames({
            forwardBookingVisitCompletes: prefillAtBook?.forwardBookingVisitCompletes,
            intent: fbiAtBook,
          });
          const forwardBookingEntryIds =
            prefillAtBook?.forwardBookingVisitCompletes?.length
              ? prefillAtBook.forwardBookingVisitCompletes.map((row) =>
                  Number(row.forwardBookingEntryId),
                )
              : prefillAtBook?.forwardBookingEntryId != null
                ? [Number(prefillAtBook.forwardBookingEntryId)]
                : undefined;
          writeForwardBookingReturnSession({
            forwardBookingEntryId: Number(prefillAtBook!.forwardBookingEntryId),
            bookedAppointmentId: savedId!,
            bookedAppointmentStart: startIso,
            bookedAppointmentEnd: bookSlot!.end?.isValid ? bookSlot!.end.toUTC().toISO() : null,
            targetWorkflowTab: isHold ? 'onHold' : 'booked',
            returnOrigin:
              fbiAtBook?.origin === 'care_outreach' ? 'care_outreach' : 'forward_booking',
            ...(forwardBookingEntryIds?.length ? { forwardBookingEntryIds } : {}),
            ...(forwardBookingPetNames.length ? { forwardBookingPetNames } : {}),
            ...(fbiAtBook?.origin === 'care_outreach'
              ? {
                  smsTemplate: 'care_outreach' as const,
                  careOutreachPetNames: fbiAtBook.careOutreachPetNames,
                  ...(fbiAtBook.careOutreachAnyPastDue ? { careOutreachAnyPastDue: true } : {}),
                  ...(fbiAtBook.careOutreachClientKey
                    ? { careOutreachClientKey: fbiAtBook.careOutreachClientKey }
                    : {}),
                  ...(fbiAtBook.careOutreachClientDisplayName
                    ? { careOutreachClientDisplayName: fbiAtBook.careOutreachClientDisplayName }
                    : {}),
                  ...(fbiAtBook.careOutreachClientId != null
                    ? { careOutreachClientId: fbiAtBook.careOutreachClientId }
                    : {}),
                  ...(fbiAtBook.careOutreachClientPhone
                    ? { careOutreachClientPhone: fbiAtBook.careOutreachClientPhone }
                    : {}),
                  ...(fbiAtBook.careOutreachClientFirstName
                    ? { careOutreachClientFirstName: fbiAtBook.careOutreachClientFirstName }
                    : {}),
                  ...(providerLastNameFromDisplayName(fbiAtBook.primaryDoctorDisplayName)
                    ? {
                        careOutreachProviderLastName: providerLastNameFromDisplayName(
                          fbiAtBook.primaryDoctorDisplayName,
                        ),
                      }
                    : {}),
                }
              : {}),
          });
        }
        if (embedInRoutingWorkspace || routingPreview) {
          clearRoutingPersistenceAfterSchedulerBook();
          setRoutingPreview(null);
        }
        clearRoutingRescheduleIntent();
        clearRoutingForwardBookingIntent();
        clearRoutingCalendarPreview();
        const warning =
          detail?.euthanasiaFutureWarning ??
          detail?.forwardBookingWarning ??
          detail?.routingFeedbackWarning ??
          detail?.schedulingOverrideWarning;
        let returnNotice = warning ?? null;
        if (!returnNotice) {
          const patientNames = forwardBookingBookedPatientNames({
            forwardBookingVisitCompletes: prefillAtBook?.forwardBookingVisitCompletes,
            intent: fbiAtBook,
          });
          const clientName =
            prefillAtBook?.clientLabel?.trim() ||
            fbiAtBook?.clientDisplayLabel?.trim() ||
            routingPreview?.clientDisplayLabel?.trim() ||
            '';
          returnNotice = buildForwardBookingBookSuccessToast({ patientNames, clientName, isHold });
        }
        if (returnNotice) {
          try {
            sessionStorage.setItem('vayd:forward-booking-return-toast', returnNotice);
          } catch {
            /* ignore */
          }
        }
        navigate(
          schedulingReturnPathAfterBook({
            isHold,
            origin: fbiAtBook?.origin === 'care_outreach' ? 'care_outreach' : 'forward_booking',
          }),
        );
        return;
      }

      const shouldReturnAfterAppointmentRequestBook =
        wasAppointmentRequest &&
        prefillAtBook?.appointmentRequestSubmissionId != null &&
        savedId != null &&
        bookSlot?.start?.isValid &&
        (Boolean(
          ariAtBook?.returnToGmail?.mailbox?.trim() && ariAtBook.returnToGmail.threadId?.trim(),
        ) ||
          ariAtBook?.returnToListAfterBook !== false);

      if (shouldReturnAfterAppointmentRequestBook) {
        const startIso = bookSlot!.start.toUTC().toISO();
        if (startIso) {
          writeAppointmentRequestReturnSession({
            appointmentRequestSubmissionId: Number(prefillAtBook!.appointmentRequestSubmissionId),
            bookedAppointmentId: savedId!,
            bookedAppointmentStart: startIso,
            bookedAppointmentEnd: bookSlot!.end?.isValid ? bookSlot!.end.toUTC().toISO() : null,
          });
        }
        if (embedInRoutingWorkspace || routingPreview) {
          clearRoutingPersistenceAfterSchedulerBook();
          setRoutingPreview(null);
        }
        clearRoutingRescheduleIntent();
        clearRoutingForwardBookingIntent();
        clearRoutingAppointmentRequestIntent();
        clearRoutingCalendarPreview();
        const warn =
          detail?.euthanasiaFutureWarning ??
          detail?.appointmentRequestWarning ??
          detail?.forwardBookingWarning ??
          detail?.routingFeedbackWarning ??
          detail?.schedulingOverrideWarning;
        if (warn) {
          try {
            sessionStorage.setItem('vayd:appointment-request-return-toast', warn);
          } catch {
            /* ignore */
          }
        }
        returnFromAppointmentRequestWorkspace(navigate, ariAtBook);
        return;
      }

      if (embedInRoutingWorkspace) {
        clearRoutingPersistenceAfterSchedulerBook();
        setRoutingPreview(null);
        window.dispatchEvent(new Event(ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT));
      } else if (routingPreview || wasOptimizeFlow) {
        clearRoutingPersistenceAfterSchedulerBook();
        setRoutingPreview(null);
      }
      if (focusReturnAtBook?.returnToOptimize) {
        clearSchedulerFocusReturnSession();
        setSchedulerFocusReturnTick((n) => n + 1);
      }
      clearRoutingRescheduleIntent();
      clearRoutingForwardBookingIntent();
      clearRoutingAppointmentRequestIntent();
      if (wasReschedule) {
        const focusProviderId =
          detail?.primaryProviderId?.trim() || prefillAtBook?.providerId?.trim() || '';
        if (
          focusProviderId &&
          providers.some((p) => String(p.id) === focusProviderId)
        ) {
          setProviderFilter(focusProviderId);
        }
        const focusDate =
          detail?.anchorDate?.trim() ||
          (bookSlot?.start?.isValid
            ? bookSlot.start.setZone(PRACTICE_TZ).toISODate() ?? ''
            : '');
        if (focusDate) {
          setAnchorDate(focusDate);
          if (view === 'month') setView('week');
        }
      }
      await loadRange({ refreshDrive: true });
      if (savedId != null && Number.isFinite(savedId) && savedId > 0) {
        pulseEditVisitHighlight(savedId, 5000);
      }
      if (wasForwardBooking && savedId != null && bookSlot?.start?.isValid) {
        const startIso = bookSlot.start.toUTC().toISO();
        if (startIso) {
          const link = {
            bookedAppointmentId: savedId,
            bookedAppointmentStart: startIso,
            bookedAppointmentEnd: bookSlot.end?.isValid ? bookSlot.end.toUTC().toISO() : null,
          };
          const entryId = prefillAtBook?.forwardBookingEntryId;
          if (entryId != null && Number.isFinite(Number(entryId))) {
            writeForwardBookingLocalLink(Number(entryId), link);
          }
        }
      }
      const warning =
        detail?.euthanasiaFutureWarning ??
        detail?.schedulingOverrideWarning ??
        detail?.appointmentRequestWarning ??
        detail?.forwardBookingWarning ??
        detail?.routingFeedbackWarning;
      if (warning) {
        toastDismissMsRef.current = 6000;
        setToast(warning);
      } else if (detail?.schedulingOverridesApplied && !wasReschedule) {
        toastDismissMsRef.current = 6000;
        setToast(
          'All-day appointment saved. Schedule overrides applied so those days are excluded from routing.'
        );
      } else {
        toastDismissMsRef.current = 6000;
        setToast(
          wasExplore
            ? 'Alternative appointment added — the original is still booked.'
            : wasReschedule
              ? 'Appointment rescheduled.'
              : 'Appointment saved to the schedule.'
        );
      }

      if (wasExplore && savedId != null && Number.isFinite(savedId) && savedId > 0) {
        const sourceIdsRaw = detail?.exploreSourceAppointmentIds ?? [];
        const createdIdsRaw =
          detail?.exploreCreatedAppointmentIds?.length
            ? detail.exploreCreatedAppointmentIds
            : [savedId];

        /** Expand single-pet anchors to the full multi-pet visit so Hold conversion covers every pet. */
        const expandVisitClumpIds = (ids: number[]): number[] => {
          const out = new Set<number>();
          for (const id of ids) {
            if (!Number.isFinite(id) || id <= 0) continue;
            const anchor = rawAppointments.find((a) => Number(a.id) === Number(id));
            const clump = householdAppointmentIdsInVisitClump(
              anchor,
              rawAppointments,
              PRACTICE_TZ
            );
            if (clump.length > 0) {
              for (const cid of clump) out.add(cid);
            } else {
              out.add(id);
            }
          }
          return [...out];
        };

        const sourceIds = expandVisitClumpIds(sourceIdsRaw);
        // Newly created rows may not be in range state yet — keep book-modal ids + any clump mates we can resolve.
        const createdIdSet = new Set([
          ...expandVisitClumpIds(createdIdsRaw),
          ...createdIdsRaw.filter((id) => Number.isFinite(id) && id > 0),
        ]);

        const newTypeId =
          detail?.exploreCreatedAppointmentTypeId ??
          detail?.bookedAppointmentTypeId ??
          prefillAtBook?.appointmentTypeId;
        const newTypeRow =
          newTypeId != null ? typeList.find((t) => Number(t.id) === Number(newTypeId)) : undefined;
        const newIsHold = isHoldAppointmentTypeForBook(typeCatalog, {
          typeId: newTypeId,
          typeName: newTypeRow?.name?.trim() || newTypeRow?.prettyName?.trim() || null,
        });

        const appointmentNeedsHold = (id: number): boolean => {
          if (createdIdSet.has(id)) {
            // Same type was used for each created alternative in the book loop.
            return !newIsHold;
          }
          const src = rawAppointments.find((a) => Number(a.id) === Number(id));
          const patch = prefillAtBook?.rescheduleVisitPatches?.find(
            (p) => Number(p.appointmentId) === Number(id)
          );
          const typeId = src?.appointmentType?.id ?? patch?.appointmentTypeId ?? null;
          const typeName =
            src?.appointmentType?.name?.trim() ||
            src?.appointmentType?.prettyName?.trim() ||
            null;
          // Only flag sources we can classify; unknown → leave alone.
          if (typeId == null && !typeName) return false;
          return !isHoldAppointmentTypeForBook(typeCatalog, { typeId, typeName });
        };

        const nonHoldSourceIds = sourceIds.filter(appointmentNeedsHold);
        const nonHoldCreatedIds = [...createdIdSet].filter(appointmentNeedsHold);
        const nonHoldIds = [...new Set([...nonHoldSourceIds, ...nonHoldCreatedIds])];
        if (nonHoldIds.length > 0 && holdAppointmentTypes.length > 0) {
          setExploreHoldConvertError(null);
          setExploreHoldPrompt({
            newAppointmentId: savedId,
            sourceNeedsHold: nonHoldSourceIds.length > 0,
            newNeedsHold: nonHoldCreatedIds.length > 0,
            nonHoldAppointmentIds: nonHoldIds,
            sourceAppointmentIds: sourceIds,
          });
        } else {
          const optimizeNotes = scheduleOptimizeNotesForAppointmentIds(PRACTICE_ID, [
            ...sourceIds,
            ...createdIdSet,
          ]);
          if (optimizeNotes) {
            const ids = [...new Set([...sourceIds, ...createdIdSet])];
            for (const id of ids) {
              const current =
                rawAppointments.find((a) => Number(a.id) === Number(id)) ??
                (await fetchAppointmentById(id, { practiceId: PRACTICE_ID }));
              const nextInstructions = mergeOptimizeNotesIntoStaffInstructions(
                current?.instructions,
                optimizeNotes
              );
              if (nextInstructions === (current?.instructions ?? '').trim()) continue;
              await patchAppointment(
                id,
                {
                  instructions: nextInstructions || null,
                  bookedViaRouting: true,
                },
                { practiceId: PRACTICE_ID },
              );
            }
          }
        }
      }
    },
    [
      loadRange,
      routingPreview,
      bookPrefill?.rescheduleAppointmentId,
      bookPrefill?.forwardBookingTrackingToken,
      bookPrefill?.forwardBookingEntryId,
      bookPrefill?.appointmentRequestSubmissionId,
      bookPrefill?.forwardBookingVisitCompletes,
      bookPrefill?.clientLabel,
      bookPrefill?.appointmentTypeId,
      bookPrefill?.providerId,
      bookSlot,
      embedInRoutingWorkspace,
      closeBookModal,
      navigate,
      providers,
      pulseEditVisitHighlight,
      view,
      typeList,
      typeCatalog,
      rawAppointments,
      holdAppointmentTypes,
      scheduleOptimizeSavingsActor,
    ]
  );

  const showToast = useCallback((msg: string, dismissMs = 6000) => {
    toastDismissMsRef.current = dismissMs;
    setToast(msg);
  }, []);

  const convertExploreHoldTypes = useCallback(
    async (holdTypeId: number) => {
      const prompt = exploreHoldPrompt;
      if (!prompt || convertingExploreHold) return;
      setConvertingExploreHold(true);
      setExploreHoldConvertError(null);
      try {
        const optimizeNotes = scheduleOptimizeNotesForAppointmentIds(PRACTICE_ID, [
          ...prompt.nonHoldAppointmentIds,
          ...prompt.sourceAppointmentIds,
        ]);
        for (const id of prompt.nonHoldAppointmentIds) {
          const current =
            rawAppointments.find((a) => Number(a.id) === Number(id)) ??
            (await fetchAppointmentById(id, { practiceId: PRACTICE_ID }));
          const nextInstructions = mergeOptimizeNotesIntoStaffInstructions(
            current?.instructions,
            optimizeNotes
          );
          await patchAppointment(
            id,
            {
              appointmentTypeId: holdTypeId,
              /** Skip role manual-book gate — converting an existing visit to HOLD. */
              bookedViaRouting: true,
              ...(nextInstructions !== (current?.instructions ?? '').trim()
                ? { instructions: nextInstructions || null }
                : {}),
            },
            { practiceId: PRACTICE_ID },
          );
        }
        if (optimizeNotes) {
          for (const id of prompt.sourceAppointmentIds) {
            if (prompt.nonHoldAppointmentIds.includes(id)) continue;
            const current =
              rawAppointments.find((a) => Number(a.id) === Number(id)) ??
              (await fetchAppointmentById(id, { practiceId: PRACTICE_ID }));
            const nextInstructions = mergeOptimizeNotesIntoStaffInstructions(
              current?.instructions,
              optimizeNotes
            );
            if (nextInstructions === (current?.instructions ?? '').trim()) continue;
            await patchAppointment(
              id,
              {
                instructions: nextInstructions || null,
                bookedViaRouting: true,
              },
              { practiceId: PRACTICE_ID },
            );
          }
        }
        const holdType = holdAppointmentTypes.find((t) => Number(t.id) === Number(holdTypeId));
        const holdTypeName = holdType?.prettyName?.trim() || holdType?.name?.trim() || 'HOLD';
        resolveScheduleOptimizeQueueItems(PRACTICE_ID, {
          appointmentIds: [...prompt.nonHoldAppointmentIds, ...prompt.sourceAppointmentIds],
          outcome: 'alternative',
          note: formatScheduleOptimizeQueueActionNote({ kind: 'hold' }),
          appointmentType: holdTypeName,
          allowAlreadyMoved: true,
          savingsStaff: scheduleOptimizeSavingsActor,
          alternativeAppointmentIds: [prompt.newAppointmentId],
        });
        setExploreHoldPrompt(null);
        await loadRange({ refreshDrive: true });
        const n = prompt.nonHoldAppointmentIds.length;
        showToast(n === 1 ? 'Appointment is on hold.' : `All ${n} appointments are on hold.`);
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string | string[] } } })?.response?.data
            ?.message ??
          (e as Error)?.message ??
          'Could not change the appointment type.';
        const text = Array.isArray(msg) ? msg.join(', ') : String(msg);
        setExploreHoldConvertError(text);
        showToast(text);
      } finally {
        setConvertingExploreHold(false);
      }
    },
    [exploreHoldPrompt, convertingExploreHold, loadRange, showToast, holdAppointmentTypes, rawAppointments, scheduleOptimizeSavingsActor]
  );

  const mergeStaffConfirmAppointmentUpdates = useCallback(
    (updated: Appointment[]) => {
      if (updated.length === 0) return;
      setRawAppointments((prev) => {
        const next = [...prev];
        for (const row of updated) {
          const idx = next.findIndex((a) => a.id === row.id);
          if (idx === -1) next.push(row);
          else next[idx] = { ...next[idx], ...row };
        }
        return next;
      });
      const anchorId = staffConfirmPreview?.bookedAppointmentId;
      const anchor =
        (anchorId != null
          ? updated.find((a) => schedulerAppointmentIdsEqual(a.id, anchorId))
          : undefined) ?? updated[0];
      if (anchor) setStaffConfirmApptResolved(anchor);
    },
    [staffConfirmPreview?.bookedAppointmentId],
  );

  const applyStaffConfirmVisitTypesFromRequest = useCallback(async () => {
    if (!staffConfirmPreview) return [];
    const appts =
      staffConfirmHouseholdAppts.length > 0
        ? staffConfirmHouseholdAppts
        : staffConfirmApptForPopover
          ? [staffConfirmApptForPopover]
          : [];
    if (appts.length === 0) return [];
    try {
      const submission = await fetchAppointmentRequestSubmission(
        staffConfirmPreview.submissionId,
      );
      return await applyAppointmentRequestTypesToStaffConfirmVisits({
        requestData: submission.requestData ?? {},
        appointments: appts,
        catalog: typeCatalog,
        appointmentTypes: typeList,
        practiceId: PRACTICE_ID,
      });
    } catch {
      return [];
    }
  }, [
    staffConfirmPreview,
    staffConfirmHouseholdAppts,
    staffConfirmApptForPopover,
    typeCatalog,
    typeList,
  ]);

  useEffect(() => {
    if (!staffConfirmPreview || !staffConfirmApptForPopover || staffConfirmEditing) return;
    if (!staffConfirmRequestDataReady) return;

    const appts =
      staffConfirmHouseholdAppts.length > 0
        ? staffConfirmHouseholdAppts
        : [staffConfirmApptForPopover];
    const blocked = staffConfirmVisitTypeUpgradeBlockedMessage({
      requestData: staffConfirmRequestData ?? {},
      appointments: appts,
      appointmentTypes: typeList,
      catalog: typeCatalog,
    });
    if (blocked) return;

    const sig = [
      staffConfirmPreview.submissionId,
      ...staffConfirmHouseholdAppts.map((a) => {
        const patientKey =
          patientsForAppointment(a)
            .map((p) => String(p.id ?? p.pimsId ?? ''))
            .join('|') || 'none';
        return `${a.id}:${patientKey}`;
      }),
    ].join(':');
    if (staffConfirmTypesAppliedRef.current === sig) return;

    let cancelled = false;
    void (async () => {
      const updated = await applyStaffConfirmVisitTypesFromRequest();
      if (cancelled) return;
      staffConfirmTypesAppliedRef.current = sig;
      if (updated.length === 0) return;
      mergeStaffConfirmAppointmentUpdates(updated);
      void loadRange({ refreshDrive: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    staffConfirmPreview,
    staffConfirmApptForPopover,
    staffConfirmHouseholdAppts,
    staffConfirmEditing,
    staffConfirmRequestData,
    staffConfirmRequestDataReady,
    typeList,
    typeCatalog,
    applyStaffConfirmVisitTypesFromRequest,
    mergeStaffConfirmAppointmentUpdates,
    loadRange,
  ]);

  const dismissStaffConfirmPreview = useCallback(() => {
    const returnPath = staffConfirmPreview?.returnPath?.trim() || null;
    staffConfirmTypesAppliedRef.current = null;
    clearAppointmentRequestStaffConfirmSession();
    setStaffConfirmPreview(null);
    setStaffConfirmPreviewError(null);
    setStaffConfirmEditing(false);
    setStaffConfirmEditingApptId(null);
    setStaffConfirmLinkSelection(null);
    setEditVisitPatientSelection(null);
    if (returnFromSchedulerFocusToGmail(navigate)) return;
    if (returnPath) {
      navigate(returnPath);
      return;
    }
    returnToAppointmentRequestsList(navigate, 'to_confirm');
  }, [navigate, staffConfirmPreview?.returnPath]);

  useEffect(() => {
    if (!staffConfirmPreview || staffConfirmPreviewConfirming || staffConfirmEditing) return;

    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-staff-confirm-popover]')) return;
      if (target.closest('[data-appt-id]')) return;
      dismissStaffConfirmPreview();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismissStaffConfirmPreview();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [
    staffConfirmPreview,
    staffConfirmPreviewConfirming,
    staffConfirmEditing,
    dismissStaffConfirmPreview,
  ]);

  const handleStaffConfirmEditSaved = useCallback(
    (updated?: Appointment, detail?: { alignedAppointments?: Appointment[] }) => {
      const preview = staffConfirmPreview;
      if (updated?.id != null || (detail?.alignedAppointments?.length ?? 0) > 0) {
        if (updated?.id != null) {
          const highlightTargets = householdAppointmentIdsInVisitClump(
            updated,
            calendarApptsForHouseholdLookup,
            PRACTICE_TZ,
          );
          pulseEditVisitHighlight(
            highlightTargets.length > 0 ? highlightTargets : Number(updated.id),
          );
        }
        setRawAppointments((prev) => {
          const next = [...prev];
          const apply = (row: Appointment) => {
            const idx = next.findIndex((a) => a.id === row.id);
            if (idx === -1) return;
            next[idx] = { ...next[idx], ...row };
          };
          if (updated?.id != null) apply(updated);
          for (const row of detail?.alignedAppointments ?? []) apply(row);
          return next;
        });
        if (updated) setStaffConfirmApptResolved(updated);
      }
      staffConfirmTypesAppliedRef.current = null;
      setStaffConfirmEditing(false);
      setStaffConfirmEditingApptId(null);
      setEditVisitPatientSelection(null);
      void loadRange({ refreshDrive: true });

      if (!preview || !updated) return;

      void (async () => {
        const anchorAppt = updated;
        const householdAppts = anchorAppt
          ? resolveHouseholdVisitAppointments(
              anchorAppt,
              calendarApptsForHouseholdLookup,
              PRACTICE_TZ,
              { clientLabel: preview.clientLabel },
            )
          : staffConfirmHouseholdAppts;

        const refreshedHousehold = await Promise.all(
          householdAppts.map(async (a) => {
            const id = Number(a.id);
            if (!Number.isFinite(id) || id <= 0) return a;
            try {
              return (await fetchAppointmentById(id, { practiceId: PRACTICE_ID })) ?? a;
            } catch {
              return a;
            }
          }),
        );

        const exitKind = resolveHouseholdHoldExitKind(refreshedHousehold, typeCatalog);
        if (exitKind === 'booked' || exitKind === 'removed') {
          await clearApptRequestGmailOnHoldLabel({ submissionId: preview.submissionId });
        }

        // Converting the HOLD via Edit (without clicking Confirm) must still clear Auto-Booked.
        if (exitKind === 'booked') {
          try {
            const submission = await fetchAppointmentRequestSubmission(preview.submissionId);
            if (appointmentRequestNeedsStaffConfirmation(submission)) {
              await patchAppointmentRequestSubmission(preview.submissionId, { confirm: true });
            }
          } catch {
            /* non-fatal — Confirm on Auto-Booked can still finish it */
          }
        }

        if (
          preview.returnPath &&
          isHoldsBoardReturnPath(preview.returnPath) &&
          (exitKind === 'booked' || exitKind === 'removed')
        ) {
          const appointmentIds = refreshedHousehold
            .map((a) => Number(a.id))
            .filter((id) => Number.isFinite(id) && id > 0);
          writeHoldsBoardReturnSession({
            appointmentIds:
              appointmentIds.length > 0 ? appointmentIds : [preview.bookedAppointmentId],
            exitKind: exitKind === 'removed' ? 'removed' : 'booked',
            clientLabel: preview.clientLabel,
          });
          staffConfirmTypesAppliedRef.current = null;
          clearAppointmentRequestStaffConfirmSession();
          setStaffConfirmPreview(null);
          setStaffConfirmPreviewError(null);
          setStaffConfirmEditing(false);
          setStaffConfirmEditingApptId(null);
          setStaffConfirmLinkSelection(null);
          setEditVisitPatientSelection(null);
          notifySchedulingToolsNavCountsRefresh();
          navigate(preview.returnPath);
        }
      })();
    },
    [
      pulseEditVisitHighlight,
      loadRange,
      calendarApptsForHouseholdLookup,
      staffConfirmPreview,
      staffConfirmHouseholdAppts,
      typeCatalog,
      navigate,
    ],
  );

  const handleStaffConfirmEditPet = useCallback((appointmentId: number) => {
    setStaffConfirmLinkSelection(null);
    setEditVisitPatientSelection(null);
    setStaffConfirmEditingApptId(appointmentId);
    setStaffConfirmEditing(true);
  }, []);

  const handleStaffConfirmEdit = useCallback(() => {
    if (staffConfirmHouseholdEditChoices.length > 1) return;
    setStaffConfirmLinkSelection(null);
    setEditVisitPatientSelection(null);
    const only = staffConfirmHouseholdEditChoices[0];
    setStaffConfirmEditingApptId(only?.appointmentId ?? staffConfirmPreview?.bookedAppointmentId ?? null);
    setStaffConfirmEditing(true);
  }, [staffConfirmHouseholdEditChoices, staffConfirmPreview?.bookedAppointmentId]);

  const confirmStaffConfirmPreview = useCallback(async () => {
    if (!staffConfirmPreview) return;
    setStaffConfirmPreviewConfirming(true);
    setStaffConfirmPreviewError(null);
    try {
      const appts =
        staffConfirmHouseholdAppts.length > 0
          ? staffConfirmHouseholdAppts
          : staffConfirmApptForPopover
            ? [staffConfirmApptForPopover]
            : [];
      const requestData =
        staffConfirmRequestData ??
        (await fetchAppointmentRequestSubmission(staffConfirmPreview.submissionId))
          .requestData ??
        {};
      const blocked =
        staffConfirmHoldVisitBlockedMessage({
          appointments: appts,
          catalog: typeCatalog,
        }) ??
        staffConfirmVisitTypeUpgradeBlockedMessage({
          requestData,
          appointments: appts,
          appointmentTypes: typeList,
          catalog: typeCatalog,
        });
      if (blocked) {
        setStaffConfirmPreviewError(blocked);
        return;
      }

      const updated = await applyStaffConfirmVisitTypesFromRequest();
      mergeStaffConfirmAppointmentUpdates(updated);
      if (updated.length > 0) {
        await loadRange({ refreshDrive: true });
      }

      const updatedById = new Map(updated.map((a) => [Number(a.id), a]));
      const apptsAfterUpdate = appts.map((a) => updatedById.get(Number(a.id)) ?? a);

      const stillBlocked =
        staffConfirmHoldVisitBlockedMessage({
          appointments: apptsAfterUpdate,
          catalog: typeCatalog,
        }) ??
        staffConfirmVisitTypeUpgradeBlockedMessage({
          requestData,
          appointments: apptsAfterUpdate,
          appointmentTypes: typeList,
          catalog: typeCatalog,
        });
      if (stillBlocked) {
        setStaffConfirmPreviewError(stillBlocked);
        return;
      }

      await clearApptRequestGmailOnHoldLabel({
        submissionId: staffConfirmPreview.submissionId,
      });

      await patchAppointmentRequestSubmission(staffConfirmPreview.submissionId, {
        confirm: true,
      });
      staffConfirmTypesAppliedRef.current = null;
      const returnPath = staffConfirmPreview.returnPath?.trim() || null;
      const submissionId = staffConfirmPreview.submissionId;
      const bookedAppointmentId = staffConfirmPreview.bookedAppointmentId;
      const confirmClientLabel = staffConfirmPreview.clientLabel;
      const appointmentIds = apptsAfterUpdate
        .map((a) => Number(a.id))
        .filter((id) => Number.isFinite(id) && id > 0);
      clearAppointmentRequestStaffConfirmSession();
      setStaffConfirmPreview(null);
      notifySchedulingToolsNavCountsRefresh();
      if (returnFromSchedulerFocusToGmail(navigate)) return;
      if (returnPath && isHoldsBoardReturnPath(returnPath)) {
        writeHoldsBoardReturnSession({
          appointmentIds:
            appointmentIds.length > 0 ? appointmentIds : [bookedAppointmentId],
          exitKind: 'booked',
          clientLabel: confirmClientLabel,
        });
        navigate(returnPath);
        return;
      }
      writeAppointmentRequestStaffConfirmReturnSession({
        submissionId,
      });
      returnToAppointmentRequestsList(navigate, 'to_confirm');
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not confirm appointment';
      setStaffConfirmPreviewError(String(msg));
    } finally {
      setStaffConfirmPreviewConfirming(false);
    }
  }, [
    staffConfirmPreview,
    navigate,
    staffConfirmHouseholdAppts,
    staffConfirmApptForPopover,
    staffConfirmRequestData,
    typeList,
    typeCatalog,
    applyStaffConfirmVisitTypesFromRequest,
    mergeStaffConfirmAppointmentUpdates,
    loadRange,
  ]);

  const dismissOnHoldVisitPreview = useCallback(() => {
    const returnPath = onHoldVisitPreview?.returnPath ?? ON_HOLD_LIST_PATH;
    clearOnHoldVisitEditSession();
    clearEditVisitHighlightTimer();
    setEditVisitHighlightIds(new Set());
    setOnHoldVisitPreview(null);
    setOnHoldVisitConvertedExitKind(null);
    setOnHoldVisitEditing(false);
    setOnHoldVisitEditingApptId(null);
    setOnHoldVisitLinkSelection(null);
    setEditVisitPatientSelection(null);
    setOnHoldVisitRemoveConfirming(false);
    setOnHoldVisitRemoveError(null);
    navigate(returnPath);
  }, [navigate, onHoldVisitPreview, clearEditVisitHighlightTimer]);

  const confirmOnHoldVisitRemove = useCallback(
    async (reason: string) => {
      const preview = onHoldVisitPreview;
      if (!preview || preview.flowIntent !== 'remove') return;
      const trimmed = reason.trim();
      if (!trimmed) return;
      const ids =
        preview.removeAppointmentIds && preview.removeAppointmentIds.length > 0
          ? preview.removeAppointmentIds
          : [preview.bookedAppointmentId];
      setOnHoldVisitRemoveConfirming(true);
      setOnHoldVisitRemoveError(null);
      try {
        for (const id of ids) {
          await cancelAppointment(
            id,
            { cancellationFlag: true, cancellationReason: trimmed },
            { practiceId: PRACTICE_ID },
          );
        }
        creditScheduleOptimizeSavingsWhenOriginalRemoved(
          PRACTICE_ID,
          ids.map((id) => Number(id)),
          scheduleOptimizeSavingsActor,
        );
        if (preview.listKind === 'appointment_request') {
          await clearApptRequestGmailOnHoldLabel({ submissionId: preview.listEntryId });
        }
        if (isHoldsBoardReturnPath(preview.returnPath)) {
          writeHoldsBoardReturnSession({
            appointmentIds: ids,
            exitKind: 'removed',
            clientLabel: preview.clientLabel,
            groupKey: preview.groupKey,
            snapshotAppointmentStart: onHoldVisitApptForPopover?.appointmentStart ?? null,
          });
        } else {
          writeOnHoldVisitEditReturnSession({
            listEntryId: preview.listEntryId,
            listKind: preview.listKind,
            exitKind: 'removed',
          });
        }
        clearOnHoldVisitEditSession();
        clearSchedulerFocusSession();
        clearEditVisitHighlightTimer();
        setEditVisitHighlightIds(new Set());
        setOnHoldVisitPreview(null);
        setOnHoldVisitConvertedExitKind(null);
        setOnHoldVisitEditing(false);
        setOnHoldVisitEditingApptId(null);
        setOnHoldVisitLinkSelection(null);
        setEditVisitPatientSelection(null);
        setOnHoldVisitRemoveConfirming(false);
        setOnHoldVisitRemoveError(null);
        notifySchedulingToolsNavCountsRefresh();
        navigate(preview.returnPath);
      } catch (e: unknown) {
        const msg =
          (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          (e as Error)?.message ??
          'Could not remove this hold.';
        setOnHoldVisitRemoveError(String(msg));
      } finally {
        setOnHoldVisitRemoveConfirming(false);
      }
    },
    [onHoldVisitPreview, onHoldVisitApptForPopover, clearEditVisitHighlightTimer, navigate, scheduleOptimizeSavingsActor],
  );

  const finishOnHoldVisitConverted = useCallback(
    (opts?: { navigateBack?: boolean }) => {
      const navigateBack = opts?.navigateBack !== false;
      const preview = onHoldVisitPreview;
      const exitKind = onHoldVisitConvertedExitKind;
      if (!preview || !exitKind) {
        dismissOnHoldVisitPreview();
        return;
      }
      if (isHoldsBoardReturnPath(preview.returnPath)) {
        const householdIds = onHoldVisitHouseholdAppts
          .map((a) => Number(a.id))
          .filter((id) => Number.isFinite(id) && id > 0);
        writeHoldsBoardReturnSession({
          appointmentIds:
            householdIds.length > 0 ? householdIds : [preview.bookedAppointmentId],
          exitKind: exitKind === 'removed' ? 'removed' : 'booked',
          clientLabel: preview.clientLabel,
          groupKey: preview.groupKey,
          snapshotAppointmentStart: onHoldVisitApptForPopover?.appointmentStart ?? null,
        });
      } else {
        writeOnHoldVisitEditReturnSession({
          listEntryId: preview.listEntryId,
          listKind: preview.listKind,
          exitKind,
        });
      }
      clearOnHoldVisitEditSession();
      clearEditVisitHighlightTimer();
      setEditVisitHighlightIds(new Set());
      setOnHoldVisitPreview(null);
      setOnHoldVisitConvertedExitKind(null);
      setOnHoldVisitEditing(false);
      setOnHoldVisitEditingApptId(null);
      setOnHoldVisitLinkSelection(null);
      setEditVisitPatientSelection(null);
      notifySchedulingToolsNavCountsRefresh();
      if (navigateBack) navigate(preview.returnPath);
    },
    [
      onHoldVisitPreview,
      onHoldVisitConvertedExitKind,
      onHoldVisitHouseholdAppts,
      onHoldVisitApptForPopover,
      dismissOnHoldVisitPreview,
      clearEditVisitHighlightTimer,
      navigate,
    ],
  );

  const completeOnHoldVisitReturn = useCallback(() => {
    finishOnHoldVisitConverted({ navigateBack: true });
  }, [finishOnHoldVisitConverted]);

  const completeOnHoldVisitStayOnSchedule = useCallback(() => {
    finishOnHoldVisitConverted({ navigateBack: false });
  }, [finishOnHoldVisitConverted]);

  const dismissNotBookedRemoveGate = useCallback(() => {
    const returnPath = notBookedRemoveGate?.returnPath;
    clearNotBookedRemoveSession();
    clearSchedulerFocusSession();
    clearEditVisitHighlightTimer();
    setEditVisitHighlightIds(new Set());
    setNotBookedRemoveGate(null);
    if (returnPath) navigate(returnPath);
  }, [notBookedRemoveGate, navigate, clearEditVisitHighlightTimer]);

  const dismissSlotOfferReview = useCallback(() => {
    const returnPath = slotOfferReviewPreview?.returnPath ?? TEXTED_OFFERS_TO_REVIEW_PATH;
    clearSlotOfferReviewSession();
    clearSchedulerFocusSession();
    clearEditVisitHighlightTimer();
    setEditVisitHighlightIds(new Set());
    setSlotOfferReviewPreview(null);
    setSlotOfferReviewError(null);
    navigate(returnPath);
  }, [navigate, slotOfferReviewPreview, clearEditVisitHighlightTimer]);

  const confirmSlotOfferReview = useCallback(async () => {
    const preview = slotOfferReviewPreview;
    if (!preview || slotOfferReviewConfirming) return;
    setSlotOfferReviewConfirming(true);
    setSlotOfferReviewError(null);
    try {
      await confirmSlotOffer(preview.offerId, PRACTICE_ID);
      writeSlotOfferReviewReturnSession(preview.offerId);
      clearSlotOfferReviewSession();
      clearSchedulerFocusSession();
      clearEditVisitHighlightTimer();
      setEditVisitHighlightIds(new Set());
      setSlotOfferReviewPreview(null);
      setSlotOfferReviewError(null);
      notifySchedulingToolsNavCountsRefresh();
      navigate(preview.returnPath);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as Error)?.message ??
        'Could not mark this offer reviewed.';
      setSlotOfferReviewError(String(msg));
    } finally {
      setSlotOfferReviewConfirming(false);
    }
  }, [slotOfferReviewPreview, slotOfferReviewConfirming, clearEditVisitHighlightTimer, navigate]);

  const completeNotBookedRemoveFlow = useCallback(
    (gate: NotBookedRemoveSessionV1) => {
      writeNotBookedRemoveReturnSession({ submissionId: gate.submissionId });
      clearNotBookedRemoveSession();
      clearSchedulerFocusSession();
      clearEditVisitHighlightTimer();
      setEditVisitHighlightIds(new Set());
      setNotBookedRemoveGate(null);
      navigate(gate.returnPath);
      showToast('Visit removed. Finish marking the request as not booked.');
    },
    [navigate, showToast, clearEditVisitHighlightTimer],
  );

  const notBookedRemoveAppt = useMemo(() => {
    if (!notBookedRemoveGate) return null;
    const targetId = notBookedRemoveGate.bookedAppointmentId;
    return (
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      null
    );
  }, [notBookedRemoveGate, rawAppointments, calendarAppointments]);

  const notBookedRemoveHighlightIds = useMemo(() => {
    if (!notBookedRemoveGate || !notBookedRemoveAppt) return null;
    const allAppts = calendarAppointments.length > 0 ? calendarAppointments : rawAppointments;
    const ids = householdAppointmentIdsInVisitClump(
      notBookedRemoveAppt,
      allAppts,
      PRACTICE_TZ,
    );
    const resolved =
      ids.length > 0 ? ids : [notBookedRemoveGate.bookedAppointmentId];
    return new Set(resolved);
  }, [notBookedRemoveGate, notBookedRemoveAppt, calendarAppointments, rawAppointments]);

  useEffect(() => {
    if (!notBookedRemoveGate || !notBookedRemoveAppt) return;
    if (!isAppointmentCancelledOnPracticeCalendar(notBookedRemoveAppt)) return;
    completeNotBookedRemoveFlow(notBookedRemoveGate);
  }, [notBookedRemoveGate, notBookedRemoveAppt, completeNotBookedRemoveFlow]);

  /** Scroll the linked visit into view while the not-booked gate is open. */
  useEffect(() => {
    if (!notBookedRemoveGate || !notBookedRemoveAppt) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(
        `[data-appt-id="${CSS.escape(String(notBookedRemoveGate.bookedAppointmentId))}"]`,
      );
      if (el instanceof HTMLElement) {
        scrollAppointmentElementIntoView(el, 'smooth');
      }
    });
  }, [notBookedRemoveGate, notBookedRemoveAppt]);

  useEffect(() => {
    if (!slotOfferReviewPreview) return;

    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-slot-offer-review-popover]')) return;
      if (target.closest('[data-appt-id]')) return;
      dismissSlotOfferReview();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismissSlotOfferReview();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [slotOfferReviewPreview, dismissSlotOfferReview]);

  useEffect(() => {
    if (!onHoldVisitPreview || onHoldVisitEditing || onHoldVisitConvertedExitKind) return;

    const onPointerDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-on-hold-visit-popover]')) return;
      if (target.closest('[data-appt-id]')) return;
      dismissOnHoldVisitPreview();
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') dismissOnHoldVisitPreview();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [
    onHoldVisitPreview,
    onHoldVisitEditing,
    onHoldVisitConvertedExitKind,
    dismissOnHoldVisitPreview,
  ]);

  useEffect(() => {
    if (!onHoldVisitPreview || !onHoldVisitConvertedExitKind) return;

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') completeOnHoldVisitStayOnSchedule();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onHoldVisitPreview, onHoldVisitConvertedExitKind, completeOnHoldVisitStayOnSchedule]);

  const handleOnHoldVisitEditSaved = useCallback(
    (updated?: Appointment, detail?: { alignedAppointments?: Appointment[] }) => {
      const preview = onHoldVisitPreview;
      if (!preview) return;

      void (async () => {
        if (updated?.id != null || (detail?.alignedAppointments?.length ?? 0) > 0) {
          setRawAppointments((prev) => {
            const next = [...prev];
            const apply = (row: Appointment) => {
              const idx = next.findIndex((a) => a.id === row.id);
              if (idx === -1) return;
              next[idx] = { ...next[idx], ...row };
            };
            if (updated?.id != null) apply(updated);
            for (const row of detail?.alignedAppointments ?? []) apply(row);
            return next;
          });
          if (updated) setOnHoldVisitApptResolved(updated);
        }

        setOnHoldVisitEditing(false);
        setOnHoldVisitEditingApptId(null);
        setOnHoldVisitLinkSelection(null);
        setEditVisitPatientSelection(null);

        const anchorAppt = updated ?? onHoldVisitApptForPopover;
        const householdAppts = anchorAppt
          ? resolveHouseholdVisitAppointments(
              anchorAppt,
              calendarApptsForHouseholdLookup,
              PRACTICE_TZ,
              { clientLabel: preview.clientLabel },
            )
          : [];

        const refreshedHousehold = await Promise.all(
          householdAppts.map(async (a) => {
            const id = Number(a.id);
            if (!Number.isFinite(id) || id <= 0) return a;
            try {
              return (await fetchAppointmentById(id, { practiceId: PRACTICE_ID })) ?? a;
            } catch {
              return a;
            }
          }),
        );

        const exitKind = resolveHouseholdHoldExitKind(refreshedHousehold, typeCatalog);

        if (exitKind === 'updated') {
          if (updated?.id != null) {
            setOnHoldVisitApptResolved(updated);
            const highlightTargets = householdAppointmentIdsInVisitClump(
              updated,
              calendarApptsForHouseholdLookup,
              PRACTICE_TZ,
            );
            pulseEditVisitHighlight(
              highlightTargets.length > 0 ? highlightTargets : Number(updated.id),
            );
          }
          void loadRange({ refreshDrive: true });
          return;
        }

        if (
          preview.listKind === 'appointment_request' &&
          (exitKind === 'booked' || exitKind === 'removed')
        ) {
          await clearApptRequestGmailOnHoldLabel({ submissionId: preview.listEntryId });
        }

        // Booking a hold that is also an unconfirmed online auto-book (e.g. new-client
        // onboarding) must clear it from the Auto-Booked queue too — otherwise it lingers
        // there "as if not confirmed" after the hold is gone. Setting staffConfirmedAt keeps
        // Holds + Auto-Booked in sync from a single action.
        if (preview.listKind === 'appointment_request' && exitKind === 'booked') {
          try {
            const submission = await fetchAppointmentRequestSubmission(preview.listEntryId);
            if (appointmentRequestNeedsStaffConfirmation(submission)) {
              await patchAppointmentRequestSubmission(preview.listEntryId, { confirm: true });
            }
          } catch {
            /* non-fatal: hold still booked; Auto-Booked can be cleared manually */
          }
        }

        const highlightTargets = anchorAppt
          ? householdAppointmentIdsInVisitClump(
              anchorAppt,
              calendarApptsForHouseholdLookup,
              PRACTICE_TZ,
            )
          : updated?.id != null
            ? [Number(updated.id)]
            : [preview.bookedAppointmentId];
        pulseEditVisitHighlight(
          highlightTargets.length > 0 ? highlightTargets : preview.bookedAppointmentId,
          60_000,
        );
        setOnHoldVisitConvertedExitKind(exitKind);
        notifySchedulingToolsNavCountsRefresh();
        void loadRange({ refreshDrive: true });
      })();
    },
    [
      onHoldVisitPreview,
      pulseEditVisitHighlight,
      calendarApptsForHouseholdLookup,
      onHoldVisitApptForPopover,
      typeCatalog,
      loadRange,
    ],
  );

  const handleOnHoldVisitEditPet = useCallback((appointmentId: number) => {
    setOnHoldVisitLinkSelection(null);
    setEditVisitPatientSelection(null);
    setOnHoldVisitEditingApptId(appointmentId);
    setOnHoldVisitEditing(true);
  }, []);

  const handleOnHoldVisitEdit = useCallback(() => {
    if (onHoldVisitHouseholdEditChoices.length > 1) return;
    setOnHoldVisitLinkSelection(null);
    setEditVisitPatientSelection(null);
    const only = onHoldVisitHouseholdEditChoices[0];
    setOnHoldVisitEditingApptId(
      only?.appointmentId ?? onHoldVisitPreview?.bookedAppointmentId ?? null,
    );
    setOnHoldVisitEditing(true);
  }, [onHoldVisitHouseholdEditChoices, onHoldVisitPreview?.bookedAppointmentId]);

  const handleOnHoldVisitEditFromConverted = useCallback(() => {
    handleOnHoldVisitEdit();
  }, [handleOnHoldVisitEdit]);

  useEffect(() => {
    if (pendingFocusApptId == null) return;
    if (providersLoadState !== 'resolved') return;

    const apptId = pendingFocusApptId;
    calendarFocusActiveRef.current = true;
    if (pendingFocusDateHintRef.current) {
      setPendingFocusHighlightApptId(apptId);
    }
    let cancelled = false;

    void (async () => {
      const appt = await fetchAppointmentById(apptId, { practiceId: PRACTICE_ID });
      if (cancelled) return;
      if (!appt) {
        calendarFocusActiveRef.current = false;
        clearSchedulerFocusSession();
        const staffConfirmSession = readAppointmentRequestStaffConfirmSession();
        clearAppointmentRequestStaffConfirmSession();
        setStaffConfirmPreview(null);
        const wasOnHoldEdit = readOnHoldVisitEditSession();
        clearOnHoldVisitEditSession();
        setOnHoldVisitPreview(null);
        const wasSlotOfferReview = readSlotOfferReviewSession();
        clearSlotOfferReviewSession();
        setSlotOfferReviewPreview(null);
        const wasNotBookedRemove = readNotBookedRemoveSession();
        clearNotBookedRemoveSession();
        setNotBookedRemoveGate(null);
        setPendingFocusApptId(null);
        // Linked visit already gone (soft-deleted / never found): still finish Not booked.
        if (wasNotBookedRemove) {
          writeNotBookedRemoveReturnSession({
            submissionId: wasNotBookedRemove.submissionId,
          });
          showToast(
            'That visit is no longer on the calendar. Finish marking the request as not booked.',
          );
          navigate(wasNotBookedRemove.returnPath);
          return;
        }
        // Auto-book Confirm: linked visit id is stale. Return to Auto-Booked so re-clicking
        // Confirm re-evaluates (re-link if another visit exists, else Not booked). Never
        // confirm here without a real appointment.
        if (staffConfirmSession) {
          showToast(
            'That visit is no longer on the calendar. Re-link the request or mark it Not booked.',
          );
          if (returnFromSchedulerFocusToGmail(navigate)) return;
          const returnPath = staffConfirmSession.returnPath?.trim() || null;
          if (returnPath) {
            navigate(returnPath);
            return;
          }
          returnToAppointmentRequestsList(navigate, 'to_confirm');
          return;
        }
        showToast('Could not find that appointment on the calendar.');
        if (wasOnHoldEdit) {
          navigate(wasOnHoldEdit.returnPath);
        } else if (wasSlotOfferReview) {
          navigate(wasSlotOfferReview.returnPath);
        }
        return;
      }

      // Not booked: cancelled hold still returned by GET — skip the remove gate.
      {
        const notBookedRemove = readNotBookedRemoveSession();
        if (
          notBookedRemove &&
          schedulerAppointmentIdsEqual(notBookedRemove.bookedAppointmentId, apptId) &&
          isAppointmentCancelledOnPracticeCalendar(appt)
        ) {
          calendarFocusActiveRef.current = false;
          clearSchedulerFocusSession();
          writeNotBookedRemoveReturnSession({ submissionId: notBookedRemove.submissionId });
          clearNotBookedRemoveSession();
          setNotBookedRemoveGate(null);
          setPendingFocusApptId(null);
          showToast(
            'That visit is no longer on the calendar. Finish marking the request as not booked.',
          );
          navigate(notBookedRemove.returnPath);
          return;
        }
      }

      // Staff Confirm: linked visit is cancelled. Return to Auto-Booked so re-clicking
      // Confirm re-evaluates (re-link if another visit exists, else Not booked). Never
      // confirm a cancelled visit.
      {
        const staffConfirmSession = readAppointmentRequestStaffConfirmSession();
        if (
          staffConfirmSession &&
          schedulerAppointmentIdsEqual(staffConfirmSession.bookedAppointmentId, apptId) &&
          isAppointmentCancelledOnPracticeCalendar(appt)
        ) {
          calendarFocusActiveRef.current = false;
          clearSchedulerFocusSession();
          clearAppointmentRequestStaffConfirmSession();
          setStaffConfirmPreview(null);
          setPendingFocusApptId(null);
          showToast(
            'That visit was cancelled. Re-link the request or mark it Not booked.',
          );
          if (returnFromSchedulerFocusToGmail(navigate)) return;
          const returnPath = staffConfirmSession.returnPath?.trim() || null;
          if (returnPath) {
            navigate(returnPath);
            return;
          }
          returnToAppointmentRequestsList(navigate, 'to_confirm');
          return;
        }
      }

      const focus = schedulerCalendarFocusFromAppointment(appt, providers, PRACTICE_TZ);
      if (focus) {
        setAnchorDate(focus.anchorDate);
        setView('week');
        if (focus.providerFilter) {
          setProviderFilter(focus.providerFilter);
          pendingFocusProviderHintRef.current = null;
        }
      } else {
        const dateHint = pendingFocusDateHintRef.current;
        if (dateHint) {
          setAnchorDate(dateHint);
          setView('week');
        }
        const providerQ = pendingFocusProviderHintRef.current;
        if (providerQ && providers.some((p) => String(p.id) === providerQ)) {
          setProviderFilter(providerQ);
          pendingFocusProviderHintRef.current = null;
        }
      }
      pendingFocusDateHintRef.current = null;
      if (!cancelled) {
        setPendingFocusHighlightApptId(apptId);
        setPendingFocusApptId(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingFocusApptId, providers, providersLoadState, showToast, navigate, typeCatalog]);

  /** After focus navigation, wait until the appointment is on the loaded calendar before pulsing. */
  useEffect(() => {
    if (pendingFocusHighlightApptId == null || loading || !showTimeGrid) return;
    const targetId = pendingFocusHighlightApptId;
    const inLoadedRange = rawAppointments.some((a) =>
      schedulerAppointmentIdsEqual(a.id, targetId)
    );
    const inRenderedRange = calendarAppointments.some((a) =>
      schedulerAppointmentIdsEqual(a.id, targetId)
    );
    if (!inLoadedRange && !inRenderedRange) return;
    setPendingFocusHighlightApptId(null);
    calendarFocusActiveRef.current = false;
    clearSchedulerFocusSession();
    const anchorAppt =
      rawAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId)) ??
      calendarAppointments.find((a) => schedulerAppointmentIdsEqual(a.id, targetId));
    const highlightTargets = householdAppointmentIdsInVisitClump(
      anchorAppt ?? null,
      calendarAppointments.length > 0 ? calendarAppointments : rawAppointments,
      PRACTICE_TZ,
    );
    const staffConfirm = readAppointmentRequestStaffConfirmSession();
    if (
      staffConfirm &&
      schedulerAppointmentIdsEqual(staffConfirm.bookedAppointmentId, targetId)
    ) {
      pulseEditVisitHighlight(highlightTargets.length > 0 ? highlightTargets : targetId, 6000);
      setStaffConfirmPreviewError(null);
      setStaffConfirmPreview(staffConfirm);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(
            `[data-appt-id="${CSS.escape(String(targetId))}"]`
          );
          if (el instanceof HTMLElement) {
            scrollAppointmentElementIntoView(el, 'smooth');
          }
        });
      });
      return;
    }
    const notBookedRemove = readNotBookedRemoveSession();
    if (
      notBookedRemove &&
      schedulerAppointmentIdsEqual(notBookedRemove.bookedAppointmentId, targetId)
    ) {
      setNotBookedRemoveGate(notBookedRemove);
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-appt-id="${CSS.escape(String(targetId))}"]`
        );
        if (el instanceof HTMLElement) {
          scrollAppointmentElementIntoView(el, 'smooth');
        }
      });
      return;
    }
    const slotOfferReview = readSlotOfferReviewSession();
    if (
      slotOfferReview &&
      schedulerAppointmentIdsEqual(slotOfferReview.bookedAppointmentId, targetId)
    ) {
      pulseEditVisitHighlight(highlightTargets.length > 0 ? highlightTargets : targetId, 6000);
      setSlotOfferReviewError(null);
      setSlotOfferReviewPreview(slotOfferReview);
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-appt-id="${CSS.escape(String(targetId))}"]`
        );
        if (el instanceof HTMLElement) {
          scrollAppointmentElementIntoView(el, 'smooth');
        }
      });
      return;
    }
    const onHoldEdit = readOnHoldVisitEditSession();
    if (onHoldEdit && schedulerAppointmentIdsEqual(onHoldEdit.bookedAppointmentId, targetId)) {
      pulseEditVisitHighlight(highlightTargets.length > 0 ? highlightTargets : targetId, 6000);
      setOnHoldVisitConvertedExitKind(null);
      setOnHoldVisitPreview(onHoldEdit);
      requestAnimationFrame(() => {
        const el = document.querySelector(
          `[data-appt-id="${CSS.escape(String(targetId))}"]`
        );
        if (el instanceof HTMLElement) {
          scrollAppointmentElementIntoView(el, 'smooth');
        }
      });
      return;
    }
    pulseEditVisitHighlight(
      highlightTargets.length > 0 ? highlightTargets : targetId,
      readSchedulerFocusReturnSession()?.returnToOptimize?.move ? 24 * 60 * 60 * 1000 : 6000,
    );
  }, [
    pendingFocusHighlightApptId,
    loading,
    showTimeGrid,
    rawAppointments,
    calendarAppointments,
    anchorDate,
    providerFilter,
    pulseEditVisitHighlight,
  ]);

  const editPreviewTypeFields = useCallback(
    (appointmentTypeId?: number) => {
      if (appointmentTypeId == null) return {};
      const row = typeList.find((t) => t.id === appointmentTypeId);
      const appointmentTypeName = row?.name?.trim() || row?.prettyName?.trim();
      return {
        appointmentTypeId,
        ...(appointmentTypeName ? { appointmentTypeName } : {}),
      };
    },
    [typeList]
  );

  const editPreviewOriginalFields = useCallback((appt: Appointment) => {
    const typeName =
      appt.appointmentType?.prettyName?.trim() || appt.appointmentType?.name?.trim() || undefined;
    return {
      originalAppointmentStart: appt.appointmentStart,
      originalAppointmentEnd: appt.appointmentEnd,
      ...(typeName ? { originalAppointmentTypeName: typeName } : {}),
    };
  }, []);

  useEffect(() => {
    return () => {
      if (editVisitHighlightTimerRef.current != null) {
        window.clearTimeout(editVisitHighlightTimerRef.current);
      }
    };
  }, []);

  const openEditVisitPreview = useCallback(
    (
      startUtc: string,
      endUtc: string,
      opts: { kind: 'time' | 'type'; appointmentTypeId?: number }
    ) => {
      if (!editAppt) return;
      const preview = buildEditVisitTimePreview(editAppt.id, startUtc, endUtc, PRACTICE_TZ, {
        kind: opts.kind,
        ...editPreviewTypeFields(opts.appointmentTypeId),
        ...editPreviewOriginalFields(editAppt),
      });
      if (!preview) return;
      setEditVisitHighlightIds(new Set());
      editVisitPostBookScrollSigRef.current = '';
      setEditTimePreview(preview);
      writeEditVisitTimePreview(preview);
      // Full-calendar preview only — keep the edit form closed until the popover is dismissed.
      setEditPlacementMode(false);
      setAnchorDate(preview.practiceDateKey);
      if (view === 'month') setView('week');
      driveSoftRefreshRef.current = true;
      setDriveRefreshNonce((n) => n + 1);
    },
    [editAppt, view, editPreviewTypeFields, editPreviewOriginalFields]
  );

  const handleViewPlacement = useCallback(
    (startUtc: string, endUtc: string) => {
      const typeId = editAppt?.appointmentType?.id;
      openEditVisitPreview(startUtc, endUtc, {
        kind: 'time',
        ...(typeId != null && Number.isFinite(Number(typeId))
          ? { appointmentTypeId: Number(typeId) }
          : {}),
      });
    },
    [openEditVisitPreview, editAppt?.appointmentType?.id]
  );

  const handlePreviewSchedule = useCallback(
    (startUtc: string, endUtc: string, appointmentTypeId: number) => {
      openEditVisitPreview(startUtc, endUtc, {
        kind: 'type',
        appointmentTypeId,
      });
    },
    [openEditVisitPreview]
  );

  const handleEditPlacementTimesChange = useCallback(
    (
      startUtc: string,
      endUtc: string,
      appointmentTypeId: number,
      kind: 'time' | 'type'
    ) => {
      if (!editAppt) return;
      const typeIdForPreview =
        kind === 'type' && editTimePreview?.appointmentTypeId != null
          ? editTimePreview.appointmentTypeId
          : appointmentTypeId;
      const preservedOriginals =
        editTimePreview?.originalAppointmentStart && editTimePreview?.originalAppointmentEnd
          ? {
              originalAppointmentStart: editTimePreview.originalAppointmentStart,
              originalAppointmentEnd: editTimePreview.originalAppointmentEnd,
              ...(editTimePreview.originalAppointmentTypeName
                ? { originalAppointmentTypeName: editTimePreview.originalAppointmentTypeName }
                : {}),
            }
          : editPreviewOriginalFields(editAppt);
      const preview = buildEditVisitTimePreview(editAppt.id, startUtc, endUtc, PRACTICE_TZ, {
        kind,
        ...editPreviewTypeFields(typeIdForPreview),
        ...preservedOriginals,
      });
      if (!preview) return;
      setEditTimePreview(preview);
      writeEditVisitTimePreview(preview);
      driveSoftRefreshRef.current = true;
      setDriveRefreshNonce((n) => n + 1);
    },
    [editAppt, editPreviewTypeFields, editPreviewOriginalFields, editTimePreview?.appointmentTypeId, editTimePreview?.originalAppointmentStart, editTimePreview?.originalAppointmentEnd, editTimePreview?.originalAppointmentTypeName]
  );

  const dismissEditPlacementPreview = useCallback(() => {
    setEditTimePreview(null);
    clearEditVisitTimePreview();
    setEditPlacementMode(false);
    setEditPreviewScoreCompare(null);
    setEditPreviewScoreError(null);
    setEditPreviewScoreLoading(false);
  }, []);

  const dismissEditPlacementPreviewOnly = useCallback(() => {
    setEditTimePreview(null);
    clearEditVisitTimePreview();
    setEditPreviewScoreCompare(null);
    setEditPreviewScoreError(null);
    setEditPreviewScoreLoading(false);
  }, []);

  const closeEditVisitModal = useCallback(() => {
    setEditTimePreview(null);
    clearEditVisitTimePreview();
    setEditPlacementMode(false);
    setEditAppt(null);
    setEditVisitLinkSelection(null);
    setEditVisitPatientSelection(null);
    setEditPreviewScoreCompare(null);
    setEditPreviewScoreError(null);
    setEditPreviewScoreLoading(false);
    setEditPreviewConfirming(false);
    setEditTimeAlignPrompt(null);
    editTimeAlignChoiceRef.current = null;
    editVisitFormSnapshotRef.current = null;
  }, []);

  const confirmEditTimeFromSlot = useCallback(async (): Promise<void> => {
    const preview = readEditVisitTimePreview() ?? editTimePreview;
    const snapshot = editVisitFormSnapshotRef.current;
    if (!preview || !snapshot || !editAppt) {
      if (!preview) {
        setToast('Preview expired — open Preview schedule again.');
      } else if (!snapshot) {
        setToast('Still preparing the visit form — try Book again in a moment.');
      } else {
        setToast('Visit editor closed — reopen the visit and try Book again.');
      }
      return;
    }
    if (Number(snapshot.appointmentId) !== Number(editAppt.id)) {
      setToast('Still preparing the visit form — try Book again in a moment.');
      return;
    }
    const formSnapshot = snapshot.snapshot;
    const scoreLine = editPreviewScoreCompare?.summaryLine;
    setEditPreviewConfirming(true);
    try {
      const typeId =
        preview.kind === 'type' && preview.appointmentTypeId != null
          ? Number(preview.appointmentTypeId)
          : formSnapshot.appointmentTypeId;
      const previewType = typeList.find((t) => Number(t.id) === typeId);
      const previewTypeFlags = appointmentFormFlags(previewType);
      const linkingClient = Boolean(editVisitLinkSelection?.clientId?.trim());
      if (previewTypeFlags.requirePatient) {
        const hasPatient =
          !appointmentHasNoPatient(editAppt) ||
          Boolean(editVisitPatientSelection?.patientId?.trim()) ||
          (linkingClient && editVisitLinkSelection?.patientId?.trim());
        const needsPatient = appointmentResolvedClientId(editAppt) != null || linkingClient;
        if (needsPatient && !hasPatient) {
          setToast('This appointment type requires a patient on the visit.');
          return;
        }
      }
      const linkValidationError = validateEditVisitLinkSelection({
        linkSelection: editVisitLinkSelection,
        visitAddress: visitAddressForLinkMatching(editAppt),
        requirePatient: previewTypeFlags.requirePatient,
      });
      if (linkValidationError) {
        setToast(linkValidationError);
        return;
      }
      const typeClientConflict = validateEditVisitAppointmentTypeClientConflict({
        appointmentType: previewType,
        hasLinkedClient:
          appointmentResolvedClientId(editAppt) != null ||
          Boolean(editVisitLinkSelection?.clientId?.trim()),
      });
      if (typeClientConflict) {
        setToast(typeClientConflict);
        return;
      }
      const patientValidationError = validateEditVisitPatientSelection({
        appt: editAppt,
        patientSelection: editVisitPatientSelection,
        slotStartIso: preview.appointmentStart,
        slotEndIso: preview.appointmentEnd,
        allAppointments: rawAppointments,
      });
      if (patientValidationError) {
        setToast(patientValidationError);
        return;
      }
      const timesUnchangedAtMinute =
        preview.kind === 'type' &&
        editVisitTimesMatchAtPracticeMinute(
          editAppt.appointmentStart,
          editAppt.appointmentEnd,
          preview.appointmentStart,
          preview.appointmentEnd,
          PRACTICE_TZ
        );
      const commitStart = timesUnchangedAtMinute
        ? editAppt.appointmentStart
        : preview.appointmentStart;
      const commitEnd = timesUnchangedAtMinute
        ? editAppt.appointmentEnd
        : preview.appointmentEnd;
      const previewTypeName =
        previewType?.name?.trim() || previewType?.prettyName?.trim() || null;
      const savedAdditionalIds = new Set(
        (editAppt.additionalEmployeeIds ??
          editAppt.additionalEmployees?.map((emp) => Number(emp.id)) ??
          []
        )
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      const formAdditionalIds = new Set(
        (formSnapshot.additionalEmployeeIds ?? [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      const additionalEmployeesUnchanged =
        savedAdditionalIds.size === formAdditionalIds.size &&
        [...savedAdditionalIds].every((id) => formAdditionalIds.has(id));
      const typeOnlyPatch =
        preview.kind === 'type' &&
        timesUnchangedAtMinute &&
        additionalEmployeesUnchanged &&
        !editVisitLinkSelection?.clientId?.trim() &&
        !editVisitPatientSelection?.patientId?.trim();

      const editChanges = detectEditVisitChanges(
        {
          description: editAppt.description,
          instructions: editAppt.instructions,
          appointmentTypeId: editAppt.appointmentType?.id,
          appointmentStart: editAppt.appointmentStart,
          appointmentEnd: editAppt.appointmentEnd,
        },
        {
          description: formSnapshot.description,
          instructions: formSnapshot.instructions,
          appointmentTypeId: typeId,
          appointmentStart: commitStart,
          appointmentEnd: commitEnd,
        }
      );

      let siblingsToAlign: Appointment[] | null = null;
      if (editChanges.includes('appt_time') && !editAppt.allDay) {
        const siblings = findHouseholdVisitsNeedingTimeAlign(
          editAppt,
          rawAppointments,
          PRACTICE_TZ,
          commitStart,
          commitEnd
        );
        if (siblings.length > 0) {
          const choice = editTimeAlignChoiceRef.current;
          if (choice == null) {
            setEditTimeAlignPrompt({
              siblings,
              startIso: commitStart,
              endIso: commitEnd,
            });
            return;
          }
          editTimeAlignChoiceRef.current = null;
          setEditTimeAlignPrompt(null);
          if (choice === 'align_all') siblingsToAlign = siblings;
        }
      }

      const updated = await commitEditVisit({
        appointmentId: Number(editAppt.id),
        practiceId: PRACTICE_ID,
        appointmentStart: commitStart,
        appointmentEnd: commitEnd,
        form: formSnapshot,
        previewAppointmentTypeId:
          preview.kind === 'type' ? preview.appointmentTypeId ?? null : null,
        appointmentTypeName: previewTypeName,
        typeOnlyPatch,
        editedByAudit: {
          actor: appointmentChangeActor,
          practiceTz: PRACTICE_TZ,
          changes: editChanges,
        },
          linkClient: commitLinkClientFromEditVisitSelection(
            editAppt,
            editVisitLinkSelection,
            {
              actor: appointmentChangeActor,
              practiceTz: PRACTICE_TZ,
            }
          ),
          assignPatient: resolveEditVisitAssignPatient(editAppt, editVisitPatientSelection),
        });
      let alignedAppointments: Appointment[] = [];
      if (siblingsToAlign?.length) {
        alignedAppointments = await alignSiblingVisitScheduledTimes({
          siblings: siblingsToAlign,
          startIso: commitStart,
          endIso: commitEnd,
          practiceId: PRACTICE_ID,
        });
      }
      if (updated?.id != null || alignedAppointments.length > 0) {
        setRawAppointments((prev) => {
          const next = [...prev];
          const apply = (row: Appointment) => {
            const idx = next.findIndex((a) => a.id === row.id);
            if (idx === -1) return;
            next[idx] = { ...next[idx], ...row };
          };
          if (updated?.id != null) apply(updated);
          for (const row of alignedAppointments) apply(row);
          return next;
        });
      }
      if (editChanges.includes('appt_time') && updated?.id != null) {
        const whenDt = DateTime.fromISO(commitStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
        resolveScheduleOptimizeQueueItems(PRACTICE_ID, {
          appointmentIds: [
            Number(editAppt.id),
            ...(siblingsToAlign ?? []).map((row) => Number(row.id)),
          ].filter((id) => Number.isFinite(id) && id > 0),
          outcome: 'rescheduled',
          note: formatScheduleOptimizeQueueActionNote({
            kind: 'rescheduled',
            whenLabel: whenDt.isValid ? whenDt.toFormat('ccc M/d h:mm a') : '',
          }),
          savingsStaff: scheduleOptimizeSavingsActor,
        });
      }
      closeEditVisitModal();
      let routingFeedbackWarning: string | undefined;
      if (editPreviewScoreCompare?.feedbackHandoff) {
        const fb = await submitEditVisitPreviewAcceptedFeedback(
          editPreviewScoreCompare.feedbackHandoff
        );
        if (!fb.submitted && fb.error) {
          routingFeedbackWarning =
            'Appointment saved, but routing score could not be linked. ' + fb.error;
        }
      }
      const typeName =
        preview.kind === 'type' && preview.appointmentTypeId != null
          ? typeList.find((t) => t.id === preview.appointmentTypeId)?.name ||
            typeList.find((t) => t.id === preview.appointmentTypeId)?.prettyName
          : null;
      const patientLabel = patientsForAppointment(updated ?? editAppt)
        .map((p) => p.name)
        .filter(Boolean)
        .join(', ');
      const bookedParts = [
        typeName ? `Saved as ${typeName}` : 'Appointment updated',
        patientLabel || clientLabel((updated ?? editAppt).client) || null,
        alignedAppointments.length > 0
          ? `aligned ${alignedAppointments.length + 1} household pets`
          : null,
        scoreLine,
        editPreviewScoreCompare?.windowLine,
      ].filter(Boolean);
      const savedId = Number((updated ?? editAppt).id);
      if (Number.isFinite(savedId) && savedId > 0) {
        pulseEditVisitHighlight(savedId);
      }
      void loadRange({ refreshDrive: true });
      setToast(routingFeedbackWarning ?? bookedParts.join(' · ') ?? 'Appointment updated.');
    } catch (e: unknown) {
      setToast(extractHttpErrorMessage(e, 'Could not save changes.'));
    } finally {
      setEditPreviewConfirming(false);
    }
  }, [
    editTimePreview,
    editAppt,
    editVisitLinkSelection,
    editVisitPatientSelection,
    closeEditVisitModal,
    loadRange,
    editPreviewScoreCompare,
    typeList,
    pulseEditVisitHighlight,
    appointmentChangeActor,
    scheduleOptimizeSavingsActor,
    embedInRoutingWorkspace,
    rawAppointments,
  ]);

  const confirmEditVisitFromPreviewPopover = useCallback(() => {
    editVisitModalRef.current?.confirmPreview?.() ?? void confirmEditTimeFromSlot();
  }, [confirmEditTimeFromSlot]);

  useEffect(() => {
    if (!editTimePreview || !editAppt) {
      setEditPreviewScoreCompare(null);
      setEditPreviewScoreError(null);
      setEditPreviewScoreLoading(false);
      return;
    }

    const practiceDateKey =
      editTimePreview.practiceDateKey ||
      appointmentPracticeDateKey(editAppt.appointmentStart, PRACTICE_TZ) ||
      '';

    if (editTimePreview.kind === 'type') {
      if (editTimePreview.appointmentTypeId == null) {
        setEditPreviewScoreCompare(null);
        setEditPreviewScoreError(null);
        setEditPreviewScoreLoading(false);
        return;
      }
    }

    let cancelled = false;
    setEditPreviewScoreLoading(true);
    setEditPreviewScoreError(null);

    const scorePromise =
      editTimePreview.kind === 'type'
        ? fetchEditVisitTypeScoreCompare({
            appt: editAppt,
            newAppointmentTypeId: editTimePreview.appointmentTypeId!,
            practiceDateKey,
            practiceTz: PRACTICE_TZ,
            providers,
            appointmentTypes: typeList,
            calendarProvider: selectedPrimaryProvider,
          })
        : fetchEditVisitTimeScoreCompare({
            appt: editAppt,
            newAppointmentStartIso: editTimePreview.appointmentStart,
            newAppointmentEndIso: editTimePreview.appointmentEnd,
            practiceDateKey,
            providers,
            calendarProvider: selectedPrimaryProvider,
          });

    void scorePromise
      .then((result) => {
        if (cancelled) return;
        setEditPreviewScoreCompare(result);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setEditPreviewScoreCompare(null);
        setEditPreviewScoreError(extractHttpErrorMessage(e, 'Could not compare routing scores.'));
      })
      .finally(() => {
        if (!cancelled) setEditPreviewScoreLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    editTimePreview?.kind,
    editTimePreview?.appointmentTypeId,
    editTimePreview?.appointmentStart,
    editTimePreview?.appointmentEnd,
    editTimePreview?.practiceDateKey,
    editAppt,
    providers,
    typeList,
    selectedPrimaryProvider,
  ]);

  useLayoutEffect(() => {
    if (editVisitHighlightIds.size === 0) {
      editVisitPostBookScrollSigRef.current = '';
      return;
    }
    if (!showTimeGrid) return;
    if (notBookedRemoveGate) return;

    const sig = [...editVisitHighlightIds].sort((a, b) => a - b).join(',');
    if (editVisitPostBookScrollSigRef.current === sig) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 240;
    const scrollTargetId = [...editVisitHighlightIds][0];

    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;
      const el = document.querySelector(`[data-appt-id="${CSS.escape(String(scrollTargetId))}"]`);
      if (!(el instanceof HTMLElement)) {
        if (attempts < maxAttempts) {
          window.setTimeout(tryScroll, 33);
        }
        return;
      }

      if (editVisitHighlightTimerRef.current == null && !householdVisitHighlightPinnedRef.current) {
        startEditVisitHighlightClearTimer(editVisitHighlightDurationMsRef.current);
      }

      scrollAppointmentElementIntoView(el, 'smooth');
      editVisitPostBookScrollSigRef.current = sig;
    };

    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [
    editVisitHighlightIds,
    loading,
    showTimeGrid,
    notBookedRemoveGate,
    filteredAppointments,
    calendarAppointments,
    allDaySpanLayout.bars.length,
    startEditVisitHighlightClearTimer,
  ]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toastDismissMsRef.current);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!calendarBlockedNotice) return;
    if (routingPreview || hasActiveRoutingCalendarPreview()) return;
    const id = window.setTimeout(() => setCalendarBlockedNotice(null), 7000);
    return () => clearTimeout(id);
  }, [calendarBlockedNotice, routingPreview]);

  const handleAppointmentContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>, appt: Appointment) => {
      if (scheduleCalendarInteractionLock) {
        e.preventDefault();
        e.stopPropagation();
        notifyScheduleCalendarLocked();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      cancelScheduledHoverPopover();
      dismissHoverPopover();
      setContextMenu({ appt, x: e.clientX, y: e.clientY });
    },
    [scheduleCalendarInteractionLock, notifyScheduleCalendarLocked, cancelScheduledHoverPopover, dismissHoverPopover]
  );

  const applyActualVisitTimeUpdate = useCallback(
    async (updated: Appointment, message: string) => {
      setRawAppointments((prev) => {
        const idx = prev.findIndex((a) => a.id === updated.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
      if (modalAppt?.id === updated.id) setModalAppt(updated);
      if (contextMenu?.appt.id === updated.id) {
        setContextMenu((m) => (m ? { ...m, appt: updated } : m));
      }
      showToast(message);
      await loadRange({ refreshDrive: true });
      await refreshForwardBookingSourceIds();
      const apptId = typeof updated.id === 'number' ? updated.id : Number(updated.id);
      if (Number.isFinite(apptId) && apptId > 0) {
        pulseEditVisitHighlight(apptId, 3000);
      }
    },
    [loadRange, modalAppt?.id, contextMenu?.appt.id, showToast, pulseEditVisitHighlight, refreshForwardBookingSourceIds]
  );

  const handleAppointmentMenuAction = useCallback(
    async (action: SchedulerContextMenuAction, appt: Appointment) => {
      setContextMenu(null);
      const patients = patientsForAppointment(appt);
      const client = appt.client;
      const firstPatient = patients[0];

      const fail = (msg: string) => showToast(msg);

      try {
        switch (action.kind) {
          case 'visitTimes':
            if (appointmentIsFutureVisit(appt, PRACTICE_TZ)) {
              fail('Start / End Visit is not available for future visits.');
              return;
            }
            void refreshForwardBookingSourceIds();
            setActualVisitModal(appt);
            return;
          case 'onMyWayText': {
            if (!client) {
              fail('No client on this appointment.');
              return;
            }
            if (!pickStr(client.phone1)) {
              fail('No phone number on file.');
              return;
            }
            setOnMyWaySmsAppt(appt);
            return;
          }
          case 'remove': {
            if (isAppointmentCancelledOnPracticeCalendar(appt)) {
              fail('This visit is already cancelled.');
              return;
            }
            setRemoveVisitModal(appt);
            return;
          }
          case 'view':
            setModalAppt(appt);
            return;
          case 'edit':
            setEditVisitLinkSelection(null);
            setEditVisitPatientSelection(null);
            setEditTimePreview(null);
            clearEditVisitTimePreview();
            setEditPlacementMode(false);
            setEditPreviewScoreCompare(null);
            setEditPreviewScoreError(null);
            setEditPreviewScoreLoading(false);
            setEditAppt(appt);
            return;
          case 'reschedule':
          case 'exploreAlternatives': {
            const explore = action.kind === 'exploreAlternatives';
            if (!appointmentIsTodayOrFuture(appt, PRACTICE_TZ)) {
              fail(
                explore
                  ? 'Visits before today cannot explore alternatives here.'
                  : 'Visits before today cannot be rescheduled here.'
              );
              return;
            }
            const buildRescheduleOpts = {
              sameCalendarDayAppointments: rawAppointments,
              providers,
              practiceTz: PRACTICE_TZ,
              exploreAlternatives: explore,
              allowAddressOnly: true,
            };
            let intent = buildRoutingRescheduleIntentFromAppointment(appt, buildRescheduleOpts);
            // Range calendar rows often set isAlternateStop without address text — load full visit.
            if (!intent && appointmentHasAlternateLocation(appt)) {
              const full = await fetchAppointmentById(appt.id, { practiceId: PRACTICE_ID });
              if (full) {
                intent = buildRoutingRescheduleIntentFromAppointment(full, buildRescheduleOpts);
                const text = appointmentAlternateAddressText(full);
                if (text) {
                  setRawAppointments((prev) => {
                    const idx = prev.findIndex((a) => a.id === appt.id);
                    if (idx === -1) return prev;
                    const next = [...prev];
                    next[idx] = {
                      ...next[idx],
                      ...full,
                      alternateAddress: { addressText: text },
                      alternateAddressText: text,
                      isAlternateStop: true,
                    } as Appointment;
                    return next;
                  });
                }
              }
            }
            if (!intent) {
              fail(
                explore
                  ? 'This visit cannot explore alternatives here (needs a linked client or a visit address, not a block).'
                  : 'This visit cannot be rescheduled here (needs a linked client or a visit address, not a block).'
              );
              return;
            }
            const calendarProviderId = resolvedPrimaryProviderId.trim();
            const calendarProvider = calendarProviderId
              ? providers.find((p) => String(p.id) === calendarProviderId)
              : undefined;
            if (calendarProviderId) {
              const pims =
                calendarProvider?.pimsId != null && String(calendarProvider.pimsId).trim()
                  ? String(calendarProvider.pimsId).trim()
                  : undefined;
              const displayName = calendarProvider?.name?.trim();
              intent = {
                ...intent,
                primaryProviderInternalId: calendarProviderId,
                sourceProviderInternalId: calendarProviderId,
                ...(pims ? { primaryDoctorPimsId: pims, sourceDoctorPimsId: pims } : {}),
                ...(displayName
                  ? { primaryDoctorDisplayName: displayName, sourceDoctorDisplayName: displayName }
                  : {}),
              };
            }
            writeRoutingRescheduleIntent(intent);
            void fetchAndCacheRescheduleSourcePlacementSnapshot(intent);
            if (embedInRoutingWorkspace) {
              applyRescheduleCalendarFocusFromIntent();
              setRescheduleIntentTick((n) => n + 1);
              showToast(
                explore
                  ? 'Alternatives: visit loaded in routing — keeping the current appointment.'
                  : 'Reschedule: visit loaded in routing — calendar shows that week and doctor.'
              );
            } else {
              const pimsRaw =
                calendarProvider?.pimsId != null ? String(calendarProvider.pimsId).trim() : '';
              writeSchedulerCalendarHandoff({
                anchorDate: intent.practiceDateKey?.trim() || anchorDate || '',
                view,
                providerFilter: calendarProviderId || intent.primaryProviderInternalId?.trim() || '',
                routingDoctorPimsId: pimsRaw || intent.primaryDoctorPimsId,
                routingDoctorLabel:
                  calendarProvider?.name?.trim() || intent.primaryDoctorDisplayName,
              });
              navigate('/schedule/routing');
            }
            return;
          }
          case 'addPet': {
            if (addAnotherPetMenuReady !== true) {
              fail('No additional pets available for this time.');
              return;
            }
            if (!appointmentSupportsAddPet(appt)) {
              fail('This appointment cannot add another pet here.');
              return;
            }
            const c = appt.client!;
            const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(PRACTICE_TZ);
            const end = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(PRACTICE_TZ);
            if (!start.isValid || !end.isValid) {
              fail('Invalid appointment time.');
              return;
            }
            const exclude = excludePatientIdsForAddPet(appt, rawAppointments, PRACTICE_TZ);
            const provId = appt.primaryProvider?.id != null ? String(appt.primaryProvider.id) : '';
            const rawTypeId = appt.appointmentType?.id;
            const typeNum =
              rawTypeId != null && (typeof rawTypeId === 'number' || typeof rawTypeId === 'string')
                ? Number(rawTypeId)
                : NaN;
            const fn = pickStr(c.firstName) ?? '';
            const ln = pickStr(c.lastName) ?? '';
            const clientLabel = [fn, ln].filter(Boolean).join(' ').trim() || undefined;
            const anchorAlternateAddress = appointmentAlternateAddressText(appt);
            setBookPrefill({
              clientId: String(c.id),
              clientLabel,
              appointmentTypeId: Number.isFinite(typeNum) ? typeNum : undefined,
              lockClient: true,
              lockProvider: true,
              // Times stay editable — lengthening the stop is common; submit prompts to align siblings.
              lockSlotTimes: false,
              preserveDurationFromSlot: true,
              coVisitAddPet: true,
              coVisitAnchorAppointmentId: Number(appt.id),
              ...(anchorAlternateAddress ? { coVisitAlternateAddress: anchorAlternateAddress } : {}),
              providerId: provId || undefined,
              excludePatientIds: exclude,
              modalTitle: 'Add another pet to this visit',
              defaultDescription: '',
            });
            setBookSlot({ start, end });
            return;
          }
          case 'addCharges': {
            const cid = pickStr(client?.pimsId);
            if (!cid) {
              fail('Client has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetQuickInvoicingLink(cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'viewChart': {
            const pid = pickStr(firstPatient?.pimsId);
            if (!pid) {
              fail('Patient has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetPatientLink(pid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'writeMedicalNote': {
            const apptPims = pickStr(appt.pimsId);
            const cid = pickStr(client?.pimsId);
            if (!apptPims || !cid) {
              fail('Appointment or client is missing a PIMS id for eVet.');
              return;
            }
            window.open(evetMedicalNoteLink(apptPims, cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'addCommunication': {
            const cid = pickStr(client?.pimsId);
            const pid = pickStr(firstPatient?.pimsId);
            if (!cid || !pid) {
              fail('Client or patient is missing a PIMS id for eVet.');
              return;
            }
            window.open(evetAddCommunicationLink(cid, pid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'viewClientInfo': {
            const cid = pickStr(client?.pimsId);
            if (!cid) {
              fail('Client has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetClientLink(cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'roomLoader': {
            if (
              schedulerRoomLoaderMenuMode(
                appt.confirmStatusName,
                null,
                roomLoaderStatusByApptId.get(Number(appt.id)) ?? null
              ) === 'view'
            ) {
              setRoomLoaderPdfModalAppt(appt);
              return;
            }
            void (async () => {
              setRoomLoaderOpening(true);
              try {
                const id = await resolveRoomLoaderIdForAppointment(appt, PRACTICE_TZ, rawAppointments);
                if (id == null) {
                  fail('Could not find or create a Room Loader for this visit.');
                  return;
                }
                setEmbeddedRoomLoaderId(id);
              } catch {
                fail('Could not open Room Loader for this visit.');
              } finally {
                setRoomLoaderOpening(false);
              }
            })();
            return;
          }
          case 'checkout': {
            const cid = pickStr(client?.pimsId);
            if (!cid) {
              fail('Client has no PIMS id (eVet link unavailable).');
              return;
            }
            window.open(evetCheckoutLink(cid), '_blank', 'noopener,noreferrer');
            return;
          }
          case 'call': {
            if (!client) {
              fail('No client on this appointment.');
              return;
            }
            const phone = action.phone === 'phone2' ? client.phone2 : client.phone1;
            if (!phone?.trim()) {
              fail('No phone number on file.');
              return;
            }
            // Match preview Call/Text: pin Quo `from` to the visit doctor's line so the
            // deep link does not inherit whatever inbox is currently active in Quo.
            const fromLine = resolveQuoFromLine({
              appointmentPrimaryProvider: appt.primaryProvider,
              providers,
            });
            window.location.href = buildPhoneDialHref(phone, { fromLine });
            return;
          }
          case 'text': {
            if (!client) {
              fail('No client on this appointment.');
              return;
            }
            const phone = action.phone === 'phone2' ? client.phone2 : client.phone1;
            if (!phone?.trim()) {
              fail('No phone number on file.');
              return;
            }
            const fromLine = resolveQuoFromLine({
              appointmentPrimaryProvider: appt.primaryProvider,
              providers,
            });
            window.location.href = buildPhoneSmsHref(phone, { fromLine });
            return;
          }
          default:
            return;
        }
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
        const m = ax?.response?.data?.message;
        if (Array.isArray(m)) fail(m.join(', '));
        else if (typeof m === 'string' && m.trim()) fail(m);
        else if (ax?.message) fail(ax.message);
        else fail('Something went wrong.');
      }
    },
    [
      loadRange,
      navigate,
      showToast,
      rawAppointments,
      addAnotherPetMenuReady,
      embedInRoutingWorkspace,
      applyActualVisitTimeUpdate,
      applyRescheduleCalendarFocusFromIntent,
      refreshForwardBookingSourceIds,
      editAppt?.id,
      providers,
      resolvedPrimaryProviderId,
      anchorDate,
      view,
      roomLoaderStatusByApptId,
    ]
  );

  const contextMenuRescheduleIntent = useMemo(() => {
    if (!contextMenu) return null;
    if (!appointmentIsTodayOrFuture(contextMenu.appt, PRACTICE_TZ)) return null;
    return buildRoutingRescheduleIntentFromAppointment(contextMenu.appt, {
      sameCalendarDayAppointments: rawAppointments,
      providers,
      allowAddressOnly: true,
    });
  }, [contextMenu, rawAppointments, providers]);

  /** Range rows may flag ALT without address text; still allow the click path to fetch + build. */
  const contextMenuMayAddressOnlyReschedule = useMemo(() => {
    if (!contextMenu) return false;
    if (!appointmentIsTodayOrFuture(contextMenu.appt, PRACTICE_TZ)) return false;
    if (contextMenuRescheduleIntent) return false;
    const appt = contextMenu.appt;
    if ((appt as { type?: string }).type === 'block') return false;
    if ((appt as { isBlock?: boolean }).isBlock === true) return false;
    if ((appt as { isPersonalBlock?: boolean }).isPersonalBlock === true) return false;
    const c = appt.client;
    const p0 = patientsForAppointment(appt)[0];
    if (c && c.id != null && p0 && p0.id != null) return false;
    return appointmentHasAlternateLocation(appt);
  }, [contextMenu, contextMenuRescheduleIntent]);

  const contextMenuRescheduleDisabledTitle = useMemo(() => {
    if (!contextMenu) return undefined;
    if (!appointmentIsTodayOrFuture(contextMenu.appt, PRACTICE_TZ)) {
      return 'Visits before today cannot be rescheduled here.';
    }
    if (!contextMenuRescheduleIntent && !contextMenuMayAddressOnlyReschedule) {
      return 'Needs a linked client or a visit address. Blocks cannot be rescheduled here.';
    }
    return undefined;
  }, [contextMenu, contextMenuRescheduleIntent, contextMenuMayAddressOnlyReschedule]);

  const addAnotherPetMenuOpts = useMemo(() => {
    if (!contextMenu || !showEmployeeAddCoVisitPet) {
      return { show: false, disabled: true as boolean, title: undefined as string | undefined };
    }
    if (!appointmentSupportsAddPet(contextMenu.appt)) {
      return { show: false, disabled: true as boolean, title: undefined as string | undefined };
    }
    const disabled = addAnotherPetMenuReady !== true;
    return { show: true, disabled, title: addPetMenuTitle(addAnotherPetMenuReady) };
  }, [contextMenu, showEmployeeAddCoVisitPet, addAnotherPetMenuReady]);

  const showEmbeddedCalendarOverlay = embedInRoutingWorkspace && (driveEtaLoading || loading);
  const showFullBleedDriveOverlay = driveEtaLoading && !embedInRoutingWorkspace;
  const showDriveLoadingOverlay = showEmbeddedCalendarOverlay || showFullBleedDriveOverlay;

  const practiceCalendarStickyWeekChrome = showTimeGrid && !embedInRoutingWorkspace;

  const weekPointsSummary = useMemo(() => {
    if (view !== 'week' || !showByDriveTime || !resolvedPrimaryProviderId.trim()) {
      return null;
    }
    let totalPoints = 0;
    let totalGoal = 0;
    let totalDriveSec = 0;
    for (const dayDt of weekDays) {
      const key = dayDt.toISODate()!;
      const dayData = driveDayByDate?.get(key);
      const dayAppts = appointmentsByDay.get(key) ?? [];
      const scheduleOverride = scheduleOverridesByDate.get(key) ?? null;
      if (
        !schedulerDayCountsForPointGoal(
          dayData,
          dayAppts,
          providerWeeklySchedules,
          key,
          scheduleOverride
        )
      ) {
        continue;
      }
      totalGoal += pointGoalForDay(dayDt);
      totalPoints += dayPoints(dayData!.households, typeCatalog);
      totalDriveSec += dayTotalDriveSeconds(dayData!);
    }
    const driveMin = Math.round(totalDriveSec / 60);
    return {
      totalPoints,
      totalGoal,
      driveMin,
      ppdh: pointsPerDriveHour(totalPoints, driveMin),
    };
  }, [
    view,
    showByDriveTime,
    resolvedPrimaryProviderId,
    weekDays,
    driveDayByDate,
    appointmentsByDay,
    typeCatalog,
    pointGoalForDay,
    providerWeeklySchedules,
    scheduleOverridesByDate,
  ]);

  const practiceRangeNav = (
          <div className="scheduler-range-above-grid-container">
          <div className="scheduler-range-above-grid">
            <div className="scheduler-range-above-grid-leading">
              <label
                className="scheduler-drive-toggle scheduler-drive-toggle--in-range-row"
                title={
                  view === 'month'
                    ? 'Switch to week or day view for drive times.'
                    : 'When on, visits use routed arrive/leave times (drive legs and ETAs), like My Week. When off, the grid uses booked appointment start and end times only.'
                }
              >
                <span className="scheduler-drive-toggle-row">
                  <input
                    type="checkbox"
                    checked={showByDriveTime}
                    disabled={view === 'month' || providers.length === 0}
                    onChange={(e) => setShowByDriveTime(e.target.checked)}
                  />
                  <span>Routed timeline</span>
                </span>
              </label>
            </div>
            <div
              className="scheduler-range-above-grid-nav"
              role="group"
              aria-label="Navigate calendar range"
            >
              <button
                type="button"
                className="scheduler-range-nav-btn"
                onClick={goPrev}
                disabled={scheduleCalendarInteractionLock}
                aria-label={
                  view === 'day' ? 'Previous day' : view === 'week' ? 'Previous week' : 'Previous month'
                }
              >
                ←
              </button>
              <div className="scheduler-range-above-grid-nav-center">
                <p className="scheduler-range-above-grid-title" role="status" aria-live="polite">
                  {rangeTitle}
                </p>
                {weekPointsSummary && weekPointsSummary.totalGoal > 0 ? (
                  <p
                    className={[
                      'scheduler-week-points-summary',
                      schedulerPointsGoalClassName(
                        weekPointsSummary.totalPoints,
                        weekPointsSummary.totalGoal,
                        'week-summary'
                      ),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <strong>Points:</strong>{' '}
                    {formatPointsAgainstGoal(
                      weekPointsSummary.totalPoints,
                      weekPointsSummary.totalGoal
                    )}
                  </p>
                ) : null}
                {weekPointsSummary?.ppdh != null ? (
                  <p
                    className="scheduler-week-ppdh"
                    title="Points per drive hour for scheduled working days this week"
                  >
                    <strong>PPDH:</strong> {formatPointsPerDriveHour(weekPointsSummary.ppdh)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="scheduler-range-nav-btn"
                onClick={goNext}
                disabled={scheduleCalendarInteractionLock}
                aria-label={view === 'day' ? 'Next day' : view === 'week' ? 'Next week' : 'Next month'}
              >
                →
              </button>
            </div>
            <div className="scheduler-range-above-grid-actions">
              {!embedInRoutingWorkspace && resolvedPrimaryProviderId.trim() ? (
                <button
                  type="button"
                  className="scheduler-optimize-btn"
                  disabled={scheduleCalendarInteractionLock}
                  title={
                    scheduleCalendarInteractionLock
                      ? 'Dismiss the calendar preview before optimizing.'
                      : 'Review points per drive hour for this week, or the next 7 days when today is on the calendar.'
                  }
                  onClick={() => {
                    if (scheduleCalendarInteractionLock) {
                      notifyScheduleCalendarLocked();
                      return;
                    }
                    setOptimizeModalOpen(true);
                  }}
                >
                  Optimize
                </button>
              ) : null}
              <div className="scheduler-view-toggle" role="group" aria-label="Calendar view">
                {(['month', 'week', 'day'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-active={view === v}
                    disabled={scheduleCalendarInteractionLock}
                    title={
                      scheduleCalendarInteractionLock
                        ? 'Dismiss the calendar preview before changing views.'
                        : routingPreview && v === 'month'
                        ? 'Month view is unavailable while a routing preview is open.'
                        : routingPreview && v === 'day' && !embedInRoutingWorkspace
                          ? 'Switch to week view to finish booking this routing preview.'
                          : undefined
                    }
                    onClick={() => {
                      if (scheduleCalendarInteractionLock) {
                        notifyScheduleCalendarLocked();
                        return;
                      }
                      setView(v);
                    }}
                  >
                    {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Day'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          </div>
  );

  const renderPracticeWeekFrozenChrome = () => (
            <div className="scheduler-calendar-frozen">
                <div className="scheduler-time-col scheduler-time-col--frozen" style={{ paddingTop: 0 }}>
                  <div
                    className="scheduler-time-col-header-spacer"
                    style={{ height: SCHEDULER_DAY_HEADER_STACK_PX, flexShrink: 0 }}
                    aria-hidden
                  />
                  <div
                    className="scheduler-time-col-allday"
                    style={{ height: allDaySpanLayout.visibleHeightPx, flexShrink: 0 }}
                  >
                    <span className="scheduler-time-col-allday-label">all-day</span>
                  </div>
                </div>
                <div className="scheduler-days-frozen">
                  <div className="scheduler-day-headers-row">
                {dayColumnDates.map((dayDt, dayIdx) => {
                  const key = dayDt.toISODate()!;
                  const dayData = driveDayByDate?.get(key);
                  const dayApptsHeader = appointmentsByDay.get(key) ?? [];
                  const scheduleOverride = scheduleOverridesByDate.get(key) ?? null;
                  const isDoctorDayOff = schedulerPracticeCalendarDayOff(
                    dayData,
                    dayApptsHeader,
                    providerWeeklySchedules,
                    key,
                    scheduleOverride
                  );
                  const isWorkingDay = schedulerDayIsWorking(
                    key,
                    dayData,
                    appointmentsByDay,
                    providerWeeklySchedules,
                    scheduleOverridesByDate
                  );
                  const hasStops = (dayData?.households?.length ?? 0) > 0;
                  const pts = dayData ? dayPoints(dayData.households, typeCatalog) : 0;
                  const pointGoal = pointGoalForDay(dayDt);
                  const revenueGoal = revenueGoalForDay(dayDt);
                  const countsForPointGoal = schedulerDayCountsForPointGoal(
                    dayData,
                    dayApptsHeader,
                    providerWeeklySchedules,
                    key,
                    scheduleOverride
                  );
                  const pointGoalDisplay = countsForPointGoal ? pointGoal : null;
                  /** Revenue goal ÷ scheduled points; optional per-doctor baseline floor and cap. */
                  const variableVsdPerPoint = (() => {
                    if (!countsForPointGoal || revenueGoal <= 0 || pts <= 0) return null;
                    let v = revenueGoal / pts;
                    const cap = Number(providerGoals?.maxVariableVsdPerPoint);
                    const baseline = Number(providerGoals?.minVariableVsdPerPoint);
                    if (Number.isFinite(cap) && cap > 0) v = Math.min(v, cap);
                    if (Number.isFinite(baseline) && baseline > 0) v = Math.max(v, baseline);
                    return v;
                  })();
                  const driveSec = dayData ? dayTotalDriveSeconds(dayData) : 0;
                  const driveMin = Math.round(driveSec / 60);
                  const driveColor = colorForDrive(driveMin);
                  const mapHouseholds =
                    hasStops && dayData
                      ? householdsInRoutingDisplayOrder(
                          dayData.households,
                          dayData.routingOrderIndices
                        )
                      : [];
                  const stops: Stop[] = mapHouseholds
                    .filter(
                      (h) =>
                        !h.isNoLocation &&
                        Number.isFinite(h.lat) &&
                        Number.isFinite(h.lon) &&
                        Math.abs(h.lat) > 1e-6 &&
                        Math.abs(h.lon) > 1e-6
                    )
                    .map((h) => ({
                      lat: h.lat,
                      lon: h.lon,
                      label: h.isPreview
                        ? previewRoutingAppointmentLabel(h.primary)
                        : h.client,
                      address: h.address,
                    }));
                  const mapsLinks = stops.length ? buildGoogleMapsLinksForDay(stops, {
                    start: dayData?.startDepot
                      ? { lat: dayData.startDepot.lat, lon: dayData.startDepot.lon }
                      : undefined,
                    end: dayData?.endDepot
                      ? { lat: dayData.endDepot.lat, lon: dayData.endDepot.lon }
                      : undefined,
                  }) : [];
                  const scheduleLoaderHref =
                    resolvedPrimaryProviderId.trim() && isWorkingDay
                      ? `/schedule/scheduling-tools/schedule-loader?targetDate=${key}&doctorId=${encodeURIComponent(resolvedPrimaryProviderId.trim())}`
                      : null;
                  const startDepot = dayData?.startDepot ?? null;
                  const officeTown =
                    (dayData?.startDepotTown?.trim() || null) ?? depotOfficeTownLabel(startDepot);
                  const offAdjoinRight = schedulerOffDayAdjoinsNext(
                    dayIdx,
                    dayColumnDates,
                    driveDayByDate,
                    appointmentsByDay,
                    isDoctorDayOff,
                    providerWeeklySchedules,
                    scheduleOverridesByDate
                  );
                  const progressEnabled = isScheduleDayOnOrBeforeToday(key, PRACTICE_TZ);
                  return (
                    <div
                      key={key}
                      className={[
                        'scheduler-day-header',
                        isDoctorDayOff ? 'scheduler-day-header--off' : '',
                        offAdjoinRight ? 'scheduler-day-off-adjoin-right' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={dayTimeColumnLayout.flexStyleForIndex(dayIdx)}
                    >
                      <div className="scheduler-day-header-date">
                        {dayDt.toFormat('ccc')}, {dayDt.month}/{dayDt.day}
                      </div>
                      <div className="scheduler-day-header-metrics">
                        {isDoctorDayOff ? (
                          <>
                            <span className="scheduler-day-off-badge" title="No shift scheduled">
                              Off
                            </span>
                            {resolvedPrimaryProviderId.trim() ? (
                              <SchedulerDayHeaderProgressButton
                                dayLabel={dayDt.toFormat('cccc, MMMM d')}
                                workday={workdayActualsByDate.get(key)}
                                disabled={!progressEnabled}
                                onClick={() => setReconcileModal({ open: true, date: key })}
                              />
                            ) : null}
                            {canManageScheduleOverrides && resolvedPrimaryProviderId.trim() ? (
                              <button
                                type="button"
                                className="scheduler-day-header-btn scheduler-day-header-adjust"
                                title={`Schedule override for ${dayDt.toFormat('cccc, MMMM d')}`}
                                onClick={() =>
                                  setScheduleOverrideModal({ open: true, date: key })
                                }
                              >
                                Override
                              </button>
                            ) : null}
                          </>
                        ) : isWorkingDay ? (
                          <>
                            <div className="scheduler-day-header-metrics-row">
                              {showByDriveTime && resolvedPrimaryProviderId.trim() ? (
                                <>
                                  <span
                                    className={schedulerPointsGoalClassName(
                                      pts,
                                      pointGoalDisplay,
                                      'day-header'
                                    )}
                                  >
                                    <strong>Points:</strong>{' '}
                                    {formatPointsAgainstGoal(pts, pointGoalDisplay)}
                                  </span>
                                  <span style={driveColor ? { color: driveColor } : undefined}>
                                    <strong>Drive:</strong> {driveMin} min
                                  </span>
                                  <span
                                    title={
                                      driveMin > 0
                                        ? 'Points per drive hour for this day’s routed drive time'
                                        : 'Points per drive hour needs drive minutes'
                                    }
                                  >
                                    <strong>PPDH:</strong>{' '}
                                    {formatPointsPerDriveHour(
                                      pointsPerDriveHour(pts, driveMin)
                                    )}
                                  </span>
                                </>
                              ) : null}
                            </div>
                            {showByDriveTime &&
                            resolvedPrimaryProviderId.trim() &&
                            canViewVariableVsd &&
                            variableVsdPerPoint != null ? (
                              <div
                                className="scheduler-day-header-vsd-per-point"
                                title={`Variable VSD per point: daily revenue goal (${formatUsdWholeDollars(
                                  revenueGoal
                                )}) ÷ ${pts} scheduled point${
                                  pts === 1 ? '' : 's'
                                }${
                                  Number(providerGoals?.minVariableVsdPerPoint) > 0
                                    ? ` (baseline ${formatUsdWholeDollars(
                                        Number(providerGoals?.minVariableVsdPerPoint)
                                      )})`
                                    : ''
                                }${
                                  Number(providerGoals?.maxVariableVsdPerPoint) > 0
                                    ? ` (capped at ${formatUsdWholeDollars(
                                        Number(providerGoals?.maxVariableVsdPerPoint)
                                      )})`
                                    : ''
                                }. Fewer points raises the target; a busy day will not go below the baseline.`}
                              >
                                <strong>VSD/pt:</strong>{' '}
                                {formatUsdWholeDollars(variableVsdPerPoint)}
                              </div>
                            ) : null}
                            {scheduleLoaderHref || mapsLinks.length > 0 || isWorkingDay ? (
                              <div className="scheduler-day-header-actions">
                                {scheduleLoaderHref ? (
                                  <a
                                    href={scheduleLoaderHref}
                                    className="scheduler-day-header-btn"
                                    title={`Open Fill for ${key}`}
                                  >
                                    Fill
                                  </a>
                                ) : null}
                                {mapsLinks.length > 0 ? (
                                  <button
                                    type="button"
                                    className="scheduler-day-header-btn"
                                    data-schedule-preview-allow="maps"
                                    title={
                                      mapsLinks.length > 1
                                        ? `Open segment 1 of ${mapsLinks.length} in Google Maps`
                                        : 'Open this day in Google Maps'
                                    }
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openUrlInNewTab(mapsLinks[0]!);
                                    }}
                                  >
                                    Maps
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="scheduler-day-header-btn scheduler-day-header-btn--icon"
                                  title={`Download My Day — Visual PDF (${dayDt.toFormat('ccc M/d')})`}
                                  aria-label={`Download My Day PDF for ${key}`}
                                  disabled={practicePdfExportingKey === key}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void exportPracticeDayMyDayPdf(key);
                                  }}
                                >
                                  <Printer size={14} strokeWidth={2} aria-hidden />
                                </button>
                              </div>
                            ) : null}
                            {officeTown ? (
                              <div className="scheduler-day-header-office">Office: {officeTown}</div>
                            ) : null}
                            {resolvedPrimaryProviderId.trim() ? (
                              <SchedulerDayHeaderProgressButton
                                dayLabel={dayDt.toFormat('cccc, MMMM d')}
                                workday={workdayActualsByDate.get(key)}
                                disabled={!progressEnabled}
                                onClick={() => setReconcileModal({ open: true, date: key })}
                              />
                            ) : null}
                            {canManageScheduleOverrides && resolvedPrimaryProviderId.trim() ? (
                              <button
                                type="button"
                                className="scheduler-day-header-btn scheduler-day-header-adjust"
                                title={`Schedule override for ${dayDt.toFormat('cccc, MMMM d')}`}
                                onClick={() =>
                                  setScheduleOverrideModal({ open: true, date: key })
                                }
                              >
                                Override
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <div className="scheduler-day-header-metrics-placeholder" aria-hidden />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className={
                  calendarFocusDim
                    ? 'scheduler-all-day-unified-outer scheduler-all-day-unified-outer--routing-preview-focus'
                    : 'scheduler-all-day-unified-outer'
                }
                style={{ height: allDaySpanLayout.visibleHeightPx }}
              >
                <div
                  className="scheduler-all-day-unified-inner"
                  style={{ height: allDaySpanLayout.contentHeightPx }}
                >
                  {dayColumnDates.map((dayDt, idx) => {
                    const leftPct = dayTimeColumnLayout.barLeftPct(idx);
                    const widthPct = dayTimeColumnLayout.barWidthPct(idx, idx);
                    const key = dayDt.toISODate() ?? String(idx);
                    return (
                      <div
                        key={key}
                        className={[
                          'scheduler-all-day-book-cell',
                          canManualBookOnCalendar ? 'scheduler-all-day-book-cell--interactive' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          height: allDaySpanLayout.contentHeightPx,
                        }}
                        onDoubleClick={() => handleAllDayDoubleClick(dayDt)}
                        aria-label={
                          canManualBookOnCalendar
                            ? `${dayDt.toFormat('cccc, MMMM d')}: double-click to book all-day appointment`
                            : undefined
                        }
                      />
                    );
                  })}
                  {allDaySpanLayout.bars.map(({ appt, s, e, lane }) => {
                    const leftPct = dayTimeColumnLayout.barLeftPct(s);
                    const widthPct = dayTimeColumnLayout.barWidthPct(s, e);
                    const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                    const topPad = SCHEDULER_ALL_DAY_PAD_Y / 2;
                    const member = appointmentPatientMember(appt);
                    const isRescheduleSourceAllDay =
                      rescheduleSourceHighlightIds != null &&
                      typeof appt.id === 'number' &&
                      rescheduleSourceHighlightIds.has(appt.id);
                    const isEditVisitActiveAllDay =
                      editAppt != null &&
                      schedulerAppointmentIdsEqual(editAppt.id, appt.id) &&
                      !schedulerAppointmentIdsEqual(editTimePreview?.appointmentId, appt.id);
                    const isEditVisitJustBookedAllDay =
                      editVisitHighlightIds.size > 0 &&
                      typeof appt.id === 'number' &&
                      editVisitHighlightIds.has(appt.id);
                    return (
                      <div
                        key={appt.id}
                        data-appt-id={appt.id != null ? String(appt.id) : undefined}
                        role="button"
                        tabIndex={0}
                        className={[
                          'scheduler-all-day-span-bar',
                          isRescheduleSourceAllDay ? 'scheduler-reschedule-source-slot' : '',
                          isEditVisitActiveAllDay ? 'scheduler-edit-visit-active-slot' : '',
                          isEditVisitJustBookedAllDay ? 'scheduler-edit-visit-booked-slot' : '',
                          isEditVisitJustBookedAllDay && onHoldVisitConvertedExitKind
                            ? 'scheduler-edit-visit-booked-slot--hold-converted'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-label={pickStr(appt.description) || schedulerEventAppointmentTitle(appt)}
                        style={{
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          top: topPad + lane * SCHEDULER_ALL_DAY_ROW_PX,
                          height: SCHEDULER_ALL_DAY_ROW_PX - 2,
                          background: apptColors.fill,
                          color: apptColors.text,
                        }}
                        onDoubleClick={(ev) => {
                          ev.stopPropagation();
                          if (scheduleCalendarInteractionLock) {
                            notifyScheduleCalendarLocked();
                            return;
                          }
                          setModalAppt(appt);
                        }}
                        onKeyDown={(ke) => {
                          if (ke.key !== 'Enter') return;
                          if (scheduleCalendarInteractionLock) {
                            notifyScheduleCalendarLocked();
                            return;
                          }
                          setModalAppt(appt);
                        }}
                        onMouseEnter={(ev) => armHoverPopover(appt, ev)}
                        onMouseMove={(ev) => trackHoverPopoverMove(appt, ev)}
                        onMouseLeave={() => endHoverPopoverForAppt(appt.id)}
                        onContextMenu={(ev) => handleAppointmentContextMenu(ev, appt)}
                      >
                        {showPreApptRoomLoaderIcon(appt) ? (
                          <div className="scheduler-appt-card-icons-tr" aria-hidden>
                            <SchedulerPreApptRlIcon
                              confirmStatusName={appt.confirmStatusName}
                              scoutUiStatus={roomLoaderStatusByApptId.get(Number(appt.id)) ?? null}
                            />
                          </div>
                        ) : null}
                        <span className="scheduler-all-day-span-bar-text">
                          <SchedulerEventTitleBlock
                            appt={appt}
                            variant="allDay"
                            forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
                </div>
              </div>
  );

  const renderPracticeWeekTimedGrid = () => (
              <div className="scheduler-calendar-scroll">
                <div className="scheduler-time-col scheduler-time-col--scroll" style={{ paddingTop: 0 }}>
                  <div style={{ height: gridHeightPx, position: 'relative', flexShrink: 0 }}>
                    {timeLabels.map(({ min, label, major }) => (
                      <div
                        key={min}
                        className="scheduler-time-slot"
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          top: (min - gridBounds.gridStartMin) * PPM,
                          height: SLOT_MINUTES * PPM,
                          borderTop: major ? '1px solid #e2e8f0' : '1px solid #f1f5f9',
                        }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="scheduler-day-bodies-scroll">
                  <div className="scheduler-day-bodies-row">
                {dayColumnDates.map((dayDt, dayIdx) => {
                  const key = dayDt.toISODate()!;
                  const dayDataCol = driveDayByDate?.get(key);
                  const dayAppts = appointmentsByDay.get(key) ?? [];
                  const scheduleOverride = scheduleOverridesByDate.get(key) ?? null;
                  const timedBase = dayAppts.filter((a) => !a.allDay);
                  const previewSyn =
                    routingPreview &&
                    routingPreviewColumnKey === key &&
                    buildRoutingPreviewSyntheticAppointment(routingPreview, typeList);
                  const timed = previewSyn ? [...timedBase, previewSyn] : timedBase;
                  const placed = assignColumnsForDay(timed, displayRangeForAppt);
                  const isDoctorDayOff = schedulerPracticeCalendarDayOff(
                    dayDataCol,
                    dayAppts,
                    providerWeeklySchedules,
                    key,
                    scheduleOverride
                  );
                  const currentTimeLineTop =
                    key === practiceTodayIso
                      ? (nowWallMinutes - gridBounds.gridStartMin) * PPM
                      : null;
                  const showCurrentTimeLine =
                    currentTimeLineTop != null &&
                    currentTimeLineTop >= 0 &&
                    currentTimeLineTop <= gridHeightPx;
                  const offAdjoinRight = schedulerOffDayAdjoinsNext(
                    dayIdx,
                    dayColumnDates,
                    driveDayByDate,
                    appointmentsByDay,
                    isDoctorDayOff,
                    providerWeeklySchedules,
                    scheduleOverridesByDate
                  );

                  return (
                    <div
                      key={key}
                      className={[
                        'scheduler-day-col',
                        isDoctorDayOff ? 'scheduler-day-col--off' : '',
                        offAdjoinRight ? 'scheduler-day-off-adjoin-right' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={dayTimeColumnLayout.flexStyleForIndex(dayIdx)}
                    >
                      <div
                        className={[
                          'scheduler-day-body',
                          isDoctorDayOff ? 'scheduler-day-body--off' : '',
                          calendarFocusDim ? 'scheduler-day-body--routing-preview-focus' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ height: gridHeightPx, position: 'relative' }}
                        onDoubleClick={(e) => handleDayBodyDoubleClick(e, dayDt)}
                        aria-label={
                          isDoctorDayOff
                            ? `${dayDt.toFormat('cccc, MMMM d')}: not scheduled`
                            : canManualBookOnCalendar
                              ? 'Day column: double-click to book an appointment'
                              : 'Day column: use Routing, My Week to book new appointments'
                        }
                      >
                        {timeLabels.map(({ min, major }) => (
                          <div
                            key={min}
                            className={`scheduler-grid-line ${major ? 'major' : ''}`}
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: (min - gridBounds.gridStartMin) * PPM,
                              height: 1,
                            }}
                          />
                        ))}
                        {calendarFocusDim ? (
                          <div className="scheduler-routing-focus-dim" aria-hidden />
                        ) : null}
                        {isDoctorDayOff ? (
                          <div className="scheduler-day-off-underlay" aria-hidden />
                        ) : null}
                        {!isDoctorDayOff &&
                        showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol?.startDepotTime?.trim() &&
                        (() => {
                          const top = schedulerDepotLineTopPx(
                            gridBounds.gridStartMin,
                            gridBounds.totalMin,
                            dayDataCol.startDepotTime
                          );
                          if (top == null) return null;
                          return (
                            <div
                              key={`depot-start-${key}`}
                              className="scheduler-day-depot-line"
                              style={{ top }}
                              title={`Leave depot (${dayDataCol.startDepotTime})`}
                              aria-hidden
                            />
                          );
                        })()}
                        {!isDoctorDayOff &&
                        showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol?.endDepotTime?.trim() &&
                        (() => {
                          const top = schedulerDepotLineTopPx(
                            gridBounds.gridStartMin,
                            gridBounds.totalMin,
                            dayDataCol.endDepotTime
                          );
                          if (top == null) return null;
                          return (
                            <div
                              key={`depot-end-${key}`}
                              className="scheduler-day-depot-line"
                              style={{ top }}
                              title={`Return to depot (${dayDataCol.endDepotTime})`}
                              aria-hidden
                            />
                          );
                        })()}
                        {!isDoctorDayOff &&
                        showByDriveTime &&
                        resolvedPrimaryProviderId.trim() &&
                        dayDataCol &&
                        (() => {
                          const layout = computeMyWeekDayColumnLayout(
                            dayDataCol,
                            weekGridMetrics,
                            key,
                            showByDriveTime,
                            dayDataCol.appointmentBufferMinutes ?? DEFAULT_APPOINTMENT_BUFFER_MINUTES,
                            // Events here are positioned from the clock, not from the layout, so
                            // shifted rows would put the bands somewhere the appointments are not.
                            { shiftRowsForDrive: false }
                          );
                          if (!layout) return null;
                          const segs = buildMyWeekDriveSegmentsFromLayout(
                            layout,
                            dayDataCol,
                            weekGridMetrics,
                            key
                          );
                          return segs.map((seg, i) => {
                            const segmentKey = `${key}-drive-${i}`;
                            const extraLine = schedulerDriveHoverExtraLine(seg, i, segs, dayDataCol);
                            return (
                              <div
                                key={`sched-drive-${key}-${i}`}
                                className="scheduler-day-drive-segment"
                                style={{
                                  top: seg.top,
                                  height: seg.height,
                                  background: seg.kind === 'buffer' ? BUFFER_STRIPE_BG : DRIVE_STRIPE_BG,
                                  border: seg.kind === 'buffer' ? BUFFER_STRIPE_BORDER : undefined,
                                }}
                                onMouseEnter={(ev) => {
                                  setDriveHoverCard({
                                    segmentKey,
                                    x: ev.clientX,
                                    y: ev.clientY,
                                    heading: seg.kind === 'buffer' ? 'Buffer' : 'Driving',
                                    body: seg.title,
                                    extraLine,
                                  });
                                }}
                                onMouseMove={(ev) => {
                                  setDriveHoverCard((prev) =>
                                    prev && prev.segmentKey === segmentKey
                                      ? { ...prev, x: ev.clientX, y: ev.clientY }
                                      : prev
                                  );
                                }}
                                onMouseLeave={() => {
                                  setDriveHoverCard((prev) =>
                                    prev?.segmentKey === segmentKey ? null : prev
                                  );
                                }}
                              />
                            );
                          });
                        })()}
                        {placed.map(({ appt, col, colCount }) => {
                          const isRoutingPreviewSlot = appt.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID;
                          const { startIso, endIso } = displayRangeForAppt(appt);
                          const sm = wallMinutes(startIso);
                          const em = wallMinutes(endIso);
                          const rawTop = (sm - gridBounds.gridStartMin) * PPM;
                          const rawH = (em - sm) * PPM;
                          const top = Math.max(0, rawTop);
                          const bottom = Math.min(gridHeightPx, rawTop + Math.max(rawH, 16));
                          const h = Math.max(18, bottom - top);
                          const durationMin = Math.max(0, em - sm);
                          const isCompactEvent =
                            durationMin > 0 && durationMin <= SCHEDULER_EVENT_COMPACT_MAX_MINUTES;
                          const wPct = 100 / colCount;
                          const leftPct = (100 * col) / colCount;
                          const apptColors = colorsForAppointment(appt, typeList, typeFillMap);
                          const member = appointmentPatientMember(appt);
                          const apptDriveHint =
                            showByDriveTime && resolvedPrimaryProviderId.trim()
                              ? buildSchedulerDriveHintForAppt(
                                  appt,
                                  showByDriveTime,
                                  resolvedPrimaryProviderId,
                                  driveDayByDate
                                )
                              : null;
                          const eventWindowLabel = schedulerEventWindowCardLabel(appt, apptDriveHint);
                          const descTrim = appt.description?.trim() ?? '';
                          if (isRoutingPreviewSlot) {
                            const previewLabel = descTrim || 'Proposed visit';
                            const previewPets = patientsForAppointment(appt);
                            const previewAria =
                              previewPets.length > 0
                                ? schedulerEventAppointmentTitle(appt)
                                : previewLabel;
                            const manualBookPreviewSlot = routingPreviewIsManualBook;
                            return (
                              <div
                                key="routing-preview-slot"
                                data-routing-preview-slot="1"
                                className={[
                                  'scheduler-event',
                                  'scheduler-routing-preview-slot',
                                  'scheduler-routing-preview-slot--in-column',
                                  manualBookPreviewSlot ? 'scheduler-manual-book-preview-slot' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                tabIndex={0}
                                aria-label={previewAria}
                                style={{
                                  top,
                                  height: h,
                                  left: `${leftPct}%`,
                                  width: `${wPct}%`,
                                }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onContextMenu={(e) => e.preventDefault()}
                                onMouseEnter={(e) => armHoverPopover(appt, e)}
                                onMouseMove={(e) => trackHoverPopoverMove(appt, e)}
                                onMouseLeave={() => endHoverPopoverForAppt(appt.id)}
                              >
                                <div className="scheduler-routing-preview-slot-default">
                                  <div
                                    className={[
                                      'scheduler-event-time',
                                      isCompactEvent ? 'scheduler-event-time--compact' : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                  >
                                    <SchedulerAlternateLocationBadgeForAppt appt={appt} compact />
                                    <SchedulerClientZoneBadge appt={appt} compact />
                                    {eventWindowLabel ? (
                                      <span className="scheduler-event-time-text">{eventWindowLabel}</span>
                                    ) : null}
                                    {isCompactEvent ? (
                                      <span
                                        className="scheduler-event-time-inline-title"
                                        title={previewAria}
                                      >
                                        {previewPets.length > 0
                                          ? schedulerEventAppointmentTitle(appt)
                                          : previewLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                  {!isCompactEvent ? (
                                    <div className="scheduler-event-title-row">
                                      {previewPets.length > 0 ? (
                                        <SchedulerEventTitleBlock
                                          appt={appt}
                                          forwardBookingSourceAppointmentIds={
                                            forwardBookingSourceAppointmentIds
                                          }
                                        />
                                      ) : (
                                        <div className="scheduler-event-title">{previewLabel}</div>
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          }
                          const isEditTimePreviewVisit =
                            editTimePreview != null && editTimePreview.appointmentId === appt.id;
                          const isRescheduleSourceVisit =
                            !isEditTimePreviewVisit &&
                            rescheduleSourceHighlightIds != null &&
                            typeof appt.id === 'number' &&
                            rescheduleSourceHighlightIds.has(appt.id);
                          const draftTypeForPreview =
                            isEditTimePreviewVisit &&
                            editTimePreview?.kind === 'type' &&
                            editTimePreview.appointmentTypeId != null
                              ? typeList.find((t) => t.id === editTimePreview.appointmentTypeId)
                              : undefined;
                          const windowWarning =
                            isEditTimePreviewVisit &&
                            editTimePreview?.kind === 'type' &&
                            editTimePreview.appointmentId === appt.id
                              ? computeEditVisitTypePreviewWindowWarning({
                                  preview: editTimePreview,
                                  draftType: draftTypeForPreview,
                                  practiceTz: PRACTICE_TZ,
                                  etaIso: apptDriveHint?.etaIso ?? null,
                                  arrivalWindowAfter: editPreviewScoreCompare?.arrivalWindowAfter,
                                  withNewTypeFeasible: editPreviewScoreCompare?.withNewTypeFeasible,
                                  withNewTypeReason: editPreviewScoreCompare?.withNewTypeReason,
                                }) || (apptDriveHint?.windowWarning ?? false)
                              : apptDriveHint?.windowWarning ?? false;
                          const isEditVisitJustBooked =
                            editVisitHighlightIds.size > 0 &&
                            typeof appt.id === 'number' &&
                            editVisitHighlightIds.has(appt.id);
                          const isEditVisitActiveSlot =
                            editAppt != null &&
                            typeof appt.id === 'number' &&
                            editAppt.id === appt.id &&
                            !isEditTimePreviewVisit &&
                            !isEditVisitJustBooked;
                          const isCalendarOnlyStaffItem = appointmentIsCalendarOnlyStaffItem(appt);
                          const canDragStaffItem =
                            canDragCalendarOnlyStaffItems &&
                            isCalendarOnlyStaffItem &&
                            !scheduleCalendarInteractionLock &&
                            !isEditTimePreviewVisit &&
                            !isRescheduleSourceVisit &&
                            !appt.allDay;
                          const isStaffItemDragging =
                            staffCalendarDrag != null &&
                            String(staffCalendarDrag.apptId) === String(appt.id);
                          const eventTop = isStaffItemDragging
                            ? Math.max(
                                0,
                                (staffCalendarDrag.liveStartMin - gridBounds.gridStartMin) * PPM
                              )
                            : top;
                          return (
                            <div
                              key={appt.id}
                              data-appt-id={appt.id != null ? String(appt.id) : undefined}
                              data-edit-time-preview={isEditTimePreviewVisit ? '1' : undefined}
                              data-edit-visit-active={isEditVisitActiveSlot ? '1' : undefined}
                              data-reschedule-source={isRescheduleSourceVisit ? '1' : undefined}
                              className={[
                                'scheduler-event',
                                isCompactEvent ? 'scheduler-event--compact' : '',
                                isEditTimePreviewVisit ? 'scheduler-edit-time-preview-slot' : '',
                                isRescheduleSourceVisit ? 'scheduler-reschedule-source-slot' : '',
                                isEditVisitActiveSlot ? 'scheduler-edit-visit-active-slot' : '',
                                isEditVisitJustBooked ? 'scheduler-edit-visit-booked-slot' : '',
                                isEditVisitJustBooked && onHoldVisitConvertedExitKind
                                  ? 'scheduler-edit-visit-booked-slot--hold-converted'
                                  : '',
                                canDragStaffItem ? 'scheduler-event--calendar-only-draggable' : '',
                                isStaffItemDragging ? 'scheduler-event--staff-dragging' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              aria-label={schedulerEventAppointmentTitle(appt)}
                              style={{
                                top: eventTop,
                                height: h,
                                left: `${leftPct}%`,
                                width: `${wPct}%`,
                                background: apptColors.fill,
                                color: apptColors.text,
                                zIndex: isStaffItemDragging ? 30 : undefined,
                              }}
                              role="button"
                              tabIndex={0}
                              onPointerDown={(e) => {
                                if (e.button !== 0 || !canDragStaffItem) return;
                                const body = (e.currentTarget as HTMLElement).closest(
                                  '.scheduler-day-body'
                                ) as HTMLElement | null;
                                if (!body) return;
                                const rect = body.getBoundingClientRect();
                                const pointerMin =
                                  gridBounds.gridStartMin + (e.clientY - rect.top) / PPM;
                                const next: StaffCalendarDragState = {
                                  apptId: appt.id,
                                  dayKey: key,
                                  durationMin: Math.max(SLOT_MINUTES, durationMin || SLOT_MINUTES),
                                  grabOffsetMin: pointerMin - sm,
                                  liveStartMin: sm,
                                  originStartMin: sm,
                                  moved: false,
                                };
                                staffCalendarDragRef.current = next;
                                staffCalendarDragMovedRef.current = false;
                                setStaffCalendarDrag(next);
                                e.currentTarget.setPointerCapture(e.pointerId);
                                dismissHoverPopover();
                              }}
                              onPointerMove={(e) => {
                                const drag = staffCalendarDragRef.current;
                                if (!drag || String(drag.apptId) !== String(appt.id)) return;
                                const body = (e.currentTarget as HTMLElement).closest(
                                  '.scheduler-day-body'
                                ) as HTMLElement | null;
                                if (!body) return;
                                const rect = body.getBoundingClientRect();
                                const pointerMin =
                                  gridBounds.gridStartMin + (e.clientY - rect.top) / PPM;
                                const liveStartMin = snapSchedulerMinutes(
                                  pointerMin - drag.grabOffsetMin,
                                  gridBounds.gridStartMin,
                                  gridBounds.gridEndMin,
                                  drag.durationMin
                                );
                                const moved =
                                  drag.moved || Math.abs(liveStartMin - drag.originStartMin) >= SLOT_MINUTES / 2;
                                const next = { ...drag, liveStartMin, moved };
                                staffCalendarDragRef.current = next;
                                if (moved) staffCalendarDragMovedRef.current = true;
                                setStaffCalendarDrag(next);
                              }}
                              onPointerUp={(e) => {
                                const drag = staffCalendarDragRef.current;
                                if (!drag || String(drag.apptId) !== String(appt.id)) return;
                                try {
                                  e.currentTarget.releasePointerCapture(e.pointerId);
                                } catch {
                                  /* already released */
                                }
                                staffCalendarDragRef.current = null;
                                setStaffCalendarDrag(null);
                                if (drag.moved) {
                                  void commitStaffCalendarDrag(drag);
                                }
                              }}
                              onPointerCancel={() => {
                                staffCalendarDragRef.current = null;
                                setStaffCalendarDrag(null);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (staffCalendarDragMovedRef.current) return;
                                if (scheduleCalendarInteractionLock && !isEditTimePreviewVisit) {
                                  notifyScheduleCalendarLocked();
                                  return;
                                }
                                if (!isEditTimePreviewVisit) setModalAppt(appt);
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter' || isEditTimePreviewVisit) return;
                                if (scheduleCalendarInteractionLock) {
                                  notifyScheduleCalendarLocked();
                                  return;
                                }
                                setModalAppt(appt);
                              }}
                              onMouseEnter={(e) => armHoverPopover(appt, e)}
                              onMouseMove={(e) => trackHoverPopoverMove(appt, e)}
                              onMouseLeave={() => endHoverPopoverForAppt(appt.id)}
                              onContextMenu={(e) => {
                                if (!isEditTimePreviewVisit) handleAppointmentContextMenu(e, appt);
                              }}
                            >
                              {showPreApptRoomLoaderIcon(appt) ? (
                                <div className="scheduler-appt-card-icons-tr" aria-hidden>
                                  <SchedulerPreApptRlIcon
                                    confirmStatusName={appt.confirmStatusName}
                                    scoutUiStatus={roomLoaderStatusByApptId.get(Number(appt.id)) ?? null}
                                  />
                                </div>
                              ) : null}
                              <div
                                className={[
                                  'scheduler-event-time',
                                  isCompactEvent ? 'scheduler-event-time--compact' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <SchedulerAlternateLocationBadgeForAppt appt={appt} compact />
                                <SchedulerClientZoneBadge appt={appt} compact />
                                {eventWindowLabel ? (
                                  <span className="scheduler-event-time-text">{eventWindowLabel}</span>
                                ) : null}
                                {isCompactEvent ? (
                                  <>
                                    <SchedulerNoPatientBadgeForAppt appt={appt} compact />
                                    <span
                                      className="scheduler-event-time-inline-title"
                                      title={schedulerEventAppointmentTitle(appt)}
                                    >
                                      {schedulerEventAppointmentTitle(appt)}
                                    </span>
                                    <SchedulerApptVisitTimesBadge
                                      appt={appt}
                                      forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
                                    />
                                    {windowWarning ? <SchedulerWindowWarningBadge compact /> : null}
                                  </>
                                ) : null}
                              </div>
                              {!isCompactEvent ? (
                                <div className="scheduler-event-title-row">
                                  <SchedulerEventTitleBlock
                                    appt={appt}
                                    forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
                                  />
                                  {windowWarning ? <SchedulerWindowWarningBadge compact /> : null}
                                </div>
                              ) : null}
                              {!isCompactEvent && descTrim ? (
                                <div className="scheduler-event-notes">
                                  {descTrim}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        {showCurrentTimeLine && (
                          <div
                            className="scheduler-current-time-line"
                            style={{ top: currentTimeLineTop! }}
                            title={practiceClock.toFormat('h:mm:ss a')}
                            aria-label={`Current time ${practiceClock.toFormat('h:mm a')}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                  </div>
                </div>
              </div>
  );
  return (
    <div
      className={[
        'scheduler-page',
        embedInRoutingWorkspace ? 'scheduler-page--embedded' : '',
        editPlacementMode && !embedInRoutingWorkspace ? 'scheduler-page--edit-placement' : '',
        routingPreview ? 'scheduler-page--routing-preview' : '',
        rescheduleWorkspaceActive ? 'scheduler-page--reschedule-focus' : '',
        calendarFocusDim ? 'scheduler-page--routing-preview-focus' : '',
        editVisitFocusDim ? 'scheduler-page--edit-visit-focus' : '',
        notBookedRemoveGate ? 'scheduler-page--not-booked-remove-gate' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {toast ? (
        <div className="scheduler-toast" role="status">
          {toast}
        </div>
      ) : null}

      {calendarBlockedNotice ? (
        <ScheduleCalendarBlockedNotice
          message={calendarBlockedNotice}
          onDismiss={() => setCalendarBlockedNotice(null)}
          actionLabel={
            routingPreview || hasActiveRoutingCalendarPreview() ? 'Dismiss preview' : undefined
          }
          onAction={
            routingPreview || hasActiveRoutingCalendarPreview()
              ? () => {
                  setCalendarBlockedNotice(null);
                  dismissRoutingPreview();
                }
              : undefined
          }
        />
      ) : null}

      {!embedInRoutingWorkspace && schedulerFocusReturnSession?.returnToGmail ? (
        <div className="scheduler-embedded-reschedule-bar" role="status" aria-live="polite">
          <span className="scheduler-embedded-reschedule-bar-badge">From email</span>
          <span className="scheduler-embedded-reschedule-bar-msg">Viewing a linked appointment</span>
          <div className="scheduler-embedded-reschedule-bar-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={returnToGmailFromSchedulerFocus}
              disabled={bookSlot != null}
            >
              Back to Email
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={dismissSchedulerFocusReturn}
              disabled={bookSlot != null}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {!embedInRoutingWorkspace &&
      !routingPreview &&
      schedulerFocusReturnSession?.returnToOptimize ? (
        <div
          className="scheduler-embedded-reschedule-bar scheduler-embedded-reschedule-bar--optimize"
          role="status"
          aria-live="polite"
        >
          <span className="scheduler-embedded-reschedule-bar-badge">Optimize</span>
          <span className="scheduler-embedded-reschedule-bar-msg">
            Viewing current appointment
            {schedulerFocusReturnSession.returnToOptimize.move?.client
              ? ` · ${schedulerFocusReturnSession.returnToOptimize.move.client}`
              : ''}
          </span>
          <div className="scheduler-embedded-reschedule-bar-actions">
            {schedulerFocusReturnSession.returnToOptimize.move ? (
              <button
                type="button"
                className="btn"
                onClick={() => void openOptimizedAppointmentFromCurrentView()}
                disabled={bookSlot != null}
              >
                View optimized appt
              </button>
            ) : null}
            <button
              type="button"
              className="btn secondary"
              onClick={returnToOptimizeFromCurrentView}
              disabled={bookSlot != null}
            >
              Back
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={dismissSchedulerFocusReturn}
              disabled={bookSlot != null}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {routingPreview && !embedInRoutingWorkspace ? (
        <div className="scheduler-routing-preview-banner" role="region" aria-label="Calendar preview">
          <div className="scheduler-routing-preview-banner-text">
            <strong>
              {routingPreviewIsScheduleLoader
                ? 'Schedule loader preview'
                : routingPreviewIsManualBook
                  ? 'Manual booking preview'
                  : routingPreviewIsOptimize
                    ? 'Optimize preview'
                    : routingPreviewIsWaitlist
                      ? 'Waitlist preview'
                      : 'Routing preview'}
            </strong>
            <span className="scheduler-routing-preview-banner-meta">
              {String(routingPreview.option.doctorName ?? 'Provider')} ·{' '}
              {DateTime.fromISO(String(routingPreview.option.date), { zone: PRACTICE_TZ }).toFormat(
                'cccc LLL d, yyyy'
              )}{' '}
              @ {DateTime.fromISO(String(routingPreview.option.suggestedStartIso)).toFormat('t')} (
              {Math.max(1, Math.floor(routingPreview.serviceMinutes) || 30)} min)
              {routingPreview.clientDisplayLabel ? (
                <span className="scheduler-routing-preview-client"> · {routingPreview.clientDisplayLabel}</span>
              ) : null}
            </span>
          </div>
          <div className="scheduler-routing-preview-banner-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={
                routingPreviewIsOptimize ? returnToOptimizeFromPreview : dismissRoutingPreview
              }
              disabled={bookSlot != null}
            >
              {routingPreviewIsScheduleLoader
                ? 'Back to Schedule Loader'
                : routingPreviewIsManualBook
                  ? 'Back to book form'
                  : routingPreviewIsOptimize
                    ? routingPreviewFromCurrentView
                      ? 'Back to current appt'
                      : 'Back to Optimize'
                    : routingPreviewIsWaitlist
                      ? 'Back to Waitlist'
                      : 'Back to routing results'}
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={[
          'scheduler-calendar-outlet',
          editPlacementMode && !embedInRoutingWorkspace ? 'scheduler-edit-placement-split' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {editPlacementMode && !embedInRoutingWorkspace ? (
          <div ref={editSidebarMountRef} className="scheduler-edit-placement-sidebar" />
        ) : null}
        <div
        className={[
          'scheduler-toolbar-calendar-merge',
          practiceCalendarStickyWeekChrome ? 'scheduler-toolbar-calendar-merge--sticky-week' : '',
          embedInRoutingWorkspace && routingPreview
            ? 'scheduler-toolbar-calendar-merge--routing-preview-halo'
            : '',
          rescheduleWorkspaceActive ? 'scheduler-toolbar-calendar-merge--reschedule-halo' : '',
          forwardBookingLockActive ? 'scheduler-toolbar-calendar-merge--forward-booking-halo' : '',
          appointmentRequestLockActive ? 'scheduler-toolbar-calendar-merge--forward-booking-halo' : '',
          editPlacementMode && !embedInRoutingWorkspace ? 'scheduler-edit-placement-main' : '',
          scheduleCalendarInteractionLock ? 'scheduler-toolbar-calendar-merge--calendar-locked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role={
          embedInRoutingWorkspace && (routingPreview || rescheduleWorkspaceActive || forwardBookingLockActive || appointmentRequestLockActive)
            ? 'region'
            : undefined
        }
        aria-label={
          embedInRoutingWorkspace && routingPreview
            ? `Routing preview: ${embeddedCalendarProviderLabel}`
            : embedInRoutingWorkspace && rescheduleWorkspaceActive
              ? exploreAlternativesActive
                ? `Looking for alternatives: ${embeddedCalendarProviderLabel}`
                : `Rescheduling: ${embeddedCalendarProviderLabel}`
              : embedInRoutingWorkspace && forwardBookingLockActive
                ? `Forward booking: ${
                    forwardBookingBarContext
                      ? forwardBookingWorkspaceContextBarLine(forwardBookingBarContext)
                      : 'Forward booking'
                  }`
                : embedInRoutingWorkspace && appointmentRequestLockActive
                  ? `Appointment request: ${appointmentRequestBarLabel}`
                  : undefined
        }
      >
        {embedInRoutingWorkspace && routingPreview ? (
          <div className="scheduler-embedded-preview-bar" role="status" aria-live="polite">
            <span className="scheduler-embedded-preview-bar-badge">Preview</span>
            <span className="scheduler-embedded-preview-bar-msg">
              {embeddedCalendarProviderLabel}
            </span>
            {readRoutingRescheduleIntent() ? (
              <button
                type="button"
                className="btn secondary scheduler-embedded-preview-bar-dismiss"
                onClick={focusRescheduleSourceOnCalendar}
                disabled={bookSlot != null}
                title="Back to where this visit is scheduled now"
              >
                Current location
              </button>
            ) : forwardBookingLockActive ? (
              <button
                type="button"
                className="btn secondary scheduler-embedded-preview-bar-dismiss scheduler-forward-booking-workspace-back"
                onClick={dismissForwardBookingWorkspace}
                disabled={bookSlot != null}
                title="Return to the forward booking list"
              >
                Back
              </button>
            ) : null}
            {!forwardBookingLockActive ? (
              <button
                type="button"
                className="btn secondary scheduler-embedded-preview-bar-dismiss"
                onClick={dismissRoutingPreview}
                disabled={bookSlot != null}
              >
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
        {forwardBookingLockActive ? (
          <div className="scheduler-embedded-forward-booking-bar" role="status" aria-live="polite">
            <span className="scheduler-embedded-forward-booking-bar-badge">Forward booking</span>
            <div className="scheduler-embedded-forward-booking-bar-msg">
              {forwardBookingBarContext ? (
                <>
                  <span className="scheduler-embedded-forward-booking-bar-line">
                    {forwardBookingWorkspaceContextBarLine(forwardBookingBarContext)}
                  </span>
                  {forwardBookingBarContext.originalVisitLabel ||
                  forwardBookingBarContext.providerLabel ? (
                    <span className="scheduler-embedded-forward-booking-bar-meta">
                      {forwardBookingBarContext.originalVisitLabel ? (
                        <>Original visit: {forwardBookingBarContext.originalVisitLabel}</>
                      ) : null}
                      {forwardBookingBarContext.originalVisitLabel &&
                      forwardBookingBarContext.providerLabel ? (
                        <span aria-hidden> · </span>
                      ) : null}
                      {forwardBookingBarContext.providerLabel ? (
                        <>Provider: {forwardBookingBarContext.providerLabel}</>
                      ) : null}
                    </span>
                  ) : null}
                  {forwardBookingBarContext.contextNote || forwardBookingBarContext.contactLog ? (
                    <ClientContactLogReadout
                      contextNote={forwardBookingBarContext.contextNote}
                      contactLog={forwardBookingBarContext.contactLog}
                    />
                  ) : null}
                </>
              ) : (
                'Forward booking'
              )}
            </div>
            <button
              type="button"
              className="btn secondary scheduler-embedded-forward-booking-bar-dismiss"
              onClick={dismissForwardBookingWorkspace}
              disabled={bookSlot != null}
            >
              Exit forward booking
            </button>
          </div>
        ) : null}
        {appointmentRequestLockActive ? (
          <div className="scheduler-embedded-forward-booking-bar" role="status" aria-live="polite">
            <span className="scheduler-embedded-forward-booking-bar-badge">Appointment request</span>
            <span className="scheduler-embedded-forward-booking-bar-msg">{appointmentRequestBarLabel}</span>
            <button
              type="button"
              className="btn secondary scheduler-embedded-forward-booking-bar-dismiss"
              onClick={dismissAppointmentRequestWorkspace}
              disabled={bookSlot != null}
            >
              Exit appointment request
            </button>
          </div>
        ) : null}
        {rescheduleWorkspaceActive ? (
          <div className="scheduler-embedded-reschedule-bar" role="status" aria-live="polite">
            <span className="scheduler-embedded-reschedule-bar-badge">
              {exploreAlternativesActive ? 'Alternatives' : 'Rescheduling'}
            </span>
            <span className="scheduler-embedded-reschedule-bar-msg">
              {exploreAlternativesActive
                ? `${embeddedCalendarProviderLabel} · keeping current appointment`
                : embeddedCalendarProviderLabel}
            </span>
            <button
              type="button"
              className="btn secondary scheduler-embedded-reschedule-bar-dismiss"
              onClick={dismissRescheduleWorkspace}
              disabled={bookSlot != null}
            >
              {rescheduleReturnsToHolds ? 'Back to Holds' : 'Dismiss'}
            </button>
          </div>
        ) : null}
      {!routingPreview && !embeddedRoutingCalendarLocked ? (
      <div className="scheduler-toolbar">
        <div className="scheduler-toolbar-row scheduler-toolbar-row--combined">
          <div className="scheduler-toolbar-cluster scheduler-toolbar-cluster--left">
            <div className="scheduler-go-date-cluster">
              <label className="scheduler-go-date-heading" htmlFor="scheduler-anchor-date">
                Go to date
              </label>
              <div className="scheduler-go-date-controls">
                <input
                  id="scheduler-anchor-date"
                  type="date"
                  value={anchorDate ?? ''}
                  onChange={(e) => onPickGoToDate(e.target.value)}
                />
                <div className="scheduler-nav scheduler-nav--today-only">
                  <button type="button" onClick={goToday}>
                    Today
                  </button>
                  <button type="button" onClick={() => setWorkZonesMapOpen(true)}>
                    Work Zones Map
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="scheduler-toolbar-cluster scheduler-toolbar-cluster--right">
            <div className="scheduler-filters">
              <label>
                Appointment type
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="">(Show all)</option>
                  {typeList.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.name || t.prettyName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Primary provider
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  disabled={Boolean(routingPreview) || providers.length === 0}
                  title={
                    routingPreview
                      ? embedInRoutingWorkspace
                        ? 'Provider is fixed for this routing preview. Dismiss the preview from the calendar slot to change.'
                        : 'Provider is fixed for this routing preview. Use Back to routing results to change.'
                      : providers.length === 0
                        ? 'Loading providers…'
                        : 'Show this doctor’s appointments only.'
                  }
                >
                  {providers.length === 0 ? (
                    <option value="">Loading providers…</option>
                  ) : (
                    providers.map((p) => (
                      <option key={String(p.id)} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      {!loading && (showTimeGrid || view === 'month') && (
        <div
          className={[
            'scheduler-calendar-shell',
            practiceCalendarStickyWeekChrome ? 'scheduler-calendar-shell--sticky-week' : '',
            view === 'day'
              ? 'scheduler-calendar-shell--day'
              : view === 'week'
                ? 'scheduler-calendar-shell--week'
                : view === 'month'
                  ? 'scheduler-calendar-shell--month'
                  : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {view === 'month' ? (
            <>
              {practiceRangeNav}
            <div className="scheduler-month-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  style={{
                    background: '#f8fafc',
                    padding: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#64748b',
                    textAlign: 'center',
                  }}
                >
                  {d}
                </div>
              ))}
              {monthCells.map((cell) => (
                <button
                  key={cell.date.toISODate()}
                  type="button"
                  className={`scheduler-month-cell ${cell.inMonth ? '' : 'muted'}`}
                  onClick={() => {
                    if (scheduleCalendarInteractionLock) {
                      notifyScheduleCalendarLocked();
                      return;
                    }
                    setAnchorDate(cell.date.toISODate()!);
                    setView('day');
                  }}
                >
                  <div className="d">{cell.date.day}</div>
                  <div className="n">{cell.count ? `${cell.count} appt` : '—'}</div>
                </button>
              ))}
            </div>
            </>
          ) : null}
          {showTimeGrid && (
          <>
          {embedInRoutingWorkspace ? practiceRangeNav : null}
          <div className="scheduler-scroll">
            <div className="scheduler-grid-wrap">
              {!embedInRoutingWorkspace ? (
              <div className="scheduler-sticky-practice-week-head">
                {practiceRangeNav}
                {renderPracticeWeekFrozenChrome()}
              </div>
              ) : (
                renderPracticeWeekFrozenChrome()
              )}
              {renderPracticeWeekTimedGrid()}
            </div>
          </div>
          </>
          )}
        </div>
      )}
      </div>
      </div>

      {loading && !embedInRoutingWorkspace && <p className="scheduler-status">Loading appointments…</p>}
      {error && <p className="scheduler-status error">{error}</p>}

      {hover &&
        hoverTooltipLayout &&
        createPortal(
          <div
            ref={hoverTooltipRef}
            className="scheduler-tooltip scheduler-tooltip--visit-highlights"
            style={{
              left: hoverTooltipLayout.pos.left,
              width: hoverTooltipLayout.pos.width,
              zIndex: editTimePreview || routingPreview || staffConfirmPreview || onHoldVisitPreview ? 2200 : 2000,
              visibility: hoverTooltipLayout.ready ? 'visible' : 'hidden',
              pointerEvents: hoverTooltipLayout.ready ? 'auto' : 'none',
              ...(hoverTooltipLayout.pos.bottom != null
                ? { top: 'auto', bottom: hoverTooltipLayout.pos.bottom }
                : { top: hoverTooltipLayout.pos.top }),
              maxWidth: hoverTooltipLayout.pos.width,
              maxHeight: hoverTooltipLayout.pos.maxCardH,
            }}
            onMouseEnter={() => {
              cancelHoverDismiss();
              hoverPinnedRef.current = true;
            }}
            onMouseLeave={() => {
              hoverPinnedRef.current = false;
              scheduleHoverDismiss(hoverAppt?.id);
            }}
          >
            <SchedulerHoverContent
              appt={hoverAppt!}
              driveHint={hoverDriveHint}
              providers={providers}
              forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
            />
          </div>,
          document.body
        )}

      {routingPreview &&
        routingPreviewPopoverPos &&
        createPortal(
          <div
            className="scheduler-edit-preview-popover-shell"
            data-schedule-preview-allow
            style={{
              position: 'fixed',
              left: routingPreviewPopoverPos.left,
              width: routingPreviewPopoverPos.width,
              maxHeight: routingPreviewPopoverPos.maxCardH,
              zIndex: 2050,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              ...(routingPreviewPopoverPos.bottom != null
                ? { top: 'auto', bottom: routingPreviewPopoverPos.bottom }
                : { top: routingPreviewPopoverPos.top }),
            }}
          >
            <RoutingPreviewSlotPopover
              preview={routingPreview}
              practiceTz={PRACTICE_TZ}
              isReschedule={routingPreviewIsReschedule}
              exploreAlternatives={exploreAlternativesActive}
              sourceVisitForCompare={reschedulePreviewSourceVisit}
              originalAppointmentStart={reschedulePreviewOriginalTimes.start}
              originalAppointmentEnd={reschedulePreviewOriginalTimes.end}
              clientContact={routingPreviewClientContact}
              bookDisabled={bookSlot != null || manualBookPreviewCommitting}
              confirmLabel={
                routingPreviewIsOptimize
                  ? undefined
                  : routingPreviewSlotOfferFlow
                    ? 'Next'
                    : undefined
              }
              onDismiss={dismissRoutingPreview}
              onBack={routingPreviewIsOptimize ? returnToOptimizeFromPreview : undefined}
              backLabel={
                routingPreviewIsOptimize
                  ? routingPreviewFromCurrentView
                    ? 'Back'
                    : 'Back to Optimize'
                  : undefined
              }
              onAddAlternative={
                routingPreviewIsOptimize ? () => openOptimizePreviewBook(true) : undefined
              }
              onAddToList={routingPreviewIsOptimize ? addOptimizePreviewToList : undefined}
              addToListDisabled={optimizePreviewOnList}
              addToListLabel="Add to List"
              onBook={() => {
                if (routingPreviewIsManualBook) {
                  void confirmManualBookFromPreview();
                } else if (routingPreviewIsOptimize) {
                  openOptimizePreviewBook(false);
                } else {
                  openRoutingBookForm();
                }
              }}
            />
          </div>,
          document.body
        )}

      {editTimePreview &&
        editPreviewPopoverPos &&
        createPortal(
          <div
            className="scheduler-edit-preview-popover-shell"
            data-schedule-preview-allow
            style={{
              position: 'fixed',
              left: editPreviewPopoverPos.left,
              width: editPreviewPopoverPos.width,
              maxHeight: editPreviewPopoverPos.maxCardH,
              zIndex: 2050,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              ...(editPreviewPopoverPos.bottom != null
                ? { top: 'auto', bottom: editPreviewPopoverPos.bottom }
                : { top: editPreviewPopoverPos.top }),
            }}
          >
            <EditVisitPreviewPopover
              preview={editTimePreview}
              practiceTz={PRACTICE_TZ}
              typeLabel={
                editTimePreview.kind === 'type'
                  ? typeList.find((t) => t.id === editTimePreview.appointmentTypeId)?.name ||
                    typeList.find((t) => t.id === editTimePreview.appointmentTypeId)?.prettyName ||
                    null
                  : null
              }
              originalAppointmentStart={
                editTimePreview.originalAppointmentStart ??
                editPreviewBookedAppt?.appointmentStart ??
                null
              }
              originalAppointmentEnd={
                editTimePreview.originalAppointmentEnd ??
                editPreviewBookedAppt?.appointmentEnd ??
                null
              }
              originalTypeLabel={
                editTimePreview.originalAppointmentTypeName ??
                editPreviewBookedAppt?.appointmentType?.prettyName ??
                editPreviewBookedAppt?.appointmentType?.name ??
                null
              }
              clientContact={editPreviewClientContact}
              scoreCompare={editPreviewScoreCompare}
              scoreLoading={editPreviewScoreLoading}
              scoreError={editPreviewScoreError}
              confirmLabel={editTimePreview.kind === 'type' ? 'Book' : 'Adjust time'}
              confirming={editPreviewConfirming}
              onConfirm={confirmEditVisitFromPreviewPopover}
              onDismiss={dismissEditPlacementPreview}
            />
          </div>,
          document.body
        )}

      {staffConfirmPreview &&
        staffConfirmApptForPopover &&
        staffConfirmPopoverPos &&
        createPortal(
          <div
            className={[
              'scheduler-edit-preview-popover-shell',
              'scheduler-staff-confirm-popover-shell',
              staffConfirmEditing ? 'scheduler-staff-confirm-popover-shell--editing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-schedule-preview-allow
            data-staff-confirm-popover
            style={{
              position: 'fixed',
              left: staffConfirmPopoverPos.left,
              width: staffConfirmPopoverPos.width,
              maxHeight: staffConfirmPopoverPos.maxCardH,
              zIndex: 2050,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              ...(staffConfirmPopoverPos.bottom != null
                ? { top: 'auto', bottom: staffConfirmPopoverPos.bottom }
                : { top: staffConfirmPopoverPos.top }),
            }}
          >
            {staffConfirmEditing ? (
              <div className="scheduler-staff-confirm-edit-pane">
                <SchedulerEditVisitModal
                  key={`${staffConfirmEditingAppt?.id}-${staffConfirmEditingAppt?.appointmentStart}-${staffConfirmEditingAppt?.appointmentEnd}`}
                  appt={staffConfirmEditingAppt ?? staffConfirmApptForPopover}
                  practiceId={PRACTICE_ID}
                  practiceTz={PRACTICE_TZ}
                  appointmentTypes={editModalAppointmentTypes}
                  providers={providers}
                  accentColor={
                    colorsForAppointment(
                      staffConfirmEditingAppt ?? staffConfirmApptForPopover,
                      typeList,
                      typeFillMap,
                    ).fill
                  }
                  inlinePaneMode
                  closeAfterSave={false}
                  hideRescheduleActions
                  cancelLabel="Back to review"
                  practiceAppointments={rawAppointments}
                  linkSelection={staffConfirmLinkSelection}
                  onLinkSelectionChange={setStaffConfirmLinkSelection}
                  linkPreferredPatientName={staffConfirmLinkPreferredPatientName}
                  patientSelection={editVisitPatientSelection}
                  onPatientSelectionChange={setEditVisitPatientSelection}
                  onClose={() => {
                    setStaffConfirmEditing(false);
                    setStaffConfirmEditingApptId(null);
                    setStaffConfirmLinkSelection(null);
                    setEditVisitPatientSelection(null);
                  }}
                  onSaved={handleStaffConfirmEditSaved}
                />
              </div>
            ) : (
              <AppointmentRequestStaffConfirmPopover
                appt={staffConfirmApptForPopover}
                practiceTz={PRACTICE_TZ}
                requestClientLabel={staffConfirmPreview.clientLabel}
                linkedClientLabel={staffConfirmLinkedClientLabel}
                isNewClient={staffConfirmPreview.isNewClient === true}
                clientContact={staffConfirmClientContact}
                householdEditChoices={staffConfirmHouseholdEditChoices}
                recommendedLength={staffConfirmRecommendedLength}
                recommendedLengthLoading={staffConfirmRecommendedLengthLoading}
                confirming={staffConfirmPreviewConfirming}
                error={staffConfirmPreviewError}
                onConfirm={() => void confirmStaffConfirmPreview()}
                onBack={dismissStaffConfirmPreview}
                onEdit={handleStaffConfirmEdit}
                onEditPet={handleStaffConfirmEditPet}
              />
            )}
          </div>,
          document.body
        )}

      {onHoldVisitPreview &&
        onHoldVisitApptForPopover &&
        onHoldVisitPopoverPos &&
        createPortal(
          <div
            className={[
              'scheduler-edit-preview-popover-shell',
              'scheduler-staff-confirm-popover-shell',
              onHoldVisitEditing ? 'scheduler-staff-confirm-popover-shell--editing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-schedule-preview-allow
            data-on-hold-visit-popover
            style={{
              position: 'fixed',
              left: onHoldVisitPopoverPos.left,
              width: onHoldVisitPopoverPos.width,
              maxHeight: onHoldVisitPopoverPos.maxCardH,
              zIndex: 2050,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              ...(onHoldVisitPopoverPos.bottom != null
                ? { top: 'auto', bottom: onHoldVisitPopoverPos.bottom }
                : { top: onHoldVisitPopoverPos.top }),
            }}
          >
            {onHoldVisitEditing ? (
              <div className="scheduler-staff-confirm-edit-pane">
                <SchedulerEditVisitModal
                  key={`${onHoldVisitEditingAppt?.id}-${onHoldVisitEditingAppt?.appointmentStart}-${onHoldVisitEditingAppt?.appointmentEnd}`}
                  appt={onHoldVisitEditingAppt ?? onHoldVisitApptForPopover}
                  practiceId={PRACTICE_ID}
                  practiceTz={PRACTICE_TZ}
                  appointmentTypes={editModalAppointmentTypes}
                  providers={providers}
                  accentColor={
                    colorsForAppointment(
                      onHoldVisitEditingAppt ?? onHoldVisitApptForPopover,
                      typeList,
                      typeFillMap,
                    ).fill
                  }
                  inlinePaneMode
                  closeAfterSave={false}
                  hideRescheduleActions
                  cancelLabel="Back to review"
                  practiceAppointments={rawAppointments}
                  linkSelection={onHoldVisitLinkSelection}
                  onLinkSelectionChange={setOnHoldVisitLinkSelection}
                  linkPreferredPatientName={onHoldVisitLinkPreferredPatientName}
                  patientSelection={editVisitPatientSelection}
                  onPatientSelectionChange={setEditVisitPatientSelection}
                  onClose={() => {
                    setOnHoldVisitEditing(false);
                    setOnHoldVisitEditingApptId(null);
                    setOnHoldVisitLinkSelection(null);
                    setEditVisitPatientSelection(null);
                  }}
                  onSaved={handleOnHoldVisitEditSaved}
                />
              </div>
            ) : onHoldVisitPreview.flowIntent === 'remove' ? (
              <OnHoldVisitRemovePopover
                appt={onHoldVisitApptForPopover}
                practiceTz={PRACTICE_TZ}
                clientLabel={onHoldVisitPreview.clientLabel}
                multiHold={(onHoldVisitPreview.removeAppointmentIds?.length ?? 0) > 1}
                confirming={onHoldVisitRemoveConfirming}
                error={onHoldVisitRemoveError}
                onBack={dismissOnHoldVisitPreview}
                onRemove={confirmOnHoldVisitRemove}
              />
            ) : onHoldVisitConvertedExitKind ? (
              <OnHoldVisitConvertedPopover
                appt={onHoldVisitApptForPopover}
                practiceTz={PRACTICE_TZ}
                clientLabel={onHoldVisitPreview.clientLabel}
                linkedClientLabel={onHoldVisitLinkedClientLabel}
                exitKind={onHoldVisitConvertedExitKind}
                recommendedLength={onHoldVisitConvertedRecommendedLength}
                recommendedLengthLoading={onHoldVisitConvertedRecommendedLengthLoading}
                onBack={completeOnHoldVisitReturn}
                onDone={completeOnHoldVisitStayOnSchedule}
                onEdit={
                  onHoldVisitConvertedExitKind === 'booked'
                    ? handleOnHoldVisitEditFromConverted
                    : undefined
                }
              />
            ) : (
              <OnHoldVisitPreviewPopover
                appt={onHoldVisitApptForPopover}
                practiceTz={PRACTICE_TZ}
                clientLabel={onHoldVisitPreview.clientLabel}
                linkedClientLabel={onHoldVisitLinkedClientLabel}
                clientContact={onHoldVisitClientContact}
                householdEditChoices={onHoldVisitHouseholdEditChoices}
                onBack={dismissOnHoldVisitPreview}
                onEdit={handleOnHoldVisitEdit}
                onEditPet={handleOnHoldVisitEditPet}
              />
            )}
          </div>,
          document.body
        )}

      {slotOfferReviewPreview &&
        slotOfferReviewApptForPopover &&
        slotOfferReviewPopoverPos &&
        createPortal(
          <div
            className="scheduler-edit-preview-popover-shell scheduler-staff-confirm-popover-shell"
            data-schedule-preview-allow
            data-slot-offer-review-popover
            style={{
              position: 'fixed',
              left: slotOfferReviewPopoverPos.left,
              width: slotOfferReviewPopoverPos.width,
              maxHeight: slotOfferReviewPopoverPos.maxCardH,
              zIndex: 2050,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              ...(slotOfferReviewPopoverPos.bottom != null
                ? { top: 'auto', bottom: slotOfferReviewPopoverPos.bottom }
                : { top: slotOfferReviewPopoverPos.top }),
            }}
          >
            <SlotOfferReviewPopover
              appt={slotOfferReviewApptForPopover}
              practiceTz={PRACTICE_TZ}
              clientLabel={slotOfferReviewPreview.clientLabel}
              confirming={slotOfferReviewConfirming}
              error={slotOfferReviewError}
              onBack={dismissSlotOfferReview}
              onReviewed={() => void confirmSlotOfferReview()}
            />
          </div>,
          document.body
        )}

      {driveHoverCard &&
        createPortal(
          (() => {
            const PADDING = 12;
            const OFFSET = 14;
            const CARD_W = 280;
            const vwW = typeof window !== 'undefined' ? window.innerWidth : 1200;
            const vwH = typeof window !== 'undefined' ? window.innerHeight : 800;
            let left = driveHoverCard.x + OFFSET;
            if (left + CARD_W > vwW - PADDING) left = vwW - PADDING - CARD_W;
            if (left < PADDING) left = PADDING;
            let top = driveHoverCard.y - 12;
            if (top + 120 > vwH - PADDING) top = vwH - PADDING - 120;
            if (top < PADDING) top = PADDING;
            return (
              <div
                className="scheduler-drive-hover-card"
                style={{
                  position: 'fixed',
                  left,
                  top,
                  zIndex: 9999,
                  minWidth: 200,
                  maxWidth: CARD_W,
                  pointerEvents: 'none',
                }}
              >
                <div className="scheduler-drive-hover-card-heading">{driveHoverCard.heading}</div>
                <div className="scheduler-drive-hover-card-body">{driveHoverCard.body}</div>
                {driveHoverCard.extraLine ? (
                  <div className="scheduler-drive-hover-card-extra">{driveHoverCard.extraLine}</div>
                ) : null}
              </div>
            );
          })(),
          document.body
        )}

      {modalApptResolved &&
        createPortal(
          <SchedulerAppointmentModal
            appt={modalApptResolved}
            driveHint={modalDriveHint}
            accentColor={colorsForAppointment(modalApptResolved, typeList, typeFillMap).fill}
            onClose={() => setModalAppt(null)}
            providers={providers}
          />,
          document.body
        )}

      <SchedulerBookModal
        open={bookSlot != null}
        slot={bookSlot}
        practiceId={PRACTICE_ID}
        practiceTz={PRACTICE_TZ}
        appointmentTypes={typeList}
        providers={providers}
        defaultProviderId={(() => {
          const id = resolvedPrimaryProviderId.trim();
          if (id) return id;
          if (providers[0]) return String(providers[0].id);
          const auth = authDoctorId?.trim();
          return auth || null;
        })()}
        prefill={bookPrefill}
        practiceAppointments={rawAppointments}
        routingLinkPreview={routingPreview}
        onPreviewOnCalendar={
          (bookPrefill?.modalTitle === MANUAL_CALENDAR_BOOK_MODAL_TITLE &&
            !bookPrefill?.allDay &&
            bookPrefill?.rescheduleAppointmentId == null &&
            !isSchedulerRoutingBookPrefill(bookPrefill)) ||
          (bookPrefill?.coVisitAddPet === true && !bookPrefill?.allDay)
            ? handleManualBookPreview
            : undefined
        }
        onClose={closeBookModal}
        onSlotOfferSent={handleSlotOfferSent}
        onViewConflictPlacement={focusHouseholdConflictOnCalendar}
        onBooked={handleSchedulerBooked}
      />

      <HouseholdScheduledVisitsWarningModal
        open={Boolean(manualBookHouseholdConflicts?.length)}
        clientLabel={routingPreview?.manualBookDraft?.clientLabel}
        conflicts={manualBookHouseholdConflicts ?? []}
        continuing={manualBookPreviewCommitting}
        onCancel={() => setManualBookHouseholdConflicts(null)}
        onViewPlacement={(row) => {
          setManualBookHouseholdConflicts(null);
          focusHouseholdConflictOnCalendar(row);
        }}
        onContinue={() => {
          manualBookHouseholdBypassRef.current = true;
          setManualBookHouseholdConflicts(null);
          void confirmManualBookFromPreview();
        }}
      />
      <EuthanasiaFutureAppointmentsModal
        open={Boolean(manualBookEuthanasiaFutureRows?.length)}
        mode="booking"
        rows={manualBookEuthanasiaFutureRows ?? []}
        patientLabel={routingPreview?.manualBookDraft?.patientLabel}
        continuing={manualBookPreviewCommitting}
        onCancel={() => {
          if (manualBookPreviewCommitting) return;
          setManualBookEuthanasiaFutureRows(null);
          pendingManualBookEuthanasiaDeletesRef.current = null;
          manualBookEuthanasiaChoiceRef.current = null;
        }}
        onKeep={() => {
          manualBookEuthanasiaChoiceRef.current = 'keep';
          setManualBookEuthanasiaFutureRows(null);
          void confirmManualBookFromPreview();
        }}
        onConfirmDelete={() => {
          manualBookEuthanasiaChoiceRef.current = 'delete';
          setManualBookEuthanasiaFutureRows(null);
          void confirmManualBookFromPreview();
        }}
      />

      <ExploreAlternativesHoldPrompt
        open={Boolean(exploreHoldPrompt)}
        holdTypes={holdAppointmentTypes}
        sourceNeedsHold={Boolean(exploreHoldPrompt?.sourceNeedsHold)}
        newNeedsHold={Boolean(exploreHoldPrompt?.newNeedsHold)}
        converting={convertingExploreHold}
        error={exploreHoldConvertError}
        onConfirm={(holdTypeId) => void convertExploreHoldTypes(holdTypeId)}
        onDismiss={() => {
          if (!convertingExploreHold) {
            setExploreHoldPrompt(null);
            setExploreHoldConvertError(null);
          }
        }}
      />

      {optimizeSmsPrompt ? (
        <ClientContactComposeModal
          open
          clientId={optimizeSmsPrompt.clientId}
          clientLabel={optimizeSmsPrompt.client}
          initialSmsMessage={buildScheduleOptimizeSmsMessage(optimizeSmsPrompt.kind, {
            petNames: optimizeSmsPrompt.petNames,
            fromDate: optimizeSmsPrompt.fromDate,
            toDate: optimizeSmsPrompt.toDate,
            fromTimeLabel: optimizeSmsPrompt.fromTimeLabel,
            toTimeLabel: optimizeSmsPrompt.toTimeLabel,
            fromWindowLabel: optimizeSmsPrompt.fromWindowLabel,
            toWindowLabel: optimizeSmsPrompt.toWindowLabel,
            originalStartIso: optimizeSmsPrompt.originalStartIso,
            newStartIso: optimizeSmsPrompt.newStartIso,
            practiceTz: PRACTICE_TZ,
          })}
          providerLastName={
            optimizeSmsPrompt.doctorName.trim().split(/\s+/).filter(Boolean).slice(-1)[0] ?? null
          }
          canText
          onClose={() => setOptimizeSmsPrompt(null)}
          onSent={() => {
            if (optimizeSmsPrompt.queueItemId) {
              markScheduleOptimizeQueueTexted(PRACTICE_ID, optimizeSmsPrompt.queueItemId);
            }
            setOptimizeSmsPrompt(null);
          }}
          smsFromLine={optimizeSmsFromLine}
          smsSource="schedule_optimization"
        />
      ) : null}

      {contextMenu ? (
        <SchedulerAppointmentContextMenu
          appt={contextMenu.appt}
          client={contextMenu.appt.client ?? undefined}
          anchorPoint={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onAction={(a) => {
            void handleAppointmentMenuAction(a, contextMenu.appt);
          }}
          showAddPet={addAnotherPetMenuOpts.show}
          addPetDisabled={addAnotherPetMenuOpts.disabled}
          addPetTitle={addAnotherPetMenuOpts.title}
          showSendForms={showPreApptRoomLoaderIcon(contextMenu.appt)}
          roomLoaderMenuLabel={schedulerRoomLoaderMenuLabel(
            contextMenu.appt.confirmStatusName,
            null,
            roomLoaderStatusByApptId.get(Number(contextMenu.appt.id)) ?? null
          )}
          rescheduleDisabled={!contextMenuRescheduleIntent && !contextMenuMayAddressOnlyReschedule}
          rescheduleDisabledTitle={contextMenuRescheduleDisabledTitle}
          removeDisabled={isAppointmentCancelledOnPracticeCalendar(contextMenu.appt)}
          removeTitle={
            isAppointmentCancelledOnPracticeCalendar(contextMenu.appt)
              ? 'This visit is already cancelled.'
              : undefined
          }
          showEditAppointment={canManualBookOnCalendar}
          visitTimesDisabled={appointmentIsFutureVisit(contextMenu.appt, PRACTICE_TZ)}
          visitTimesDisabledTitle={
            appointmentIsFutureVisit(contextMenu.appt, PRACTICE_TZ)
              ? 'Start / End Visit is not available for future visits.'
              : undefined
          }
        />
      ) : null}

      {onMyWaySmsAppt ? (
        <OnMyWaySmsModal
          appt={onMyWaySmsAppt}
          defaultMinutes={onMyWaySmsDefaultMinutes}
          providers={providers}
          practiceId={PRACTICE_ID}
          onClose={() => setOnMyWaySmsAppt(null)}
        />
      ) : null}

      {notBookedRemoveGate && notBookedRemoveAppt && notBookedRemoveHighlightIds ? (
        <NotBookedRemoveGateOverlay
          appt={notBookedRemoveAppt}
          practiceTz={PRACTICE_TZ}
          clientLabel={notBookedRemoveGate.clientLabel}
          appointmentIds={[...notBookedRemoveHighlightIds]}
          showDialog={!removeVisitModal}
          onBack={dismissNotBookedRemoveGate}
          onRemove={() => setRemoveVisitModal(notBookedRemoveAppt)}
        />
      ) : null}

      {removeVisitModal ? (
        <SchedulerRemoveVisitModal
          key={removeVisitModal.id}
          appt={removeVisitModal}
          practiceId={PRACTICE_ID}
          accentColor={colorsForAppointment(removeVisitModal, typeList, typeFillMap).fill}
          onClose={() => setRemoveVisitModal(null)}
          onRemoved={(updated) => {
            const removedId = String(updated.id);
            creditScheduleOptimizeSavingsWhenOriginalRemoved(
              PRACTICE_ID,
              [Number(updated.id)],
              scheduleOptimizeSavingsActor,
            );
            setRawAppointments((prev) => prev.filter((a) => String(a.id) !== removedId));
            setDriveIsoByApptId((prev) => {
              if (!prev) return prev;
              const m = new Map(prev);
              m.delete(removedId);
              return m;
            });
            const dayKey = dayKeyFromIso(updated.appointmentStart);
            if (dayKey) {
              setDriveDayByDate((prev) => {
                if (!prev) return prev;
                const day = prev.get(dayKey);
                if (!day) return prev;
                return new Map(prev).set(dayKey, dropAppointmentFromDriveDayData(day, updated.id));
              });
            }
            driveSoftRefreshRef.current = false;
            setDriveRefreshNonce((n) => n + 1);
            void loadRange({ refreshDrive: true });
            notifySchedulingToolsNavCountsRefresh();
            const notBookedGate = readNotBookedRemoveSession();
            if (
              notBookedGate &&
              schedulerAppointmentIdsEqual(notBookedGate.bookedAppointmentId, updated.id) &&
              isAppointmentCancelledOnPracticeCalendar(updated)
            ) {
              completeNotBookedRemoveFlow(notBookedGate);
              return;
            }
            showToast('Visit removed from the schedule.');
          }}
        />
      ) : null}

      {actualVisitModal ? (
        <SchedulerActualVisitTimeModal
          key={actualVisitModal.id}
          appt={actualVisitModal}
          field="both"
          practiceId={PRACTICE_ID}
          practiceTz={PRACTICE_TZ}
          sameCalendarDayAppointments={rawAppointments}
          forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
          forwardBookingSavedPatientIds={forwardBookingSavedPatientIds}
          accentColor={colorsForAppointment(actualVisitModal, typeList, typeFillMap).fill}
          onClose={() => setActualVisitModal(null)}
          onSaved={(updated, options) => {
            void applyActualVisitTimeUpdate(
              updated,
              options?.closeModal === false ? 'Visit times updated.' : 'Visit times saved.'
            );
            if (options?.closeModal !== false) {
              setActualVisitModal(null);
            } else {
              setActualVisitModal(updated);
            }
          }}
        />
      ) : null}

      {editTimeAlignPrompt ? (
        <HouseholdVisitTimeAlignModal
          open
          practiceTz={PRACTICE_TZ}
          newStartIso={editTimeAlignPrompt.startIso}
          newEndIso={editTimeAlignPrompt.endIso}
          addedPetName={editAppt ? appointmentPatientLabel(editAppt) : 'this pet'}
          siblings={editTimeAlignPrompt.siblings}
          saving={editPreviewConfirming}
          onCancel={() => {
            if (editPreviewConfirming) return;
            setEditTimeAlignPrompt(null);
            editTimeAlignChoiceRef.current = null;
          }}
          onChoose={(choice) => {
            editTimeAlignChoiceRef.current = choice;
            void confirmEditTimeFromSlot();
          }}
        />
      ) : null}

      {roomLoaderOpening
        ? createPortal(
            <div className="scheduler-modal-backdrop" role="status" aria-live="polite">
              <div className="scheduler-modal" style={{ maxWidth: 360 }}>
                <p className="scheduler-modal-muted" style={{ margin: 0 }}>
                  Opening Room Loader…
                </p>
              </div>
            </div>,
            document.body
          )
        : null}

      {workZonesMapOpen ? <WorkZonesMapModal onClose={() => setWorkZonesMapOpen(false)} /> : null}

      {roomLoaderPdfModalAppt ? (
        <SchedulerRoomLoaderPdfModal
          appt={roomLoaderPdfModalAppt}
          practiceTz={PRACTICE_TZ}
          accentColor={colorsForAppointment(roomLoaderPdfModalAppt, typeList, typeFillMap).fill}
          allAppointments={rawAppointments}
          onClose={() => setRoomLoaderPdfModalAppt(null)}
          onOpenDetails={(roomLoaderId) => {
            setRoomLoaderPdfModalAppt(null);
            setEmbeddedRoomLoaderId(roomLoaderId);
          }}
        />
      ) : null}

      {embeddedRoomLoaderId != null
        ? createPortal(
            <Suspense fallback={null}>
              <RoomLoaderPage
                embedded={{
                  roomLoaderId: embeddedRoomLoaderId,
                  onClose: () => {
                    setEmbeddedRoomLoaderId(null);
                    void loadRoomLoaderStatusesForRange();
                  },
                }}
              />
            </Suspense>,
            document.body
          )
        : null}

      {editApptForModal &&
        !editTimePreview &&
        createPortal(
          <SchedulerEditVisitModal
            ref={editVisitModalRef}
            key={editApptForModal.id}
            appt={editApptForModal}
            arrivalWindowLine={editArrivalWindowLine}
            practiceId={PRACTICE_ID}
            practiceTz={PRACTICE_TZ}
            appointmentTypes={editModalAppointmentTypes}
            providers={providers}
            accentColor={colorsForAppointment(editApptForModal, typeList, typeFillMap).fill}
            inlinePaneMode={editVisitInlinePaneMode}
            dockInRoutingPane={false}
            placementPreviewActive={false}
            placementPreviewKind={null}
            draftPreviewAppointmentTypeId={null}
            draftPreviewAppointmentStart={null}
            draftPreviewAppointmentEnd={null}
            typeScoreCompare={editPreviewScoreCompare}
            typeScoreLoading={editPreviewScoreLoading}
            typeScoreError={editPreviewScoreError}
            onFormSnapshotChange={(snapshot) => {
              if (!editApptForModal || !snapshot) {
                editVisitFormSnapshotRef.current = null;
                return;
              }
              editVisitFormSnapshotRef.current = {
                appointmentId: Number(editApptForModal.id),
                snapshot,
              };
            }}
            initialFormSnapshot={
              editVisitFormSnapshotRef.current?.appointmentId === Number(editApptForModal.id)
                ? editVisitFormSnapshotRef.current.snapshot
                : null
            }
            linkSelection={editVisitLinkSelection}
            onLinkSelectionChange={setEditVisitLinkSelection}
            patientSelection={editVisitPatientSelection}
            onPatientSelectionChange={setEditVisitPatientSelection}
            practiceAppointments={rawAppointments}
            onViewPlacement={handleViewPlacement}
            onPreviewSchedule={handlePreviewSchedule}
            onConfirmPreview={confirmEditTimeFromSlot}
            onPreviewBlock={setToast}
            onPlacementTimesChange={
              editPlacementMode ? handleEditPlacementTimesChange : undefined
            }
            onClose={closeEditVisitModal}
            onSaved={(updated, detail) => {
              if (updated?.id != null) {
                pulseEditVisitHighlight(Number(updated.id));
              }
              const aligned = detail?.alignedAppointments ?? [];
              if (updated?.id != null || aligned.length > 0) {
                setRawAppointments((prev) => {
                  const next = [...prev];
                  const apply = (row: Appointment) => {
                    const idx = next.findIndex((a) => a.id === row.id);
                    if (idx === -1) return;
                    next[idx] = { ...next[idx], ...row };
                  };
                  if (updated?.id != null) apply(updated);
                  for (const row of aligned) apply(row);
                  return next;
                });
              }
              void loadRange({ refreshDrive: true });
              // Converting an online auto-book HOLD via normal Edit must clear Auto-Booked.
              if (updated) {
                const submissionId = submissionIdFromOnlineHoldPimsId(
                  (updated as { pimsId?: string | null }).pimsId,
                );
                if (
                  submissionId != null &&
                  !isAppointmentCancelledOnPracticeCalendar(updated) &&
                  opsPointsForAppointment(updated, typeCatalog) > 0
                ) {
                  void (async () => {
                    try {
                      const submission = await fetchAppointmentRequestSubmission(submissionId);
                      if (appointmentRequestNeedsStaffConfirmation(submission)) {
                        await patchAppointmentRequestSubmission(submissionId, { confirm: true });
                        notifySchedulingToolsNavCountsRefresh();
                      }
                    } catch {
                      /* non-fatal */
                    }
                  })();
                }
              }
              if (detail?.routingFeedbackWarning) {
                setToast(detail.routingFeedbackWarning);
              } else if (aligned.length > 0) {
                setToast(
                  `Appointment updated · aligned ${aligned.length + 1} household pets.`
                );
              } else {
                setToast('Appointment updated.');
              }
            }}
          />,
          editPlacementMode && !embedInRoutingWorkspace && editSidebarMountEl
            ? editSidebarMountEl
            : document.body
        )}

      {showDriveLoadingOverlay ? (
        <div
          className={`scheduler-drive-overlay${embedInRoutingWorkspace ? ' scheduler-drive-overlay--embedded' : ''}`}
          role="alert"
          aria-busy="true"
          aria-live="polite"
          aria-label={driveEtaLoading ? 'Loading drive times' : 'Loading appointments'}
        >
          <div className="scheduler-drive-overlay-card">
            <div className="scheduler-drive-spinner" aria-hidden />
            <p className="scheduler-drive-overlay-text">
              {driveEtaLoading ? 'Loading drive times…' : 'Loading appointments…'}
            </p>
          </div>
        </div>
      ) : null}

      <ScheduleOverrideModal
        open={scheduleOverrideModal.open}
        onClose={() => setScheduleOverrideModal({ open: false })}
        initialEmployeeId={resolvedPrimaryProviderId.trim() || null}
        initialDate={scheduleOverrideModal.date ?? null}
        onSaved={() => {
          driveSoftRefreshRef.current = false;
          setDriveRefreshNonce((n) => n + 1);
          void loadRange({ refreshDrive: true });
        }}
      />

      {optimizeModalOpen && resolvedPrimaryProviderId.trim() ? (
        <SchedulerOptimizeModal
          open={optimizeModalOpen}
          onClose={() => setOptimizeModalOpen(false)}
          doctorId={resolvedPrimaryProviderId.trim()}
          doctorName={selectedPrimaryProvider?.name?.trim() || 'Doctor'}
          practiceTz={PRACTICE_TZ}
          practiceId={PRACTICE_ID}
          typeCatalog={typeCatalog}
          weekDates={optimizeWeekDates}
        />
      ) : null}

      {reconcileModal.open && reconcileModal.date && resolvedPrimaryProviderId.trim() ? (
        <SchedulerReconcileModal
          open={reconcileModal.open}
          onClose={() => setReconcileModal({ open: false })}
          date={reconcileModal.date}
          employeeId={resolvedPrimaryProviderId.trim()}
          practiceTz={PRACTICE_TZ}
          predictedDayData={driveDayByDate?.get(reconcileModal.date) ?? null}
          appointments={appointmentsByDay.get(reconcileModal.date) ?? []}
          appointmentTypes={typeList}
          renderVisitHighlights={(appt, driveHint) => (
            <SchedulerHoverContent
              appt={appt}
              driveHint={driveHint}
              providers={providers}
              forwardBookingSourceAppointmentIds={forwardBookingSourceAppointmentIds}
            />
          )}
          onWorkdaySaved={(row) => {
            setWorkdayActualsByDate((prev) => {
              const next = new Map(prev);
              if (row.date) next.set(row.date, row);
              return next;
            });
          }}
        />
      ) : null}
    </div>
  );
}
