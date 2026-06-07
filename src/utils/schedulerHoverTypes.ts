/** Drive-time fields for Visit Highlights (calendar + progress modal). */
export type SchedulerHoverDriveHint = {
  practiceTz: string;
  etaIso: string | null;
  etdIso: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  schedStartIso: string | null;
  schedEndIso: string | null;
  isPersonalBlock: boolean;
  isFixedTime: boolean;
  windowWarning: boolean;
};
