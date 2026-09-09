/**
 * Google Tag Manager container bootstrap.
 * GA4 page views / appointment_form_* events still go through gtag in analytics.ts.
 * Do not add a second GA4 Configuration tag in GTM or page views will double-count.
 */

declare global {
  interface Window {
    dataLayer: any[];
  }
}

const gtmContainerId = import.meta.env.VITE_GTM_CONTAINER_ID as string | undefined;

export function getGtmContainerId(): string | undefined {
  const id = gtmContainerId?.trim();
  return id && /^GTM-[A-Z0-9]+$/i.test(id) ? id : undefined;
}

export function ensureDataLayer(): any[] {
  if (typeof window === 'undefined') return [];
  window.dataLayer = window.dataLayer || [];
  return window.dataLayer;
}

/** Standard GTM snippet + noscript iframe. Safe to call more than once. */
export function initGtm(containerId = getGtmContainerId()): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const id = containerId?.trim();
  if (!id || !/^GTM-[A-Z0-9]+$/i.test(id)) return;
  if (document.getElementById('gtm-script')) return;

  const dataLayer = ensureDataLayer();
  dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const script = document.createElement('script');
  script.id = 'gtm-script';
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);

  if (document.body && !document.getElementById('gtm-noscript')) {
    const noscript = document.createElement('noscript');
    noscript.id = 'gtm-noscript';
    noscript.innerHTML = `<iframe src="https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(
      id,
    )}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`;
    document.body.insertBefore(noscript, document.body.firstChild);
  }
}

export function pushGtmEvent(
  eventName: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  const dataLayer = ensureDataLayer();
  const payload: Record<string, unknown> = { event: eventName };
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      payload[key] = value;
    }
  }
  dataLayer.push(payload);
}

export function pushAppSurface(
  pathname: string,
  surface: 'public' | 'staff',
): void {
  pushGtmEvent('app_surface', {
    app_surface: surface,
    page_path: pathname,
  });
}
