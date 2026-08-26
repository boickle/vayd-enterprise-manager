/**
 * Recommended staff email signature (Gmail send-as) for the referral program.
 * Paste into Gmail Settings → See all settings → General → Signature,
 * or update each send-as alias. Link points at the public /share page.
 */
export const STAFF_REFERRAL_SHARE_PATH = '/share';

export function staffReferralSignatureHtml(portalOrigin = 'https://portal.vetatyourdoor.com'): string {
  const shareUrl = `${portalOrigin.replace(/\/+$/, '')}${STAFF_REFERRAL_SHARE_PATH}`;
  return [
    '<div>',
    '<p><strong>Your Pet Deserves a Team.</strong></p>',
    '<p>Know a pet owner who might appreciate calmer, more personal veterinary care at home?<br>',
    'As a warm welcome, their first trip fee is on us.</p>',
    `<p><a href="${shareUrl}">Share Vet at Your Door</a></p>`,
    '</div>',
  ].join('');
}

export function staffReferralSignaturePlain(portalOrigin = 'https://portal.vetatyourdoor.com'): string {
  const shareUrl = `${portalOrigin.replace(/\/+$/, '')}${STAFF_REFERRAL_SHARE_PATH}`;
  return [
    'Your Pet Deserves a Team.',
    '',
    'Know a pet owner who might appreciate calmer, more personal veterinary care at home?',
    'As a warm welcome, their first trip fee is on us.',
    '',
    `Share Vet at Your Door: ${shareUrl}`,
  ].join('\n');
}
