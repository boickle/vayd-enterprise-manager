/**
 * Marketing menu (RP-08, owner decision D3 menus, Nov 8, 2026; two links only, Nov 11):
 *   Promotions: a page with tabs Membership Promotions and Appointment Request Promotions (like Labs)
 *   Email campaigns
 * Both promotions pages used to be Admin tabs; their old links redirect here.
 */
export const MARKETING_PATH_PREFIX = '/schedule/marketing';

/** Email campaigns stay at the Marketing root so existing campaign links keep working. */
export const EMAIL_CAMPAIGNS_PATH = MARKETING_PATH_PREFIX;

export const MEMBERSHIP_PROMOTIONS_PATH = `${MARKETING_PATH_PREFIX}/membership-promotions`;

export const APPOINTMENT_REQUEST_PROMOTIONS_PATH = `${MARKETING_PATH_PREFIX}/appointment-request-promotions`;

/** The menu's Promotions link opens the first tab. */
export const PROMOTIONS_PATH = MEMBERSHIP_PROMOTIONS_PATH;

export function isMarketingNavPath(pathname: string): boolean {
  return pathname === MARKETING_PATH_PREFIX || pathname.startsWith(`${MARKETING_PATH_PREFIX}/`);
}

export function isPromotionsNavPath(pathname: string): boolean {
  return (
    pathname.startsWith(MEMBERSHIP_PROMOTIONS_PATH) ||
    pathname.startsWith(APPOINTMENT_REQUEST_PROMOTIONS_PATH)
  );
}

/** Email campaigns: the Marketing root and campaign pages, but not the promotions pages. */
export function isEmailCampaignsNavPath(pathname: string): boolean {
  return isMarketingNavPath(pathname) && !isPromotionsNavPath(pathname);
}
