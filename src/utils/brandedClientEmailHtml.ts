/** Matches API `wrapBrandedEmailHtml` — logo header + body for client-facing email. */
export function brandedClientEmailLogoUrl(): string {
  const base =
    typeof window !== 'undefined' && window.location.hostname === 'localhost'
      ? 'https://portal.vetatyourdoor.com'
      : `${window.location.origin}`.replace(/\/+$/, '');
  return `${base}/final_thick_lines_cropped.jpeg`;
}

export function brandedClientEmailLogoBlock(brandName = 'Vet At Your Door'): string {
  const logoUrl = brandedClientEmailLogoUrl();
  if (!logoUrl) return '';
  return `<div style="text-align: center; margin-bottom: 28px;">
  <img src="${logoUrl}" alt="${brandName}" style="max-width: 180px; width: auto; height: auto; display: block; margin: 0 auto;" />
</div>`;
}

export function wrapBrandedClientEmailHtml(bodyHtml: string, brandName = 'Vet At Your Door'): string {
  const logo = brandedClientEmailLogoBlock(brandName);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  ${logo}
  ${bodyHtml}
</body>
</html>`;
}
