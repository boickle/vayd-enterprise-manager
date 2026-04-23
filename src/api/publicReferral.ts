// src/api/publicReferral.ts
import axios from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

/** No JWT — same base URL as surveys; do not use `http` (it attaches Authorization when logged in). */
const publicReferralClient = axios.create({ baseURL, withCredentials: false });

/**
 * Anonymous “refer a friend” (static link, no survey token).
 *
 * **Backend:** implement `POST /public/referral` (public, no auth). Suggested body matches authenticated
 * `POST /referral` (`email`, `name` = friend) plus who is referring:
 * - `referrerEmail` (required): must match an existing client account to credit referrals, if that is your rule
 * - `referrerName` (optional): for notification/email copy
 *
 * Returns 201/200 with a small JSON body or 4xx with `{ message: string }` like other public routes.
 */
export type PublicReferralRequest = {
  referrerEmail: string;
  referrerName?: string;
  /** Friend’s email — same as `POST /referral` body field `email`. */
  email: string;
  /** Friend’s name — same as `POST /referral` body field `name`. */
  name: string;
};

export type PublicReferralResponse = {
  message?: string;
};

export async function submitPublicReferral(body: PublicReferralRequest): Promise<PublicReferralResponse> {
  const { data } = await publicReferralClient.post<PublicReferralResponse>('/public/referral', {
    referrerEmail: body.referrerEmail.trim(),
    ...(body.referrerName != null && String(body.referrerName).trim()
      ? { referrerName: String(body.referrerName).trim() }
      : {}),
    email: body.email.trim(),
    name: String(body.name).trim(),
  });
  return data ?? {};
}
