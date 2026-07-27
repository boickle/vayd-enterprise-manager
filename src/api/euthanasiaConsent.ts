import axios from 'axios';
import { http, apiBaseUrl } from './http';

const publicClient = axios.create({ baseURL: apiBaseUrl, withCredentials: false });

export type EuthanasiaConsentVariant = 'southern' | 'cv';

export type EuthanasiaConsentPrefill = {
  clientFirstName: string | null;
  clientLastName: string | null;
  email: string | null;
  petName: string | null;
  petWeightLbs: string | null;
  doctorDisplayName: string | null;
};

export type EuthanasiaConsentFormPayload = {
  variant: EuthanasiaConsentVariant;
  allowAshHomeDelivery: boolean;
  alreadySubmitted: boolean;
  prefill: EuthanasiaConsentPrefill;
};

export type SendEuthanasiaConsentRequest = {
  variant: EuthanasiaConsentVariant;
  appointmentId: number;
  email?: string;
  allowAshHomeDelivery?: boolean;
  skipEmail?: boolean;
  doctorDisplayName?: string;
  prefill?: Record<string, unknown>;
};

export type SendEuthanasiaConsentResult = {
  inviteId: number;
  formUrl: string;
  sentTo: string | null;
  skippedEmail: boolean;
};

export type SubmitEuthanasiaConsentRequest = {
  token: string;
  formData: Record<string, unknown>;
  signatureDataUrl: string;
  signerName?: string;
  paymentIntentId?: string;
  clayPawQuantity?: number;
  clayPawAmountCents?: number;
};

/** Clay paw print unit price (southern / Final Gift). */
export const CLAY_PAW_UNIT_CENTS = 8025;

export function getPublicEuthanasiaConsentFormPath(token: string): string {
  return `/public/euthanasia-consent/form?token=${encodeURIComponent(token)}`;
}

export async function sendEuthanasiaConsent(
  body: SendEuthanasiaConsentRequest
): Promise<SendEuthanasiaConsentResult> {
  const { data } = await http.post<SendEuthanasiaConsentResult>('/euthanasia-consent/send', body);
  return data;
}

export async function fetchEuthanasiaConsentForm(
  token: string
): Promise<EuthanasiaConsentFormPayload> {
  const { data } = await publicClient.get<EuthanasiaConsentFormPayload>(
    '/public/euthanasia-consent/form',
    { params: { token } }
  );
  return data;
}

export async function submitEuthanasiaConsent(
  body: SubmitEuthanasiaConsentRequest
): Promise<{ submissionId: number }> {
  const { data } = await publicClient.post<{ submissionId: number }>(
    '/public/euthanasia-consent/submit',
    body
  );
  return data;
}
